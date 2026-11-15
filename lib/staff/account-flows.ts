// U3 + U5 (Nov 15): the steps for changing a staff account, kept apart from Supabase so they can be tested with
// failing steps (unit tests in account-flows.test.ts). The server actions in app/dashboard/users/actions.ts pass in
// the real database and Supabase Auth calls.
//
// U3 Before: one "editAccount" action saved name, role AND active together, using values from when the page was opened.
//    A Save on an old page quietly reactivated (and un-blocked) someone another Admin had just deactivated, and
//    Deactivate/Reactivate wrote back an old name and role.
//    Now: "details" (name, role) and "status" (deactivate, reactivate) are separate, each changes only its own fields,
//    and each needs the account to be exactly as the page showed it (updated_at). Otherwise:
//    "This account was changed by another Admin. Reload before trying again."
// U5 Before: the profile was switched off first and the Supabase sign-in block second, with no record if the second
//    step failed, so the page could say "Deactivated" while the person could still sign in (or the other way round).
//    Now (deactivate): 1. the profile is switched off, which already stops every page and every database read and
//    write for that person (migration 0076); 2. then the Supabase sign-in is blocked. If step 2 fails, the account
//    stays switched off (the safe state), the failure is recorded, and the page offers "Finish deactivation".
//    Reactivate: the profile first (with the stale check), then the sign-in is un-blocked; if that fails the page
//    offers "Finish reactivation". Nothing ever silently gives access back.

export type StaffRow = { id: string; full_name: string; role: string; is_active: boolean; updated_at: string };

export type StaffDeps = {
  readProfile(id: string): Promise<StaffRow | null>;
  /** update only these fields, only if updated_at still equals `expected`; "stale" when 0 rows changed */
  updateProfile(id: string, expected: string, patch: Partial<Pick<StaffRow, "full_name" | "role" | "is_active">>): Promise<"ok" | "stale" | { error: string }>;
  isLoginBlocked(id: string): Promise<boolean>;
  /** returns an error message, or null when it worked */
  setLoginBlocked(id: string, blocked: boolean): Promise<string | null>;
  /** returns an error message, or null */
  recordEvent(id: string, action: StaffEvent, note?: string): Promise<string | null>;
};

export type StaffEvent = "login_blocked" | "login_unblocked" | "login_block_failed" | "login_unblock_failed" | "password_reset";

export type FlowResult = { success: true; message: string } | { error: string; partial?: boolean };

export const STALE_MESSAGE = "This account was changed by another Admin. Reload before trying again.";
const SELF_MESSAGE = "You can't deactivate or remove Admin rights from your own account. Ask another Admin.";

// a history entry that couldn't be saved is reported, but never undoes a security step
const withHistoryNote = (message: string, historyError: string | null) =>
  historyError ? `${message} (The history entry could not be saved: ${historyError})` : message;

export async function updateDetails(
  deps: StaffDeps,
  input: { userId: string; actorId: string; expectedUpdatedAt: string; fullName: string; role: string },
): Promise<FlowResult> {
  const now = await deps.readProfile(input.userId);
  if (!now) return { error: "This staff account could not be found. Reload the page." };
  if (now.updated_at !== input.expectedUpdatedAt) return { error: STALE_MESSAGE };
  if (input.userId === input.actorId && input.role !== now.role) return { error: SELF_MESSAGE };
  if (now.full_name === input.fullName && now.role === input.role) return { error: "Nothing was changed." };
  const res = await deps.updateProfile(input.userId, input.expectedUpdatedAt, { full_name: input.fullName, role: input.role });
  if (res === "stale") return { error: STALE_MESSAGE };
  if (res !== "ok") return { error: res.error };
  return { success: true, message: `Saved ${input.fullName}.` };
}

export async function deactivate(
  deps: StaffDeps,
  input: { userId: string; actorId: string; expectedUpdatedAt: string },
): Promise<FlowResult> {
  if (input.userId === input.actorId) return { error: SELF_MESSAGE };
  const now = await deps.readProfile(input.userId);
  if (!now) return { error: "This staff account could not be found. Reload the page." };

  if (now.is_active) {
    if (now.updated_at !== input.expectedUpdatedAt) return { error: STALE_MESSAGE };
    // step 1: from here on the person can't open any page or read or change any data
    const res = await deps.updateProfile(input.userId, input.expectedUpdatedAt, { is_active: false });
    if (res === "stale") return { error: STALE_MESSAGE };
    if (res !== "ok") return { error: res.error }; // e.g. "At least one active Admin must remain..."
  } else if (await deps.isLoginBlocked(input.userId)) {
    return { error: `${now.full_name} is already deactivated. Reload the page.` };
  } // else: switched off but the sign-in block didn't finish last time, so finish it now (recovery)

  // step 2: block the Supabase sign-in
  const blockError = await deps.setLoginBlocked(input.userId, true);
  if (blockError) {
    const historyError = await deps.recordEvent(input.userId, "login_block_failed", blockError);
    return {
      partial: true,
      error: withHistoryNote(
        `${now.full_name} is deactivated in PawnTrack and can't open any page or data, but blocking their sign-in didn't finish (${blockError}). Press "Finish deactivation" to try again.`,
        historyError,
      ),
    };
  }
  const historyError = await deps.recordEvent(input.userId, "login_blocked");
  return { success: true, message: withHistoryNote(`${now.full_name} deactivated. They can't sign in or use PawnTrack until an Admin reactivates the account.`, historyError) };
}

export async function reactivate(
  deps: StaffDeps,
  input: { userId: string; actorId: string; expectedUpdatedAt: string },
): Promise<FlowResult> {
  const now = await deps.readProfile(input.userId);
  if (!now) return { error: "This staff account could not be found. Reload the page." };

  if (!now.is_active) {
    if (now.updated_at !== input.expectedUpdatedAt) return { error: STALE_MESSAGE };
    const res = await deps.updateProfile(input.userId, input.expectedUpdatedAt, { is_active: true });
    if (res === "stale") return { error: STALE_MESSAGE };
    if (res !== "ok") return { error: res.error };
  } else if (!(await deps.isLoginBlocked(input.userId))) {
    return { error: `${now.full_name} is already active. Reload the page.` };
  } // else: switched on but the sign-in is still blocked from last time, so finish it now (recovery)

  const unblockError = await deps.setLoginBlocked(input.userId, false);
  if (unblockError) {
    const historyError = await deps.recordEvent(input.userId, "login_unblock_failed", unblockError);
    return {
      partial: true,
      error: withHistoryNote(
        `${now.full_name} is reactivated in PawnTrack, but their sign-in is still blocked (${unblockError}). Press "Finish reactivation" to try again.`,
        historyError,
      ),
    };
  }
  const historyError = await deps.recordEvent(input.userId, "login_unblocked");
  return { success: true, message: withHistoryNote(`${now.full_name} reactivated. They can sign in again with their current password.`, historyError) };
}
