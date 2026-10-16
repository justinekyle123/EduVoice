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
import {
  navOpenerFor,
  voiceNavLine,
  type PhraseLine,
  type VoiceNavKey,
} from "@/features/chat/lib/phrases";
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
  /**
   * Confirmation from the pre-generated bank (lib/phrases.ts) — use this when
   * the page's reply is always the same words, so it is played instead of
   * synthesized. It wins over `spoken` when both are set.
   */
  spokenKey?: VoiceNavKey;
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

/**
 * Delay before the mic is reopened, in milliseconds.
 *
 * Voice navigation closes the recognizer while EduVoice speaks (it must not
 * hear its own reply) and reopens it the moment the audio finishes, so this is
 * dead time between two commands. Kept as short as the browser allows: Chrome
 * throws if a new session starts while the previous one is still shutting down,
 * which is what leaves a gap at all — voice mode settled on the same 120.
 */
const RESTART_DELAY_MS = 120;
/** Ceiling for the backoff below — long enough to stop a restart loop. */
const MAX_RESTART_DELAY_MS = 4000;

/**
 * Languages the browser's recognizer almost never serves, and the closest one
 * that it does. Getting stuck asking for a language the service rejects is the
 * difference between voice navigation hearing nothing and hearing everything.
 */
const LANG_FALLBACK: Record<string, string> = {
  "ceb-PH": "fil-PH",
  "fil-PH": "en-PH",
};

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
    speakLine,
    stop: stopSpeaking,
  } = useSpeechSynthesis();

  const handleCommandRef = useRef<(text: string) => void>(() => {});

  /**
   * Words this turn has already been acted on from, before the browser had
   * decided the student was finished (see `handleInterim` below). The finalized
   * utterance repeats those same words, and running it as well would run the
   * same command twice.
   */
  const actedOnRef = useRef("");
  const handleInterimRef = useRef<(text: string) => void>(() => {});

  const recognition = useSpeechRecognition(
    (finalText) => {
      // The words were already acted on early: drop the repeat.
      if (actedOnRef.current) {
        actedOnRef.current = "";
        return;
      }
      handleCommandRef.current(finalText);
    },
    (interimText) => handleInterimRef.current(interimText)
  );
  const {
    supported,
    listening,
    interim,
    blocked,
    start,
    abort,
    error: recognitionError,
  } = recognition;

  // Refs the (stable) command handler closes over, so it always sees fresh state
  // without being re-created on every keystroke of recognition.
  const enabledRef = useRef(enabled);
  const languageRef = useRef(language);
  /**
   * Recognition languages the browser has already refused, so the next session
   * asks for the next one down instead of retrying what cannot work.
   */
  const unsupportedLangsRef = useRef(new Set<string>());
  /** Language the live session was opened with, for the error that follows. */
  const attemptLangRef = useRef("");
  /** Delay before reopening the mic, doubled after each recognition failure. */
  const restartDelayRef = useRef(RESTART_DELAY_MS);
  const pageCommandsRef = useRef(new Map<string, PageCommand[]>());
  // The last thing EduVoice said, so "repeat" can say it again. The bank line is
  // kept next to the text so a fixed line is replayed from its recording instead
  // of being synthesized a second time.
  const lastSpokenRef = useRef<{ text: string; line?: PhraseLine } | null>(null);
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

  /** Say a fresh sentence — one built from a label or a number — the usual way. */
  const announce = useCallback(
    (message: string) => {
      setFeedback(message);
      lastSpokenRef.current = { text: message };
      speak("voice-nav", message, speechLangFor(languageRef.current), DEFAULT_TTS_VOICE, {
        maxChars: 400,
      });
    },
    [speak]
  );

  /**
   * Say a line from the pre-generated bank (lib/phrases.ts).
   *
   * Voice navigation confirms nearly every command with words that never
   * change, and each of those used to be synthesized — and written into
   * `data/speech/` — the first time a student heard it. Asking for the line by
   * file key plays the recording `npm run phrases:generate` wrote into
   * `data/phrases/` instead, so the confirmation costs no TTS request at all.
   */
  const speakBankLine = useCallback(
    (line: PhraseLine) => {
      setFeedback(line.text);
      lastSpokenRef.current = { text: line.text, line };
      speakLine("voice-nav", {
        key: line.key,
        text: line.text,
        lang: speechLangFor(languageRef.current),
        voice: DEFAULT_TTS_VOICE,
        style: line.style,
      });
    },
    [speakLine]
  );

  /** Say one of the fixed voice-navigation lines, by key. */
  const announceLine = useCallback(
    (key: VoiceNavKey) => speakBankLine(voiceNavLine(key)),
    [speakBankLine]
  );

  /**
   * Announce the page a navigation command is opening. The confirmation names a
   * destination from a fixed list, so it comes from the bank; a page that has no
   * line yet falls back to synthesizing its label.
   */
  const announceNav = useCallback(
    (href: string, label: string) => {
      const line = navOpenerFor(href);
      if (line) speakBankLine(line);
      else announce(`Opening ${label}.`);
    },
    [announce, speakBankLine]
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
        announceLine("nav-nothing-to-move");
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
    [announce, announceLine, listTargets]
  );

  const activateCursor = useCallback(() => {
    const list = listTargets();
    const current = cursorRef.current;
    const target =
      current !== null ? targetAtIndex(list, current) : list[0] ?? null;
    if (!target) {
      announceLine("nav-nothing-to-select");
      return;
    }
    cursorRef.current = target.index;
    setCursor(target.index);
    announce(`Opening ${target.label}.`);
    activateTarget(target);
  }, [announce, announceLine, listTargets]);

  const readPage = useCallback(() => {
    const main = document.querySelector("main") ?? document.body;
    const heading = main.querySelector("h1")?.textContent?.replace(/\s+/g, " ").trim();
    const body = (main.textContent ?? "").replace(/\s+/g, " ").trim();
    const spoken = [heading ? `${heading}.` : "", body.slice(0, READ_BUDGET)]
      .filter(Boolean)
      .join(" ")
      .trim();
    if (spoken) announce(spoken);
    else announceLine("nav-nothing-to-read");
  }, [announce, announceLine]);

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
      announceLine("nav-on");
      refreshTargets();
    }
    setEnabled(next);
  }, [announceLine, refreshTargets, setEnabled]);

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
          // A page can name a bank line for its confirmation, so a fixed reply
          // like "Starting the quiz." is a recording too.
          if (command.spokenKey) speakBankLine(voiceNavLine(command.spokenKey));
          else announce(command.spoken ?? command.description);
          await command.run();
          refreshTargets();
          return;
        }

        // 2. Built-in vocabulary and navigation.
        const parsed = parseVoiceCommand(text);

        if (parsed.kind === "navigate") {
          announceNav(parsed.href, parsed.label);
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
          announceLine("nav-no-catch");
          return;
        }

        switch (parsed.id) {
          case "help":
            setPanelOpen(true);
            announceLine("nav-help");
            return;
          case "stop":
            stopSpeaking();
            setFeedback("Stopped.");
            return;
          case "repeat": {
            const last = lastSpokenRef.current;
            if (!last) {
              announceLine("nav-nothing-to-repeat");
              return;
            }
            // A line from the bank is replayed from its recording, so repeating a
            // confirmation does not pay for the same sentence twice.
            if (last.line) speakBankLine(last.line);
            else announce(last.text);
            return;
          }
          case "read-page":
            readPage();
            return;
          case "scroll-up":
            window.scrollBy({ top: -window.innerHeight * SCROLL_STEP, behavior: "smooth" });
            announceLine("nav-scrolled-up");
            return;
          case "scroll-down":
            window.scrollBy({ top: window.innerHeight * SCROLL_STEP, behavior: "smooth" });
            announceLine("nav-scrolled-down");
            return;
          case "scroll-top":
            window.scrollTo({ top: 0, behavior: "smooth" });
            announceLine("nav-top");
            return;
          case "scroll-bottom":
            window.scrollTo({
              top: document.body.scrollHeight,
              behavior: "smooth",
            });
            announceLine("nav-bottom");
            return;
          case "back":
            announceLine("nav-back");
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
      announceLine,
      announceNav,
      speakBankLine,
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

  /**
   * True when the words heard so far already contain a command this provider can
   * act on — the page names, the built-in vocabulary, or an action the screen on
   * display registered. Deliberately strict: anything the parser cannot place is
   * left to the final result, so nothing new is ever announced as "I did not
   * catch that" just because the student was still speaking.
   */
  const looksLikeCommand = useCallback((text: string): boolean => {
    const pageList: PageCommand[] = [];
    for (const list of pageCommandsRef.current.values()) pageList.push(...list);
    if (matchPageCommand(text, pageList) >= 0) return true;
    return parseVoiceCommand(text).kind !== "unknown";
  }, []);

  /**
   * Act on a command the moment its words are there, instead of waiting for the
   * browser to decide the student has stopped talking.
   *
   * Chrome only hands over an utterance once it has heard a pause in it, and a
   * pause is the second or so between saying "go to the quiz" and the page
   * actually moving. The words are already there in the interim transcript, so
   * when it contains a command nothing has to wait — say it and it happens.
   *
   * Nothing else changes: an interim that matches nothing is ignored and the
   * finalized utterance is handled exactly as before, so a command the browser
   * only gets right at the end still works.
   */
  const handleInterim = useCallback(
    (interimText: string) => {
      // One command per turn: until the transcript moves on (see the effect
      // below) the rest of this utterance must not be taken as another command.
      if (!enabled || blocked || actedOnRef.current) return;

      const pending = interimText.trim();
      if (!pending || !looksLikeCommand(pending)) return;

      actedOnRef.current = pending;
      void handleCommand(pending);
    },
    [enabled, blocked, handleCommand, looksLikeCommand]
  );

  useEffect(() => {
    handleInterimRef.current = handleInterim;
  }, [handleInterim]);

  // A turn is used up until the transcript moves on. The browser empties it when
  // it finalizes the utterance, and a fresh recognition session starts empty
  // too — either one means the next command may be taken early.
  const wasListeningRef = useRef(false);
  useEffect(() => {
    const newSession = listening && !wasListeningRef.current;
    wasListeningRef.current = listening;
    if (newSession || !interim.trim()) actedOnRef.current = "";
  }, [interim, listening]);

  // -------------------------------------------------------------------------
  // Listening loop
  // -------------------------------------------------------------------------

  // Never listen while EduVoice is talking or while navigation is off. Its own
  // reply is the one thing the recognizer must not pick up.
  useEffect(() => {
    if (!enabled || speaking) abort();
  }, [enabled, speaking, abort]);

  // Keep one session open (restarting across the browser's own silence timeouts,
  // and after every reply) for as long as voice navigation is on.
  //
  // Three things decide how quickly a spoken command is heard:
  //
  //   • keepInterim — a browser session ends on its own after a few seconds of
  //     silence, and voice navigation restarts one constantly. Carrying the
  //     interim words across that restart is what stops a command that began
  //     just before it from arriving with its first half missing, which the
  //     student experiences as having to say it again (voice mode asks for the
  //     same thing).
  //   • the language actually asked for — see `unsupportedLangsRef` below.
  //   • how long the mic stays closed afterwards — `restartDelayRef`.
  useEffect(() => {
    if (!enabled || speaking || blocked || !supported || listening) return;

    let attempt = speechLangFor(language);
    while (unsupportedLangsRef.current.has(attempt) && LANG_FALLBACK[attempt]) {
      attempt = LANG_FALLBACK[attempt];
    }
    attemptLangRef.current = attempt;

    const timer = window.setTimeout(
      () => start(attempt, { continuous: true, keepInterim: true }),
      restartDelayRef.current
    );
    return () => window.clearTimeout(timer);
  }, [
    enabled,
    speaking,
    blocked,
    supported,
    listening,
    language,
    recognitionError,
    start,
  ]);

  // A session is open again, so the mic is hearing something: drop any backoff
  // left over from an earlier failure.
  useEffect(() => {
    if (listening) restartDelayRef.current = RESTART_DELAY_MS;
  }, [listening]);

  // Repeated recognition failures back off instead of hammering the service (a
  // silent "no-speech" never gets here — the hook swallows those). A language
  // the browser does not serve is noted instead, so the next attempt steps down
  // to one it does rather than asking again forever and hearing nothing.
  useEffect(() => {
    if (!recognitionError) return;

    if (
      recognitionError.code === "language-not-supported" &&
      attemptLangRef.current
    ) {
      unsupportedLangsRef.current.add(attemptLangRef.current);
      restartDelayRef.current = RESTART_DELAY_MS;
      return;
    }

    restartDelayRef.current = Math.min(
      restartDelayRef.current * 2,
      MAX_RESTART_DELAY_MS
    );
  }, [recognitionError]);

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
