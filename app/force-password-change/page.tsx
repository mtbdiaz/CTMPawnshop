"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AuthCard } from "@/components/auth-card";
import { Alert, buttonClasses, cx } from "@/components/ui";

const inputClass =
  "mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm shadow-sm focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-navy-500/20";

// PB-2 AC2: first login after an Admin-issued reset forces the user to set a new password.
export default function ForcePasswordChangePage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const tooShort = password.length > 0 && password.length < 8;
  const mismatch = confirm.length > 0 && password !== confirm;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError("Password must be at least 8 characters.");
    if (password !== confirm) return setError("The two passwords don't match.");

    setLoading(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password, data: { force_password_change: false } });
    if (updateError) {
      setLoading(false);
      setError(updateError.message);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <AuthCard title="Set a new password" subtitle="Your password was reset by an Admin. Choose your own password to continue.">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-slate-700">
            New password
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={tooShort || undefined}
            aria-describedby="password-hint"
            className={inputClass}
          />
          <p id="password-hint" className={cx("mt-1 text-xs", tooShort ? "font-medium text-red-700" : "text-slate-500")}>
            At least 8 characters.
          </p>
        </div>
        <div>
          <label htmlFor="confirm" className="block text-sm font-medium text-slate-700">
            Confirm new password
          </label>
          <input
            id="confirm"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            aria-invalid={mismatch || undefined}
            aria-describedby={mismatch ? "confirm-error" : undefined}
            className={inputClass}
          />
          {mismatch && (
            <p id="confirm-error" className="mt-1 text-xs font-medium text-red-700">
              Passwords don&apos;t match yet.
            </p>
          )}
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
        <button type="submit" disabled={loading} className={cx(buttonClasses("primary"), "w-full py-2.5")}>
          {loading ? "Saving…" : "Set password & continue"}
        </button>
      </form>
    </AuthCard>
  );
}
