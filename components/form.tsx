"use client";

import {
  createContext,
  startTransition,
  useActionState,
  useContext,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { Alert, buttonClasses, cx, type ButtonSize, type ButtonVariant } from "./ui";
import { useToast } from "./toast";

export type FormState = {
  error?: string;
  success?: boolean;
  fieldErrors?: Record<string, string>;
};

type Ctx = { pending: boolean; fieldErrors: Record<string, string> };
const FormCtx = createContext<Ctx>({ pending: false, fieldErrors: {} });

type ConfirmRequest = {
  title: string;
  message: string;
  confirmLabel: string;
  tone: "danger" | "primary";
  data: FormData;
};

/**
 * Wraps a server action with the app's standard form behaviour:
 * - typed values survive a failed submit (React 19 resets `<form action>` forms)
 * - per-field errors (`fieldErrors`) flow to <Field>, first invalid field is focused
 * - submit buttons disable while pending (no double submits)
 * - buttons with `confirm` open a confirmation dialog before submitting
 * - success raises a toast and can reset the form
 */
export function ActionForm<S extends FormState>({
  action,
  initialState,
  children,
  className,
  successMessage,
  resetOnSuccess = false,
  showError = true,
  onSuccess,
}: {
  action: (state: S, formData: FormData) => Promise<S>;
  initialState?: S;
  children: ReactNode | ((state: S) => ReactNode);
  className?: string;
  successMessage?: string | ((state: S) => string | null);
  resetOnSuccess?: boolean;
  showError?: boolean;
  onSuccess?: (state: S) => void;
}) {
  const [initial] = useState<S>(() => initialState ?? ({} as S));
  const [state, formAction, pending] = useActionState<S, FormData>(
    action as (state: Awaited<S>, formData: FormData) => Promise<S>,
    initial as Awaited<S>,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [confirmReq, setConfirmReq] = useState<ConfirmRequest | null>(null);
  const toast = useToast();

  useEffect(() => {
    if (state === initial) return;
    if (state.success) {
      const message = typeof successMessage === "function" ? successMessage(state) : successMessage;
      if (message) toast.push(message, "success");
      if (resetOnSuccess) formRef.current?.reset();
      onSuccess?.(state);
    } else if (state.fieldErrors && formRef.current) {
      const first = Object.keys(state.fieldErrors)[0];
      const el = first ? (formRef.current.elements.namedItem(first) as HTMLElement | null) : null;
      if (el && "focus" in el) el.focus();
    }
    // Only react to a new result from the server action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  useEffect(() => {
    if (confirmReq) dialogRef.current?.showModal();
  }, [confirmReq]);

  function submit(data: FormData) {
    startTransition(() => formAction(data));
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const data = new FormData(e.currentTarget, submitter);
    const message = submitter?.dataset.confirm;
    if (message) {
      setConfirmReq({
        title: submitter.dataset.confirmTitle ?? "Are you sure?",
        message,
        confirmLabel: submitter.dataset.confirmLabel ?? "Confirm",
        tone: submitter.dataset.confirmTone === "primary" ? "primary" : "danger",
        data,
      });
      return;
    }
    submit(data);
  }

  function closeDialog() {
    dialogRef.current?.close();
    setConfirmReq(null);
  }

  return (
    <FormCtx.Provider value={{ pending, fieldErrors: state.fieldErrors ?? {} }}>
      <form ref={formRef} onSubmit={handleSubmit} className={className}>
        {typeof children === "function" ? children(state) : children}
        {showError && state.error && (
          <div className="col-span-full">
            <Alert tone="danger">{state.error}</Alert>
          </div>
        )}
      </form>
      <dialog
        ref={dialogRef}
        onClose={() => setConfirmReq(null)}
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-slate-200 p-0 shadow-2xl backdrop:bg-navy-950/50"
      >
        {confirmReq && (
          <div className="p-6">
            <h2 className="text-lg font-semibold text-slate-900">{confirmReq.title}</h2>
            <p className="mt-2 text-sm text-slate-600">{confirmReq.message}</p>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" autoFocus onClick={closeDialog} className={buttonClasses("secondary")}>
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const data = confirmReq.data;
                  closeDialog();
                  submit(data);
                }}
                className={buttonClasses(confirmReq.tone === "danger" ? "danger" : "primary")}
              >
                {confirmReq.confirmLabel}
              </button>
            </div>
          </div>
        )}
      </dialog>
    </FormCtx.Provider>
  );
}

export function useFormPending() {
  return useContext(FormCtx).pending;
}

export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
  size = "md",
  name,
  value,
  disabled,
  confirm,
  className,
}: {
  children: ReactNode;
  pendingLabel?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  name?: string;
  value?: string;
  disabled?: boolean;
  confirm?: { title?: string; message: string; confirmLabel?: string; tone?: "danger" | "primary" };
  className?: string;
}) {
  const { pending } = useContext(FormCtx);
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending || disabled}
      aria-busy={pending}
      data-confirm={confirm?.message}
      data-confirm-title={confirm?.title}
      data-confirm-label={confirm?.confirmLabel}
      data-confirm-tone={confirm?.tone}
      className={cx(buttonClasses(variant, size), className)}
    >
      {pending && (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden="true" />
      )}
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}

const controlClass =
  "mt-1 block w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 disabled:bg-slate-100 disabled:text-slate-500";

function controlState(error?: string) {
  return error
    ? "border-red-500 focus:border-red-600 focus:ring-red-500/20"
    : "border-slate-300 focus:border-navy-500 focus:ring-navy-500/20";
}

function FieldShell({
  id,
  label,
  hint,
  error,
  required,
  className,
  children,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {label}
        {required && (
          <span className="ml-0.5 text-red-600" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-xs font-medium text-red-700">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type FieldProps = {
  label: ReactNode;
  name: string;
  hint?: ReactNode;
  className?: string;
};

export function Field({
  label,
  name,
  hint,
  className,
  id,
  ...input
}: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  const error = useContext(FormCtx).fieldErrors[name];
  const fieldId = id ?? `f-${name}`;
  return (
    <FieldShell id={fieldId} label={label} hint={hint} error={error} required={input.required} className={className}>
      <input
        id={fieldId}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
        {...input}
        className={cx(controlClass, controlState(error))}
      />
    </FieldShell>
  );
}

export function SelectField({
  label,
  name,
  hint,
  className,
  id,
  children,
  ...select
}: FieldProps & SelectHTMLAttributes<HTMLSelectElement>) {
  const error = useContext(FormCtx).fieldErrors[name];
  const fieldId = id ?? `f-${name}`;
  return (
    <FieldShell id={fieldId} label={label} hint={hint} error={error} required={select.required} className={className}>
      <select
        id={fieldId}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
        {...select}
        className={cx(controlClass, controlState(error))}
      >
        {children}
      </select>
    </FieldShell>
  );
}

export function TextareaField({
  label,
  name,
  hint,
  className,
  id,
  ...textarea
}: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const error = useContext(FormCtx).fieldErrors[name];
  const fieldId = id ?? `f-${name}`;
  return (
    <FieldShell id={fieldId} label={label} hint={hint} error={error} required={textarea.required} className={className}>
      <textarea
        id={fieldId}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
        {...textarea}
        className={cx(controlClass, controlState(error))}
      />
    </FieldShell>
  );
}

export function CheckboxField({
  label,
  name,
  hint,
  className,
  ...input
}: { label: ReactNode; name: string; hint?: ReactNode; className?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = input.id ?? `f-${name}`;
  return (
    <div className={cx("flex items-start gap-2", className)}>
      <input
        id={id}
        type="checkbox"
        name={name}
        {...input}
        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-navy-700 focus:ring-navy-500"
      />
      <label htmlFor={id} className="text-sm text-slate-700">
        {label}
        {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      </label>
    </div>
  );
}
