// Sign-in helpers for the login page: plain functions, so they are easy to test.

/** What staff see when Supabase refuses the sign-in. The real error is kept for anything we don't recognise. */
export function friendlyAuthError(message: string): string {
  if (/invalid login credentials/i.test(message)) return "That email and password don't match. Check them and try again.";
  if (/banned|disabled/i.test(message)) return "This account has been deactivated. Ask an Admin to reactivate it.";
  if (/network|fetch/i.test(message)) return "Can't reach the server. Check your internet connection and try again.";
  return message;
}

export type LoginFieldErrors = { email?: string; password?: string };

/**
 * Checks the two fields before anything is sent. Returns the messages to show under each field, or null when both are fine.
 * It only catches what is plainly wrong (empty, or not shaped like an email); whether the account exists is Supabase's answer.
 * The password is never trimmed or judged: any text may be a password.
 */
export function validateLogin(email: string, password: string): LoginFieldErrors | null {
  const errors: LoginFieldErrors = {};
  const e = email.trim();
  if (!e) errors.email = "Enter your email address.";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) errors.email = "Enter your email address, like name@example.com.";
  if (!password) errors.password = "Enter your password.";
  return errors.email || errors.password ? errors : null;
}
