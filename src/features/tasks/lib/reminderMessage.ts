// The body of the "your task is due" text.
//
// Built here rather than in the notifier so the app stays the single place that
// decides what a student reads: the PHP cron in sms/ only fetches the queued
// messages and hands them to the gateway (see sms/README.md).

const MS_PER_MINUTE = 60_000;

/**
 * A long dictated title has to leave room for the rest of the one SMS. With the
 * fixed wording below this keeps the worst case at 155 characters — inside the
 * 160 of a single GSM-7 segment, so a reminder is never billed as two texts.
 */
const TITLE_LIMIT = 80;

/**
 * The GSM-7 alphabet has no curly quotes, ellipsis, or narrow spaces, and one
 * character outside it switches the whole message to UCS-2 — 70 characters per
 * segment instead of 160. Everything composed here is therefore plain ASCII:
 * straight quotes, "...", and ordinary spaces. This mops up the handful of
 * non-breaking spaces ICU puts in formatted dates on some platforms.
 */
function toGsmSafe(text: string): string {
  return text.replace(/[\u00a0\u202f]/g, " ");
}

/**
 * Wall-clock label for a due instant, in the reader's own timezone:
 * "Oct 16, 5:00 PM".
 *
 * `tzOffsetMinutes` is minutes behind UTC as `new Date().getTimezoneOffset()`
 * reports it (-480 for Polomolok). The instant is shifted by that offset and
 * then read as UTC, exactly as features/tasks/lib/parse.ts resolves due dates,
 * so the label matches the clock the student set the task by.
 */
export function dueLabelFor(due: Date, tzOffsetMinutes: number): string {
  const shifted = new Date(due.getTime() - tzOffsetMinutes * MS_PER_MINUTE);
  return toGsmSafe(
    shifted.toLocaleString("en-US", {
      timeZone: "UTC",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })
  );
}

/**
 * The message itself:
 *
 *   EduVoice: "Review chapter 4" is due now (Oct 16, 5:00 PM). Open EduVoice to
 *   tick it off.
 */
export function taskReminderBody(
  task: { title: string; dueDate: Date },
  tzOffsetMinutes: number
): string {
  const title =
    task.title.length > TITLE_LIMIT
      ? `${task.title.slice(0, TITLE_LIMIT).trimEnd()}...`
      : task.title;

  return toGsmSafe(
    `EduVoice: "${title}" is due now (${dueLabelFor(
      task.dueDate,
      tzOffsetMinutes
    )}). Open EduVoice to tick it off.`
  );
}
