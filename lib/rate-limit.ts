// #22: rate limiting. One staff account may do 60 searches and 30 saves a minute (owner decision, Nov 10, 2026).
// The counting happens in the database (ctm_rate_check, migration 0037), so it works the same no matter which
// server answers the request. This file is only for server code (server actions).
import { createClient } from "@/lib/supabase/server";

// search = the live searches; save = anything that changes or reveals data;
// audit = one item checked in a physical audit (300 a minute: a person ticks items quickly while walking the vault; migration 0044)
export type RateKind = "search" | "save" | "audit";

// the message staff see when they are over the limit
export const TOO_MANY = "Too many requests. Wait a minute, then try again.";

/**
 * Counts this request for the logged-in account and says if it may go ahead.
 * true = go ahead, false = over the limit (show TOO_MANY and do nothing).
 * If the counter itself can't be reached, the request is allowed: a broken counter must not stop the counter work.
 */
export async function allowRequest(kind: RateKind): Promise<boolean> {
  try {
    const supabase = await createClient(); // as the logged-in user, so the database knows whose counter to use
    const { data, error } = await supabase.rpc("ctm_rate_check", { p_kind: kind });
    if (error) {
      console.error("rate limit check failed:", error.message); // details for the developers
      return true; // allow: see above
    }
    return data !== false; // false only when the database says "over the limit"
  } catch (e) {
    console.error("rate limit check failed:", e);
    return true;
  }
}
