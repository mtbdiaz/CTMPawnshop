"use client";

import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyAuthError, validateLogin, type LoginFieldErrors } from "@/lib/auth/login";
import { Icon } from "@/components/icons";
import { Alert, buttonClasses, cx } from "@/components/ui";

// 48px tall (a comfortable thumb target), 16px text (phones don't zoom the page when a 16px field is focused)
const inputBase =
  "block w-full rounded-md border bg-white px-3.5 py-3 text-base text-slate-900 placeholder:text-slate-500 transition-colors focus:outline-none focus:ring-2";
const inputOk = "border-slate-300 hover:border-slate-400 focus:border-navy-500 focus:ring-navy-500/25";
const inputBad = "border-red-600 focus:border-red-600 focus:ring-red-600/25";

function FieldError({ id, children }: { id: string; children: string }) {
  return (
    <p id={id} className="mt-1.5 flex items-start gap-1.5 text-sm font-medium text-red-700">
      <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-5 w-5">
      {off ? (
        <path d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M9.9 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6A16.8 16.8 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 4.4-1" />
      ) : (
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6" />
      )}
    </svg>
  );
}

export function LoginForm() {
  const router = useRouter();
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [capsLock, setCapsLock] = useState(false);
  const [loading, setLoading] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  // Caps Lock is the most common reason a right password is refused, so say so while typing
  function watchCapsLock(e: KeyboardEvent<HTMLInputElement>) {
    setCapsLock(e.getModifierState("CapsLock"));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    // plainly wrong input (empty, not an email): say which field, and put the cursor there
    const invalid = validateLogin(email, password);
    setFieldErrors(invalid ?? {});
    if (invalid) {
      (invalid.email ? emailRef : passwordRef).current?.focus();
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient();
      const { data, error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (authError || !data.user) {
        fail(friendlyAuthError(authError?.message ?? "Invalid email or password."));
        return;
      }
      router.push(data.user.app_metadata?.force_password_change || data.user.user_metadata?.force_password_change ? "/force-password-change" : "/dashboard");
      router.refresh();
    } catch (err) {
      fail(friendlyAuthError(err instanceof Error ? err.message : "Sign-in failed."));
    }
  }

  // a refused sign-in: show the real reason (announced to screen readers) and select the password so retyping is one step
  function fail(message: string) {
    setFormError(message);
    setLoading(false);
    requestAnimationFrame(() => {
      passwordRef.current?.focus();
      passwordRef.current?.select();
    });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5" aria-busy={loading}>
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-slate-800">
          Email
        </label>
        <input
          ref={emailRef}
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
          placeholder="name@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={fieldErrors.email ? true : undefined}
          aria-describedby={fieldErrors.email ? "email-error" : undefined}
          className={cx("mt-1.5", inputBase, fieldErrors.email ? inputBad : inputOk)}
        />
        {fieldErrors.email && <FieldError id="email-error">{fieldErrors.email}</FieldError>}
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-slate-800">
          Password
        </label>
        <div className="relative mt-1.5">
          <input
            ref={passwordRef}
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={watchCapsLock}
            onKeyUp={watchCapsLock}
            onBlur={() => setCapsLock(false)}
            aria-invalid={fieldErrors.password ? true : undefined}
            aria-describedby={cx(fieldErrors.password && "password-error", capsLock && "caps-hint") || undefined}
            className={cx(inputBase, "pr-12", fieldErrors.password ? inputBad : inputOk)}
          />
          {/* a real button inside the field: 44px wide, named, and it says whether the password is showing */}
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            className="absolute inset-y-0 right-0 flex w-12 cursor-pointer items-center justify-center rounded-r-md text-slate-600 transition-colors hover:text-navy-800 focus-visible:outline-2 focus-visible:-outline-offset-2"
          >
            <EyeIcon off={showPassword} />
          </button>
        </div>
        {fieldErrors.password && <FieldError id="password-error">{fieldErrors.password}</FieldError>}
        <div aria-live="polite">
          {capsLock && (
            <p id="caps-hint" className="mt-1.5 flex items-start gap-1.5 text-sm text-amber-900">
              <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Caps Lock is on.</span>
            </p>
          )}
        </div>
      </div>

      {/* the reason the sign-in was refused, as Supabase reports it (role="alert": read out when it appears) */}
      {formError && <Alert tone="danger">{formError}</Alert>}

      <button type="submit" disabled={loading} className={cx(buttonClasses("primary"), "min-h-12 w-full text-base")}>
        {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none" aria-hidden="true" />}
        {loading ? "Signing in" : "Sign in"}
      </button>

      {/* the help box opens by sliding (grid rows 0fr -> 1fr), not by popping, and only grows downward: nothing above it moves.
          Closed, it is inert, so keyboard and screen reader users can't land in the hidden text. */}
      <div className="rounded-md border border-slate-200 text-sm">
        <button
          type="button"
          onClick={() => setHelpOpen((v) => !v)}
          aria-expanded={helpOpen}
          aria-controls="login-help"
          className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 rounded-md px-4 py-2.5 text-left font-medium text-slate-800 transition-colors hover:bg-slate-50"
        >
          Need help signing in?
          <Icon name="chevron-down" className={cx("h-4 w-4 shrink-0 text-slate-600 transition-transform duration-200 motion-reduce:transition-none", helpOpen && "rotate-180")} />
        </button>
        <div
          id="login-help"
          inert={!helpOpen}
          className={cx("grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none", helpOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}
        >
          <div className="overflow-hidden">
            <ul className="space-y-2 border-t border-slate-200 px-4 py-3 text-slate-700">
              <li>
                <span className="font-medium text-slate-900">Forgot your password?</span> Ask an Admin to reset it. You will choose your own new password the next time you sign in.
              </li>
              <li>
                <span className="font-medium text-slate-900">Account deactivated?</span> Only an Admin can switch it back on.
              </li>
              <li>
                <span className="font-medium text-slate-900">Signed out on your own?</span> For safety you are signed out after 15 minutes without activity.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </form>
  );
}
