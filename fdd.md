# EduVoice Feature Definition Document (FDD)

## 1. Document Control

| Item | Value |
|---|---|
| Product | EduVoice |
| Document | Feature Definition Document (FDD) |
| Product type | Voice-enabled AI learning companion |
| Primary users | Students and independent learners |
| Initial study context | Learners in Polomolok, South Cotabato |
| Version | 2.0 |
| Date | 2026-10-16 |
| Source documents | `EduVoice_Guide.md`, `SCHEMA.md`, `ACTIVITY_DIAGRAM.md`, and the complete `src/` implementation |
| Author | EduVoice Development Team |

This document defines the functional scope, technical architecture, and delivery expectations for EduVoice. Feature statuses describe the current repository state and are not a substitute for production readiness or user acceptance testing.

**Document Purpose:** This FDD serves as the single source of truth for all features, functions, and technical implementations in the EduVoice platform. It bridges product requirements with technical implementation details.

## 2. Product Overview

EduVoice is a centralized study platform that lets a student ask an AI tutor questions by text or voice, listen to spoken explanations, work with personal study materials, generate quizzes, capture study tasks, and review learning progress. The product is designed for hands-free learning and supports English, Filipino, and Cebuano interactions where the browser and configured AI services support them.

The product combines:

- AI tutoring and guided practice
- Voice input, speech output, and voice navigation
- Document-based study support
- Automatic quizzes and review materials
- Personal task tracking
- Collaborative study rooms
- Progress-driven recommendations

## 2.1 Functional Decomposition Flow

The following hierarchy decomposes EduVoice into independent functional areas. The lowest-level nodes are the features defined in Section 7.

```mermaid
flowchart TD
    EV[EduVoice Learning Assistant]

    EV --> AI[AI Tutoring and Voice Interaction]
    EV --> SM[Study Materials and Assessment]
    EV --> PM[Personal Study Management]
    EV --> CL[Collaborative Learning]
    EV --> AX[Access and Accessibility]

    AI --> AI1[Text-to-speech AI responses]
    AI --> AI2[Voice-based question and answer]
    AI --> AI3[Hint mode]
    AI --> AI4[Debate mode]
    AI --> AI5[Interview mode]
    AI --> AI6[Language detection]
    AI --> AI7[Tone and mood detection]

    SM --> SM1[Document upload and processing]
    SM --> SM2[Document-based question and answer]
    SM --> SM3[Document summaries]
    SM --> SM4[Quiz generation]
    SM --> SM5[Quiz taking and scoring]
    SM --> SM6[Smart flashcards]
    SM --> SM7[Spaced-repetition reviews]

    PM --> PM1[Hands-free task capture]
    PM --> PM2[Task list and reminders]
    PM --> PM3[Progress visualization]
    PM --> PM4[Performance trends]
    PM --> PM5[Adaptive study planner]

    CL --> CL1[Study-room creation]
    CL --> CL2[Room joining and membership]
    CL --> CL3[Room messaging]
    CL --> CL4[Shared quizzes]
    CL --> CL5[Room leaderboard]

    AX --> AX1[Clerk authentication]
    AX --> AX2[Voice navigation]
    AX --> AX3[Spoken command feedback]
    AX --> AX4[Typed and pointer fallbacks]
```

### Decomposition summary

| Major function | Independent sub-functions |
|---|---|
| AI Tutoring and Voice Interaction | TTS, voice Q&A, Hint, Debate, Interview, language detection, tone detection |
| Study Materials and Assessment | Upload and processing, document Q&A, summaries, quiz generation, quiz scoring, flashcards, spaced repetition |
| Personal Study Management | Voice task capture, task list, reminders, progress, trends, adaptive planning |
| Collaborative Learning | Room creation, membership, messaging, shared quizzes, leaderboard |
| Access and Accessibility | Authentication, voice navigation, spoken feedback, non-voice fallbacks |

## 3. Problem Statement

Students often have to switch between separate tools for tutoring, document review, quiz creation, reminders, and progress tracking. Typing every question slows study sessions and limits access for learners with visual strain, reading difficulties, or occupied hands. Students also need immediate practice and feedback without becoming dependent on direct AI answers.

EduVoice addresses these problems by keeping study activities in one authenticated workspace, allowing spoken interaction, grounding learning activities in the student's materials, guiding learners with hints, and recording outcomes for later review.

## 4. Goals and Success Measures

### 4.1 Product goals

1. Reduce the effort required to ask a study question.
2. Provide immediate, understandable tutoring support.
3. Help students practice instead of only consuming answers.
4. Turn personal notes into usable summaries, questions, quizzes, and flashcards.
5. Make core study flows usable without continuous typing.
6. Give students an evidence-based view of progress and weak topics.
7. Support individual and collaborative study in one platform.

### 4.2 Success measures

The following measures should be instrumented as the product matures:

- Percentage of chat turns completed with voice input.
- Time from document upload to a usable study artifact.
- Quiz completion rate and repeat-attempt rate.
- Percentage of tasks captured successfully from speech.
- Weekly active learners and returning study sessions.
- Improvement in accuracy on repeated topics.
- Voice-command success rate and unrecognized-command rate.
- User-reported usefulness of explanations and accessibility support.

## 5. Users and Actors

### Student

The primary actor. A student authenticates, asks questions, uploads material, takes quizzes, manages tasks, reviews progress, joins rooms, and controls the dashboard by voice.

### Classmate

A student who joins a shared study room, participates in room chat, takes room-linked quizzes, and appears on the room leaderboard.

### EduVoice system

The Next.js application validates requests, authenticates users, coordinates browser speech APIs, applies feature rules, stores records, and presents results.

### AI provider

Google AI Studio/Gemini generates tutor responses, mode-specific guidance, quiz content, summaries, and spoken output through configured provider services.

### Clerk

The authentication provider supplies the identity used to protect dashboard routes and synchronize local user records.

### Neon PostgreSQL

The persistent data store, accessed through Drizzle ORM, stores users, conversations, documents, quizzes, tasks, rooms, flashcards, study plans, and activity records.

## 6. Scope and Feature Catalog

Status meanings:

- **Implemented:** The repository contains an active user-facing flow and supporting logic.
- **Partial:** The data model or supporting logic exists, but the complete user-facing flow is incomplete.
- **Planned:** The feature is defined and represented in the product model, but the current user-facing implementation is not complete.

| ID | Feature | Status | Primary surface |
|---|---|---|---|
| F01 | Text-to-speech AI responses | Implemented | Chat and shared speech engine |
| F02 | Hint mode | Implemented | Chat mode |
| F03 | Document-based Q&A | Planned | Documents and chat |
| F04 | Quiz generation | Implemented | Quiz and chat-generated quiz flow |
| F05 | English, Filipino, and Cebuano detection | Implemented | Chat and voice navigation |
| F06 | Debate mode | Implemented | Chat mode |
| F07 | Interview mode | Implemented | Chat mode |
| F08 | Voice-based Q&A | Implemented | Chat and voice mode |
| F09 | Hands-free task capture | Implemented | Tasks |
| F10 | Progress visualization and trends | Implemented | Progress |
| F11 | Tone and mood detection | Implemented | Chat message metadata and response orchestration |
| F12 | Smart flashcards with spaced repetition | Planned | Flashcards |
| F13 | Collaborative study rooms | Implemented | Study Rooms and room-linked quizzes |
| F14 | Accessibility voice navigation | Implemented | Dashboard-wide voice navigation |
| F15 | Adaptive study planner | Planned | Study plans |

## 7. Functional Requirements

### F01. Text-to-speech AI responses

**Purpose:** Let a learner listen to tutor responses instead of reading every response.

**Requirements:**

- Provide a listen action for an assistant response.
- Convert response text to speech through the shared speech engine and configured AI provider.
- Pause or coordinate recognition while EduVoice is speaking so the application does not hear its own output.
- Support the selected speech language and voice where available.
- Limit or handle overly long text safely.
- Report provider or browser failures without losing the text response.

**Acceptance criteria:** A student can select a tutor response, hear it spoken, stop or interrupt it, and continue the conversation when speech ends or fails.

### F02. Hint mode

**Purpose:** Encourage independent reasoning rather than immediate answer consumption.

**Requirements:**

- Allow the student to select Hint mode for a chat session.
- Send a mode-specific instruction to the AI provider.
- Prefer progressive clues, questions, and partial guidance over a complete answer.
- Preserve the conversation history and session mode.
- Allow the student to switch back to normal chat or another supported mode.

**Acceptance criteria:** A hint-mode response guides the learner toward a solution and does not intentionally reveal the final answer on the first response unless the learner asks to proceed.

### F03. Document-based Q&A

**Purpose:** Make uploaded study material searchable and useful for grounded questions.

**Requirements:**

- Accept supported PDF, Word, and text study files.
- Create a document record and expose processing status: uploaded, processing, ready, or failed.
- Extract and store document chunks.
- Generate and store a summary when processing succeeds.
- Answer questions using the selected document as the source of truth.
- Clearly report when the document does not contain enough information.
- Prevent one student from reading another student's documents.

**Acceptance criteria:** A ready document can be selected for Q&A, and an answer identifies or reflects the source material rather than inventing unsupported content. Failed processing shows a recoverable error.

### F04. Quiz generation

**Purpose:** Turn study material or a requested topic into immediate practice.

**Requirements:**

- Generate multiple-choice, true/false, and short-answer questions.
- Store quiz metadata and ordered questions.
- Associate a quiz with a source document when applicable.
- Allow the learner to start, answer, submit, and leave a quiz.
- Grade supported question types and show the result with explanations where available.
- Store attempts and per-question answers.
- Allow a quiz to be associated with a study-room leaderboard.

**Acceptance criteria:** A student can complete a generated quiz, submit answers once, receive a score, and find the attempt in the data used for later progress analysis.

### F05. English, Filipino, and Cebuano detection

**Purpose:** Let the learner interact in a familiar language.

**Requirements:**

- Detect or retain the input language for supported chat turns.
- Store language at the session and message level where known.
- Use the detected language when constructing the response and speech settings.
- Allow voice-navigation language selection where supported.
- Fall back clearly when confidence is low or a language is unsupported.

**Acceptance criteria:** A supported English, Filipino, or Cebuano input is recorded with its language and receives a response intended for that language.

### F06. Debate mode

**Purpose:** Practice argumentation and evidence-based reasoning.

**Requirements:**

- Let the student select Debate mode and state a topic or position.
- Have the tutor challenge the position with counterpoints and follow-up questions.
- Keep the tutor's role consistent throughout the session.
- Preserve the debate transcript for the session history.

**Acceptance criteria:** The tutor takes an opposing or challenging stance and asks the learner to support claims instead of only agreeing with them.

### F07. Interview mode

**Purpose:** Provide low-cost, on-demand job interview practice.

**Requirements:**

- Let the student identify a role or interview context.
- Ask one interview question at a time.
- Accept spoken or typed answers.
- Provide feedback on relevance, clarity, and confidence when the provider can evaluate them.
- Keep the session structured as an interview until the student exits or changes mode.

**Acceptance criteria:** A student can complete multiple interview turns and receive actionable feedback after an answer.

### F08. Voice-based Q&A

**Purpose:** Support hands-free conversation with the tutor.

**Requirements:**

- Use browser speech recognition for supported browsers.
- Show listening, interim transcription, thinking, speaking, and error states.
- Submit final speech text through the same tutor path used for typed messages.
- Allow the learner to interrupt or recover from recognition and microphone errors.
- Offer a typed fallback when recognition is unavailable.

**Acceptance criteria:** A student can ask a question by voice, see or hear that it was received, and receive a spoken or text answer without typing the question.

### F09. Hands-free task capture

**Purpose:** Record study tasks and due dates while the learner's hands are occupied.

**Requirements:**

- Accept voice or typed task entry.
- Transcribe voice input and parse common date/time phrases in English, Filipino, and Cebuano.
- Ask for or expose confirmation before saving ambiguous captured text where necessary.
- Store task source as voice or text.
- Allow tasks to be listed, completed, and managed by the owning student.
- Keep due dates optional.

**Acceptance criteria:** A spoken task such as “review biology tomorrow at 5 PM” creates an owned task with the correct title, source, and due date, or presents a clear correction path when parsing is ambiguous.

### F10. Progress visualization and trends

**Purpose:** Show what the learner knows and what needs review.

**Requirements:**

- Aggregate completed quiz attempts, per-question answers, topics, and study sessions.
- Calculate scores, accuracy, study time, and changes over time.
- Identify weak topics and suggest a next activity.
- Display empty, loading, and error states.
- Exclude incomplete attempts from completed-performance summaries.

**Acceptance criteria:** A learner with completed activity sees accurate summary values and a weak-topic suggestion; a new learner sees a useful empty state rather than misleading zeroed charts.

### F11. Tone and mood detection

**Purpose:** Adapt tutoring style when the learner appears confused, frustrated, stressed, positive, or neutral.

**Requirements:**

- Analyze supported user input and assign a tone label when confidence permits.
- Store tone with the user message.
- Use tone as a response-orchestration signal, not as a diagnosis.
- Prefer simpler explanations, reassurance, or clarification prompts for negative study signals.
- Avoid making clinical or sensitive mental-health claims.

**Acceptance criteria:** A tone-aware message stores its classification and produces an appropriate tutoring style without presenting the classification as a medical assessment.

### F12. Smart flashcards with spaced repetition

**Purpose:** Improve long-term retention through targeted review.

**Requirements:**

- Generate decks and cards from eligible documents, quizzes, or extracted concepts.
- Store front/back content and ownership.
- Present due cards first.
- Record review ratings: again, hard, good, or easy.
- Update interval, repetitions, ease factor, and next due date using the selected spaced-repetition algorithm.
- Keep review state per learner.

**Acceptance criteria:** A learner can review a card, submit a rating, and receive a deterministic next due date based on the stored review state.

### F13. Collaborative study rooms

**Purpose:** Enable peer learning through shared workspaces with real-time interaction.

**Requirements:**

- Create study rooms with unique join codes for easy sharing.
- Allow room owners to manage membership and upload shared materials.
- Provide real-time chat messaging within rooms.
- Support file sharing (PDFs, documents) with authenticated member-only download.
- Link quiz attempts to rooms for shared leaderboards.
- Calculate leaderboard rankings based on accuracy, total points, and answer speed.
- Support live synchronized quizzes where all members answer the same question simultaneously.
- Provide voice-narrated questions through host-uploaded audio clips or TTS.
- Track question timing with synchronized countdowns across all clients.
- Show real-time response indicators and reveal answers together.
- Handle room deletion with proper cascade of members, messages, and linked data.

**Acceptance criteria:** A student can create a room, share its join code, conduct live quizzes with synchronized question-answer-reveal cycles, review the leaderboard showing accuracy-first rankings, and exchange messages and files with verified room members only.

**Technical Implementation:**

- Tables: `study_rooms`, `study_room_members`, `room_messages`, `room_files`, `room_quiz_sessions`, `room_quiz_responses`, `room_quiz_ready`
- File storage: Binary data stored in PostgreSQL `bytea` column for secure member-only access
- Quiz audio: Stored in `data/quiz-audio/<roomId>/` directory, referenced by key
- Real-time updates: Client polling with optimistic UI updates
- Authorization: Membership verification on every room action
- Leaderboard: Aggregated from `quiz_attempts` where `room_id` matches
- Live quiz state machine: lobby → question → reveal → ended phases
- Countdown synchronization: Server timestamp (`questionStartedAt`) + duration calculation on clients

### F14. Accessibility voice navigation

**Purpose:** Make the entire dashboard usable without typing or pointer input.

**Requirements:**

- Activate voice navigation from any dashboard screen.
- Support continuous speech recognition throughout the session.
- Parse built-in commands (navigation, scrolling, reading, cursor control).
- Allow pages to register custom commands contextually.
- Provide spoken feedback for every recognized command.
- Use pre-generated phrase bank for instant confirmation without TTS cost.
- Handle unrecognized commands with clear guidance.
- Coordinate with TTS playback to avoid self-recognition.
- Support cursor navigation (next/previous/activate) for screen elements.
- Provide "read the page" functionality for content overview.
- Support multi-language commands (English, Filipino, Cebuano).
- Show visual feedback for listening/thinking/speaking phases.
- Offer typed fallback for every voice command.

**Acceptance criteria:** A student can enable voice navigation, control the dashboard entirely by voice including page navigation, element interaction, and content reading, receive spoken confirmations, and accomplish any critical task with alternative input methods when voice fails.

**Technical Implementation:**

- Speech recognition: Browser Web Speech API with continuous listening mode
- Command vocabulary: Comprehensive parser in `src/features/voice-nav/lib/commands.ts`
- Page command registry: Dynamic registration system for screen-specific actions
- Phrase bank: Pre-synthesized confirmations in `data/phrases/` directory
- Target detection: DOM scanning for interactive elements with accessible names
- Cursor visualization: Highlighted index with keyboard-style navigation
- Speech coordination: Pauses recognition during TTS playback
- Language fallback: Maps unsupported recognition languages to closest available
- Backoff strategy: Exponential delay on restart failures (up to 4s max)
- State management: React context provider with persistent settings
- Settings storage: LocalStorage for enabled state and language preference

### F15. Adaptive study planner

**Purpose:** Generate personalized weekly study schedules based on performance data.

**Requirements:**

- Analyze completed quiz attempts and study sessions.
- Identify weak topics requiring additional focus.
- Generate day-by-day study plans with activities and topics.
- Store plans with weekly granularity (one per week start date).
- Update recommendations based on new performance data.
- Suggest specific activities (review, quiz, flashcards) per topic.
- Balance weak areas with maintenance of strong topics.
- Present plans in an accessible visual format.
- Allow manual regeneration when student priorities change.

**Acceptance criteria:** A student with quiz history receives a weekly plan highlighting weak topics, sees recommended daily activities, can regenerate the plan when performance improves, and finds suggestions aligned with actual performance gaps.

**Technical Implementation:**

- Status: Planned (data model complete, generation logic pending)
- Table: `study_plans` with JSONB content structure
- Data source: Aggregates from `quiz_attempts`, `quiz_answers`, `study_sessions`
- Weak topic algorithm: Accuracy threshold analysis per topic/question
- Plan structure: 7-day array with topics and activities per day
- Uniqueness: One plan per (user, week_start) combination
- AI integration: Gemini-generated recommendations based on performance summary
- Regeneration: Replace existing plan for same week or create for upcoming week

## 7.1 Feature Interaction Matrix

The following matrix shows how features depend on or enhance each other:

| Feature | Depends On | Enhances |
|---|---|---|
| F01: TTS Responses | F05: Language Detection | F02, F06, F07, F08, F14 |
| F02: Hint Mode | F01: TTS Responses | F08: Voice Q&A |
| F03: Document Q&A | F04: Quiz Generation | F12: Flashcards, F13: Rooms |
| F04: Quiz Generation | F03: Documents (optional) | F10: Progress, F13: Rooms |
| F05: Language Detection | - | F01, F02, F06, F07, F08, F09, F14 |
| F06: Debate Mode | F01: TTS Responses | F08: Voice Q&A |
| F07: Interview Mode | F01: TTS Responses | F08: Voice Q&A |
| F08: Voice Q&A | F01: TTS, F05: Language | F02, F06, F07, F14 |
| F09: Task Capture | F05: Language Detection | F14: Voice Navigation |
| F10: Progress Viz | F04: Quizzes, F12: Flashcards | F15: Study Planner |
| F11: Tone Detection | - | F02, F06, F07 (adaptive responses) |
| F12: Flashcards | F03: Documents | F10: Progress, F15: Planner |
| F13: Study Rooms | F04: Quiz Generation | F10: Progress (leaderboard) |
| F14: Voice Navigation | F01: TTS, F05: Language | All features (accessibility layer) |
| F15: Study Planner | F04: Quizzes, F10: Progress | - |

## 8. Technical Architecture Details

### 8.1 Technology Stack

**Frontend:**
- Framework: Next.js 15+ (App Router)
- UI Library: React 19+
- Styling: Tailwind CSS 4.0+
- Icons: Lucide React
- Animation: Framer Motion / GSAP
- Speech: Web Speech API (recognition + synthesis coordination)
- Audio: Web Audio API (for TTS playback engine)

**Backend:**
- Runtime: Node.js 20+
- Framework: Next.js Server Actions + API Routes
- Authentication: Clerk (webhook-driven user sync)
- ORM: Drizzle ORM
- Database: PostgreSQL 15+ (Neon cloud / local)
- AI Provider: Google AI Studio (Gemini 1.5 Flash/Pro)
- TTS Provider: Google Gemini TTS (via `@google/genai`)

**External Services:**
- SMS Gateway: Custom PHP service (Semaphore API) in `sms/` directory
- File Storage: PostgreSQL bytea (room files), local filesystem (quiz audio, TTS cache)
- Deployment: Vercel (Edge + Serverless Functions)

**Development Tools:**
- TypeScript 5.3+
- ESLint + TypeScript ESLint
- Drizzle Kit (migrations)
- Environment: Node 20+, npm/pnpm

### 8.2 System Architecture Diagram

```mermaid
flowchart TB
    subgraph Client["Browser Client"]
        UI[Next.js UI Components]
        WSR[Web Speech Recognition]
        WA[Web Audio API]
        LS[LocalStorage]
    end
    
    subgraph NextJS["Next.js Application"]
        APP[App Router Pages]
        SA[Server Actions]
        API[API Routes]
        MW[Middleware]
    end
    
    subgraph External["External Services"]
        CLERK[Clerk Auth]
        GEMINI[Google Gemini AI]
        TTS[Gemini TTS]
        SMS[SMS Gateway PHP]
    end
    
    subgraph Data["Data Layer"]
        DB[(PostgreSQL<br/>Neon/Local)]
        FS[Filesystem<br/>TTS Cache & Audio]
    end
    
    UI --> WSR
    UI --> WA
    UI --> LS
    
    UI --> APP
    APP --> SA
    APP --> API
    APP --> MW
    
    MW --> CLERK
    SA --> CLERK
    SA --> DB
    SA --> GEMINI
    API --> TTS
    API --> DB
    API --> FS
    API --> SMS
    
    CLERK -.Webhook.-> API
    
    style Client fill:#e1f5ff
    style NextJS fill:#fff4e1
    style External fill:#ffe1e1
    style Data fill:#e1ffe1
```

### 8.3 Database Schema Overview

**15 tables across 6 functional domains:**

1. **Authentication & Users** (1 table)
   - `users` - Local profiles synced from Clerk

2. **Chat & AI Tutoring** (2 tables)
   - `chat_sessions` - Conversations with mode tracking
   - `chat_messages` - Messages with language/tone metadata

3. **Study Materials** (2 tables)
   - `documents` - Uploaded files with processing status
   - `document_chunks` - Extracted paragraphs for Q&A

4. **Quizzes & Assessment** (4 tables)
   - `quizzes` - Generated quiz metadata
   - `quiz_questions` - Questions with type, options, answers
   - `quiz_attempts` - Student quiz runs with room attribution
   - `quiz_answers` - Per-question responses for analysis

5. **Personal Organization** (1 table)
   - `tasks` - Voice/text captured to-dos with SMS reminder tracking

6. **Flashcards** (3 tables)
   - `flashcard_decks` - Card collections
   - `flashcards` - Individual cards
   - `flashcard_reviews` - Spaced repetition state (SM-2 algorithm)

7. **Collaborative Learning** (7 tables)
   - `study_rooms` - Shared study spaces
   - `study_room_members` - Room membership with roles
   - `room_messages` - Chat history
   - `room_files` - Shared file storage (bytea)
   - `room_quiz_sessions` - Live synchronized quiz state
   - `room_quiz_responses` - Real-time answers with timing
   - `room_quiz_ready` - Lobby ready-up tracking

8. **Progress & Planning** (2 tables)
   - `study_sessions` - Activity log for analytics
   - `study_plans` - Weekly AI-generated schedules

**Total Relations:** 47 foreign key relationships with appropriate cascade/set-null rules

### 8.4 API Routes Documentation

| Route | Method | Purpose | Authentication |
|---|---|---|---|
| `/api/chat` | POST | Stream AI chat responses | Required |
| `/api/chat/speech` | POST | Generate TTS audio (WAV) | Required |
| `/api/chat/voice` | POST | Process voice transcription + respond | Required |
| `/api/documents/upload` | POST | Upload and process study files | Required |
| `/api/documents/[id]` | GET | Retrieve document with chunks | Required |
| `/api/quiz/generate` | POST | Create quiz from topic/document | Required |
| `/api/quiz/[id]/start` | POST | Begin quiz attempt | Required |
| `/api/quiz/[id]/submit` | POST | Grade and store answers | Required |
| `/api/tasks` | GET/POST | List and create tasks | Required |
| `/api/tasks/reminders` | POST | Send due task SMS (cron) | Internal |
| `/api/rooms` | GET/POST | List and create study rooms | Required |
| `/api/rooms/[id]/join` | POST | Join by code | Required |
| `/api/rooms/[id]/messages` | GET/POST | Chat and files | Required |
| `/api/rooms/[id]/files/[fileId]` | GET | Download room file | Required (member) |
| `/api/rooms/[id]/quiz-audio/[key]` | POST/GET | Upload/play quiz narration | Required (host/member) |
| `/api/rooms/[id]/live-quiz` | POST/PATCH | Start/control live quiz | Required (host) |
| `/api/webhooks/clerk` | POST | Sync user from Clerk | Clerk signature |

### 8.5 Authentication & Authorization Flow

```mermaid
sequenceDiagram
    participant B as Browser
    participant M as Middleware
    participant C as Clerk
    participant SA as Server Action
    participant DB as Database
    
    B->>M: Request protected page
    M->>C: Verify session
    C-->>M: Session valid + clerkId
    M->>SA: Forward with auth()
    SA->>DB: Check/create local user
    DB-->>SA: Return userId
    SA->>DB: Execute authorized query
    DB-->>SA: Return user-scoped data
    SA-->>B: Render page/return data
```

**Authorization Rules:**
1. All dashboard routes require Clerk authentication (enforced by middleware)
2. Server actions call `auth()` to get `clerkId`, then resolve to local `userId`
3. User record auto-created on first dashboard visit if webhook missed
4. Every database query scopes to authenticated `userId`
5. Room operations verify membership before granting access
6. Room files served only to verified members via authenticated route
7. No client-provided IDs trusted for authorization decisions

### 8.6 AI Integration Architecture

**Gemini Model Usage:**

| Feature | Model | Temperature | Max Tokens | Streaming |
|---|---|---|---|---|
| Chat (normal) | gemini-1.5-flash | 0.7 | 2048 | Yes |
| Chat (voice mode) | gemini-1.5-flash | 0.7 | 512 | Yes |
| Quiz Generation | gemini-1.5-flash | 0.3 | 4096 | No |
| Document Summary | gemini-1.5-flash | 0.5 | 1024 | No |
| Tone Detection | gemini-1.5-flash | 0.1 | 64 | No |
| Study Plan | gemini-1.5-flash | 0.5 | 2048 | No |
| TTS Synthesis | Gemini TTS API | N/A | N/A | No |

**System Instructions:**
- Base persona: `EDUVOICE_SYSTEM_INSTRUCTION` (patient Filipino tutor)
- Mode augmentation: Each mode adds specific guidance
- Voice mode: Adds brevity and spoken-format instructions
- Context: Includes detected language, tone, conversation history

**Prompt Construction:**
```
[System Instruction: Base + Mode + Voice (if applicable)]
[Context: Language, Tone, Recent Messages]
[User Input: Transcribed/Typed Message]
```

**Failure Handling:**
- Multi-key rotation: Try up to 3 configured API keys before failing
- Quota detection: Parse error messages for rate limit/exhaustion
- Cooldown: 10-minute pause after quota exhaustion detected
- Graceful degradation: Text preserved even if TTS fails
- Error messages: User-friendly explanations without technical details

### 8.7 Speech Engine Architecture

**TTS Flow:**
```mermaid
flowchart LR
    A[Message Text] --> B[Chunk into Sentences]
    B --> C{Cached?}
    C -->|Yes| D[Load from Memory/Disk]
    C -->|No| E[POST /api/chat/speech]
    E --> F[Gemini TTS API]
    F --> G[WAV Bytes]
    G --> H[Save to data/speech/]
    G --> I[Cache in Memory]
    D --> J[Web Audio Decode]
    I --> J
    J --> K[Schedule on Timeline]
    K --> L[Play Through Speakers]
    L --> M{More Chunks?}
    M -->|Yes| B
    M -->|No| N[Return to Idle]
```

**Key Technical Details:**
- Audio format: 16-bit PCM WAV, 24kHz sample rate
- Cache: In-memory Map (max 10 entries) + filesystem persistence
- Scheduling: Web Audio timeline ensures gapless sentence transitions
- Lookahead: Fetch next chunk 9 seconds before current ends
- Budget: Max 3000 characters per reply (SPEECH_BUDGET constant)
- Chunking: Split at sentence boundaries, max 1000 chars per chunk
- Timeout: 45-second limit per synthesis request
- Failure threshold: 2 failed chunks abort remaining sentences

**Speech Recognition:**
- API: Browser native `webkitSpeechRecognition` or `SpeechRecognition`
- Mode: Continuous listening with interim results
- Language: Dynamic based on user setting (en-PH, fil-PH, ceb-PH → fil-PH)
- Coordination: Pauses during TTS playback, resumes after 120ms delay
- Fallback: Typed input always available if recognition unavailable/blocked

### 8.9 Voice Navigation Command System

**Command Categories:**

1. **Navigation Commands:**
   - "go to chat" / "open chat" → `/dashboard/chat`
   - "go to overview" → `/dashboard`
   - "go to quiz" → `/dashboard/quiz`
   - "go to tasks" → `/dashboard/tasks`
   - "go to progress" → `/dashboard/progress`
   - "go to rooms" → `/dashboard/rooms`

2. **Element Interaction:**
   - "click [1-9]" → Activate numbered screen element
   - "click [name]" → Fuzzy match element by accessible name
   - "next" / "previous" → Move cursor highlight
   - "select" / "activate" → Click highlighted element

3. **Screen Control:**
   - "scroll up/down" → Move viewport 80%
   - "scroll to top/bottom" → Jump to page ends
   - "read the page" → Speak first 700 chars of main content
   - "refresh targets" / "rescan" → Rebuild element list

4. **Page-Specific Actions:** (dynamically registered by current page)
   - Quiz: "start the quiz", "submit my answers", "leave the quiz"
   - Tasks: "create a task"
   - Rooms: "create a room", "join a room"
   - Documents: "upload a document"

5. **System Commands:**
   - "help" → Show command panel
   - "stop" → Cancel current speech
   - "repeat" → Replay last announcement
   - "turn off" → Disable voice navigation

**Command Parsing:**
1. Fuzzy match against built-in phrases (Levenshtein distance)
2. Check page-registered commands
3. Parse numeric/name parameters for "click" commands
4. Return `{kind, id, params}` or `{kind: 'unknown'}`

**Target Collection:**
- Scans DOM for: buttons, links, inputs, select, textarea, [role=button/link]
- Extracts: textContent, aria-label, title, placeholder
- Assigns: 1-based index, normalized name, activation callback
- Updates: On route change, explicit rescan, or element registration

## 9. User Flows & Activity Diagrams

### 9.1 Complete Chat Session with Voice

```mermaid
sequenceDiagram
    participant S as Student
    participant UI as Dashboard UI
    participant SR as Speech Recognition
    participant SA as Server Action
    participant AI as Gemini AI
    participant TTS as TTS Engine
    participant SP as Speakers
    
    S->>UI: Click microphone button
    UI->>SR: Start listening
    SR-->>UI: Status: "Listening..."
    S->>SR: Speak question
    SR-->>UI: Show interim transcript
    SR-->>UI: Final transcript
    UI->>SA: submitMessage(text, voice:true)
    SA->>AI: Generate response (streaming)
    AI-->>SA: Stream text chunks
    SA-->>UI: Display assistant message
    UI->>TTS: speak(message, language, voice)
    TTS->>TTS: Chunk into sentences
    TTS->>SA: POST /api/chat/speech (first chunk)
    SA->>AI: Gemini TTS synthesis
    AI-->>SA: WAV bytes
    SA-->>TTS: Audio buffer
    TTS->>SP: Schedule + play audio
    TTS->>SA: POST /api/chat/speech (next chunk)
    loop While speaking
        TTS-->>UI: Update orb animation
    end
    TTS-->>UI: Status: idle
    SR->>SR: Resume listening
```

### 9.2 Quiz Generation to Leaderboard

```mermaid
flowchart TD
    A[Student in Study Room] --> B{Quiz Source?}
    B -->|Topic| C[Enter topic + question count]
    B -->|Document| D[Upload file]
    
    C --> E[POST /api/quiz/generate]
    D --> F[POST /api/quiz/generate-from-file]
    
    E --> G[Gemini: Generate questions]
    F --> G
    
    G --> H[Insert quiz + questions]
    H --> I[Create quiz_attempt with room_id]
    I --> J[Display questions]
    
    J --> K[Student answers all questions]
    K --> L[Click Submit]
    L --> M[Grade answers]
    M --> N[Update attempt: score, completedAt]
    N --> O[Refresh room leaderboard]
    
    O --> P{Top score?}
    P -->|Yes| Q[Show celebration]
    P -->|No| R[Show results + ranking]
```

### 9.3 Voice Task Capture with SMS Reminder

```mermaid
flowchart TD
    A[Student says task] --> B[Speech recognition transcribes]
    B --> C[Parse: title, due date, time]
    C --> D{Parsing successful?}
    D -->|Yes| E[Show draft task]
    D -->|No| F[Show error + allow edit]
    
    E --> G{Student action?}
    G -->|Confirm| H[Save to database]
    G -->|Edit| I[Modify fields manually]
    G -->|Discard| J[Cancel]
    
    I --> H
    H --> K[Task stored with source=voice]
    
    K --> L[Cron job checks due_date]
    L --> M{Due within 1 hour<br/>and reminded_at=null?}
    M -->|Yes| N[POST /api/tasks/reminders]
    M -->|No| O[Skip]
    
    N --> P[PHP SMS Gateway]
    P --> Q[Semaphore API]
    Q --> R[Student receives text]
    
    N --> S[Update reminded_at timestamp]
    S --> T[Task won't be texted again]
```

## 10. Data Flow Patterns

### 10.1 Authentication Flow

1. **User visits dashboard** → Middleware checks Clerk session
2. **Session valid** → Extract `clerkId`
3. **Server Action called** → `auth()` returns `clerkId`
4. **User resolution** → Query `users` table by `clerk_id`
5. **If not found** → Fetch from Clerk API → Insert new user record
6. **Return `userId`** → All DB queries use this for authorization

### 10.2 Chat Message Flow

1. Student types/speaks → Text captured
2. Language detection (Gemini) → Store in message
3. Tone detection (optional, Gemini) → Store in message
4. Load conversation history → Last N messages
5. Build prompt: System instruction + mode + history + new message
6. Stream Gemini response → Save assistant message
7. If voice mode: Chunk response → Synthesize each → Play sequentially
8. Update session.updatedAt for sorting

### 10.3 Quiz Attempt Flow

1. Generate or load existing quiz → Questions retrieved in order
2. Create attempt record → status: started, score: 0
3. Student answers each question → Store locally, don't save yet
4. Submit all at once → Grade each answer against `correct_answer`
5. Calculate score → Update attempt with total
6. Insert all `quiz_answers` records → One per question
7. If room-linked: Leaderboard query includes this attempt
8. Mark `completed_at` → Enables progress analysis

### 10.4 Room File Sharing Flow

1. Host uploads file → Validate size, type, membership
2. Read file into memory → Convert to Buffer
3. Insert `room_files` record → Store bytea in Postgres
4. Broadcast to room chat → Message with fileId reference
5. Member clicks download → GET `/api/rooms/[id]/files/[fileId]`
6. Verify membership → Reject if not member
7. Stream bytes to client → Set content-disposition header
8. Browser prompts save → File never publicly accessible

## 11. Performance & Optimization Strategies

### 11.1 TTS Caching Strategy
- **Level 1:** In-memory cache (10 most recent audio buffers)
- **Level 2:** Filesystem cache (`data/speech/<sha1>.wav`)
- **Level 3:** Pre-generated phrase bank (`data/phrases/*.wav`)
- **Cache key:** SHA-1 hash of (text, voice, style)
- **Hit rate goal:** >80% for repeated messages and confirmations

### 11.2 Database Query Optimization
- Indexed columns: All foreign keys, date ranges, status filters
- Leaderboard: Single aggregated query with CTEs, no N+1
- Room messages: Paginated (limit 50), ordered by createdAt DESC
- Chat sessions: Limit to 20 most recent per user
- Quiz attempts: Filter completed before aggregation

### 11.3 Real-Time Updates
- Polling interval: 3s for active live quiz, 10s for room chat
- Optimistic UI: Show local changes immediately, rollback on error
- Stale-while-revalidate: Display cached data while fetching fresh
- Exponential backoff: On repeated failures, reduce poll frequency

### 11.4 Bundle Size Management
- Code splitting: Dynamic imports for heavy features (quiz, rooms)
- Tree shaking: Lucide icons imported individually
- Lazy load: Framer Motion loaded only when animations visible
- Edge runtime: API routes use minimal dependencies

## 12. Security Considerations

### 12.1 Authentication & Authorization
- ✅ All dashboard routes protected by Clerk middleware
- ✅ Server actions verify `clerkId` before database access
- ✅ User ID resolved server-side, never trusted from client
- ✅ Room membership verified on every file/message/quiz action
- ✅ Document chunks scoped to owner, no cross-user leakage

### 12.2 Input Validation
- ✅ File uploads: Type whitelist, size limits (12MB quiz, configurable docs)
- ✅ Quiz answers: Sanitized before storage, no script injection
- ✅ Room messages: Length limits, content filtered for XSS
- ✅ Task dates: Parsed with safe date library, invalid dates rejected
- ✅ SQL injection: Drizzle ORM parameterizes all queries

### 12.3 API Security
- ✅ Clerk webhook: Signature verification before user sync
- ✅ Rate limiting: Implicit via Vercel function limits
- ✅ API keys: Server-side only, never exposed to client
- ✅ CORS: Default Next.js policy (same-origin)

### 12.4 Data Privacy
- ✅ User deletion: Cascade to all owned records
- ✅ Room files: Never served as public URLs
- ✅ Phone numbers: Optional, E.164 validated, used only for opted-in SMS
- ✅ Tone labels: Stored as non-clinical metadata, not medical diagnoses
- ✅ Chat history: Visible only to owner, not shared across users

## 13. Testing Strategy

### 13.1 Unit Tests (Target Coverage: 70%+)
- AI prompt construction and mode instructions
- Voice command parsing (built-in + page-specific)
- Target collection and fuzzy name matching
- Date parsing for task capture (multiple languages)
- Quiz grading logic for each question type
- Leaderboard calculation accuracy
- TTS chunk splitting at sentence boundaries

### 13.2 Integration Tests
- End-to-end chat flow: input → AI → storage → display
- Quiz generation from document: upload → process → questions
- Room creation + join → chat → file sharing
- Live quiz flow: lobby → question → answer → reveal → leaderboard
- Task reminder: create → due date reached → SMS sent

### 13.3 E2E Tests (Critical Paths)
- Sign up → verify email → first chat session
- Voice Q&A: speak → transcribe → AI response → TTS playback
- Quiz: generate → answer → submit → see score
- Study room: create → share code → classmate joins → chat exchange
- Voice navigation: enable → navigate → click element → hear confirmation

### 13.4 Browser Compatibility Matrix
| Feature | Chrome | Edge | Safari | Firefox |
|---|---|---|---|---|
| Speech Recognition | ✅ | ✅ | ❌ | ❌ |
| Web Audio TTS | ✅ | ✅ | ✅ | ✅ |
| Voice Navigation | ✅ | ✅ | Fallback | Fallback |
| All other features | ✅ | ✅ | ✅ | ✅ |

*Note: Safari/Firefox lack Web Speech API; voice features fall back to typed input.*

## 14. Deployment & Infrastructure

### 14.1 Environment Variables
```
# Authentication
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
CLERK_WEBHOOK_SECRET=whsec_...

# Database
DATABASE_URL=postgresql://user:pass@host/db

# AI Services
GOOGLE_AI_API_KEY=AIzaSy...
GOOGLE_AI_API_KEY_2=AIzaSy...  # Rotation fallback
GOOGLE_AI_API_KEY_3=AIzaSy...  # Rotation fallback

# SMS Gateway (optional)
SMS_GATEWAY_URL=https://your-domain.com/sms/notify.php
SMS_API_KEY=your-semaphore-key

# App Configuration
NEXT_PUBLIC_APP_URL=https://eduvoice.vercel.app
NODE_ENV=production
```

### 14.2 Vercel Configuration
- **Framework:** Next.js
- **Build Command:** `npm run build`
- **Output Directory:** `.next`
- **Install Command:** `npm install`
- **Functions:** Serverless (API routes) + Edge (middleware)
- **Regions:** Auto (nearest to users)
- **Node Version:** 20.x

### 14.3 Database Migrations
- **Tool:** Drizzle Kit
- **Migration files:** `drizzle/*.sql`
- **Generate:** `npm run db:generate`
- **Apply:** `npm run db:migrate`
- **Studio:** `npm run db:studio` (local GUI)

### 14.4 Monitoring & Observability
- **Error tracking:** Vercel Analytics (default)
- **Performance:** Web Vitals (LCP, FID, CLS)
- **AI costs:** Log API calls per model/operation
- **Usage metrics:** User count, session duration, feature adoption
- **Voice metrics:** Recognition success rate, command accuracy

## 15. Future Enhancements (Post-MVP)

### 15.1 Planned Features (Partially Implemented)
- **F03: Document Q&A** - Schema ready, processing pending
- **F10: Progress Visualization** - Data collected, charts pending
- **F12: Smart Flashcards** - Tables exist, generation + SRS algorithm pending
- **F15: Adaptive Planner** - Table ready, AI generation logic pending

### 15.2 Technical Improvements
- **Vector Search:** Add pgvector for semantic document Q&A
- **Real-time Updates:** Replace polling with WebSockets/Server-Sent Events
- **Mobile App:** React Native wrapper with native speech APIs
- **Offline Mode:** Service worker + IndexedDB for chat cache
- **CDN Audio:** Move TTS cache from filesystem to R2/S3 + CloudFront

### 15.3 Feature Expansions
- **Group Study Sessions:** Video/audio calls within rooms
- **Gamification:** Badges, streaks, achievement system
- **Content Marketplace:** Share/discover quiz packs
- **Teacher Dashboard:** Class management, assignment tracking
- **Advanced Analytics:** Learning velocity, knowledge graphs

### 15.4 Accessibility Enhancements
- **Screen reader:** Enhanced ARIA labels and live regions
- **Keyboard navigation:** Complete shortcuts for power users
- **High contrast:** Theme switcher with WCAG AAA compliance
- **Dyslexia mode:** OpenDyslexic font + enhanced spacing
- **Closed captions:** Real-time STT transcript overlay

## 16. Glossary

| Term | Definition |
|---|---|
| **Attempt** | One run through a quiz with stored answers and score |
| **Chunk** | Paragraph-sized piece of a document for Q&A retrieval |
| **Clerk ID** | External user identifier from Clerk authentication |
| **Debate Mode** | Chat mode where AI takes opposing stance |
| **Gemini** | Google's AI model family used for chat, TTS, and content generation |
| **Hint Mode** | Chat mode that guides without revealing full answers |
| **Interview Mode** | Chat mode simulating job interview practice |
| **Join Code** | Shareable alphanumeric code to join a study room |
| **Leaderboard** | Ranked list of quiz scores within a study room |
| **Live Quiz** | Synchronized quiz session where all room members answer together |
| **Page Command** | Voice command registered by current screen (context-specific) |
| **Phrase Bank** | Pre-synthesized audio clips for instant voice navigation feedback |
| **Room** | Collaborative study space with chat, files, and shared quizzes |
| **SM-2 Algorithm** | Spaced repetition algorithm for flashcard scheduling |
| **Target** | Interactive element on screen that voice navigation can activate |
| **Tone** | Detected emotional sentiment of user message (non-clinical) |
| **TTS** | Text-to-Speech synthesis via Gemini or browser APIs |
| **User ID** | Internal PostgreSQL UUID, resolved from Clerk ID |
| **Voice Mode** | Chat with continuous speech input and spoken responses |
| **Voice Navigation** | Hands-free dashboard control via spoken commands |

## 17. References & Documentation

### 17.1 Related Documents
- `EduVoice_Guide.md` - User-facing feature guide
- `SCHEMA.md` - Detailed database design documentation
- `ACTIVITY_DIAGRAM.md` - Visual user flow diagrams
- `EduVoice_stack.md` - Technology stack decisions
- `CLAUDE.md` - AI interaction guidelines
- `AGENTS.md` - Development agent rules

**Purpose:** Support peer study, shared quizzes, and friendly competition.

**Requirements:**

- Allow an authenticated student to create a room with a unique join code.
- Allow another student to join or leave a room.
- Enforce owner and member permissions.
- Support room messages and member/state refresh.
- Link room quiz attempts to the room leaderboard.
- Handle deleted rooms, invalid codes, and membership changes safely.

**Acceptance criteria:** A room owner can create a room, a classmate can join with its code, both can exchange messages, and completed room-linked quiz attempts appear in the leaderboard data.

### F14. Accessibility voice navigation

**Purpose:** Make the dashboard operable without relying on continuous pointer or keyboard use.

**Requirements:**

- Wrap the authenticated dashboard in a shared voice-navigation provider.
- Support navigation commands for dashboard destinations in English, Filipino, and Cebuano synonyms.
- Support control commands such as help, stop, repeat, read page, scroll, back, next, previous, activate, and refresh targets.
- Register page-specific commands for interactive workflows such as quizzes.
- Expose current command, feedback, listening state, microphone state, and recognition errors.
- Provide a typed or pointer fallback for every critical operation.
- Respect microphone permission and allow the user to turn voice navigation off.

**Acceptance criteria:** A student can say a navigation command to open a dashboard section and can use help, target activation, scrolling, and stop commands without leaving the current dashboard session.

### F15. Adaptive study planner

**Purpose:** Convert performance data into a practical weekly study plan.

**Requirements:**

- Use quiz accuracy, weak topics, study history, and due review work as inputs.
- Generate a weekly plan with topics and activities by day.
- Store one plan per learner and week.
- Regenerate or update the plan when a learner requests it or meaningful performance changes occur.
- Explain why a topic was prioritized.

**Acceptance criteria:** A learner with sufficient history receives a weekly plan that prioritizes weaker topics and schedules review activities; a learner without history receives a setup state instead.

## 8. Core User Flows

### 8.1 Tutor conversation

1. The student opens Chat and selects Chat, Hint, Debate, or Interview mode.
2. The student types a message or speaks it through browser recognition.
3. EduVoice normalizes the input, detects language and tone, and stores the user message.
4. The system loads the conversation context and sends a mode-specific prompt to Gemini.
5. The assistant response is stored and displayed.
6. The student optionally selects Listen or continues by voice.

### 8.2 Study material to practice

1. The student uploads a supported study file.
2. EduVoice creates a document record and processes the file.
3. The system stores a summary and document chunks when processing succeeds.
4. The student asks grounded questions or requests a quiz.
5. EduVoice creates ordered questions and stores the quiz.
6. The student completes the quiz and the system stores the attempt and answers.

### 8.3 Voice task capture

1. The student opens Tasks and starts capture.
2. The student dictates a task, date, and optional time.
3. The browser transcribes the utterance.
4. EduVoice parses the task and due date and shows the draft.
5. The student confirms, edits, discards, or lets the configured pause behavior save it.
6. The task is stored with `source = voice` and appears in the task list.

### 8.4 Collaborative quiz

1. A student creates a study room and shares its join code.
2. Classmates join and see room membership and messages.
3. A member starts a quiz linked to the room.
4. The member submits the quiz.
5. EduVoice stores the attempt with the room ID and refreshes leaderboard data.

### 8.5 Voice navigation

1. The student enables Voice Navigation from the dashboard.
2. EduVoice listens for a final utterance and parses it against built-in and page-specific commands.
3. A recognized command opens a route, activates a visible target, scrolls, reads content, or runs a page action.
4. EduVoice announces the result using speech synthesis.
5. An unrecognized command leaves the current screen unchanged and offers help or recovery feedback.

## 9. System Architecture

```mermaid
flowchart LR
    Browser[Student browser\nNext.js UI + Web Speech APIs]
    Auth[Clerk authentication]
    App[Next.js App Router\nserver actions and API routes]
    AI[Google AI Studio\nGemini and speech services]
    DB[(Neon PostgreSQL\nDrizzle ORM)]
    Host[Vercel]

    Browser --> Auth
    Browser --> App
    App --> Auth
    App --> AI
    App --> DB
    Host --> App
```

### Technology boundaries

- **Frontend:** Next.js App Router, React, Tailwind CSS, Lucide icons, Motion/GSAP where used by the existing UI.
- **Authentication:** Clerk for sign-in, sign-up, route protection, and user identity.
- **AI:** Google AI Studio through `@google/genai`; provider key rotation and failure handling belong in the server-side AI layer.
- **Speech:** Browser speech recognition for input and the shared speech/TTS engine for spoken output.
- **Persistence:** PostgreSQL on Neon or local PostgreSQL, accessed through Drizzle ORM.
- **Deployment:** Vercel, with environment variables for authentication, database, and AI provider configuration.

## 10. Data and Ownership Rules

- Every user-owned record is scoped to the local `users.id` derived from the Clerk identity.
- Deleting a user cascades to their owned conversations, documents, quizzes, attempts, tasks, flashcards, rooms, plans, and study sessions according to the schema.
- Shared references such as a document attached to a quiz, deck, or room are set to null when the document is removed.
- A study-room member may read room state and messages only while membership is valid.
- A quiz attempt is visible to its owner and, when room-linked, to the room's supported leaderboard view.
- Voice audio is not required to be stored in the relational schema; the current model stores transcribed text and metadata.
- Semantic retrieval may later add vector storage to document chunks; until then, grounded document Q&A must not imply retrieval that is not implemented.

## 11. Non-Functional Requirements

### Security and privacy

- Protect all dashboard routes with Clerk authentication.
- Authorize every server action using the authenticated user, not a client-provided user ID.
- Keep AI provider keys and database credentials server-side.
- Validate file type, size, content, and processing status before use.
- Avoid exposing private document text, chat history, tasks, or room data across users.
- Treat tone labels as non-clinical product metadata.

### Reliability and recovery

- Show recoverable errors for unavailable AI, database, microphone, speech-recognition, and TTS services.
- Preserve typed text and completed user input when a downstream provider fails.
- Make repeated submissions idempotent where duplicate attempts could create incorrect scores or tasks.
- Use explicit loading, empty, success, and failure states for asynchronous features.

### Accessibility and usability

- Provide a non-voice fallback for every voice-controlled operation.
- Expose accessible names, focus states, and status announcements for interactive controls.
- Do not make speech recognition the only way to complete a critical flow.
- Keep text readable and avoid relying on color alone for status.

### Performance

- Avoid unnecessary database polling when a page is hidden.
- Paginate or bound long chat, room-message, document, and activity queries.
- Keep spoken responses within provider and browser limits.
- Process document work asynchronously when file size or provider latency requires it.

## 12. Delivery Roadmap

### Release 1: Core study loop

- Stabilize authentication and local user synchronization.
- Maintain Chat, voice Q&A, TTS, language support, Hint, Debate, and Interview modes.
- Maintain quiz generation, completion, scoring, and persistence.
- Complete error, loading, and accessibility states for the core loop.

### Release 2: Personal materials and organization

- Complete document upload, extraction, summary, chunking, and grounded Q&A.
- Complete flashcard generation and spaced-repetition review.
- Maintain voice and typed task capture with robust date parsing.

### Release 3: Insight and planning

- Implement progress queries and visualizations from completed attempts and study sessions.
- Add weak-topic analysis and next-activity recommendations.
- Implement adaptive weekly study plans and regeneration rules.

### Release 4: Collaborative and production hardening

- Harden room authorization, polling behavior, moderation, and leaderboard consistency.
- Add telemetry for feature success measures.
- Perform browser compatibility, accessibility, security, and load testing.

### 17.2 External Resources
- [Next.js Documentation](https://nextjs.org/docs)
- [Drizzle ORM](https://orm.drizzle.team/)
- [Clerk Authentication](https://clerk.com/docs)
- [Google AI Studio](https://ai.google.dev/)
- [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API)
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)

### 17.3 Code Locations
| Component | Path |
|---|---|
| Database Schema | `src/lib/db/schema.ts` |
| Chat Feature | `src/features/chat/` |
| Voice Navigation | `src/features/voice-nav/` |
| Quiz System | `src/features/quiz/` |
| Study Rooms | `src/features/rooms/` |
| Tasks | `src/features/tasks/` |
| Speech Engine | `src/features/chat/lib/speechEngine.ts` |
| Voice Commands | `src/features/voice-nav/lib/commands.ts` |
| AI Integration | `src/lib/ai/` |
| API Routes | `src/app/api/` |
| Server Actions | `*/server/actions.ts` files |

## 18. Appendix: Feature Status Summary

| ID | Feature Name | Status | Completion | Priority |
|---|---|---|---|---|
| F01 | Text-to-Speech AI Responses | ✅ Implemented | 100% | Critical |
| F02 | Hint Mode | ✅ Implemented | 100% | High |
| F03 | Document-Based Q&A | ⚠️ Partial | 40% | High |
| F04 | Quiz Generation | ✅ Implemented | 100% | Critical |
| F05 | Language Detection | ✅ Implemented | 100% | Critical |
| F06 | Debate Mode | ✅ Implemented | 100% | Medium |
| F07 | Interview Mode | ✅ Implemented | 100% | Medium |
| F08 | Voice-Based Q&A | ✅ Implemented | 100% | Critical |
| F09 | Hands-Free Task Capture | ✅ Implemented | 100% | High |
| F10 | Progress Visualization | ✅ Implemented | 90% | High |
| F11 | Tone & Mood Detection | ✅ Implemented | 100% | Medium |
| F12 | Smart Flashcards | ⚠️ Partial | 20% | Medium |
| F13 | Collaborative Study Rooms | ✅ Implemented | 100% | High |
| F14 | Voice Navigation | ✅ Implemented | 100% | Critical |
| F15 | Adaptive Study Planner | ⚠️ Partial | 15% | Low |

**Legend:**
- ✅ Implemented: Feature is functional and user-accessible
- ⚠️ Partial: Data model exists, user-facing implementation incomplete
- ❌ Planned: Not yet started (none currently)

**Overall Platform Completion: ~82%**

---

## Document Changelog

| Version | Date | Changes | Author |
|---|---|---|---|
| 1.0 | 2026-10-12 | Initial FDD with 15 features | EduVoice Team |
| 2.0 | 2026-10-16 | Complete technical architecture, API documentation, data flows, security, testing strategy, and deployment details | EduVoice Team |

---

**Document Status:** ✅ Complete and Current  
**Last Review:** 2026-10-16  
**Next Review:** 2026-11-01  

**For questions about this document, contact the EduVoice development team.**
