import {
  Accessibility,
  Briefcase,
  CalendarClock,
  ClipboardList,
  FileText,
  GraduationCap,
  HeartPulse,
  Languages,
  Layers,
  Lightbulb,
  ListTodo,
  Mic,
  Swords,
  TrendingUp,
  Upload,
  Users,
  Volume2,
  type LucideIcon,
} from "lucide-react";

export const siteConfig = {
  name: "EduVoice",
  tagline: "Voice Chat Learning Assistant with Quiz System",
  description:
    "EduVoice is your AI learning companion for students — ask questions by voice, get spoken answers, generate quizzes from your notes, and learn hands-free in English, Filipino, or Cebuano.",
};

export const navLinks = [
  { label: "Features", href: "#features" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Languages", href: "#languages" },
] as const;

export type Feature = {
  icon: LucideIcon;
  title: string;
  description: string;
};

export const features: Feature[] = [
  {
    icon: Volume2,
    title: "Text-to-Speech Responses",
    description:
      "Every answer becomes natural spoken audio, so you can listen and learn while walking, commuting, or doing chores.",
  },
  {
    icon: Lightbulb,
    title: "Hint Mode",
    description:
      "Progressive clues instead of direct answers — you solve problems yourself and build critical thinking instead of depending on the AI.",
  },
  {
    icon: FileText,
    title: "Document Q&A",
    description:
      "Upload PDFs, Word files, or lecture notes and ask anything. Answers stay grounded strictly in your own material.",
  },
  {
    icon: ClipboardList,
    title: "Quiz Generation",
    description:
      "Instant multiple-choice, true-or-false, and short-answer quizzes generated from the key concepts of your documents.",
  },
  {
    icon: Languages,
    title: "Filipino & Cebuano Detection",
    description:
      "EduVoice detects the language you type or speak and answers back in English, Filipino, or Cebuano.",
  },
  {
    icon: Swords,
    title: "Debate Mode",
    description:
      "Pick any stance and EduVoice challenges your arguments with counterpoints and follow-ups to sharpen your reasoning.",
  },
  {
    icon: Briefcase,
    title: "Interview Mode",
    description:
      "Practice role-specific job interviews by voice, with feedback on the clarity, relevance, and confidence of your answers.",
  },
  {
    icon: Mic,
    title: "Voice-Based Q&A",
    description:
      "Ask questions and receive answers entirely through speech — no typing required, fully hands-free.",
  },
  {
    icon: ListTodo,
    title: "Hands-Free Task Capture",
    description:
      "Dictate to-dos, deadlines, and reminders while your hands are busy; EduVoice logs them automatically.",
  },
  {
    icon: TrendingUp,
    title: "Progress Visualization",
    description:
      "Quiz scores, study sessions, and topic performance become charts and trend summaries that show what to review.",
  },
  {
    icon: HeartPulse,
    title: "Tone & Mood Detector",
    description:
      "EduVoice senses frustration, confusion, or stress and shifts to simpler explanations and encouragement.",
  },
  {
    icon: Layers,
    title: "Smart Flashcards",
    description:
      "Key terms are extracted automatically and scheduled with spaced repetition for long-term retention.",
  },
  {
    icon: Users,
    title: "Collaborative Study Rooms",
    description:
      "Create or join rooms to quiz each other and compete on shared leaderboards built from the same material.",
  },
  {
    icon: Accessibility,
    title: "Voice Navigation",
    description:
      "Menus, quiz selection, and document uploads can all be driven by voice commands for fully hands-free use.",
  },
  {
    icon: CalendarClock,
    title: "Adaptive Study Planner",
    description:
      "A weekly study plan is generated from your performance, prioritizing weak topics and scheduling reviews.",
  },
];

export const steps = [
  {
    icon: Mic,
    title: "Ask by voice or text",
    description:
      "Speak your question or type it — EduVoice understands English, Filipino, and Cebuano.",
  },
  {
    icon: Upload,
    title: "Upload your materials",
    description:
      "Drop in PDFs, Word documents, or lecture notes and get instant summaries and document Q&A.",
  },
  {
    icon: GraduationCap,
    title: "Learn, quiz, and review",
    description:
      "Take auto-generated quizzes and review smart flashcards built from your own notes.",
  },
  {
    icon: TrendingUp,
    title: "Track your progress",
    description:
      "Charts and trends reveal your strengths and weak spots so you always know what to study next.",
  },
];

export const languages = [
  {
    name: "English",
    sample: "Hi! How can I help you today?",
    description: "Clear, natural explanations and instant feedback in English.",
  },
  {
    name: "Filipino",
    sample: "Kumusta! Ano ang gusto mong pag-aralan?",
    description: "Learn comfortably in Tagalog when you prefer your local language.",
  },
  {
    name: "Cebuano",
    sample: "Kumusta! Unsa ang imong gusto nga tun-an?",
    description: "Ask and answer in Bisaya — no need to switch to English.",
  },
] as const;