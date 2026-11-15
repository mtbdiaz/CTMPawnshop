"use server";

import { validationFailure, type FieldErrors } from "@/lib/validation/errors";

import { revalidatePath } from "next/cache";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { allowRequest, TOO_MANY } from "@/lib/rate-limit"; // #22: rate limiting
import { createAccountSchema, staffDetailsSchema } from "@/lib/validation/account";
import { generateTempPassword } from "@/lib/auth/temp-password"; // U6
import { deactivate, reactivate, updateDetails, type StaffDeps, type StaffEvent } from "@/lib/staff/account-flows"; // U3, U5

export type ActionState = { error?: string; fieldErrors?: FieldErrors; success?: boolean; tempPassword?: string; message?: string };

// "100 years": how Supabase blocks a sign-in (PB-4)
const BLOCK_FOREVER = "876000h";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// U4 (Nov 15): who did it. Before: every change was written with the service-role key, so the audit log had no actor.
// Now: profile changes and staff events go through the signed-in Admin's own session (createClient), so the database
// takes the actor from that session (auth.uid()), never from anything the browser sends. Only the Supabase Auth steps
// (create the sign-in, set a password, block or un-block it) need the service-role key, and those are recorded with
// record_staff_account_event as the signed-in Admin.
async function staffDeps(): Promise<StaffDeps> {
  const supabase = await createClient();
  const admin = createAdminClient();
  return {
    readProfile: async (id) => {
      const { data } = await supabase.from("profiles").select("id, full_name, role, is_active, updated_at").eq("id", id).maybeSingle();
      return data;
    },
    updateProfile: async (id, expected, patch) => {
      const { data, error } = await supabase
        .from("profiles")
        .update(patch as never)
        .eq("id", id)
        .eq("updated_at", expected) // U3: only if nobody changed it since the page was opened
        .select("id");
      if (error) return { error: error.message };
      return data && data.length === 1 ? "ok" : "stale";
    },
    isLoginBlocked: async (id) => {
      const { data } = await admin.auth.admin.getUserById(id);
      const until = (data?.user as { banned_until?: string | null } | undefined)?.banned_until;
      return Boolean(until && new Date(until).getTime() > Date.now());
    },
    setLoginBlocked: async (id, blocked) => {
      const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: blocked ? BLOCK_FOREVER : "none" });
      return error ? error.message : null;
    },
    recordEvent: async (id, action: StaffEvent, note?: string) => {
      const { error } = await supabase.rpc("record_staff_account_event", { p_profile: id, p_action: action, p_note: note });
      return error ? error.message : null;
    },
  };
}

// PB-4: Admin creates a new staff account with an assigned role.
export async function createAccount(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(["admin"]);
  if (!(await allowRequest("save"))) return { error: TOO_MANY }; // #22: at most 30 saves a minute per account

  const tempPassword = generateTempPassword(); // U6: secure random, shown once, never stored by the app
  const parsed = createAccountSchema.safeParse({
    full_name: formData.get("full_name"),
    email: formData.get("email"),
    role: formData.get("role"),
    temp_password: tempPassword,
  });
  if (!parsed.success) return validationFailure(parsed.error);

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: parsed.data.email,
    password: tempPassword,
    email_confirm: true,
    // app_metadata can only be changed by the server, so the user can't clear it themselves (#8)
    app_metadata: { force_password_change: true },
    user_metadata: { force_password_change: true },
  });
  if (error || !data.user) return { error: error?.message ?? "Could not create account" };

  // U4: the profile is added as the signed-in Admin, so the audit log shows who created the account
  const supabase = await createClient();
  const { error: profileError } = await supabase.from("profiles").insert({
    id: data.user.id,
    full_name: parsed.data.full_name,
    role: parsed.data.role as never,
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(data.user.id); // no half-made account is left behind
    return { error: profileError.message };
  }

  revalidatePath("/dashboard/settings");
  return { success: true, tempPassword };
}

// U3: name and role only. Never touches the active status, so an old page can't reactivate anyone.
export async function updateStaffDetails(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const currentUser = await requireRole(["admin"]);
  if (!(await allowRequest("save"))) return { error: TOO_MANY };

  const userId = String(formData.get("user_id") ?? "");
  const expectedUpdatedAt = String(formData.get("expected_updated_at") ?? "");
  if (!UUID.test(userId) || !expectedUpdatedAt) return { error: "This staff account could not be found. Reload the page." };
  const parsed = staffDetailsSchema.safeParse({ full_name: formData.get("full_name"), role: formData.get("role") });
  if (!parsed.success) return validationFailure(parsed.error);

  const result = await updateDetails(await staffDeps(), {
    userId,
    actorId: currentUser.id,
    expectedUpdatedAt,
    fullName: parsed.data.full_name,
    role: parsed.data.role,
  });
  revalidatePath("/dashboard/settings");
  return "success" in result ? { success: true, message: result.message } : { error: result.error };
}

// U3 + U5: Deactivate / Reactivate (and "Finish ..." when the sign-in step didn't complete last time).
// Only the active status and the sign-in block change; the name and role stay as they are in the database now.
export async function setStaffActive(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const currentUser = await requireRole(["admin"]);
  if (!(await allowRequest("save"))) return { error: TOO_MANY };

  const userId = String(formData.get("user_id") ?? "");
  const expectedUpdatedAt = String(formData.get("expected_updated_at") ?? "");
  const makeActive = formData.get("make_active") === "on";
  if (!UUID.test(userId) || !expectedUpdatedAt) return { error: "This staff account could not be found. Reload the page." };

  const deps = await staffDeps();
  const input = { userId, actorId: currentUser.id, expectedUpdatedAt };
  const result = makeActive ? await reactivate(deps, input) : await deactivate(deps, input);
  revalidatePath("/dashboard/settings");
  return "success" in result ? { success: true, message: result.message } : { error: result.error };
}

// PB-2: Admin-assisted password reset. Issues a temp password and forces the user to set a new one on their next
// login. Supabase ends the person's other sessions when the password changes (their sign-in can't be renewed); a page
// they already have open keeps its current token until it runs out (at most 1 hour).
export async function resetPassword(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(["admin"]);
  if (!(await allowRequest("save"))) return { error: TOO_MANY };

  const userId = String(formData.get("user_id") ?? "");
  if (!UUID.test(userId)) return { error: "This staff account could not be found. Reload the page." };

  const tempPassword = generateTempPassword(); // U6
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, {
    password: tempPassword,
    app_metadata: { force_password_change: true },
    user_metadata: { force_password_change: true },
  });
  if (error) return { error: error.message };

  // U4: recorded as the signed-in Admin; the password itself is never written anywhere
  const supabase = await createClient();
  const { error: historyError } = await supabase.rpc("record_staff_account_event", { p_profile: userId, p_action: "password_reset" });

  revalidatePath("/dashboard/settings");
  return { success: true, tempPassword, message: historyError ? `The history entry could not be saved: ${historyError.message}` : undefined };
}

export async function listAccounts() {
  await requireRole(["admin"]);
  const supabase = await createClient();
  const { data, error } = await supabase.from("profiles").select("*").order("created_at");
  if (error) throw error;

  // Emails and the sign-in block live on auth.users, not profiles — fetched server-side via the admin API.
  const auth = new Map<string, { email: string | null; loginBlocked: boolean }>();
  const { data: authUsers } = await createAdminClient().auth.admin.listUsers({ perPage: 1000 });
  for (const u of authUsers?.users ?? []) {
    const until = (u as { banned_until?: string | null }).banned_until;
    auth.set(u.id, { email: u.email ?? null, loginBlocked: Boolean(until && new Date(until).getTime() > Date.now()) });
  }

  // U5: loginBlocked lets the page show an unfinished deactivation or reactivation and offer "Finish ..."
  return (data ?? []).map((p) => ({ ...p, email: auth.get(p.id)?.email ?? null, loginBlocked: auth.get(p.id)?.loginBlocked ?? false }));
}
