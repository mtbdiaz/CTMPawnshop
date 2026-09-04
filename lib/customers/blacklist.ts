import { createClient } from "@/lib/supabase/server";

// PB-11: reusable pre-transaction blacklist guard. Call from any flow that
// starts a new loan or appraisal (Sprints 3-5) before letting it proceed.
export async function getBlacklistStatus(
  customerId: string,
): Promise<{ isBlacklisted: boolean; reason: string | null }> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("customers")
    .select("is_blacklisted, blacklist_reason")
    .eq("id", customerId)
    .single();

  return {
    isBlacklisted: data?.is_blacklisted ?? false,
    reason: data?.blacklist_reason ?? null,
  };
}
