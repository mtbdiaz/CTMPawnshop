import type { ZodError } from "zod";

export type FieldErrors = Record<string, string>;

/** Server-action error shape: a form-level message plus one message per invalid field. */
export function validationFailure(error: ZodError): { error: string; fieldErrors: FieldErrors } {
  const fieldErrors: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  const count = Object.keys(fieldErrors).length;
  return {
    error:
      count > 1
        ? "Please fix the highlighted fields."
        : (error.issues[0]?.message ?? "Please check the form and try again."),
    fieldErrors,
  };
}
