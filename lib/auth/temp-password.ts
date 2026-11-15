import { randomInt } from "node:crypto";

// U6 (Nov 15): temporary passwords for new accounts and Admin resets.
// Before: `Ctm-` + 8 letters/digits from Math.random() + `!1` (about 41 bits, not cryptographically random).
// Now: 16 characters from the operating system's secure random generator (crypto.randomInt), about 90 bits, with at
// least one capital, one small letter, one digit and one symbol so it passes any password rule. Letters that look
// alike (0/O, 1/l/I) are left out because the Admin reads it out or copies it to the person.
// The password is only returned to the Admin's screen once; it is never logged or saved anywhere by the app.

const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const DIGIT = "23456789";
const SYMBOL = "!@#$%*?";
const ALL = UPPER + LOWER + DIGIT + SYMBOL;

export const TEMP_PASSWORD_LENGTH = 16;

const pick = (set: string) => set[randomInt(set.length)];

export function generateTempPassword(length = TEMP_PASSWORD_LENGTH): string {
  if (length < 12) throw new Error("A temporary password needs at least 12 characters.");
  const chars = [pick(UPPER), pick(LOWER), pick(DIGIT), pick(SYMBOL)];
  while (chars.length < length) chars.push(pick(ALL));
  // shuffle (Fisher–Yates, secure random) so the guaranteed characters aren't always first
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
