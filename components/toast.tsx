"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./icons";
import { cx } from "./ui";

type Toast = { id: number; message: string; tone: "success" | "error" };
type ToastApi = { push: (message: string, tone?: Toast["tone"]) => void };

const ToastContext = createContext<ToastApi>({ push: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((all) => all.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((message: string, tone: Toast["tone"] = "success") => {
    const id = nextId.current++;
    setToasts((all) => [...all.slice(-3), { id, message, tone }]);
  }, []);

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-4 sm:items-end print:hidden"
      >
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), 4500);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  return (
    <div
      role="status"
      className={cx(
        "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg",
        toast.tone === "success" ? "border-emerald-300 bg-white text-slate-900" : "border-red-300 bg-white text-slate-900",
      )}
    >
      <span
        className={cx(
          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white",
          toast.tone === "success" ? "bg-emerald-600" : "bg-red-600",
        )}
      >
        <Icon name={toast.tone === "success" ? "check" : "alert"} className="h-3 w-3" />
      </span>
      <p className="flex-1">{toast.message}</p>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className="text-slate-400 hover:text-slate-700"
        aria-label="Dismiss notification"
      >
        <Icon name="x" className="h-4 w-4" />
      </button>
    </div>
  );
}
