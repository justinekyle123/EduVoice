// Philippine mobile numbers for task reminder texts.
//
// Students type their number the way they say it — "0917 123 4567",
// "9171234567", "+63 917 123 4567" — but the SMS gateway wants one canonical
// shape, so everything is normalised to E.164 ("+639171234567") before it is
// stored. Pure and dependency-free, so the server action (typing) and the
// reminder route (reading) can both use it.

/** A PH mobile number without the country code: 9 followed by nine digits. */
const PH_MOBILE = /^9\d{9}$/;

/**
 * Canonical E.164 form of a Philippine mobile number, or null when the input is
 * not one. Accepts the local ("0917…"), bare ("917…"), and international
 * ("+63917…", "63917…", "0063917…") ways students write it, with any spacing,
 * dashes, dots, or parentheses.
 */
export function normalizePhMobile(input: string): string | null {
  let digits = input.replace(/[\s\-().]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (!/^\d+$/.test(digits)) return null;

  // International prefix, dialed or written.
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("63")) digits = digits.slice(2);

  // "0917…" and a doubly-prefixed "+630917…" both land here.
  digits = digits.replace(/^0+/, "");

  return PH_MOBILE.test(digits) ? `+63${digits}` : null;
}

/** "+639171234567" → "+63 917 123 4567", for showing back to the student. */
export function formatPhMobile(value: string): string {
  const normalized = normalizePhMobile(value);
  if (!normalized) return value;
  const local = normalized.slice(3);
  return `+63 ${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`;
}
