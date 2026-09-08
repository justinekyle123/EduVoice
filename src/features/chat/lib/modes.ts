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

export function instructionFor(mode: ChatMode): string {
  return (
    chatModes.find((m) => m.id === mode)?.instruction ??
    EDUVOICE_SYSTEM_INSTRUCTION
  );
}