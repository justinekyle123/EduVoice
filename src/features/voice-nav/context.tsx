"use client";

// Voice Navigation Mode (feature 6.14) — the engine behind the whole feature.
//
// The provider sits above the dashboard and owns one continuous speech
// recognition session. Every finished utterance is turned into a command and
// dispatched: open a page ("go to the quiz"), run a screen action registered by
// the current page ("upload a document"), drive the visible interface ("click
// three", "next", "select"), or read the page aloud. Spoken feedback goes
// through the same speech engine the tutor uses (feature 6.1), and recognition
// pauses while EduVoice talks so it never hears itself.
//
// Everything the student can say is documented in lib/commands.ts.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { DEFAULT_TTS_VOICE } from "@/features/chat/lib/voices";
import { useSpeechRecognition } from "@/features/chat/hooks/useSpeechRecognition";
import { useSpeechSynthesis } from "@/features/chat/hooks/useSpeechSynthesis";
import { getSpeechEngine } from "@/features/chat/lib/speechEngine";
import {
  speechLangFor,
  type DetectedLanguage,
} from "@/features/chat/lib/detect";
import { matchPageCommand, parseVoiceCommand } from "./lib/commands";
import {
  activateTarget,
  collectClickTargets,
  targetAtIndex,
  targetByName,
  type ClickTarget,
} from "./lib/targets";
import {
  readEnabled,
  readLang,
  serverEnabled,
  serverLang,
  subscribeSettings,
  writeEnabled,
  writeLang,
} from "./lib/settings";

export type VoiceNavPhase = "off" | "listening" | "thinking" | "speaking";

/** A screen-specific action, registered by the page currently on display. */
export type PageCommand = {
  id: string;
  description: string;
  /** Spoken/typed phrases that trigger the action. */
  phrases: string[];
  /** Confirmation read back after the action runs (falls back to description). */
  spoken?: string;
  run: () => void | Promise<void>;
};

export type VoiceNavApi = {
  /** Voice navigation is on and listening. */
  enabled: boolean;
  /** The browser supports speech recognition at all. */
  supported: boolean;
  /** The browser refused the microphone — the student must allow it. */
  blocked: boolean;
  phase: VoiceNavPhase;
  /** Ready-to-show sentence describing what is happening right now. */
  status: string;
  /** Last command heard, verbatim. */
  heard: string;
  /** Last thing EduVoice said back. */
  feedback: string;
  /** Command that could not be understood, or a recognition warning. */
  notice: string | null;
  panelOpen: boolean;
  language: DetectedLanguage;
  /** Interactive elements currently on screen ("click 3"). */
  targets: ClickTarget[];
  /** Highlighted target index for "next" / "previous" / "select". */
  cursor: number | null;
  pageCommands: PageCommand[];
  toggle: () => void;
  setEnabled: (on: boolean) => void;
  setPanelOpen: (open: boolean) => void;
  setLanguage: (lang: DetectedLanguage) => void;
  refreshTargets: () => ClickTarget[];
  activateIndex: (index: number) => void;
  registerPageCommands: (id: string, commands: PageCommand[]) => void;
  unregisterPageCommands: (id: string) => void;
};

const VoiceNavContext = createContext<VoiceNavApi | null>(null);

export function useVoiceNav(): VoiceNavApi {
  const value = useContext(VoiceNavContext);
  if (!value) {
    throw new Error("useVoiceNav must be used inside <VoiceNavProvider>");
  }
  return value;
}

/** How far a "scroll up/down" command moves the page. */
const SCROLL_STEP = 0.8;
/** Characters read aloud by "read the page" before it stops. */
const READ_BUDGET = 700;

export function VoiceNavProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  // Preferences live in localStorage; the external store restores them without
  // an effect that would cascade renders.
  const enabled = useSyncExternalStore(subscribeSettings, readEnabled, serverEnabled);
  const language = useSyncExternalStore(subscribeSettings, readLang, serverLang);

  const [panelOpen, setPanelOpen] = useState(false);
  const [heard, setHeard] = useState("");
  const [feedback, setFeedback] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [targets, setTargets] = useState<ClickTarget[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [pageCommands, setPageCommands] = useState<PageCommand[]>([]);

  const {
    speaking,
    speak,
    stop: stopSpeaking,
  } = useSpeechSynthesis();

  const handleCommandRef = useRef<(text: string) => void>(() => {});
  const recognition = useSpeechRecognition((finalText) =>
    handleCommandRef.current(finalText)
  );
  const {
    supported,
    listening,
    blocked,
    start,
    abort,
    error: recognitionError,
  } = recognition;

  // Refs the (stable) command handler closes over, so it always sees fresh state
  // without being re-created on every keystroke of recognition.
  const enabledRef = useRef(enabled);
  const languageRef = useRef(language);
  const pageCommandsRef = useRef(new Map<string, PageCommand[]>());
  const lastFeedbackRef = useRef("");
  const targetsRef = useRef<ClickTarget[]>([]);
  const cursorRef = useRef<number | null>(null);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);
  useEffect(() => {
    languageRef.current = language;
  }, [language]);
  useEffect(() => {
    targetsRef.current = targets;
  }, [targets]);
  useEffect(() => {
    cursorRef.current = cursor;
  }, [cursor]);

  // -------------------------------------------------------------------------
  // Feedback
  // -------------------------------------------------------------------------

  const announce = useCallback(
    (message: string) => {
      setFeedback(message);
      lastFeedbackRef.current = message;
      speak("voice-nav", message, speechLangFor(languageRef.current), DEFAULT_TTS_VOICE, {
        maxChars: 400,
      });
    },
    [speak]
  );

  // -------------------------------------------------------------------------
  // Screen targets
  // -------------------------------------------------------------------------

  const refreshTargets = useCallback((): ClickTarget[] => {
    const next = collectClickTargets();
    targetsRef.current = next;
    setTargets(next);
    return next;
  }, []);

  const listTargets = useCallback((): ClickTarget[] => {
    return targetsRef.current.length > 0 ? targetsRef.current : refreshTargets();
  }, [refreshTargets]);

  const activateIndex = useCallback(
    (index: number) => {
      const list = listTargets();
      const target = targetAtIndex(list, index);
      if (!target) {
        announce(`There is no item ${index}. Say rescan the page to refresh the list.`);
        return;
      }
      cursorRef.current = target.index;
      setCursor(target.index);
      announce(`Opening ${target.label}.`);
      activateTarget(target);
    },
    [announce, listTargets]
  );

  const moveCursor = useCallback(
    (delta: number) => {
      const list = listTargets();
      if (list.length === 0) {
        announce("There is nothing to move through on this page.");
        return;
      }
      const current = cursorRef.current;
      const position = current === null ? -1 : list.findIndex((t) => t.index === current);
      let next = position === -1 ? (delta > 0 ? 0 : list.length - 1) : position + delta;
      next = ((next % list.length) + list.length) % list.length;

      const target = list[next];
      cursorRef.current = target.index;
      setCursor(target.index);
      target.element.focus({ preventScroll: true });
      target.element.scrollIntoView({ block: "center", behavior: "smooth" });
      announce(`${target.index}. ${target.label}`);
    },
    [announce, listTargets]
  );

  const activateCursor = useCallback(() => {
    const list = listTargets();
    const current = cursorRef.current;
    const target =
      current !== null ? targetAtIndex(list, current) : list[0] ?? null;
    if (!target) {
      announce("There is nothing to select on this page.");
      return;
    }
    cursorRef.current = target.index;
    setCursor(target.index);
    announce(`Opening ${target.label}.`);
    activateTarget(target);
  }, [announce, listTargets]);

  const readPage = useCallback(() => {
    const main = document.querySelector("main") ?? document.body;
    const heading = main.querySelector("h1")?.textContent?.replace(/\s+/g, " ").trim();
    const body = (main.textContent ?? "").replace(/\s+/g, " ").trim();
    const spoken = [heading ? `${heading}.` : "", body.slice(0, READ_BUDGET)]
      .filter(Boolean)
      .join(" ")
      .trim();
    announce(spoken || "This page has nothing to read yet.");
  }, [announce]);

  // -------------------------------------------------------------------------
  // Steering
  // -------------------------------------------------------------------------

  const setEnabled = useCallback(
    (on: boolean) => {
      writeEnabled(on);
      setPanelOpen(on);
      if (!on) {
        stopSpeaking();
        setCursor(null);
        cursorRef.current = null;
      }
    },
    [stopSpeaking]
  );

  const toggle = useCallback(() => {
    const next = !enabledRef.current;
    // Unlock audio while this click still counts as a user gesture, so the
    // first spoken confirmation isn't blocked by the browser.
    if (next) getSpeechEngine().unlock();
    if (next) {
      announce("Voice navigation on. Say help to hear the commands.");
      refreshTargets();
    }
    setEnabled(next);
  }, [announce, refreshTargets, setEnabled]);

  const setLanguage = useCallback((lang: DetectedLanguage) => {
    writeLang(lang);
  }, []);

  // -------------------------------------------------------------------------
  // Dispatch
  // -------------------------------------------------------------------------

  const handleCommand = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text) return;
      setHeard(text);
      setNotice(null);
      setThinking(true);

      try {
        // 1. Actions the current page registered win on their own screen, so a
        //    quiz can offer "start the quiz" without hijacking "go to the quiz".
        const pageList: PageCommand[] = [];
        for (const list of pageCommandsRef.current.values()) pageList.push(...list);
        const pageIndex = matchPageCommand(text, pageList);
        if (pageIndex >= 0) {
          const command = pageList[pageIndex];
          announce(command.spoken ?? command.description);
          await command.run();
          refreshTargets();
          return;
        }

        // 2. Built-in vocabulary and navigation.
        const parsed = parseVoiceCommand(text);

        if (parsed.kind === "navigate") {
          announce(`Opening ${parsed.label}.`);
          router.push(parsed.href);
          return;
        }

        if (parsed.kind === "click") {
          const list = listTargets();
          const target =
            parsed.index !== undefined
              ? targetAtIndex(list, parsed.index)
              : parsed.name
                ? targetByName(list, parsed.name)
                : null;
          if (!target) {
            const what =
              parsed.index !== undefined ? `item ${parsed.index}` : `“${parsed.name}”`;
            announce(`I could not find ${what} on this page. Say rescan the page.`);
            return;
          }
          cursorRef.current = target.index;
          setCursor(target.index);
          announce(`Opening ${target.label}.`);
          activateTarget(target);
          return;
        }

        if (parsed.kind === "unknown") {
          setNotice(`I did not catch a command in “${text}”.`);
          announce("Sorry, I did not catch that. Say help for the list of commands.");
          return;
        }

        switch (parsed.id) {
          case "help":
            setPanelOpen(true);
            announce(
              "Voice navigation commands. Say a page name such as quiz, chat, " +
                "tasks or progress. Say click three to open an item, next and " +
                "select to move and choose, read the page to hear it, or stop to be quiet."
            );
            return;
          case "stop":
            stopSpeaking();
            setFeedback("Stopped.");
            return;
          case "repeat":
            announce(lastFeedbackRef.current || "There is nothing to repeat yet.");
            return;
          case "read-page":
            readPage();
            return;
          case "scroll-up":
            window.scrollBy({ top: -window.innerHeight * SCROLL_STEP, behavior: "smooth" });
            announce("Scrolled up.");
            return;
          case "scroll-down":
            window.scrollBy({ top: window.innerHeight * SCROLL_STEP, behavior: "smooth" });
            announce("Scrolled down.");
            return;
          case "scroll-top":
            window.scrollTo({ top: 0, behavior: "smooth" });
            announce("At the top of the page.");
            return;
          case "scroll-bottom":
            window.scrollTo({
              top: document.body.scrollHeight,
              behavior: "smooth",
            });
            announce("At the bottom of the page.");
            return;
          case "back":
            announce("Going back.");
            router.back();
            return;
          case "next":
            moveCursor(1);
            return;
          case "previous":
            moveCursor(-1);
            return;
          case "activate":
            activateCursor();
            return;
          case "refresh-targets": {
            const list = refreshTargets();
            announce(`${list.length} items on this page.`);
            return;
          }
          case "turn-off":
            setEnabled(false);
            return;
          case "turn-on":
            setEnabled(true);
            return;
        }
      } finally {
        setThinking(false);
      }
    },
    [
      announce,
      listTargets,
      moveCursor,
      activateCursor,
      readPage,
      refreshTargets,
      router,
      setEnabled,
      stopSpeaking,
    ]
  );

  useEffect(() => {
    handleCommandRef.current = (text: string) => void handleCommand(text);
  }, [handleCommand]);

  // -------------------------------------------------------------------------
  // Listening loop
  // -------------------------------------------------------------------------

  // Never listen while EduVoice is talking or while navigation is off.
  useEffect(() => {
    if (!enabled || speaking) abort();
  }, [enabled, speaking, abort]);

  // Keep one session open (restarting across the browser's own timeouts) for as
  // long as voice navigation is on.
  useEffect(() => {
    if (!enabled || speaking || blocked || !supported || listening) return;
    const timer = window.setTimeout(
      () => start(speechLangFor(language), { continuous: true }),
      150
    );
    return () => window.clearTimeout(timer);
  }, [enabled, speaking, blocked, supported, listening, language, start]);

  // Refresh the numbered list whenever the page changes underneath us, so the
  // commands always describe what is actually on screen.
  useEffect(() => {
    if (!enabled) return;
    const timer = window.setTimeout(() => refreshTargets(), 400);
    return () => window.clearTimeout(timer);
  }, [enabled, pathname, refreshTargets]);

  // Keyboard: Alt+V toggles voice navigation from anywhere.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.altKey && (event.key === "v" || event.key === "V")) {
        event.preventDefault();
        toggle();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  // -------------------------------------------------------------------------
  // Page command registry
  // -------------------------------------------------------------------------

  const publishPageCommands = useCallback(() => {
    const list: PageCommand[] = [];
    for (const commands of pageCommandsRef.current.values()) list.push(...commands);
    setPageCommands(list);
  }, []);

  const registerPageCommands = useCallback(
    (id: string, commands: PageCommand[]) => {
      pageCommandsRef.current.set(id, commands);
      publishPageCommands();
    },
    [publishPageCommands]
  );

  const unregisterPageCommands = useCallback(
    (id: string) => {
      pageCommandsRef.current.delete(id);
      publishPageCommands();
    },
    [publishPageCommands]
  );

  // -------------------------------------------------------------------------
  // Context value
  // -------------------------------------------------------------------------

  const value = useMemo<VoiceNavApi>(() => {
    const phase: VoiceNavPhase = !enabled
      ? "off"
      : speaking
        ? "speaking"
        : thinking
          ? "thinking"
          : "listening";

    const status = !enabled
      ? "Voice navigation is off"
      : !supported
        ? "This browser cannot listen — voice navigation is unavailable"
        : blocked
          ? "Microphone blocked — allow it to use voice navigation"
          : speaking
            ? "EduVoice is speaking…"
            : thinking
              ? "Working on it…"
              : "Listening for a command";

    return {
      enabled,
      supported,
      blocked,
      phase,
      status,
      heard,
      feedback,
      notice: notice ?? recognitionError?.message ?? null,
      panelOpen,
      language,
      targets,
      cursor,
      pageCommands,
      toggle,
      setEnabled,
      setPanelOpen,
      setLanguage,
      refreshTargets,
      activateIndex,
      registerPageCommands,
      unregisterPageCommands,
    };
  }, [
    enabled,
    supported,
    blocked,
    speaking,
    thinking,
    heard,
    feedback,
    notice,
    recognitionError,
    panelOpen,
    language,
    targets,
    cursor,
    pageCommands,
    toggle,
    setEnabled,
    setLanguage,
    refreshTargets,
    activateIndex,
    registerPageCommands,
    unregisterPageCommands,
  ]);

  return (
    <VoiceNavContext.Provider value={value}>{children}</VoiceNavContext.Provider>
  );
}
