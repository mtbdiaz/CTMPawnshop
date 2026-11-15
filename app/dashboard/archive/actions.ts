"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { allowRequest, TOO_MANY } from "@/lib/rate-limit"; // #22: rate limiting
import type { FieldErrors } from "@/lib/validation/errors";
import { ARCHIVABLE_TABLES, friendlyArchiveError, restoreReasonError, type ArchivableTable } from "@/lib/archive";

export type ArchiveState = { error?: string; fieldErrors?: FieldErrors; success?: boolean };


const tableSchema = z.enum(ARCHIVABLE_TABLES);

// Item 1: nothing is ever hard-deleted. Role checks, the "only closed loans /
// only pool appraisals / no open loans" rules and audit logging all happen in
// the archive_record() database function.
export async function archiveRecord(_prev: ArchiveState, formData: FormData): Promise<ArchiveState> {
  await requireRole(["appraiser", "admin"]);
  if (!(await allowRequest("save"))) return { error: TOO_MANY }; // #22: at most 30 saves a minute per account
  const table = tableSchema.safeParse(formData.get("table"));
  const id = z.string().uuid().safeParse(formData.get("id"));
  const reason = String(formData.get("reason") ?? "").trim();
  if (!table.success || !id.success) return { error: "Invalid record" };
  if (reason.length < 3) return { error: "Write a short reason for archiving.", fieldErrors: { reason: "A reason is required" } };

  const supabase = await createClient();
  const { error } = await supabase.rpc("archive_record", { p_table: table.data, p_id: id.data, p_reason: reason });
  if (error) return { error: friendlyArchiveError(error) }; // 0085: plain messages only, never raw database text
  revalidatePath("/dashboard", "layout");
  return { success: true };
}

// 0085 (Archive Phase 2A): restoring needs a written reason, and the database decides per record whether it can come
// back (VOID loans, auction batches, vault audits, duplicates... are refused with a plain reason). The Admin is taken
// from the signed-in session by the database, never from the form.
export async function restoreRecord(_prev: ArchiveState, formData: FormData): Promise<ArchiveState> {
  await requireRole(["admin"]);
  if (!(await allowRequest("save"))) return { error: TOO_MANY }; // #22: at most 30 saves a minute per account
  const table = tableSchema.safeParse(formData.get("table"));
  const id = z.string().uuid().safeParse(formData.get("id"));
  const reason = String(formData.get("reason") ?? "");
  if (!table.success || !id.success) return { error: "Invalid record" };
  const reasonError = restoreReasonError(reason);
  if (reasonError) return { error: reasonError, fieldErrors: { reason: reasonError } };

  const supabase = await createClient();
  const { error } = await supabase.rpc("restore_record", { p_table: table.data, p_id: id.data, p_reason: reason.trim() });
  if (error) return { error: friendlyArchiveError(error) };
  revalidatePath("/dashboard", "layout");
  return { success: true };
}

// failed = the check itself couldn't run (e.g. before 0085 is installed): restoring is then not offered at all
export type RestoreCheck = { exists: boolean; archived: boolean; canRestore: boolean; reason: string | null; failed?: boolean };

// 0085: asks the database whether this record can be restored and, if not, why (for the Review dialog, Phase 2B)
export async function checkRestore(table: ArchivableTable, id: string): Promise<RestoreCheck> {
  await requireRole(["admin"]);
  if (!tableSchema.safeParse(table).success || !z.string().uuid().safeParse(id).success) {
    return { exists: false, archived: false, canRestore: false, reason: "Invalid record", failed: true };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("archive_restore_check", { p_table: table, p_id: id });
  if (error || !data) return { exists: false, archived: false, canRestore: false, reason: friendlyArchiveError(error), failed: true };
  const j = data as { exists: boolean; archived: boolean; can_restore: boolean; reason: string | null };
  return { exists: j.exists, archived: j.archived, canRestore: j.can_restore, reason: j.reason };
}

export type ArchiveHistoryEvent = { action: "archived" | "restored"; at: string; by: string; reason: string; undid: { at: string | null; by: string; reason: string | null } | null };

// 0085: the record's archive and restore history (archive_events, Admin-read only). null = the history isn't
// available (for example before 0085 is installed), so the dialog shows the archive details from the record itself.
export async function getArchiveHistory(table: ArchivableTable, id: string): Promise<ArchiveHistoryEvent[] | null> {
  await requireRole(["admin"]);
  if (!tableSchema.safeParse(table).success || !z.string().uuid().safeParse(id).success) return null;
  const supabase = await createClient();
  const [{ data, error }, { data: staff }] = await Promise.all([
    supabase
      .from("archive_events")
      .select("action, created_at, actor, reason, original_archived_at, original_archived_by, original_archive_reason")
      .eq("table_name", table)
      .eq("record_id", id)
      .order("created_at", { ascending: true }),
    supabase.from("profiles").select("id, full_name"),
  ]);
  if (error || !data) return null;
  const name = (uid: string | null) => (uid ? ((staff ?? []).find((p) => p.id === uid)?.full_name ?? "A former staff member") : "System (data cleanup)");
  return data.map((e) => ({
    action: e.action as "archived" | "restored",
    at: e.created_at,
    by: name(e.actor),
    reason: e.reason,
    undid: e.action === "restored" ? { at: e.original_archived_at, by: name(e.original_archived_by), reason: e.original_archive_reason } : null,
  }));
}
