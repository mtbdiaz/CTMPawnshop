"use server";

import { createAdminClient, createClient } from "@/lib/supabase/server";

// #8: the new password and the end of the forced change happen together on the server.
// The flag lives in app_metadata, which only the server can change, so it can't be
// cleared without actually setting a new password.
export async function setOwnPassword(password: string): Promise<{ error?: string }> {
  if (typeof password !== "string" || password.length < 8) return { error: "Password must be at least 8 characters." };
  if (password.length > 72) return { error: "Password can be at most 72 characters." };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Your session has ended. Sign in again with the temporary password." };

  const { error } = await supabase.auth.updateUser({ password, data: { force_password_change: false } });
  if (error) return { error: error.message };

  const admin = createAdminClient();
  const { error: flagError } = await admin.auth.admin.updateUserById(user.id, { app_metadata: { force_password_change: false } });
  if (flagError) return { error: `Your password was changed, but the account could not be unlocked: ${flagError.message}` };
  return {};
}
