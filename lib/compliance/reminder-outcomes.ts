// R3: the words for a reminder's contact method and result (saved in reminder_log since migration 0027).
// One place, so the popup, the list and the history always use the same words.

export const METHODS = [
  { value: "call", label: "Call" },
  { value: "sms", label: "SMS (sent by hand)" },
  { value: "in_person", label: "In person" },
  { value: "other", label: "Other" },
] as const;
export type ReminderMethod = (typeof METHODS)[number]["value"];

// tone = the badge color. Only "Reached" and "Message sent" count as done; the rest still need work
export const OUTCOMES = [
  { value: "reached", label: "Reached", help: "You talked to the customer.", tone: "success" },
  { value: "message_sent", label: "Message sent", help: "You sent an SMS or chat by hand.", tone: "success" },
  { value: "no_answer", label: "No answer", help: "Nobody picked up. Stays in To contact.", tone: "neutral" },
  { value: "wrong_number", label: "Wrong number", help: "The number isn't the customer's. Goes to Needs follow-up.", tone: "danger" },
  { value: "follow_up", label: "Follow-up needed", help: "Call back later or an Admin should look. Goes to Needs follow-up.", tone: "warning" },
] as const;
export type ReminderOutcome = (typeof OUTCOMES)[number]["value"];

export const methodLabel = (m: string | null | undefined) => METHODS.find((x) => x.value === m)?.label ?? null;
/** The result's words and badge color. A log from before 0027 has no result: "Attempt logged" (navy). */
export function outcomeBadge(o: string | null | undefined): { label: string; tone: "success" | "neutral" | "danger" | "warning" | "info" } {
  const found = OUTCOMES.find((x) => x.value === o);
  return found ? { label: found.label, tone: found.tone } : { label: "Attempt logged", tone: "info" };
}

export const isMethod = (v: string): v is ReminderMethod => METHODS.some((m) => m.value === v);
export const isOutcome = (v: string): v is ReminderOutcome => OUTCOMES.some((o) => o.value === v);
