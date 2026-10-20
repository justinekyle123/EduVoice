"use client";

// The voice layer of the manual quiz: it reads each card aloud, opens the
// microphone after the reading, and turns what the student says into the answer
// for that card. Tapping and typing stay in QuizUI — this hook never touches the
// answer buttons.
//
// The manual quiz keeps its navigation, so the narration follows the card on
// screen: every question change (and every "Play question") starts that card's
// clip, and moving on stops the previous one. The microphone is only opened once
// the clip has ended, which is simpler and safer than listening over it: the
// read-aloud can never be graded as the answer.

import { useCallback, useEffect, useRef, useState } from "react";
import { useSpeechRecognition } from "@/features/chat/hooks/useSpeechRecognition";
import { detectLanguage, speechLangFor } from "@/features/chat/lib/detect";
import { resolveSpokenAnswer } from "@/features/rooms/lib/voiceAnswer";
import { questionNarration } from "../lib/narration";
import type { SafeQuestion } from "../server/actions";

/** Quiet time after the last heard word before the answer is taken. */
const AUTO_SUBMIT_MS = 900;
/** A clip that never reports its end must not hold the card. */
const CLIP_CAP_MS = 45_000;
/** A live synthesis that never comes back must not hold the card. */
const TTS_TIMEOUT_MS = 30_000;

function join(...parts: string[]): string {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
}

export type QuestionVoice = {
  /** The browser can listen at all. */
  supported: boolean;
  /** A recognizer is open right now. */
  listening: boolean;
  /** The browser refused the microphone; stop retrying. */
  blocked: boolean;
  error: { code: string; message: string } | null;
  /** The question's clip (or live synthesis) is playing. */
  reading: boolean;
  /** The student's latest words, interim or final. */
  heard: string;
  /** Something worth telling the student (audio unavailable, unclear answer). */
  notice: string | null;
  /** The microphone is wanted on this card. */
  micOn: boolean;
  /** A voice answer was taken; the mic waits for the student to resume. */
  paused: boolean;
  /** Play the card again from the start. */
  repeat: () => void;
  /** Reopen the microphone after an answer was taken. */
  resume: () => void;
  /** Stop the reading and the microphone (before a verdict line, or on submit). */
  stop: () => void;
};

/**
 * Read the current card and listen for its answer.
 *
 * `onAnswer` receives the card and the answer mapped onto it (an exact option
 * for choice questions, the student's words for short answers). Return `false`
 * when the answer cannot be used — the card keeps listening and shows a notice.
 */
export function useQuestionVoice({
  active,
  quizId,
  question,
  position,
  total,
  onAnswer,
}: {
  active: boolean;
  quizId: string | null;
  question: SafeQuestion | null;
  position: number;
  total: number;
  onAnswer: (question: SafeQuestion, answer: string) => boolean;
}): QuestionVoice {
  const [reading, setReading] = useState(false);
  // Keyed by question, so turning to another card starts it unpaused without a
  // setState in an effect.
  const [pausedFor, setPausedFor] = useState<string | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [heard, setHeard] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [micSession, setMicSession] = useState(0);
  const [repeatNonce, setRepeatNonce] = useState(0);

  // A card is paused only while it is the one that was just answered (or
  // stopped). Turning to another card is automatically unpaused.
  const paused = question !== null && pausedFor === question.id;

  const questionRef = useRef<SafeQuestion | null>(question);
  const readingRef = useRef(false);
  const pausedRef = useRef<string | null>(null);
  const activeRef = useRef(active);
  const tokenRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ttsAbortRef = useRef<AbortController | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const quietRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftRef = useRef("");
  const onAnswerRef = useRef(onAnswer);
  const langFallbackRef = useRef<string | null>(null);

  useEffect(() => {
    questionRef.current = question;
  }, [question]);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);
  useEffect(() => {
    onAnswerRef.current = onAnswer;
  });

  const clearQuiet = useCallback(() => {
    if (quietRef.current) {
      clearTimeout(quietRef.current);
      quietRef.current = null;
    }
  }, []);

  const stopAudio = useCallback(() => {
    tokenRef.current += 1;
    const audio = audioRef.current;
    audioRef.current = null;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
    }
    ttsAbortRef.current?.abort();
    ttsAbortRef.current = null;
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    readingRef.current = false;
    setReading(false);
  }, []);

  /** Play one card: its clip, or the same words synthesized live. */
  const playQuestion = useCallback(
    async (card: SafeQuestion, at: number, count: number) => {
      stopAudio();
      const token = ++tokenRef.current;
      readingRef.current = true;
      setReading(true);
      setNotice(null);
      draftRef.current = "";
      setHeard("");

      const spoken = questionNarration(card, at, count);

      const playUrl = (url: string) =>
        new Promise<void>((resolve, reject) => {
          const audio = new Audio(url);
          audioRef.current = audio;
          let settled = false;
          const finish = (error?: Error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            audio.onended = null;
            audio.onerror = null;
            if (audioRef.current === audio) audioRef.current = null;
            if (error) reject(error);
            else resolve();
          };
          const timer = setTimeout(() => finish(new Error("clip timed out")), CLIP_CAP_MS);
          audio.onended = () => finish();
          audio.onerror = () => finish(new Error("clip failed"));
          void audio.play().catch(() => finish(new Error("clip blocked")));
        });

      const speak = async (text: string) => {
        const controller = new AbortController();
        ttsAbortRef.current = controller;
        const timer = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS);
        try {
          const res = await fetch("/api/chat/speech", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
            signal: controller.signal,
          });
          if (!res.ok) throw new Error("speech failed");
          const url = URL.createObjectURL(await res.blob());
          objectUrlRef.current = url;
          await playUrl(url);
        } finally {
          clearTimeout(timer);
          if (ttsAbortRef.current === controller) ttsAbortRef.current = null;
        }
      };

      try {
        if (quizId && card.audioFile) {
          try {
            await playUrl(`/api/quiz/${quizId}/audio/${card.audioFile}`);
          } catch {
            if (token !== tokenRef.current) return;
            await speak(spoken);
          }
        } else {
          await speak(spoken);
        }
      } catch {
        if (token !== tokenRef.current) return;
        setNotice("The question audio could not be played, but you can still answer.");
      }

      if (token !== tokenRef.current) return;
      readingRef.current = false;
      setReading(false);
    },
    [quizId, stopAudio]
  );

  // Start the card (and every repeat of it) as soon as it is on screen.
  useEffect(() => {
    if (!active || !question) return;
    void playQuestion(question, position, total);
    return () => {
      stopAudio();
      clearQuiet();
    };
  }, [active, question, position, total, repeatNonce, playQuestion, stopAudio, clearQuiet]);

  const takeAnswer = useCallback(() => {
    const card = questionRef.current;
    if (
      !card ||
      !activeRef.current ||
      readingRef.current ||
      pausedRef.current === card.id
    ) {
      return;
    }
    const transcript = join(draftRef.current, micRef.current.getInterim());
    if (!transcript) return;

    const resolved = resolveSpokenAnswer(card, transcript);
    const choice = (card.options?.length ?? 0) > 0;
    if (choice && resolved.source === "verbatim") {
      clearQuiet();
      setNotice(`I heard “${transcript}”. Say the letter, or tap an option.`);
      return;
    }

    if (!onAnswerRef.current(card, resolved.answer)) return;

    clearQuiet();
    draftRef.current = "";
    setHeard(transcript);
    pausedRef.current = card.id;
    setPausedFor(card.id);
    micRef.current.abort();
  }, [clearQuiet]);

  function isPaused() {
    const card = questionRef.current;
    return card !== null && pausedRef.current === card.id;
  }

  function handleSpoken(finalText: string) {
    const text = finalText.trim();
    if (!text || !activeRef.current || readingRef.current || isPaused()) return;
    draftRef.current = join(draftRef.current, text);
    setHeard(draftRef.current);
    clearQuiet();
    quietRef.current = setTimeout(takeAnswer, AUTO_SUBMIT_MS);
  }

  function handleInterim(interimText: string) {
    if (!activeRef.current || readingRef.current || isPaused()) return;
    const shown = join(draftRef.current, interimText);
    if (!shown) return;
    setHeard(shown);
    clearQuiet();
    quietRef.current = setTimeout(takeAnswer, AUTO_SUBMIT_MS);
  }

  const {
    supported,
    listening,
    blocked,
    error,
    start: startMic,
    abort: abortMic,
    clearError,
    clearInterim,
    getInterim,
  } = useSpeechRecognition(handleSpoken, handleInterim);

  const micRef = useRef<{ abort: () => void; getInterim: () => string }>({
    abort: () => {},
    getInterim: () => "",
  });
  useEffect(() => {
    micRef.current = { abort: abortMic, getInterim };
  }, [abortMic, getInterim]);

  const canListen = supported && !blocked && error?.code !== "not-allowed";

  // Open the microphone once the reading has finished. The card's own words are
  // never in the recognizer's buffer, so no echo filtering is needed here.
  useEffect(() => {
    if (!active || !question || reading || paused || !micOn || !canListen) {
      abortMic();
      return;
    }

    let lang = speechLangFor(detectLanguage(question.question));
    if (error?.code === "language-not-supported") {
      if (langFallbackRef.current === question.id) {
        abortMic();
        return;
      }
      langFallbackRef.current = question.id;
      lang = "en-US";
    }

    startMic(lang, { continuous: true, keepInterim: true });
    return () => abortMic();
  }, [
    active,
    question,
    reading,
    paused,
    micOn,
    canListen,
    error,
    micSession,
    startMic,
    abortMic,
  ]);

  // Chrome ends a recognition session on silence; reopen it while the card waits.
  useEffect(() => {
    if (!active || !question || reading || paused || !micOn || !canListen || listening) {
      return;
    }
    if (quietRef.current) return;
    if (error?.code === "language-not-supported" && langFallbackRef.current === question.id) {
      return;
    }
    const timer = setTimeout(() => setMicSession((session) => session + 1), 500);
    return () => clearTimeout(timer);
  }, [
    active,
    question,
    reading,
    paused,
    micOn,
    canListen,
    listening,
    error,
    micSession,
  ]);

  const repeat = useCallback(() => setRepeatNonce((nonce) => nonce + 1), []);

  const resume = useCallback(() => {
    pausedRef.current = null;
    setPausedFor(null);
    setNotice(null);
    clearError();
    setMicOn(true);
    setMicSession((session) => session + 1);
  }, [clearError]);

  const stop = useCallback(() => {
    const id = questionRef.current?.id ?? null;
    pausedRef.current = id;
    setPausedFor(id);
    clearQuiet();
    stopAudio();
    micRef.current.abort();
  }, [clearQuiet, stopAudio]);

  // A new card starts a fresh recognition buffer, not the previous card's words.
  // (The transcript itself is cleared by `playQuestion` when the card starts.)
  useEffect(() => {
    clearInterim();
    draftRef.current = "";
  }, [question?.id, clearInterim]);

  return {
    supported,
    listening,
    blocked,
    error,
    reading,
    heard,
    notice,
    micOn,
    paused,
    repeat,
    resume,
    stop,
  };
}
