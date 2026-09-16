import {
  Briefcase,
  Lightbulb,
  MessageCircle,
  Swords,
  type LucideIcon,
} from "lucide-react";
import { EDUVOICE_SYSTEM_INSTRUCTION } from "@/lib/ai/persona";

export type ChatMode = "chat" | "hint" | "debate" | "interview";

export type ChatModeMeta = {
  id: ChatMode;
  label: string;
  icon: LucideIcon;
  description: string;
  instruction: string;
};

export const chatModes: ChatModeMeta[] = [
  {
    id: "chat",
    label: "Chat",
    icon: MessageCircle,
    description: "Ask anything, get answers in your language",
    instruction: EDUVOICE_SYSTEM_INSTRUCTION,
  },
  {
    id: "hint",
    label: "Hint",
    icon: Lightbulb,
    description: "Guided clues — you solve it yourself",
    instruction:
      EDUVOICE_SYSTEM_INSTRUCTION +
      `\n\nCURRENT MODE: HINT MODE. Never give the full answer directly. Give ONE progressive clue at a time and ask the student to try again. Only reveal the full solution after the student has attempted at least three times or explicitly asks you to check their final answer.`,
  },
  {
    id: "debate",
    label: "Debate",
    icon: Swords,
    description: "Argue your stance against the AI",
    instruction:
      EDUVOICE_SYSTEM_INSTRUCTION +
      `\n\nCURRENT MODE: DEBATE MODE. Take the OPPOSING stance on the student's chosen topic. Challenge each of their arguments with a counterpoint and a follow-up question. Stay respectful and encourage them to defend their position with evidence.`,
  },
  {
    id: "interview",
    label: "Interview",
    icon: Briefcase,
    description: "Practice a real job interview by voice",
    instruction:
      EDUVOICE_SYSTEM_INSTRUCTION +
      `\n\nCURRENT MODE: INTERVIEW MODE. Act as a job interviewer. If the student has not named a target role, ask which role they are practicing for. Then ask ONE interview question at a time. After their answer, give brief feedback on clarity, relevance, and confidence, then ask the next question.`,
  },
];

/**
 * Extra rules for hands-free voice turns.
 *
 * Spoken replies have to be short and read well out loud: a four-paragraph
 * answer takes half a minute to say and buries the point the student asked
 * about. Short replies are also what makes voice mode feel responsive, since
 * every sentence is synthesized as soon as the model writes it.
 */
export const VOICE_MODE_INSTRUCTION = `You are speaking out loud in a live voice conversation with the student.
- Reply in ONE short spoken turn: at most 3 or 4 sentences, then stop.
- No lists, headings, tables, Markdown or code blocks — plain spoken sentences only.
- Answer the question first; add at most one short example if it truly helps.
- Write things the way they are said aloud ("two thirds", "x squared", "around five kilometres").
- Never describe your formatting or mention that this is voice mode.`;

export function instructionFor(mode: ChatMode): string {
  return (
    chatModes.find((m) => m.id === mode)?.instruction ??
    EDUVOICE_SYSTEM_INSTRUCTION
  );
}

/** System instruction for a spoken turn: mode rules plus the voice rules. */
export function voiceInstructionFor(mode: ChatMode): string {
  return `${instructionFor(mode)}\n\n${VOICE_MODE_INSTRUCTION}`;
}