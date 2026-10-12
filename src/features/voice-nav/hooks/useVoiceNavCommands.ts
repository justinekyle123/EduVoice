"use client";

import { useEffect } from "react";
import { useVoiceNav, type PageCommand } from "../context";

/**
 * Register screen-specific voice commands for as long as the calling component
 * is mounted (feature 6.14).
 *
 * A page passes a stable, memoised array of commands; the provider matches them
 * against what the student says before its generic vocabulary, so a quiz can
 * expose "start the quiz" without shadowing "go to the quiz" elsewhere.
 *
 *   const commands = useMemo(
 *     () => [
 *       {
 *         id: "upload",
 *         description: "Open the document upload picker",
 *         phrases: ["upload a document", "upload file"],
 *         run: () => fileInputRef.current?.click(),
 *       },
 *     ],
 *     []
 *   );
 *   useVoiceNavCommands("documents", commands);
 */
export function useVoiceNavCommands(id: string, commands: PageCommand[]) {
  const { registerPageCommands, unregisterPageCommands } = useVoiceNav();

  useEffect(() => {
    registerPageCommands(id, commands);
    return () => unregisterPageCommands(id);
  }, [id, commands, registerPageCommands, unregisterPageCommands]);
}
