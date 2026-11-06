import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/supabase/database.types";

export type CurrentUser = {
  id: string;
  email: string | null;
  profile: Tables<"profiles">;
  /** True after an Admin reset: the user must set their own password before using the app (#8). */
  mustChangePassword: boolean;
};

/** Loads the logged-in user's auth + profile row, or null if not signed in / deactivated / profile missing. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!profile || !profile.is_active) return null;

  const mustChangePassword = Boolean(user.app_metadata?.force_password_change || user.user_metadata?.force_password_change);
  return { id: user.id, email: user.email ?? null, profile, mustChangePassword };
}
