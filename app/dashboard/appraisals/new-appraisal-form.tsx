"use client";

import { useActionState, useState } from "react";
import { createAppraisal, type ActionState } from "./actions";
import { createClient } from "@/lib/supabase/client";

const initialState: ActionState = {};

export function NewAppraisalForm({
  customers,
}: {
  customers: { id: string; full_name: string }[];
}) {
  const [state, formAction, pending] = useActionState(createAppraisal, initialState);
  const [photoPaths, setPhotoPaths] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    const supabase = createClient();
    const uploaded: string[] = [];

    for (const file of Array.from(files)) {
      const path = `${crypto.randomUUID()}-${file.name}`;
      const { error } = await supabase.storage.from("item-photos").upload(path, file);
      if (error) {
        setUploadError(error.message);
        continue;
      }
      uploaded.push(path);
    }

    setPhotoPaths((prev) => [...prev, ...uploaded]);
    setUploading(false);
  }

  return (
    <form action={formAction} className="grid max-w-2xl grid-cols-2 gap-4">
      {photoPaths.map((p) => (
        <input key={p} type="hidden" name="photo_paths" value={p} />
      ))}

      <div className="col-span-2">
        <label htmlFor="customer_id" className="block text-sm font-medium text-slate-700">
          Customer
        </label>
        <select
          id="customer_id"
          name="customer_id"
          required
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">Select a customer...</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.full_name}
            </option>
          ))}
        </select>
      </div>

      <NumField label="Weight (grams)" name="weight_grams" step="0.001" />
      <NumField label="Karat" name="karat" step="1" />
      <NumField label="Purity (%) from test" name="purity_percent" step="0.01" />

      <div className="col-span-2">
        <label htmlFor="condition_notes" className="block text-sm font-medium text-slate-700">
          Condition notes
        </label>
        <textarea
          id="condition_notes"
          name="condition_notes"
          rows={2}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </div>

      <div className="col-span-2">
        <label htmlFor="photos" className="block text-sm font-medium text-slate-700">
          Item photos
        </label>
        <input
          id="photos"
          type="file"
          accept="image/*"
          multiple
          onChange={handleFiles}
          className="mt-1 text-sm"
        />
        {uploading && <p className="text-xs text-slate-500">Uploading...</p>}
        {uploadError && <p className="text-xs text-red-600">{uploadError}</p>}
        {photoPaths.length > 0 && (
          <p className="text-xs text-green-700">{photoPaths.length} photo(s) attached.</p>
        )}
      </div>

      {state.error && (
        <p role="alert" className="col-span-2 text-sm text-red-600">
          {state.error}
        </p>
      )}
      {state.success && (
        <p className="col-span-2 text-sm text-green-600">Appraisal recorded.</p>
      )}

      <div className="col-span-2">
        <button
          type="submit"
          disabled={pending || uploading}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {pending ? "Saving..." : "Calculate & save appraisal"}
        </button>
      </div>
    </form>
  );
}

function NumField({ label, name, step }: { label: string; name: string; step: string }) {
  return (
    <div>
      <label htmlFor={name} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type="number"
        step={step}
        required
        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
      />
    </div>
  );
}
