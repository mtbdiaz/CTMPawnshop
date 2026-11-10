// #25: deletes item photos that were uploaded but never saved with an appraisal (the form was closed, or the
// browser crashed). Only photos older than 24 hours are touched, so a photo on a form that is still open is safe.
// Server only: it uses the service role, because staff logins may only delete their own unattached photos.
import { createAdminClient } from "@/lib/supabase/server";

/** Returns how many files were deleted. Never throws: a failed clean-up must not break the action that ran it. */
export async function cleanUpUnusedPhotos(): Promise<number> {
  try {
    const admin = createAdminClient();
    // the database decides which photos are unused (ctm_unused_photos, migration 0037): not attached to any
    // appraisal (archived ones count as attached) and uploaded more than 24 hours ago. At most 200 per run.
    const { data, error } = await admin.rpc("ctm_unused_photos");
    if (error) {
      console.error("photo clean-up: couldn't list unused photos:", error.message);
      return 0;
    }
    const names = (data ?? []).map((r) => r.name);
    if (!names.length) return 0; // nothing to do (the usual case)
    // files are deleted through the Storage API (Supabase refuses a direct delete from its table)
    const { data: removed, error: removeError } = await admin.storage.from("item-photos").remove(names);
    if (removeError) {
      console.error("photo clean-up: couldn't delete files:", removeError.message);
      return 0;
    }
    return removed?.length ?? 0;
  } catch (e) {
    console.error("photo clean-up failed:", e);
    return 0;
  }
}
