"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import type { FieldErrors } from "@/lib/validation/errors";
import { ARCHIVABLE_TABLES } from "@/lib/archive";

export type ArchiveState = { error?: string; fieldErrors?: FieldErrors; success?: boolean };


const tableSchema = z.enum(ARCHIVABLE_TABLES);

// Item 1: nothing is ever hard-deleted. Role checks, the "only closed loans /
// only pool appraisals / no open loans" rules and audit logging all happen in
// the archive_record() database function.
export async function archiveRecord(_prev: ArchiveState, formData: FormData): Promise<ArchiveState> {
  await requireRole(["appraiser", "admin"]);
  const table = tableSchema.safeParse(formData.get("table"));
  const id = z.string().uuid().safeParse(formData.get("id"));
  const reason = String(formData.get("reason") ?? "").trim();
  if (!table.success || !id.success) return { error: "Invalid record" };
  if (reason.length < 3) return { error: "Write a short reason for archiving.", fieldErrors: { reason: "A reason is required" } };

  const supabase = await createClient();
  const { error } = await supabase.rpc("archive_record", { p_table: table.data, p_id: id.data, p_reason: reason });
  if (error) return { error: error.message };
  revalidatePath("/dashboard", "layout");
  return { success: true };
}

export async function restoreRecord(_prev: ArchiveState, formData: FormData): Promise<ArchiveState> {
  await requireRole(["admin"]);
  const table = tableSchema.safeParse(formData.get("table"));
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!table.success || !id.success) return { error: "Invalid record" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("restore_record", { p_table: table.data, p_id: id.data });
  if (error) return { error: error.message };
  revalidatePath("/dashboard", "layout");
  return { success: true };
}
