# EduVoice — Activity Diagrams (WITH PARTITION)

With-partition (swimlane) activity diagrams for EduVoice's four modules, drawn
in the same notation as the whiteboard example: **partitions** as vertical
lanes, **actions** as boxes, **decisions** as diamonds, and **guards** in
brackets — `[Accepted]`, `[Rejected]`.

Each module's lanes are cut from the same set:

| Partition | Meaning |
| --- | --- |
| **STUDENT** | What the user does (equivalent of the whiteboard's TEACHER lane) |
| **CLASSMATES** | Other students in a shared room (study-room module only) |
| **EDUVOICE SYSTEM** | Next.js server actions — validation, detection, grading, orchestration |
| **AI (GOOGLE AI STUDIO)** | Gemini — replies, quiz writing, spoken audio (rotating free-tier keys) |
| **DATABASE (NEON POSTGRES)** | Postgres tables via Drizzle |

Every diagram reflects the code as implemented (`src/features/*`); the one
exception is noted in the Progress module, whose page is still a placeholder
but whose tables and queries are designed and partly exercised.

## Module map

| Module | Features covered | Lanes used |
| --- | --- | --- |
| 1. Chat | 6.1 TTS AI response · 6.2 Hint Mode · 6.4 Quiz generation · 6.5 Language detection · 6.6 Debate Mode · 6.7 Interview Mode · 6.8 Voice-based conversation · 6.11 Tone & Mood Detector | STUDENT · SYSTEM · AI · DATABASE |
| 2. Progress Summary & Trends | 6.10 Progress Visualization | STUDENT · SYSTEM · DATABASE |
| 3. To-do | 6.9 Hands-Free Task Capture | STUDENT · SYSTEM · DATABASE |
| 4. Collaborative Study Room | 6.13 Collaborative Study Rooms | STUDENT · CLASSMATES · SYSTEM · DATABASE |

---

## 1. Chat Module

Covers: 6.1 TTS AI response · 6.2 Hint Mode · 6.4 Quiz generation · 6.5
Language detection · 6.6 Debate Mode · 6.7 Interview Mode · 6.8 Voice-based
conversation · 6.11 Tone & Mood Detector.

One spoken-or-typed turn, showing where each feature fires: language is
detected on entry (6.5), tone right after it (6.11), the mode pick switches the
AI's instruction (6.2/6.6/6.7), a quiz request branches to JSON generation
(6.4), and the reply can be spoken back (6.1).

### Mermaid

```mermaid
flowchart TD
    Start([Start]) --> ST_Input

    subgraph P_STUDENT["STUDENT"]
        ST_Input["Speak (6.8) or type a message"]
        ST_Mode["Pick mode: Chat · Hint (6.2) · Debate (6.6) · Interview (6.7)"]
        ST_Listen["Tap Listen"]
        ST_Play["Hear spoken reply"]
        Stop([Stop])
    end

    subgraph P_SYSTEM["EDUVOICE SYSTEM"]
        SY_Transcribe["Speech-to-text (browser)"]
        SY_Lang["Detect language: EN · FIL · CEB (6.5)"]
        SY_Tone["Detect tone: frustrated · confused · positive · neutral (6.11)"]
        SY_Save1["Save user message + language + tone"]
        SY_History["Load conversation history"]
        SY_QuizPick{"Student asked for a quiz?"}
        SY_Ask["Send prompt + mode instruction"]
        SY_Reply["Save AI reply"]
        SY_Tts["Send reply text to TTS"]
    end

    subgraph P_AI["AI (GOOGLE AI STUDIO)"]
        AI_Tutor["Compose tutor reply<br/>(mode instruction: hint = clues only,<br/>debate = opposing stance,<br/>interview = one question + feedback)"]
        AI_Quiz["Write quiz questions — JSON only (6.4)"]
        AI_Speak["Synthesize speech audio (6.1)"]
    end

    subgraph P_DB["DATABASE (NEON POSTGRES)"]
        DB_Msg[("chat_messages<br/>chat_sessions")]
        DB_Quiz[("quizzes ·<br/>quiz_questions")]
    end

    ST_Input --> SY_Transcribe
    SY_Transcribe --> ST_Mode
    ST_Mode --> SY_Lang
    SY_Lang --> SY_Tone
    SY_Tone --> SY_Save1
    SY_Save1 --> DB_Msg
    SY_Save1 --> SY_History
    SY_History --> SY_QuizPick
    SY_QuizPick -->|"[Yes — quiz me]"| SY_Ask
    SY_Ask --> AI_Quiz
    AI_Quiz --> DB_Quiz
    SY_QuizPick -->|"[No — normal turn]"| SY_Ask
    SY_Ask --> AI_Tutor
    AI_Tutor --> SY_Reply
    SY_Reply --> DB_Msg
    SY_Reply --> ST_Listen
    ST_Listen --> SY_Tts
    SY_Tts --> AI_Speak
    AI_Speak --> ST_Play
    ST_Play --> ST_Input
```

### PlantUML

```plantuml
@startuml
title Chat Module — one tutor turn (6.1, 6.2, 6.4, 6.5, 6.6, 6.7, 6.8, 6.11)

|STUDENT|
start
:Speak (6.8) or type a message;

|EDUVOICE SYSTEM|
:Speech-to-text (browser);
:Detect language EN / FIL / CEB (6.5);
:Detect tone — frustrated, confused,<br/>positive, neutral (6.11);

|DATABASE (NEON POSTGRES)|
:Save user message + language + tone;

|EDUVOICE SYSTEM|
:Load conversation history;
if (Student asked for a quiz?) then ([Yes — 6.4])
  |AI (GOOGLE AI STUDIO)|
  :Write quiz questions — JSON only;
  |DATABASE (NEON POSTGRES)|
  :Save quiz + questions;
else ([No — normal turn])
endif

|EDUVOICE SYSTEM|
:Send prompt with mode instruction<br/>(6.2 hint = clues only · 6.6 debate =<br/>opposing stance · 6.7 interview =<br/>one question + feedback);

|AI (GOOGLE AI STUDIO)|
:Compose tutor reply;

|EDUVOICE SYSTEM|
:Save AI reply;

|STUDENT|
if (Wants it spoken?) then ([Yes — 6.1])
  :Tap Listen;
  |EDUVOICE SYSTEM|
  :Send reply text to TTS;
  |AI (GOOGLE AI STUDIO)|
  :Synthesize speech audio;
  |STUDENT|
  :Hear spoken reply;
else ([No])
endif

:Continue the conversation;
stop
@enduml
```

**Database touchpoints:** `chat_sessions` (mode, language, title) ·
`chat_messages` (role, content, language, tone, provider) · `quizzes` +
`quiz_questions` when a quiz request branches (6.4).

---

## 2. Progress Summary & Trends Module

Covers: 6.10 Progress Visualization and Summary Trends.

Aggregates finished work into charts and trends, then closes the loop by
pointing the student at their weakest topic. Note: the tables, aggregates, and
index design below exist in the schema and were exercised against the database;
the charts page itself is still a `ComingSoon` placeholder, so this diagram is
the designed flow.

### Mermaid

```mermaid
flowchart TD
    Start([Start]) --> ST_Open

    subgraph P_STUDENT["STUDENT"]
        ST_Open["Open Progress page"]
        ST_Read["Read charts and trend summary"]
        ST_Pick["Pick the weakest suggested topic"]
        Stop([Stop])
    end

    subgraph P_SYSTEM["EDUVOICE SYSTEM"]
        SY_Gather["Aggregate finished activity:<br/>quiz scores · study time · per-topic accuracy"]
        SY_Trend["Compute trends:<br/>accuracy over time · weak topics"]
        SY_Render["Render charts + summary"]
        SY_Suggest["Suggest what to study next"]
    end

    subgraph P_DB["DATABASE (NEON POSTGRES)"]
        DB_Attempts[("quiz_attempts<br/>(completed_at not null)")]
        DB_Answers[("quiz_answers<br/>quiz_questions")]
        DB_Sessions[("study_sessions")]
    end

    ST_Open --> SY_Gather
    DB_Attempts --> SY_Gather
    DB_Answers --> SY_Gather
    DB_Sessions --> SY_Gather
    SY_Gather --> SY_Trend
    SY_Trend --> SY_Render
    SY_Render --> ST_Read
    SY_Trend --> SY_Suggest
    SY_Suggest --> ST_Pick
    ST_Pick --> Stop
```

### PlantUML

```plantuml
@startuml
title Progress Summary & Trends (6.10)

|STUDENT|
start
:Open Progress page;

|EDUVOICE SYSTEM|

|DATABASE (NEON POSTGRES)|
:Read completed quiz_attempts,<br/>quiz_answers + questions,<br/>study_sessions;

|EDUVOICE SYSTEM|
:Aggregate scores, study time,<br/>per-topic accuracy;
:Compute trends — accuracy over time,<br/>strong vs weak topics;
:Render charts + trend summary;

|STUDENT|
:Read charts and trend summary;
:Pick the weakest suggested topic;

note right: Picking a topic leads straight back<br/>to the quiz flow (6.4)

stop
@enduml
```

**Database touchpoints:** `quiz_attempts` (indexed on `user_id, completed_at`)
· `quiz_answers` + `quiz_questions` (per-topic correctness) · `study_sessions`
(activity type, topic, duration).

---

## 3. To-do Module

Covers: 6.9 Hands-Free Task Capture.

The hands-free path: dictate a task, the system transcribes and stores it with
`source = voice`; typed entry follows the same path with `source = text`.

### Mermaid

```mermaid
flowchart TD
    Start([Start]) --> ST_Choice

    subgraph P_STUDENT["STUDENT"]
        ST_Choice{"Dictate or type?"}
        ST_Speak["Dictate the task (6.9)"]
        ST_Type["Type the task"]
        ST_Confirm["See the task appear in the list"]
        ST_Done["Mark the task done"]
        Stop([Stop])
    end

    subgraph P_SYSTEM["EDUVOICE SYSTEM"]
        SY_Transcribe["Speech-to-text (browser)"]
        SY_Parse["Extract title and due date"]
        SY_Save["Save task · source = voice or text"]
        SY_List["Load pending tasks"]
    end

    subgraph P_DB["DATABASE (NEON POSTGRES)"]
        DB_Tasks[("tasks<br/>(indexed on user + completed)")]
    end

    ST_Choice -->|"[Dictate]"| ST_Speak
    ST_Speak --> SY_Transcribe
    ST_Choice -->|"[Type]"| ST_Type
    ST_Type --> SY_Parse
    SY_Transcribe --> SY_Parse
    SY_Parse --> SY_Save
    SY_Save --> DB_Tasks
    SY_Save --> ST_Confirm
    SY_List --> ST_Confirm
    ST_Confirm --> ST_Done
    ST_Done --> DB_Tasks
    ST_Done --> Stop
```

### PlantUML

```plantuml
@startuml
title To-do Module — Hands-Free Task Capture (6.9)

|STUDENT|
start
if (Dictate or type?) then ([Dictate])
  :Dictate the task;
  |EDUVOICE SYSTEM|
  :Speech-to-text (browser);
else ([Type])
  :Type the task;
endif

|EDUVOICE SYSTEM|
:Extract title and due date;

|DATABASE (NEON POSTGRES)|
:Save task with source = voice or text;

|STUDENT|
:See the task appear in the list;
:Mark the task done;

|DATABASE (NEON POSTGRES)|
:Update completed;

stop
@enduml
```

**Database touchpoints:** `tasks` (title, description, `due_date`, `completed`,
`source` enum `voice | text`, indexed on `user_id, completed`).

---

## 4. Collaborative Study Room Module

Covers: 6.13 Collaborative Study Rooms.

The full room lifecycle with a CLASSMATES lane, because the module is
meaningless without other people: rooms are created and joined by code, chat is
polled live, and every finished quiz stamped with the room's `room_id` lands on
the shared leaderboard.

### Mermaid

```mermaid
flowchart TD
    Start([Start]) --> ST_SignIn

    subgraph P_STUDENT["STUDENT"]
        ST_SignIn["Sign in"]
        ST_Room{"Have a join code?"}
        ST_Create["Create a room"]
        ST_Join["Enter the 6-character code"]
        ST_Chat["Send chat messages"]
        ST_Quiz["Tap Take a room quiz<br/>and answer it (6.4 flow)"]
        ST_Watch["Watch the leaderboard update"]
        Stop([Stop])
    end

    subgraph P_CLASSMATES["CLASSMATES"]
        CL_Join["Join with the shared code"]
        CL_Chat["Reply in room chat"]
        CL_Quiz["Finish room quizzes"]
    end

    subgraph P_SYSTEM["EDUVOICE SYSTEM"]
        SY_Auth{"Accepted?"}
        SY_Invalid["Show: invalid credentials"]
        SY_Code{"Code valid?"}
        SY_CodeBad["Show: no room matches that code"]
        SY_Room["Show room: chat · members · leaderboard"]
        SY_Poll["Poll for new messages every 3 s<br/>(paused while the tab is hidden)"]
        SY_Stamp["Open attempt stamped with room_id"]
        SY_Grade["Grade server-side and close the attempt"]
        SY_Board["Recompute leaderboard:<br/>accuracy first, then points"]
    end

    subgraph P_DB["DATABASE (NEON POSTGRES)"]
        DB_Room[("study_rooms<br/>study_room_members<br/>room_messages")]
        DB_Attempt[("quiz_attempts (room_id)<br/>quiz_answers")]
    end

    ST_SignIn --> SY_Auth
    SY_Auth -->|"[Rejected]"| SY_Invalid
    SY_Invalid --> ST_SignIn
    SY_Auth -->|"[Accepted]"| ST_Room

    ST_Room -->|"[No — create]"| ST_Create
    ST_Room -->|"[Yes — join]"| ST_Join
    ST_Join --> SY_Code
    SY_Code -->|"[Invalid]"| SY_CodeBad
    SY_CodeBad --> ST_Join
    SY_Code -->|"[Valid]"| DB_Room
    ST_Create --> DB_Room
    CL_Join --> DB_Room
    DB_Room --> SY_Room

    SY_Room --> ST_Chat
    ST_Chat --> DB_Room
    CL_Chat --> DB_Room
    DB_Room --> SY_Poll
    SY_Poll --> ST_Chat

    SY_Room --> ST_Quiz
    ST_Quiz --> SY_Stamp
    SY_Stamp --> DB_Attempt
    CL_Quiz --> DB_Attempt
    ST_Quiz --> SY_Grade
    SY_Grade --> DB_Attempt
    DB_Attempt --> SY_Board
    SY_Board --> ST_Watch
    ST_Watch --> Stop
```

### PlantUML

```plantuml
@startuml
title Collaborative Study Room (6.13)

|STUDENT|
start
:Sign in;

|EDUVOICE SYSTEM|
if (Accepted?) then ([Accepted])
else ([Rejected])
  :Show "Invalid credentials";
  |STUDENT|
  :Sign in again;
  |EDUVOICE SYSTEM|
  detach
endif

|STUDENT|
if (Have a join code?) then ([Yes — join])
  :Enter the 6-character code;
  |EDUVOICE SYSTEM|
  if (Code valid?) then ([Valid])
  else ([Invalid])
    :Show "No room matches that code";
    detach
  endif
else ([No — create])
  :Create a room;
endif

|DATABASE (NEON POSTGRES)|
:Save study_rooms + study_room_members<br/>(owner or member role);

|CLASSMATES|
:Join with the shared code;

|EDUVOICE SYSTEM|
:Show room — chat, members, leaderboard;

|STUDENT|
:Send chat messages;

|CLASSMATES|
:Reply in room chat;

|EDUVOICE SYSTEM|
:Poll for new messages every 3 s<br/>(paused while the tab is hidden);

|STUDENT|
:Tap "Take a room quiz" and answer it;

|EDUVOICE SYSTEM|
:Open attempt stamped with room_id;
:Grade server-side and close the attempt<br/>(score, total, completed_at);

|CLASSMATES|
:Finish room quizzes too;

|DATABASE (NEON POSTGRES)|
:Save quiz_attempts + quiz_answers;

|EDUVOICE SYSTEM|
:Recompute leaderboard —<br/>accuracy first, then points;

|STUDENT|
:Watch the leaderboard update;
stop
@enduml
```

**Database touchpoints:** `study_rooms` (unique `join_code`, optional shared
`document_id`) · `study_room_members` (role enum, unique per room + user) ·
`room_messages` (polled chat) · `quiz_attempts.room_id` — the column that ties
a score to a room — plus `quiz_answers`.

---

## Cross-module notes

- **Sign-in is shared.** Every module starts behind Clerk authentication; the
  `[Accepted] / [Rejected]` loop is drawn in full only in module 4.
- **Feature 6.4 appears twice by design.** Generation lives in the Chat module
  (per the module breakdown), and the Study Room module reuses it for
  room-attributed quizzes — the attempt's `room_id` is the hand-off between the
  two.
- **Features 6.3 (document Q&A), 6.12 (flashcards), 6.14 (voice navigation) and
  6.15 (adaptive planner) are out of scope here** — they belong to the
  documents, flashcards, and planner modules, which are not in this breakdown.
