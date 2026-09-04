"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { createAccountSchema, editAccountSchema } from "@/lib/validation/account";

export type ActionState = { error?: string; success?: boolean; tempPassword?: string };

function randomTempPassword() {
  return `Ctm-${Math.random().toString(36).slice(2, 10)}!1`;
}

// PB-4: Admin creates a new staff account with an assigned role.
export async function createAccount(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole(["admin"]);

  const parsed = createAccountSchema.safeParse({
    full_name: formData.get("full_name"),
    email: formData.get("email"),
    role: formData.get("role"),
    temp_password: randomTempPassword(),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: parsed.data.email,
    password: parsed.data.temp_password,
    email_confirm: true,
    user_metadata: { force_password_change: true },
  });
  if (error || !data.user) return { error: error?.message ?? "Could not create account" };

  const { error: profileError } = await admin.from("profiles").insert({
    id: data.user.id,
    full_name: parsed.data.full_name,
    role: parsed.data.role as never,
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(data.user.id);
    return { error: profileError.message };
  }

  revalidatePath("/dashboard/users");
  return { success: true, tempPassword: parsed.data.temp_password };
}

// PB-4: Admin edits an existing account's name/role, or deactivates/reactivates it.
export async function editAccount(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole(["admin"]);

  const userId = String(formData.get("user_id") ?? "");
  const parsed = editAccountSchema.safeParse({
    full_name: formData.get("full_name"),
    role: formData.get("role"),
    is_active: formData.get("is_active") === "on",
  });
  if (!userId || !parsed.success) {
    return { error: parsed.success ? "Missing account id" : parsed.error.issues[0]?.message };
  }

  const admin = createAdminClient();

  const { error: profileError } = await admin
    .from("profiles")
    .update({
      full_name: parsed.data.full_name,
      role: parsed.data.role as never,
      is_active: parsed.data.is_active,
    })
    .eq("id", userId);
  if (profileError) return { error: profileError.message };

  // Deactivation must also block Supabase Auth login itself, not just hide UI.
  const { error: banError } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: parsed.data.is_active ? "none" : "876000h",
  });
  if (banError) return { error: banError.message };

  revalidatePath("/dashboard/users");
  return { success: true };
}

// PB-2: Admin-assisted password reset. Issues a temp password and forces the
// user to set a new one on their next login.
export async function resetPassword(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole(["admin"]);

  const userId = String(formData.get("user_id") ?? "");
  if (!userId) return { error: "Missing account id" };

  const tempPassword = randomTempPassword();
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, {
    password: tempPassword,
    user_metadata: { force_password_change: true },
  });
  if (error) return { error: error.message };

  revalidatePath("/dashboard/users");
  return { success: true, tempPassword };
}

export async function listAccounts() {
  await requireRole(["admin"]);
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("*").order("created_at");
  return data ?? [];
}
