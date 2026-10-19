# What Students Can Do in EduVoice

Every action available to a student, listed twice:

1. **[By page](#part-1--by-page)** — one section per screen, in the order a student meets them.
2. **[By feature](#part-2--by-feature)** — the same actions regrouped by feature (task capture, quiz, voice navigation, …).

Everything is in **English, Filipino, or Cebuano** unless stated otherwise — the app detects which one you use and answers back in it.

---

## Part 1 — By page

### 1. Landing page — `/`

- Scroll through the sections from the navbar: **Home**, **Features**, **How it works**, **Languages** (anchor links; the active one highlights as you scroll).
- Watch the background hero video ("Learn out loud." headline with rotating role words).
- Click **Get started free** (hero, Features, How-it-works, and bottom CTA) → goes to registration.
- Click **See how it works** → scrolls to the How-it-works section.
- Click **Sign in** (when signed out) → `/sign-in`.
- Click **Get started** (navbar) → `/sign-up`.
- When already signed in: click **Dashboard** → `/dashboard`, and open the **account avatar** (Clerk `UserButton`) to manage the account or sign out.
- Open/close the **mobile menu** (hamburger icon on small screens) and use the same links inside it.
- Use the footer: jump to **Features / How it works / Languages**, **Get started** (`#cta`), open **Twitter / LinkedIn / GitHub** links, tap the logo to return to the top.

### 2. Register — `/sign-up`

- Create an account with the Clerk sign-up form (email + password, and any social/SSO options Clerk shows).
- Verify the email as required by Clerk.
- After registering, land automatically on `/dashboard`.

### 3. Log in — `/sign-in`

- Sign in with the Clerk form (email + password or social sign-in).
- Land on `/dashboard` after signing in.
- Be redirected here from **any** protected `/dashboard/...` page when not signed in.

### 4. Account (sidebar footer, topbar, navbar)

- Open the **avatar / My account** menu (Clerk) to view the profile, change details or a profile photo, and **sign out**.
- On the Overview page, see your **email**, **name**, and **DB sync** status (Synced / Pending / Unavailable) — the profile is synced from Clerk into the local `users` table automatically.
- See a **Database unavailable** banner with fix instructions if the profile could not be synced.

### 5. Dashboard shell — every `/dashboard/...` page

- Navigate the sidebar: **Overview, Chat, Quiz, Documents, Flashcards, Tasks, Study Rooms, Progress** (current page is highlighted; each item shows an icon + description on hover).
- Click the **logo** in the sidebar → back to the landing page `/`.
- On phones: **open the menu** (hamburger) and **close it** (X or tapping the backdrop); links close it after navigating.
- Read the **topbar page title** (matches the current section).
- Toggle **Voice Navigation** from the topbar mic badge (or press **Alt + V** anywhere).
- Open the **account avatar** from the topbar (see Account above).

### 6. Overview page — `/dashboard`

- See today's date and a personalized **"Welcome back, {first name}"** greeting.
- Use the **quick actions**: **Start a chat** → `/dashboard/chat`, **Generate a quiz** → `/dashboard/quiz`, **Add a task** → `/dashboard/tasks`.
- Read the four **stat cards**: Study sessions, Quizzes taken, Avg. score, Tasks pending (with hints on how to populate them).
- Check the **Account** panel (email, name, DB sync status).
- Work through the **Getting started** checklist: Create your account ✔, Set up your profile ✔, **Start your first chat** (clickable link), **Take your first quiz** (clickable link) — each unfinished item is a link.
- Read the **Recent activity** feed (fills in with study sessions, quiz results, and tasks as you use the app).

### 7. Chat page — `/dashboard/chat` and `/dashboard/chat/{sessionId}`

**Composer (the input box)**

- **Type a question** and press **Enter** to send (**Shift+Enter** for a new line), or press the **Send** button.
- Press the **mic button** to dictate your question (interim words appear italicized; press again to stop); disabled with a tooltip if the browser has no speech recognition.
- Open the **“+” menu** to:
  - **Upload file** — attach files (chips show name + size with an ✕ to remove each one). Note: attachments are **preview only — not sent to the tutor yet**.
  - **Switch mode**: **Chat** (normal answers), **Hint** (one clue at a time, solve it yourself), **Debate** (AI takes the opposing stance), **Interview** (AI interviews you, question by question, with feedback). The choice is saved to the session.
- Pick the **Tutor voice** from the voice dropdown (saved in the browser, persists across visits).
- Press the **Voice mode** pill → opens the hands-free voice call (see the Voice mode section below).

**Conversation**

- Scroll the thread (auto-scrolls to new messages; grows the composer up to ~8 lines).
- See your messages with **language badges** ("Filipino detected" / "Cebuano detected") and **tone badges** (😤 Frustrated / 🤔 Confused).
- See the tutor's replies with the **provider label** (which AI answered) and a loading equalizer while it thinks.
- Press **Listen** under any tutor reply to hear it read aloud (Gemini TTS), then **Stop**; see a "voice unavailable" note if the voice quota is out.
- See and dismiss the **error banner** ("Could not reach the AI tutor") and press **Retry** to regenerate the last answer.
- Open an old session from the sidebar, or start fresh (empty state: "Ask anything, by voice or text").

**Chat sidebar** (replaces the normal sidebar on chat pages)

- **Back to dashboard**.
- **New chat** → `/dashboard/chat`.
- Browse **Chat history** (title + preview of each session).
- **Delete a chat** (trash icon → browser confirm) — the app jumps to the next chat or a new one.

### 8. Voice mode (full-screen overlay from Chat)

- **Start** it from the **Voice mode** pill in the composer.
- **Just talk** — pause and the tutor answers; the reply streams onto the screen as it is spoken.
- **Interrupt**: say an explicit stop word — **stop**, **wait**, **sandali lang**, **hunong** (or any close Filipino/Cebuano form) — or tap the ■ button. Ordinary speech and background noise do not cut the tutor off.
- **Mute / unmute** the mic with the top-left button or the **Space** key.
- **End the call** with the red phone button or **Esc**.
- Watch the **orb** (reacts to your mic level and tutor playback) and the **status chip**: *Your turn* / *Tutor is thinking* / *Tutor is speaking* / *Muted*.
- Read the **session header**: chat title, mode (Chat/Hint/Debate/Interview), voice style, and a **call timer**; after a turn, a **response-time badge** (e.g. "1.2s").
- Follow the full **transcript** (auto-follows unless you scroll up), including your interim words.
- Switch the **voice** with the "Voice: {name}" chips.
- If the mic is blocked/unsupported, **type your question** in the fallback field instead — replies are still spoken.
- **Retry** a failed turn from the banner; see the turn counter ("3 turns").
- On close, the URL catches up to the chat session the call created.

### 9. Quiz page — `/dashboard/quiz`

**Lobby**

- **Name a topic** (e.g. "Cell division") or **attach a file** to quiz from (**PDF, TXT, MD, CSV**) with the paperclip button; remove the file with ✕.
- Add an **optional focus** when a file is attached (e.g. "Chapter 3").
- Choose the **number of questions**: 3, 5, 8, 10, or 15.
- Press **Start quiz** → "Writing questions…".
- In a room context: see the banner "**Quizzing in {room} — scores land on its shared leaderboard**" and the **Back to rooms** link.
- **Retake a quiz**: pick any recent quiz card (shows question count, times taken, best score).
- Read **Recent results** (score, ✗/✓ icon, **room** badge for room quizzes).
- Deep links: `?topic=` pre-fills the topic, `?room=` links the score to a room, `?room=&retake=` jumps straight into a retake.

**Choose how to take it**

- Pick **Manual quiz** (read and answer on screen) or **Voice quiz** (hands-free) — asked every time.
- Go **Back to the quiz lobby**.
- See warnings about missing audio (quota) or a browser that cannot listen.

**Manual quiz (on screen)**

- Answer **multiple choice / true-or-false** by clicking an option (lettered A/B/C/D), or **type a short answer** in the field.
- Use **number keys 1–9** to pick an option and **← / →** (or Enter) to move between questions.
- Jump to any question by clicking its **progress segment**; see "Question x of y" and "n answered".
- **Previous** / **Next** between cards; **Leave quiz** at any time.
- On the last question: **Submit answers**, plus **Go to the first blank** and a warning that "blank answers score zero".
- See the room banner: "This score counts toward {room}'s leaderboard".

**Results**

- Read the **score ring** (percent + "x of y") with **correct** and **to review** chips.
- See the **"Added to the room leaderboard"** confirmation for room quizzes.
- Review **every question**: your answer (or *blank*), the correct answer for wrong ones, and the AI's **explanation**.
- Press **Take another quiz**, or **Back to the room** when it was a room quiz.

**Voice quiz** (the same actions are grouped under **Part 2 — G**)

- Press **Start the voice quiz** — each question is **read aloud**, you **answer out loud**, and it moves on by itself.
- Say **"repeat"**, **"skip"**, or **"stop"** at any time — or press the **Repeat question** / **Skip** buttons.
- Watch the **progress segments**, stage orb, and what it heard ("…you said …").
- Get instant feedback: **Correct** or **Not this one** with the right answer and an explanation.
- Can't be heard, or the mic keeps dropping? **Tap an option or type a short answer at any time** while the question is read aloud or listening.
- **Leave voice quiz** at any time.

### 10. Documents page — `/dashboard/documents`

- **Choose a file** (PDF, TXT, MD, CSV — up to 12 MB) and press **Upload & read** ("Reading your document…"), or **Clear** the choice.
- See the notice: "Read "{name}" — {n} sections indexed."
- Track each document with a **status badge**: Ready / Reading… / Queued / Could not read, plus its **section count** and **summary**.
- See the "**n ready**" chip in the header.
- Press **Ask** on a ready document to open the Q&A panel ("Answers come from this document only").
- Pick the **answer language** (English / Filipino / Cebuano).
- **Type a question** (max 500 chars) or press the **mic** to ask by voice; use the **example chips** ("What is the main argument?", Filipino/Cebuano examples).
- Press **Ask** → see the answer, **Listen** to it read aloud (or **Stop**).
- See the **"From sections"** citations (section number + excerpt) and a **weak-match warning** if nothing matched.
- See which AI answered ("Answered by {provider}").
- Jump to **Flashcards** for that document (`?document=<id>` — pre-selects it as the deck source).
- **Delete a document** (trash → confirm).
- Empty state explains what to upload first.

### 11. Flashcards page — `/dashboard/flashcards`

- Press **Review {n} due** in the header to review every due card across decks (or see the deck count when nothing is due).
- **Make a new deck** — choose the source tab:
  - **Topic**: type a topic (e.g. "Cell division in mitosis").
  - **Document**: pick one of your ready documents.
  - **Quiz**: pick a quiz you've already taken.
- Choose the **number of cards** and press **Create deck** ("Writing your cards…") → success notice: "“{title}” is ready — {n} cards."
- From empty states, jump to **Upload one first** (Documents) or **Take one first** (Quiz).
- In the deck list, see each deck's **card count**, **"n due now" / "nothing due"**, and **"from a document"** tag.
- Per deck: **Review** (due cards only; disabled when nothing is due), **All** (review everything), **Delete** (confirm: "Delete “{title}” and its cards?").
- **Review session**:
  - Read the **front**, press **Show answer** to reveal the back.
  - Rate it: **Again (1)**, **Hard (2)**, **Good (3)**, **Easy (4)** — buttons or number keys.
  - **Listen** to the card read aloud (or **Stop**).
  - Watch the **progress bar** and "Card x of y"; **Exit** any time.
  - Finish to a **Review complete** summary: cards reviewed, how many "again" cards return shortly, and when the soonest card is due; then **Done** or **Review what is due**.
- Read the scheduling note: SM-2 — again in 10 minutes, good after 1 day, then 6, then longer.
- Deep links: `?deck=<id>` opens a review at once, `?document=` / `?quiz=` / `?topic=` pre-fill the maker.

### 12. Tasks page — `/dashboard/tasks`

**Capture**

- Press the **big mic** and **say your task** — e.g. "Review chapter 4 tomorrow at 7pm". Keep talking (continuous listening); after ~1.8 s of silence it is filed automatically.
- While dictating: press **Add now** to file immediately, **Discard** to throw the draft away, or tap the mic again to file it.
- Choose the **dictation language** (English / Filipino / Cebuano) — remembered across visits.
- Tap an **example chip** ("Pass the physics lab report sa Lunes") to fill the typed field.
- **Type a task** instead ("pass the lab report tomorrow at 5pm") and press **Add** — works in browsers without speech recognition.
- Rely on the date parser: today · tomorrow · tonight · this Friday · next week · in 3 days · Oct 5 · 10/5, plus Filipino/Cebuano (bukas, ngayon, ugma, karon, sa Lunes, sa makalawa, sa sunod nga semana).
- See the capture notice: Captured “{title}” — due {when}, with the language if it wasn't English.

**Manage**

- See count chips: **n open**, **n due today**, **n overdue**.
- **Tick / untick** a task's circle to mark done/not done.
- See **due chips**: Due / Overdue / Was due (Today/Tomorrow/date + time).
- See the **source badge**: 🎤 Voice (captured by voice) or ⌨ Typed.
- **Edit** a task (pencil): change the **title** and **due date/time**, then **Save** or **Cancel**.
- **Delete** a task (trash).
- Work through the **To do** list, then the **Done (n)** list — and press **Clear finished** to empty it.
- Empty state: "Nothing on your list — tap the mic while commuting, cooking, or reviewing."

**Text reminders**

- Enter a **mobile number** (e.g. 0917 123 4567) and press **Save number** / **Update number** — "Reminders will be texted to {number}."
- Press **Turn off** to stop reminder texts.
- Press **Send test text** to send one real SMS through the same gateway and see the result (gateway id, SMS parts, or a specific error + hint).
- Receive an SMS automatically the moment a task's day and time arrives (batched, within 24 h of due).

### 13. Study Rooms page — `/dashboard/rooms`

**Lobby**

- **Create a room**: type a name (e.g. "Finals review — Biology") → **Create room**; you become the owner and the room opens.
- **Join with a code**: type a classmate's code (e.g. ABC123) → **Join room**.
- Open any of **Your rooms** from the cards (name, member count, join code, 👑 owner badge).
- Deep link `?room=<id>` opens a room directly (used after a repeat).

**Inside a room**

- **Copy the join code** (formatted "ABC123" → "ABC 123") to share it.
- Open **History & scores** → `/dashboard/rooms/{id}/history`.
- As owner: **Delete** the room (confirm); as member: **Leave**.
- See member count and your role ("you are the owner" / "a member").

**Room chat**

- **Send messages** ("Message the room…", up to 2000 chars); messages refresh live (paused when the tab is hidden).
- As owner: **share a file** with the paperclip (PDF, DOC/DOCX, PPT/PPTX, XLS/XLSX, TXT, MD, CSV) — it appears as a downloadable card.
- **Download** any shared file; as owner, **remove** a shared file (trash).

**Leaderboards**

- Read the **Room leaderboard** — ranked by accuracy across quizzes finished in this room (rank, name, quizzes, best, %), with yourself highlighted and a "Waiting on…" list.
- Press **Take a room quiz** → `/dashboard/quiz?room=<id>`.
- Read the **Live voice quiz leaderboard** — accuracy across live rounds, ties broken by speed (rounds, correct/answered, avg seconds).
- See the **Members** list with roles (👑 owner); as owner, **remove a member** (trash).

**Live voice quiz (as host/owner)**

- Type a **topic** or choose a **source** (Topic / an uploaded file), or **Upload file** (PDF, TXT, MD, CSV) to write the quiz from.
- Choose **questions** (3/5/8/10/15) and **seconds each** (15/20/30/45/60).
- Press **Start live quiz** (needs ≥ 2 members — otherwise: "share your join code and wait for a classmate to join"). While it runs, the button reads **Writing and voicing the quiz…**: the questions are written *and* their narration is rendered, so the round plays without a pause between questions.
- Switch to **"or write the quiz manually →"** and build the round yourself: write **3–15 questions**, each with an optional **quiz title**, a **type** (Multiple choice / True-False / Short answer), the **question text**, the **options**, the **correct answer** (mark it by clicking the option), an optional **explanation**, and **seconds per question**. Each card shows **Ready** / **Incomplete**, incomplete ones block **Start live quiz**; use **Add question** / the trash icon to grow or shrink the set, optionally **drag an audio clip** onto a question, then **Start live quiz**. Toggle **"← Back to auto-generate (topic or file)"** to switch back.
- After a round ends: **Repeat last quiz — {title}** to reopen it.
- As non-owner: wait for the host ("Waiting for the host to start a round").

**Joining a live round (as member)**

- Press **Join waiting room** / **Join live quiz** when a round is active.
- In the waiting room, press **I'm ready** (toggle to cancel) and watch "n of m ready".
- During the round, see "Question x of y" and "n of m answered"; if hosting, "you are hosting".

### 14. Live room quiz (full-screen overlay)

**Waiting room**

- See who's ready (Host / Ready / Waiting…); the host can **remove** a member.
- Member: press **I'm ready**; host: **Start the quiz** (enabled once everyone is ready) or **Cancel quiz**; anyone: **Back to room**.
- Read the **voice status**: "Voice ready for all N questions", or "x of N questions voiced — the rest are read live" when a clip could not be rendered.

**During a question** — the same card as the quiz page's voice quiz

- Watch the **stage orb** (reading / listening / checking / verdict) with its label and hint, and the **question progress segments** across the top.
- Hear/read the question (auto-read aloud) and press **Repeat question** to hear it again.
- Watch the **countdown bar** and seconds chip (turns red in the last 5 s).
- **Answer by voice**: the mic opens with the question — say the option ("letter B", "the second one") or the answer itself; it is sent after a short pause. **Stop listening** / **Answer by voice** toggles the mic.
- **Or tap an option** in its lettered card (A, B, C…) — a tap always wins over the mic.
- **Or type a short answer** ("Type your answer") and press **Answer**.
- See live status: the words heard so far, "Answer locked in — you said …", "n of m answered".
- See the **Live results** board (ranks, correct counts) and **This question** panel with everyone's answers (✓/✗) after the question closes.
- Host controls: **Reveal** (show the correct option, answer and explanation), **Skip / Next**, **End** the session.
- After reveal: the **verdict** (Correct / Not this one — you said …, the answer, the explanation) replaces the answering card.
- The round **moves on by itself**: once every other member has answered the question closes early (otherwise the clock closes it), and the reveal opens the next question automatically — nothing to press.
- Watch the **final board** when it ends; the host can **replay**; **Back to room** closes it.

### 15. Room history — `/dashboard/rooms/{roomId}/history`

- Read the **Quiz leaderboard** and the **Live voice quiz leaderboard** side by side.
- Browse **live rounds**: per-player correct/answered scores; as host, press **Repeat** on a round to reopen its waiting room for everyone.
- Browse **Quiz history**: everyone's attempts with score and timestamp; press **Repeat** to retake that quiz (`?room=&retake=`).
- **Back to the room** / **Back to rooms** links.
- Non-members see "You are no longer a member of this room."

### 16. Progress page — `/dashboard/progress`

- Read the headline stats: **Quizzes taken** (questions answered), **Average score** (+ best or "▲ 8% vs your last 3 quizzes"), **Accuracy** (x of y right), **Practice time**.
- See chips for **active days** and your **streak** ("5-day streak").
- Read **What to study next** and press its button: **Practise this topic** (deep link to a quiz on your weakest topic), **Try a new topic**, or **Take a quiz**.
- Read the **Score trend** chart across your quizzes.
- See **Needs review** topics (below 80% on ≥2 questions) and **Looking solid** topics (≥80%).
- Read the **Daily activity** chart (minutes per day) and the **By question type** accuracy bars (MC/TF/short answer).
- See **Recent quizzes** with % badges, date, score, and a **study room** tag; press **Take another quiz**.
- Empty state: "**Take your first quiz**" button; error state: **Try again**.

### 17. Voice navigation (floating overlay, every dashboard page)

- **Turn it on/off** with the floating round button, the topbar mic badge, **Alt + V**, or by saying "**turn on voice navigation**" / "**turn off voice navigation**".
- **Navigate by voice**: say a page name or synonym — e.g. "chat", "talk to the tutor", "quiz", "test me", "notes", "upload", "flashcards", "deck", "tasks", "reminders", "rooms", "leaderboard", "progress", "scores", "home", plus Filipino/Cebuano forms ("pagsusulit", "mga gawain", "silid", "progreso", …).
- Say **help / "what can I say"** to hear and open the command list.
- Say **stop**, **wait**, **sandali lang** or **hunong** to silence the tutor mid-answer (including while the long help list is being read); **repeat / "say that again"** to hear the last message again. Other speech does not interrupt it.
- Say **"read the page"** to have the current page's heading and text read aloud.
- Move by voice: **scroll up / scroll down / scroll to top / scroll to bottom**, **go back**, **next / previous**, and **select / press enter** to open the highlighted item.
- Say **"rescan the page"** to re-scan the buttons and links.
- Click by number or name: "**click 3**", "**number three**", "**open the quiz**".
- Change the **listening language** (English / Filipino / Cebuano) in the panel.
- Read the live **transcript** ("Heard: …") and spoken **feedback** ("Opening the quiz.", "Scrolled up.", "Sorry, I did not catch that.").
- See **"On this page"** commands (e.g. on the quiz page: "start the quiz", "voice quiz", "manual quiz", "submit answers", "leave the quiz").
- Browse the **Go to** chips and the **On screen (n)** numbered list — tap any item to activate it; press **Rescan** to refresh.
- Use the status pill (listening / thinking / speaking) and the panel **✕** to hide the commands while staying on.

---

## Part 2 — By feature

### A. Authentication & account

- **Register** at `/sign-up` (Clerk: email + password / social), verify, land on the dashboard.
- **Log in** at `/sign-in`; be bounced there from any protected page when signed out.
- **Sign out** and manage the profile/photo from the avatar menu (navbar, sidebar, or topbar).
- Profile is **auto-synced** to the local `users` table (webhook + fallback), visible as **DB sync: Synced/Pending/Unavailable** on Overview.
- Clerk session is shown as "**Signed in via Clerk**" in the sidebar.

### B. AI chat (text)

- Send messages (type + Enter, or the Send button); new chats create a session and move the URL.
- Switch **modes**: Chat, Hint, Debate, Interview (saved per session).
- Attach files as **preview chips** (not sent to the tutor yet).
- Dictate into the composer with the **mic**.
- **Listen** to any reply (or **Stop**), choose the **TTS voice**.
- See **language** and **tone** badges, the AI **provider** label, and a **Retry** button on failures.
- Manage history: open, start a **New chat**, **delete** a chat.

### C. Voice mode (hands-free conversation)

- Start/exit from the **Voice mode** pill; talk naturally, pause to let the tutor answer.
- **Interrupt** with an explicit stop word (**stop**, **wait**, **sandali lang**, **hunong**); **mute (Space)**; **hang up (Esc)**.
- Watch the **orb**, **status chip**, **timer**, **turn count**, and **response-time badge**.
- Read the live transcript; switch **voices**; use the **typed fallback** if the mic is unavailable; **Retry** failed turns.

### D. Text-to-speech

- Hear tutor replies read aloud in the language of the session (Gemini TTS, cached as WAV).
- Per-message **Listen / Stop**; voice-mode replies spoken sentence by sentence as they stream.
- Choose among the available **voices** (persisted locally); get a "voice unavailable" note instead of silence when the quota runs out.
- Voice-navigation confirmations ("Opening the quiz.") are spoken too.

### E. Task capture (the feature)

- **Dictate a task** with the mic — multi-breath sentences, auto-filed after ~1.8 s quiet, or **Add now** / **Discard** / tap-mic-again.
- **Type a task** as an alternative.
- The **date/time is parsed** from natural phrases in English, Filipino, and Cebuano and stored as the due date (using your timezone).
- Pick the **dictation language** (remembered).
- See capture notices, counts (**open / due today / overdue**), and **Voice vs Typed** badges.
- **Tick done**, **edit** (title + due), **delete**, **clear finished**.
- Get **SMS reminders** when a task comes due: **save/update/turn off** your number, **send a test text** and read its result.

### F. Quiz generation & taking

- Generate a quiz from a **topic** or an **attached file** (PDF/TXT/MD/CSV), choose **3–15 questions**.
- Take it **manually**: click options or type short answers, number keys/arrow keys, progress segments, Previous/Next, "go to first blank", **Submit answers**, **Leave quiz**.
- See the **score ring**, correct/review chips, per-question **explanations**, and **Take another quiz**.
- **Retake** any recent quiz; browse **Recent results**.
- Take quizzes **linked to a room** (score lands on its leaderboard) or deep-linked from Progress (`?topic=`).

### G. Voice quiz

- Choose the **Voice quiz** mode for any quiz; questions are **read aloud**, answers given **out loud**, auto-advance.
- Say **"repeat" / "skip" / "stop"** or use the buttons.
- Get instant **Correct / Not this one** feedback with the answer and explanation.
- Fallback to **clicking/typing answers** when there is no mic (questions still spoken).

### H. Document Q&A

- **Upload** PDF/TXT/MD/CSV (≤12 MB) → **Upload & read**, watch **status badges**, read the **summary** and section count.
- **Select** a document, ask a question **typed or by voice**, choose the **answer language**.
- Read answers **grounded in the document only**, with **section citations**, a **weak-match warning**, **Listen** to the answer, and the provider label.
- Jump to **Flashcards** for that document; **delete** documents.

### I. Smart flashcards

- Create a deck from a **topic**, a **document**, or a **quiz**; choose card count.
- Review **due cards** (one-click "Review {n} due") or **all cards**; deep-link straight into a deck (`?deck=`).
- **Show answer**, rate with **Again/Hard/Good/Easy** (keys 1–4); **Listen** to the card; **Exit**; watch the progress bar.
- Get a **summary** (again cards, next due date) and schedule note (SM-2).
- **Delete** decks; see due counts and "from a document" tags.

### J. Collaborative study rooms

- **Create** a room (name) or **join** with a 6-char **code**; **copy the code** to share; **leave** or (owner) **delete** the room.
- **Chat** with the room (live), **share/download/remove files** (owner uploads).
- Compete on two **leaderboards**: accuracy-based room board and speed-tied live-voice board; jump to **Take a room quiz**.
- Open **History & scores**: all attempts, live rounds with per-player scores, and **Repeat** buttons (retake an async quiz, replay a live round).

### K. Live room quiz (real-time)

- Host: build the quiz **from a topic, an uploaded file, or by writing it manually** (question types, options, correct answer, explanation, seconds each, optional audio clip), set count/timer, **Start live quiz** (≥2 members), then **Reveal / Skip / Next / End**, and **Repeat last quiz**.
- Members: **ready up** in the waiting room, answer each timed question **by voice or typing**, hear the question read aloud (and **read again**), watch **live results** and the **final board**, then see standings on the live leaderboard.

### L. Progress tracking

- See **quizzes taken, average score (+ trend), accuracy, practice time**, active days and **streak**.
- Get the **"What to study next"** recommendation with a one-click **Practise this topic** quiz link.
- Read the **score trend chart**, **daily activity chart**, **by-question-type bars**, and **weak/strong topic** panels.
- Review **recent quizzes** and jump back into quizzing; empty/error states guide first use.

### M. Voice navigation

- Toggle with the **floating button**, **topbar badge**, **Alt + V**, or voice ("turn on/off voice navigation").
- **Go to any page by voice** (page names + synonyms in English/Filipino/Cebuano).
- **Help**, **stop**, **repeat**, **read the page**, **scroll up/down/top/bottom**, **go back**, **next/previous**, **select**, **rescan**.
- **Click by number or name** ("click 3", "open the quiz"); use the **On screen** list and **Rescan**.
- See the live **transcript/feedback**, switch the **listening language**, and read the **"On this page"** commands for the current screen.

### N. Language & tone handling

- Type or speak in **English, Filipino, or Cebuano** and get replies in the same language (detected automatically, shown as a badge in chat).
- The app detects **frustrated/confused** tone in your messages and adapts (badge + gentler replies).
- Choose explicit language controls where offered: chat answer language (Documents), dictation language (Tasks), command language (Voice navigation).

### O. Dashboard & navigation

- Move between the **8 sidebar sections**, open the **mobile drawer**, and read the topbar title.
- Use **quick actions** and the **getting-started checklist** on Overview.
- Manage sessions in the **chat sidebar** (new chat, history, delete).
- Watch **recent activity**, **stats**, and **account/DB sync** status fill in as you study.
