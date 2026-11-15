"use client"; // the Actions menu and its popups run in the browser

import { createContext, useContext, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { ActionForm, Field, SelectField, SubmitButton } from "@/components/form";
import { buttonClasses, cx } from "@/components/ui";
import { Icon } from "@/components/icons";
import { ALL_ROLES, ROLE_LABELS, type StaffRole } from "@/lib/auth/roles";
import { describeEdit, oneTimePassword, type StaffAccount, type StaffPermissions } from "@/lib/staff/directory";
import { createAccount, resetPassword, setStaffActive, updateStaffDetails, type ActionState } from "./actions";

// Phase 2B (Nov 15): Settings → Users.
// Before: every row had an editable name box, a role list, Save, Reset password and a red Deactivate button (35
// buttons for 12 people), a role change saved on one click with no summary, and the temporary password appeared
// inside the table row.
// Now: one "Actions" menu per person (Edit staff, Reset password, Deactivate/Reactivate, or Finish ... when a sign-in
// step didn't finish), and each action opens its own popup that says exactly what will happen. The server actions
// and the database rules from Phase 2A (0084) are unchanged and still check everything.

// The four server actions the popups call. The real app always uses these; a test page can pass made-up ones (for
// example a reset that fails) so every result can be checked without changing a real staff account.
type StaffApi = { createAccount: typeof createAccount; resetPassword: typeof resetPassword; setStaffActive: typeof setStaffActive; updateStaffDetails: typeof updateStaffDetails };
export const StaffApiContext = createContext<StaffApi>({ createAccount, resetPassword, setStaffActive, updateStaffDetails });

// ---------- a popup (the browser's <dialog>): Esc and the dark area close it; focus goes back to the Actions button ----------
function StaffDialog({
  open,
  onClose,
  title,
  children,
  returnFocus,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  returnFocus?: RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      // sensible first focus: the element marked data-autofocus (Cancel in a confirm, the first box in a form).
      // The browser would otherwise focus the first button, which is Close.
      d.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    }
  }, [open]);
  if (!open) return null;
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      // e.target check: a confirm box inside a form closing must not close this popup
      onClose={(e) => {
        if (e.target !== e.currentTarget) return;
        onClose();
        returnFocus?.current?.focus(); // back to the button that opened it
      }}
      onClick={(e) => e.target === e.currentTarget && ref.current?.close()}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(30rem,calc(100vw-2rem))] overflow-y-auto rounded-md border border-slate-200 p-0 text-left shadow-2xl backdrop:bg-navy-950/50"
    >
      <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4">
        <h2 id={titleId} className="text-lg font-semibold text-slate-900">
          {title}
        </h2>
        <button type="button" onClick={() => ref.current?.close()} aria-label="Close" className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500">
          <Icon name="x" className="h-5 w-5" />
        </button>
      </div>
      <div className="px-5 py-4">{children}</div>
    </dialog>
  );
}

// closes the popup that holds this element (used by Cancel / Done buttons and after a save)
const closeNearestDialog = (el: Element | null) => (el?.closest("dialog") as HTMLDialogElement | null)?.close();

function CancelButton({ label = "Cancel", autoFocus }: { label?: string; autoFocus?: boolean }) {
  return (
    <button type="button" autoFocus={autoFocus} data-autofocus={autoFocus ? "" : undefined} onClick={(e) => closeNearestDialog(e.currentTarget)} className={buttonClasses("secondary")}>
      {label}
    </button>
  );
}

// ---------- the one-time temporary password (new account or reset) ----------
function TempPasswordResult({ name, email, password, note }: { name: string; email: string | null; password: string; note?: string }) {
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLElement>(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
    } catch {
      // no clipboard (old browser or blocked): select the text so Ctrl+C works
      const range = document.createRange();
      if (codeRef.current) range.selectNodeContents(codeRef.current);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
    }
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-700">
        Temporary password for <span className="font-semibold text-slate-900">{name}</span>
        {email && <span className="break-all text-slate-500"> ({email})</span>}:
      </p>
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-300 bg-slate-50 px-3 py-2">
        <code ref={codeRef} className="min-w-0 flex-1 select-all break-all font-mono text-base tracking-wide text-slate-900">
          {password}
        </code>
        <button type="button" onClick={copy} className={buttonClasses("secondary", "sm")} aria-live="polite">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
        <li>Give it only to {name}, in person or by private message. Don&apos;t post it in a group chat.</li>
        <li>They&apos;ll be asked to choose their own password the first time they sign in with it.</li>
        <li>It is shown only now. After you close this, it can&apos;t be shown again; if it&apos;s lost, reset the password again.</li>
      </ul>
      {note && <p className="text-xs text-amber-800">{note}</p>}
      <div className="flex justify-end">
        <CancelButton label="Done" autoFocus />
      </div>
    </div>
  );
}

// ---------- Edit staff ----------
function EditStaff({ account, perms }: { account: StaffAccount; perms: StaffPermissions }) {
  const box = useRef<HTMLDivElement>(null);
  const api = useContext(StaffApiContext);
  const [name, setName] = useState(account.full_name);
  const [role, setRole] = useState<StaffRole>(account.role);
  const [ack, setAck] = useState(false);
  const edit = describeEdit(account, { full_name: name, role });
  const canSave = edit.changes.length > 0 && !edit.nameBlank && (!edit.makesAdmin || ack);
  return (
    <div ref={box}>
      <ActionForm<ActionState>
        action={api.updateStaffDetails}
        successMessage={(s) => s.message ?? `Saved ${name.trim()}.`}
        onSuccess={() => closeNearestDialog(box.current)}
        className="space-y-4"
      >
        <input type="hidden" name="user_id" value={account.id} />
        {/* the version this page shows: the server refuses if another Admin changed the account since (U3) */}
        <input type="hidden" name="expected_updated_at" value={account.updated_at} />
        <Field id={`edit-name-${account.id}`} data-autofocus="" label="Full name" name="full_name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-slate-500">Email</dt>
          <dd className="break-all text-slate-900">{account.email ?? "-"} <span className="text-xs text-slate-500">(can&apos;t be changed here)</span></dd>
          <dt className="text-slate-500">Current role</dt>
          <dd className="font-medium text-slate-900">{ROLE_LABELS[account.role]}</dd>
        </dl>
        <SelectField
          id={`edit-role-${account.id}`}
          data-native-picker="" // inside a popup: the app's own dropdown list (picker-enhancer) would open behind it
          label="Role"
          name="role"
          value={role}
          onChange={(e) => {
            setRole(e.target.value as StaffRole);
            setAck(false);
          }}
          disabled={!perms.canChangeRole}
          hint={perms.roleLockedReason ?? "What this person can open and do in PawnTrack."}
        >
          {ALL_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </SelectField>
        {/* a disabled list isn't sent with the form, so send the current role */}
        {!perms.canChangeRole && <input type="hidden" name="role" value={account.role} />}

        {edit.makesAdmin && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <p className="font-semibold">This gives {name.trim() || "this person"} full Admin access.</p>
            <p className="mt-1">They will be able to manage staff accounts, change rates and settings, correct records, and see every report and the Audit trail.</p>
            <label className="mt-2 flex items-start gap-2">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-amber-400 text-navy-800 focus:ring-navy-500" />
              <span>I understand and want to make them an Admin.</span>
            </label>
          </div>
        )}
        {edit.removesAdmin && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {account.full_name} will lose Admin access the next time they open a page.
          </p>
        )}

        <div className="rounded-md border border-slate-200 px-3 py-2 text-sm" aria-live="polite">
          {edit.changes.length === 0 ? (
            <p className="text-slate-500">No changes yet.</p>
          ) : (
            <>
              <p className="font-medium text-slate-900">Changes to save</p>
              <ul className="mt-1 space-y-0.5">
                {edit.changes.map((c) => (
                  <li key={c.field} className="text-slate-700">
                    {c.field}: <span className="text-slate-500 line-through decoration-slate-400">{c.from}</span> → <span className="font-medium text-slate-900">{c.to}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <CancelButton />
          <SubmitButton pendingLabel="Saving" disabled={!canSave}>
            Save changes
          </SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}

// ---------- Reset password ----------
function ResetPassword({ account, isSelf }: { account: StaffAccount; isSelf: boolean }) {
  const api = useContext(StaffApiContext);
  return (
    <ActionForm<ActionState> action={api.resetPassword} className="space-y-4">
      {(state) =>
        oneTimePassword(state) ? (
          <TempPasswordResult name={account.full_name} email={account.email} password={oneTimePassword(state)!} note={state.message} />
        ) : (
          <>
            <input type="hidden" name="user_id" value={account.id} />
            <div className="space-y-2 text-sm text-slate-700">
              <p>
                A new temporary password will replace <span className="font-semibold text-slate-900">{account.full_name}</span>&apos;s current password right away. You&apos;ll see it once, to give to them.
              </p>
              <p>They&apos;ll have to choose their own password the next time they sign in.</p>
              <p className="text-slate-600">
                Their other sign-ins are ended, but a page they already have open may keep working for up to an hour.
              </p>
              {isSelf && <p className="font-medium text-amber-900">This is your own account: you&apos;ll have to set a new password the next time you sign in.</p>}
              {!account.is_active && <p className="text-slate-600">This account is deactivated, so they still can&apos;t sign in until it is reactivated.</p>}
            </div>
            <div className="flex justify-end gap-2">
              <CancelButton autoFocus />
              <SubmitButton pendingLabel="Resetting">Reset password</SubmitButton>
            </div>
          </>
        )
      }
    </ActionForm>
  );
}

// ---------- Deactivate / Reactivate / Finish ... ----------
const STATUS_TEXT = {
  deactivate: {
    title: (n: string) => `Deactivate ${n}?`,
    body: (n: string) => [
      `${n} will lose access to protected data and actions. They won't be able to sign in again until an Admin reactivates them.`,
      "Pages they already have open may still show information loaded earlier.",
      "Their name stays on every record they made. Nothing is deleted.",
    ],
    button: "Deactivate account",
    tone: "danger" as const,
    makeActive: false,
  },
  reactivate: {
    title: (n: string) => `Reactivate ${n}?`,
    body: (n: string, role: string) => [`${n} can sign in again with their current password and gets their ${role} access back.`],
    button: "Reactivate account",
    tone: "primary" as const,
    makeActive: true,
  },
  "finish-deactivation": {
    title: (n: string) => `Finish deactivating ${n}`,
    body: (n: string) => [
      `${n} is already deactivated in PawnTrack and has lost access to protected data and actions, but blocking their sign-in didn't finish last time.`,
      "Try again now. If it fails again, wait a few minutes and retry.",
    ],
    button: "Finish deactivation",
    tone: "danger" as const,
    makeActive: false,
  },
  "finish-reactivation": {
    title: (n: string) => `Finish reactivating ${n}`,
    body: (n: string) => [`${n} is active in PawnTrack, but their sign-in is still blocked from last time, so they can't sign in yet.`, "Try again now."],
    button: "Finish reactivation",
    tone: "primary" as const,
    makeActive: true,
  },
};
type StatusKind = keyof typeof STATUS_TEXT;

function ChangeStatus({ account, kind }: { account: StaffAccount; kind: StatusKind }) {
  const box = useRef<HTMLDivElement>(null);
  const api = useContext(StaffApiContext);
  const t = STATUS_TEXT[kind];
  return (
    <div ref={box}>
      <ActionForm<ActionState> action={api.setStaffActive} successMessage={(s) => s.message ?? "Saved."} onSuccess={() => closeNearestDialog(box.current)} className="space-y-4">
        <input type="hidden" name="user_id" value={account.id} />
        <input type="hidden" name="expected_updated_at" value={account.updated_at} />
        {t.makeActive && <input type="hidden" name="make_active" value="on" />}
        <div className="space-y-2 text-sm text-slate-700">
          {t.body(account.full_name, ROLE_LABELS[account.role]).map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <CancelButton autoFocus />
          <SubmitButton variant={t.tone === "danger" ? "danger" : "primary"} pendingLabel="Saving">
            {t.button}
          </SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}

// ---------- the Actions menu ----------
type MenuItem = { key: string; label: string; danger?: boolean; onSelect: () => void };

function ActionsMenu({ name, items, buttonRef }: { name: string; items: MenuItem[]; buttonRef: RefObject<HTMLButtonElement | null> }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  function openMenu() {
    const r = buttonRef.current?.getBoundingClientRect();
    if (!r) return;
    // fixed position next to the button, so the menu isn't cut off by the table's scroll box; flips up near the bottom
    const below = r.bottom + 4 + items.length * 40 + 16 < window.innerHeight;
    setPos({ top: below ? r.bottom + 4 : Math.max(8, r.top - 4 - items.length * 40 - 8), right: Math.max(8, window.innerWidth - r.right) });
    setOpen(true);
  }
  const close = (focusButton: boolean) => {
    setOpen(false);
    if (focusButton) buttonRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    (menuRef.current?.querySelector('[role="menuitem"]') as HTMLElement | null)?.focus();
    const outside = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !buttonRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const away = () => setOpen(false);
    document.addEventListener("mousedown", outside);
    window.addEventListener("resize", away);
    window.addEventListener("scroll", away, true);
    return () => {
      document.removeEventListener("mousedown", outside);
      window.removeEventListener("resize", away);
      window.removeEventListener("scroll", away, true);
    };
  }, [open, buttonRef]);

  function onMenuKey(e: KeyboardEvent<HTMLDivElement>) {
    const all = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const i = all.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") all[(i + 1) % all.length]?.focus();
    else if (e.key === "ArrowUp") all[(i - 1 + all.length) % all.length]?.focus();
    else if (e.key === "Home") all[0]?.focus();
    else if (e.key === "End") all[all.length - 1]?.focus();
    else if (e.key === "Escape") close(true);
    else if (e.key === "Tab") close(false);
    else return;
    if (e.key !== "Tab") e.preventDefault();
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Actions for ${name}`}
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            openMenu();
          }
        }}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500"
      >
        <Icon name="dots" className="h-5 w-5" />
      </button>
      {open && pos && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={`Actions for ${name}`}
          onKeyDown={onMenuKey}
          style={{ position: "fixed", top: pos.top, right: pos.right }}
          className="z-50 min-w-[12rem] rounded-md border border-slate-200 bg-white py-1 shadow-lg"
        >
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                setOpen(false);
                it.onSelect();
              }}
              className={cx(
                "block w-full px-3 py-2 text-left text-sm focus:outline-none focus-visible:bg-navy-50 hover:bg-slate-50",
                it.danger ? "text-red-700" : "text-slate-800",
              )}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

// ---------- one person's Actions menu + its popups (used by the table rows and the phone cards) ----------
export function StaffActions({ account, perms }: { account: StaffAccount; perms: StaffPermissions }) {
  const [dialog, setDialog] = useState<null | "edit" | "reset" | StatusKind>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const items: MenuItem[] = [];
  if (perms.status === "finish-deactivation" || perms.status === "finish-reactivation") {
    items.push({ key: "status", label: STATUS_TEXT[perms.status].button, onSelect: () => setDialog(perms.status) });
  }
  items.push({ key: "edit", label: "Edit staff", onSelect: () => setDialog("edit") });
  items.push({ key: "reset", label: "Reset password", onSelect: () => setDialog("reset") });
  if (perms.status === "deactivate") items.push({ key: "status", label: "Deactivate", danger: true, onSelect: () => setDialog("deactivate") });
  if (perms.status === "reactivate") items.push({ key: "status", label: "Reactivate", onSelect: () => setDialog("reactivate") });

  const title =
    dialog === "edit" ? `Edit ${account.full_name}` : dialog === "reset" ? `Reset ${account.full_name}'s password` : dialog ? STATUS_TEXT[dialog].title(account.full_name) : "";
  return (
    <>
      <ActionsMenu name={account.full_name} items={items} buttonRef={buttonRef} />
      <StaffDialog open={dialog !== null} onClose={() => setDialog(null)} title={title} returnFocus={buttonRef}>
        {dialog === "edit" && <EditStaff account={account} perms={perms} />}
        {dialog === "reset" && <ResetPassword account={account} isSelf={perms.isSelf} />}
        {dialog && dialog !== "edit" && dialog !== "reset" && <ChangeStatus account={account} kind={dialog} />}
      </StaffDialog>
    </>
  );
}

// ---------- the "Finish ..." button shown on accounts that need attention ----------
export function FinishButton({ account, kind }: { account: StaffAccount; kind: "finish-deactivation" | "finish-reactivation" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={ref} type="button" onClick={() => setOpen(true)} className={buttonClasses("secondary", "sm")}>
        {STATUS_TEXT[kind].button}
        <span className="sr-only"> for {account.full_name}</span>
      </button>
      <StaffDialog open={open} onClose={() => setOpen(false)} title={STATUS_TEXT[kind].title(account.full_name)} returnFocus={ref}>
        <ChangeStatus account={account} kind={kind} />
      </StaffDialog>
    </>
  );
}

// ---------- Add staff ----------
function AddStaffForm() {
  const api = useContext(StaffApiContext);
  const [name, setName] = useState("");
  const [role, setRole] = useState<StaffRole>("operator"); // the same default as before
  const [ack, setAck] = useState(false);
  return (
    <ActionForm<ActionState> action={api.createAccount} successMessage="Staff account created." className="space-y-4">
      {(state) =>
        oneTimePassword(state) ? (
          // the name and email the server saved, so the password is clearly for this new account
          <TempPasswordResult name={state.accountName ?? (name.trim() || "the new staff member")} email={state.accountEmail ?? null} password={oneTimePassword(state)!} />
        ) : (
          <>
            <Field id="add-staff-name" data-autofocus="" label="Full name" name="full_name" required maxLength={80} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
            <Field id="add-staff-email" label="Email" name="email" type="email" required maxLength={254} autoComplete="off" hint="They sign in with this. It can't be changed later in PawnTrack." />
            <SelectField
              id="add-staff-role"
              data-native-picker="" // inside a popup: keep the browser's own list (see Edit staff)
              label="Role"
              name="role"
              required
              value={role}
              onChange={(e) => {
                setRole(e.target.value as StaffRole);
                setAck(false);
              }}
              hint="Operator: vault, inventory, audits. Cashier: loans, payments. Appraiser: appraisals. Admin: everything, including staff."
            >
              {ALL_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </SelectField>
            {role === "admin" && (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <p className="font-semibold">An Admin account has full access.</p>
                <p className="mt-1">They can manage staff accounts, change rates and settings, correct records, and see every report and the Audit trail.</p>
                <label className="mt-2 flex items-start gap-2">
                  <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-amber-400 text-navy-800 focus:ring-navy-500" />
                  <span>I understand and want to create an Admin account.</span>
                </label>
              </div>
            )}
            <p className="text-sm text-slate-600">After you add them, you&apos;ll get a temporary password to give them. They choose their own when they first sign in.</p>
            <div className="flex justify-end gap-2">
              <CancelButton />
              <SubmitButton pendingLabel="Adding" disabled={role === "admin" && !ack}>
                Add staff
              </SubmitButton>
            </div>
          </>
        )
      }
    </ActionForm>
  );
}

export function AddStaffButton() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={ref} type="button" onClick={() => setOpen(true)} className={buttonClasses("primary")}>
        <Icon name="plus" className="h-4 w-4" />
        Add staff
      </button>
      <StaffDialog open={open} onClose={() => setOpen(false)} title="Add a staff member" returnFocus={ref}>
        <AddStaffForm />
      </StaffDialog>
    </>
  );
}

