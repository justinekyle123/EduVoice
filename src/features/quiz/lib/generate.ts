import { generateText } from "@/lib/ai";

// Quiz generation lives on the free tier: one request produces a whole quiz, and
// it rides the same rotating AI Studio key pool the chat uses (./lib/ai/keys.ts),
// so a single exhausted account can't take quiz writing down.

export type QuestionType = "multiple_choice" | "true_false" | "short_answer";

export type GeneratedQuestion = {
  question: string;
  type: QuestionType;
  options: string[] | null;
  correctAnswer: string;
  explanation: string | null;
};

export type GeneratedQuiz = {
  title: string;
  questions: GeneratedQuestion[];
  /** Which AI Studio key slot answered, recorded for diagnostics. */
  provider: string;
};

const QUESTION_TYPES: QuestionType[] = [
  "multiple_choice",
  "true_false",
  "short_answer",
];

const SYSTEM_INSTRUCTION = `You are EduVoice's quiz writer for students.
Write clear, unambiguous questions that test understanding rather than trivia.
Base every question on well-established facts.
Return JSON only — no commentary, no markdown fences.`;

function buildPrompt(topic: string, count: number) {
  return `Write ${count} quiz questions about "${topic}".

Return JSON in exactly this shape:
{
  "title": "short quiz title",
  "questions": [
    {
      "question": "the question text",
      "type": "multiple_choice",
      "options": ["A", "B", "C", "D"],
      "correctAnswer": "A",
      "explanation": "one sentence on why that answer is right"
    }
  ]
}

Rules:
- "type" is one of: multiple_choice, true_false, short_answer
- use mostly multiple_choice, at most two true_false, at most one short_answer
- multiple_choice: exactly 4 options, and "correctAnswer" must match one option verbatim
- true_false: "options" is ["True", "False"] and "correctAnswer" is "True" or "False"
- short_answer: "options" is [] and "correctAnswer" is a short phrase of at most 6 words
- "explanation" is one sentence, at most 200 characters
- vary which option holds the correct answer instead of always using the first`;
}

/** Pull the JSON body out of a reply that may carry prose or ``` fences. */
function extractJson(text: string): unknown {
  const withoutFences = text.replace(/```(?:json)?/gi, "");
  const start = withoutFences.indexOf("{");
  const end = withoutFences.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("The quiz writer did not return usable JSON");
  }
  try {
    return JSON.parse(withoutFences.slice(start, end + 1));
  } catch {
    throw new Error("The quiz writer returned malformed JSON");
  }
}

function asText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Validate one raw question. Returns null for anything malformed rather than
 * throwing, so one bad item doesn't discard an otherwise good quiz.
 */
function normalizeQuestion(raw: unknown): GeneratedQuestion | null {
  if (typeof raw !== "object" || raw === null) return null;
  const item = raw as Record<string, unknown>;

  const question = asText(item.question);
  const rawType = asText(item.type);
  const correctAnswer = asText(item.correctAnswer);
  if (!question || !rawType || !correctAnswer) return null;

  const type = rawType.toLowerCase().replace(/[\s-]+/g, "_") as QuestionType;
  if (!QUESTION_TYPES.includes(type)) return null;

  const explanation = asText(item.explanation);
  const rawOptions = Array.isArray(item.options)
    ? item.options.map(asText).filter((option): option is string => option !== null)
    : [];

  if (type === "multiple_choice") {
    if (rawOptions.length < 2) return null;
    // Snap the answer onto the exact option text so grading can compare strings.
    const match = rawOptions.find(
      (option) => normalize(option) === normalize(correctAnswer)
    );
    if (!match) return null;
    return { question, type, options: rawOptions, correctAnswer: match, explanation };
  }

  if (type === "true_false") {
    const normalized = normalize(correctAnswer);
    if (normalized !== "true" && normalized !== "false") return null;
    const answer = normalized === "true" ? "True" : "False";
    return { question, type, options: ["True", "False"], correctAnswer: answer, explanation };
  }

  // short_answer: keep the first option off entirely so the UI has one shape.
  return { question, type, options: null, correctAnswer, explanation };
}

/**
 * Parse and validate a raw model reply. Exported so the parsing rules can be
 * exercised without spending an AI request.
 */
export function parseQuizReply(text: string): {
  title: string | null;
  questions: GeneratedQuestion[];
} {
  const parsed = extractJson(text);
  const body = parsed as Record<string, unknown>;
  const rawQuestions = Array.isArray(body.questions) ? body.questions : [];

  return {
    title: asText(body.title),
    // Malformed items are dropped individually so one bad question doesn't
    // throw away an otherwise usable quiz.
    questions: rawQuestions
      .map(normalizeQuestion)
      .filter((question): question is GeneratedQuestion => question !== null),
  };
}

/** Derive a quiz title from the topic when the model didn't supply one. */
export function titleFromTopic(topic: string) {
  return topic.length > 60 ? `${topic.slice(0, 60).trimEnd()}…` : topic;
}

export async function generateQuizQuestions(input: {
  topic: string;
  count: number;
}): Promise<GeneratedQuiz> {
  const { text, provider } = await generateText({
    prompt: buildPrompt(input.topic, input.count),
    systemInstruction: SYSTEM_INSTRUCTION,
    json: true,
  });

  const { title, questions } = parseQuizReply(text);

  if (questions.length === 0) {
    throw new Error("The quiz writer did not return any usable questions");
  }

  return {
    title: title ?? titleFromTopic(input.topic),
    questions,
    provider,
  };
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

/**
 * Short answers are graded loosely on purpose: a student who writes a fuller
 * sentence containing the expected phrase is right, and spelling casing or
 * surrounding punctuation shouldn't decide a score.
 */
export function isAnswerCorrect(
  type: QuestionType,
  expected: string,
  given: string
): boolean {
  const expectedNorm = normalize(expected);
  const givenNorm = normalize(given);
  if (givenNorm.length === 0) return false;
  if (expectedNorm === givenNorm) return true;

  if (type === "short_answer" && expectedNorm.length >= 4) {
    return givenNorm.includes(expectedNorm);
  }

  return false;
}
