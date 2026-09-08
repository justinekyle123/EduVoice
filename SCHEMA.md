# EduVoice — Database Schema Design

PostgreSQL (Drizzle ORM) · Neon (cloud) / pgAdmin (local)

This document maps the 15 features from `EduVoice_Guide.md` to the data model.
The Drizzle definitions live in `src/lib/db/schema.ts`; migrations are in
`drizzle/`.

## Feature → table mapping

| # | Feature (guide §6) | Tables |
|---|---|---|
| 6.1 | Text-to-Speech AI Response | `chat_sessions`, `chat_messages` |
| 6.2 | Hint Mode | `chat_sessions.mode = 'hint'` |
| 6.3 | Document-Based Q&A | `documents`, `document_chunks` |
| 6.4 | Quiz Generation | `quizzes`, `quiz_questions` |
| 6.5 | Filipino & Cebuano Language Detection | `chat_sessions.language`, `chat_messages.language` |
| 6.6 | Debate Mode | `chat_sessions.mode = 'debate'` |
| 6.7 | Interview Mode | `chat_sessions.mode = 'interview'` |
| 6.8 | Voice-Based Q&A | `chat_messages` (voice input), `tasks.source = 'voice'` |
| 6.9 | Hands-Free Task Capture | `tasks` |
| 6.10 | Progress Visualization & Trends | `quiz_attempts`, `study_sessions` (aggregated) |
| 6.11 | Tone & Mood Detector | `chat_messages.tone` |
| 6.12 | Smart Flashcards (Spaced Repetition) | `flashcard_decks`, `flashcards`, `flashcard_reviews` |
| 6.13 | Collaborative Study Rooms | `study_rooms`, `study_room_members`, `quiz_attempts.room_id` |
| 6.14 | Accessibility Voice Navigation | app-level (no table) |
| 6.15 | Adaptive Study Planner | `study_plans` |

## Entities

### users
Stores the local profile for every Clerk account (synced via webhook / on
first dashboard visit).

- `id` uuid PK
- `clerk_id` text UNIQUE — Clerk user id
- `email` text UNIQUE
- `name` text
- `avatar_url` text
- `created_at`, `updated_at`

### chat_sessions
One conversation with the AI tutor. The `mode` column powers Hint, Debate,
and Interview modes (feature 6.2/6.6/6.7).

- `id`, `user_id` FK → users (cascade)
- `mode` enum: `chat` | `hint` | `debate` | `interview`
- `title` text — auto-generated from the first question
- `language` text — detected session language (`en`, `tl`, `ceb`)
- `created_at`, `updated_at`
- Index: (`user_id`, `updated_at`)

### chat_messages
Every turn of a conversation, including the detected language and tone
(features 6.1, 6.5, 6.8, 6.11).

- `id`, `session_id` FK → chat_sessions (cascade)
- `role` enum: `user` | `assistant`
- `content` text
- `language` text — detected from the user input
- `tone` text — detected mood (`frustrated`, `confused`, `stressed`,
  `positive`, `neutral`, …)
- `created_at`
- Index: (`session_id`, `created_at`)

### documents
Uploaded study material (PDF / Word / notes). Status tracks the
summarization/indexing pipeline (features 6.3, 6.4, 6.12).

- `id`, `user_id` FK → users (cascade)
- `file_name`, `file_type` (pdf/docx/txt), `file_url`
- `summary` text — auto-generated summary
- `status` enum: `uploaded` | `processing` | `ready` | `failed`
- `created_at`, `updated_at`

### document_chunks
Split paragraphs of a document so Q&A can ground answers in the source
material (feature 6.3). A `vector` column (pgvector) can be added later for
semantic search.

- `id`, `document_id` FK → documents (cascade)
- `chunk_index` int, `content` text
- UNIQUE (`document_id`, `chunk_index`)

### quizzes
A generated quiz, optionally tied to a source document (feature 6.4).

- `id`, `user_id` FK → users (cascade)
- `document_id` FK → documents (SET NULL) — null when typed in manually
- `title`, `topic` text — topic enables per-topic performance analysis
- `created_at`

### quiz_questions
Items inside a quiz (features 6.4, 6.10).

- `id`, `quiz_id` FK → quizzes (cascade)
- `question` text
- `type` enum: `multiple_choice` | `true_false` | `short_answer`
- `options` jsonb — option strings for multiple-choice
- `correct_answer` text, `explanation` text
- `order` int — UNIQUE (`quiz_id`, `order`)

### quiz_attempts
One run of a quiz. Score history here powers progress trends; `room_id`
enables shared-room leaderboards (features 6.10, 6.13).

- `id`, `quiz_id` FK → quizzes (cascade)
- `user_id` FK → users (cascade)
- `room_id` FK → study_rooms (SET NULL)
- `score`, `total_questions` int
- `started_at`, `completed_at` (null while in progress)
- Index: (`user_id`, `completed_at`)

### quiz_answers
Per-question results of an attempt, for review screens and weak-topic
analysis (features 6.4, 6.10).

- `id`, `attempt_id` FK → quiz_attempts (cascade)
- `question_id` FK → quiz_questions (cascade)
- `user_answer` text, `is_correct` boolean
- UNIQUE (`attempt_id`, `question_id`)

### tasks
Hands-free study to-dos, captured by voice or text (feature 6.9).

- `id`, `user_id` FK → users (cascade)
- `title`, `description`
- `due_date` timestamp (null = anytime)
- `completed` boolean
- `source` enum: `voice` | `text`
- `created_at`, `updated_at`
- Index: (`user_id`, `completed`)

### flashcard_decks
A set of flashcards, usually extracted from one document (feature 6.12).

- `id`, `user_id` FK → users (cascade)
- `title` text
- `document_id` FK → documents (SET NULL)
- `created_at`

### flashcards
A single front/back card (feature 6.12).

- `id`, `deck_id` FK → flashcard_decks (cascade)
- `front`, `back` text
- `created_at`

### flashcard_reviews
Spaced-repetition state per card, following the SM-2 model (feature 6.12).

- `id`, `flashcard_id` FK → flashcards (cascade)
- `user_id` FK → users (cascade)
- `ease_factor` real (default 2.5)
- `interval_days` int, `repetitions` int, `due_at` timestamp
- `rating` enum: `again` | `hard` | `good` | `easy`
- `reviewed_at`

### study_rooms
A collaborative room sharing material and leaderboards (feature 6.13).

- `id`, `name` text
- `join_code` text UNIQUE — shareable invite code
- `owner_id` FK → users (cascade)
- `document_id` FK → documents (SET NULL) — shared material
- `created_at`

### study_room_members
Room membership (feature 6.13).

- `id`, `room_id` FK → study_rooms (cascade)
- `user_id` FK → users (cascade)
- `role` enum: `owner` | `member`
- `joined_at`
- UNIQUE (`room_id`, `user_id`)

### study_plans
Weekly adaptive study plans generated from performance (feature 6.15).

- `id`, `user_id` FK → users (cascade)
- `week_start` date — UNIQUE (`user_id`, `week_start`)
- `content` jsonb — generated day-by-day schedule
- `created_at`

### study_sessions
Activity log (chat, quiz, document, flashcards, tasks) feeding progress
charts and trends (feature 6.10).

- `id`, `user_id` FK → users (cascade)
- `activity_type` enum: `chat` | `quiz` | `document` | `flashcards` | `tasks` | `other`
- `topic` text
- `started_at`, `ended_at`, `duration_minutes` int
- Index: (`user_id`, `started_at`)

## Notes / future work

- **Semantic search:** add a `vector` column to `document_chunks` and enable
  the `pgvector` extension on Neon when RAG-style retrieval is implemented.
- **Topic mastery:** derived from `quiz_questions.topic` +
  `quiz_answers.is_correct`; no separate table needed.
- **Voice audio:** TTS/STT audio can be stored in blob storage with a URL on
  `chat_messages`/`documents`; the schema only stores text.
- Deleting a user cascades to all owned data; shared references (documents
  on quizzes/decks/rooms) are set to NULL instead.