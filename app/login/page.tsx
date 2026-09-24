"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AuthCard } from "@/components/auth-card";
import { Alert, buttonClasses, cx } from "@/components/ui";

const inputClass =
  "mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm shadow-sm focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-navy-500/20";

function friendlyAuthError(message: string): string {
  if (/invalid login credentials/i.test(message)) return "That email and password don't match. Check them and try again.";
  if (/banned|disabled/i.test(message)) return "This account has been deactivated. Ask an Admin to reactivate it.";
  if (/network|fetch/i.test(message)) return "Can't reach the server. Check your internet connection and try again.";
  return message;
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const supabase = createClient();
      const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError || !data.user) {
        setError(friendlyAuthError(authError?.message ?? "Invalid email or password."));
        setLoading(false);
        return;
      }
      router.push(data.user.user_metadata?.force_password_change ? "/force-password-change" : "/dashboard");
      router.refresh();
    } catch (err) {
      setError(friendlyAuthError(err instanceof Error ? err.message : "Sign-in failed."));
      setLoading(false);
    }
  }

  return (
    <AuthCard title="Welcome back" subtitle="Sign in with the staff account your Admin created for you.">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-slate-700">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="username"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label htmlFor="password" className="block text-sm font-medium text-slate-700">
              Password
            </label>
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="text-xs font-medium text-navy-700 hover:underline"
              aria-controls="password"
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
          <input
            id="password"
            type={showPassword ? "text" : "password"}
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </div>

        {error && <Alert tone="danger">{error}</Alert>}

        <button type="submit" disabled={loading} className={cx(buttonClasses("primary"), "w-full py-2.5")}>
          {loading && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden="true" />}
          {loading ? "Signing in…" : "Sign in"}
        </button>

        <p className="text-center text-xs text-slate-500">Forgot your password? Ask an Admin to reset it for you.</p>
      </form>
    </AuthCard>
  );
}
