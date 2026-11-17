"use client";

// One place that gives every dropdown (<select>) and date box (<input type="date">) in the app the same look when it opens.
// The browser draws those pop-ups itself, in its own generic style, and a page can't restyle them. So this takes over
// the opening: the real <select> / <input> stays in the page (forms, validation, onChange, screen readers all keep
// working exactly as before); only the pop-up is ours. Picking writes the value into the real field and fires the same
// "input" and "change" events a click on the browser's own list would. On phones and tablets (touch) the browser's own
// pickers are kept, because they are the best thing to use there.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { manilaToday } from "@/lib/format";
import {
  MONTH_NAMES,
  WEEKDAYS,
  addDays,
  addMonths,
  clampIso,
  isDisabledDay,
  isMonthOutOfRange,
  isYearOutOfRange,
  longDate,
  monthGrid,
  monthTitle,
  parseIso,
  toIso,
  YEARS_PER_PAGE,
  yearBounds,
  yearPage,
  yearPageStart,
} from "@/lib/calendar";
import { Icon } from "./icons";
import { cx } from "./ui";

type Target = { kind: "select"; el: HTMLSelectElement } | { kind: "date"; el: HTMLInputElement };

type Row = { type: "group"; label: string } | { type: "option"; value: string; label: string; disabled: boolean };

function isPlainSelect(el: Element | null): el is HTMLSelectElement {
  return el instanceof HTMLSelectElement && !el.multiple && el.size <= 1 && !el.disabled && el.dataset.nativePicker === undefined;
}
function isDateInput(el: Element | null): el is HTMLInputElement {
  return el instanceof HTMLInputElement && el.type === "date" && !el.disabled && !el.readOnly && el.dataset.nativePicker === undefined;
}

/** Writes a value into the real field and tells the page, the same way a click on the browser's own list would. */
function writeValue(el: HTMLSelectElement | HTMLInputElement, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value); // the setter React's change tracking expects
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

const ICON_ZONE = 38; // px at the right edge of a date box that count as "the calendar button"

/** Places a pop-up under its field, or above it when there is no room below, and keeps it on screen. */
function place(anchor: HTMLElement, popup: HTMLElement) {
  const a = anchor.getBoundingClientRect();
  const margin = 8;
  const w = popup.offsetWidth;
  const h = popup.offsetHeight;
  const below = window.innerHeight - a.bottom - margin;
  const above = a.top - margin;
  const openUp = h > below && above > below;
  const top = openUp ? Math.max(margin, a.top - h - 4) : a.bottom + 4;
  const left = Math.min(Math.max(margin, a.left), Math.max(margin, window.innerWidth - w - margin));
  popup.style.top = `${top}px`;
  popup.style.left = `${left}px`;
  popup.style.maxHeight = `${Math.max(160, openUp ? above : below)}px`;
  // Inside a popup window that is moved with a CSS transform, "fixed" is measured from that window, not the screen.
  // Check where the list really landed and shift it by the difference, so it always sits on its field.
  const at = popup.getBoundingClientRect();
  if (Math.abs(at.top - top) > 1 || Math.abs(at.left - left) > 1) {
    popup.style.top = `${top - (at.top - top)}px`;
    popup.style.left = `${left - (at.left - left)}px`;
  }
}

/**
 * The open popup window (<dialog> opened with showModal) the field sits in, if any. The browser draws such a window
 * above everything else on the page and switches the rest of the page off, so a list drawn outside it would open
 * behind it and couldn't be clicked. The list is drawn inside that window instead.
 */
function modalHost(el: Element): HTMLDialogElement | null {
  const d = el.closest("dialog");
  return d instanceof HTMLDialogElement && d.open && d.matches(":modal") ? d : null;
}

export function PickerEnhancer() {
  const [target, setTarget] = useState<Target | null>(null);
  const targetRef = useRef<Target | null>(null);
  useEffect(() => {
    targetRef.current = target;
  }, [target]);

  const close = useCallback((returnFocus = true) => {
    const t = targetRef.current;
    if (!t) return;
    t.el.removeAttribute("aria-expanded");
    t.el.removeAttribute("aria-activedescendant");
    setTarget(null);
    if (returnFocus) t.el.focus({ preventScroll: true });
  }, []);

  // open / close from the field itself
  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches) return; // touch screens keep the browser's own pickers

    const open = (t: Target) => {
      if (targetRef.current?.el === t.el) {
        close();
        return;
      }
      targetRef.current?.el.removeAttribute("aria-expanded");
      t.el.focus({ preventScroll: true });
      t.el.setAttribute("aria-expanded", "true");
      setTarget(t);
    };

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const el = e.target instanceof Element ? e.target : null;
      const sel = el?.closest("select") ?? null;
      if (isPlainSelect(sel)) {
        e.preventDefault(); // stops the browser's own list
        open({ kind: "select", el: sel });
        return;
      }
      if (isDateInput(el)) {
        const r = el.getBoundingClientRect();
        if (e.clientX >= r.right - ICON_ZONE) {
          e.preventDefault();
          open({ kind: "date", el });
        }
      }
    };
    // the browser opens its own calendar on click of its small icon: stop that one too
    const onClick = (e: MouseEvent) => {
      const el = e.target instanceof Element ? e.target : null;
      if (isDateInput(el) && e.clientX >= el.getBoundingClientRect().right - ICON_ZONE) e.preventDefault();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (targetRef.current) return; // while a pop-up is open it has its own key handling (below)
      const el = e.target instanceof Element ? e.target : null;
      const wantsOpen = (e.altKey && e.key === "ArrowDown") || e.key === "F4" || (e.key === " " && isPlainSelect(el));
      if (!wantsOpen) return;
      if (isPlainSelect(el)) {
        e.preventDefault();
        open({ kind: "select", el });
      } else if (isDateInput(el)) {
        e.preventDefault();
        open({ kind: "date", el });
      }
    };

    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [close]);

  // close on outside click, resize, or leaving the field
  useEffect(() => {
    if (!target) return;
    const onDown = (e: MouseEvent) => {
      const n = e.target as Node;
      if (target.el.contains(n) || document.getElementById("picker-popup")?.contains(n)) return;
      close(false);
    };
    const onResize = () => close(false);
    document.addEventListener("mousedown", onDown, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("resize", onResize);
    };
  }, [target, close]);

  // a field inside a popup window: close the list when that window closes
  useEffect(() => {
    const host = target ? modalHost(target.el) : null;
    if (!host) return;
    const onClose = () => close(false);
    host.addEventListener("close", onClose);
    return () => host.removeEventListener("close", onClose);
  }, [target, close]);

  if (!target) return null;
  const popup =
    target.kind === "select" ? (
      <ListPopup key="select" el={target.el} close={close} />
    ) : (
      <CalendarPopup key="date" el={target.el} close={close} />
    );
  const host = modalHost(target.el);
  return host ? createPortal(popup, host) : popup;
}

/* ---------------------------------- dropdown list ---------------------------------- */

function readRows(el: HTMLSelectElement): Row[] {
  const rows: Row[] = [];
  for (const child of Array.from(el.children)) {
    if (child instanceof HTMLOptGroupElement) {
      rows.push({ type: "group", label: child.label });
      for (const o of Array.from(child.children)) {
        if (o instanceof HTMLOptionElement && !o.hidden) rows.push({ type: "option", value: o.value, label: o.text, disabled: o.disabled || child.disabled });
      }
    } else if (child instanceof HTMLOptionElement && !child.hidden) {
      rows.push({ type: "option", value: child.value, label: child.text, disabled: child.disabled });
    }
  }
  return rows;
}

function ListPopup({ el, close }: { el: HTMLSelectElement; close: (returnFocus?: boolean) => void }) {
  const rows = useMemo(() => readRows(el), [el]);
  const optionIdx = useMemo(() => rows.map((r, i) => (r.type === "option" ? i : -1)).filter((i) => i >= 0), [rows]);
  const popupRef = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const [active, setActive] = useState(() => {
    const selected = rows.findIndex((r) => r.type === "option" && r.value === el.value);
    return selected >= 0 ? selected : (optionIdx.find((i) => !(rows[i] as { disabled: boolean }).disabled) ?? -1);
  });

  const choose = useCallback(
    (index: number) => {
      const row = rows[index];
      if (!row || row.type !== "option" || row.disabled) return;
      if (el.value !== row.value) writeValue(el, row.value);
      close();
    },
    [rows, el, close],
  );

  useLayoutEffect(() => {
    if (popupRef.current) {
      popupRef.current.style.minWidth = `${el.getBoundingClientRect().width}px`;
      place(el, popupRef.current);
    }
  }, [el]);

  // keep the active row in view, and tell screen readers which one it is
  useEffect(() => {
    const node = popupRef.current?.querySelector<HTMLElement>(`[data-row="${active}"]`);
    node?.scrollIntoView({ block: "nearest" });
    if (node) el.setAttribute("aria-activedescendant", node.id);
  }, [active, el]);

  useEffect(() => {
    const move = (from: number, step: number) => {
      const at = optionIdx.indexOf(from);
      for (let i = at + step; i >= 0 && i < optionIdx.length; i += step) {
        if (!(rows[optionIdx[i]] as { disabled: boolean }).disabled) return optionIdx[i];
      }
      return from;
    };
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          setActive((a) => (a < 0 ? (optionIdx[0] ?? -1) : move(a, 1)));
          break;
        case "ArrowUp":
          setActive((a) => (a < 0 ? (optionIdx[0] ?? -1) : move(a, -1)));
          break;
        case "Home":
          setActive(optionIdx.find((i) => !(rows[i] as { disabled: boolean }).disabled) ?? -1);
          break;
        case "End":
          setActive([...optionIdx].reverse().find((i) => !(rows[i] as { disabled: boolean }).disabled) ?? -1);
          break;
        case "Enter":
        case " ":
          choose(active);
          break;
        case "Escape":
          close();
          break;
        case "Tab":
          close(false);
          return; // Tab keeps working normally
        default: {
          if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            const now = Date.now();
            typed.current.text = now - typed.current.at > 700 ? e.key.toLowerCase() : typed.current.text + e.key.toLowerCase();
            typed.current.at = now;
            const hit = optionIdx.find((i) => {
              const r = rows[i] as { label: string; disabled: boolean };
              return !r.disabled && r.label.toLowerCase().startsWith(typed.current.text);
            });
            if (hit !== undefined) setActive(hit);
            break;
          }
          return;
        }
      }
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [rows, optionIdx, active, choose, close]);

  return (
    <div
      id="picker-popup"
      ref={popupRef}
      role="listbox"
      aria-label={el.labels?.[0]?.textContent?.trim() || el.getAttribute("aria-label") || "Options"}
      className="picker-pop fixed z-[70] w-max max-w-[min(32rem,calc(100vw-1rem))] overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-[0_12px_32px_-8px_rgba(10,22,40,0.28),0_2px_6px_rgba(10,22,40,0.08)] print:hidden"
    >
      {rows.map((r, i) =>
        r.type === "group" ? (
          <div key={`g${i}`} className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500" role="presentation">
            {r.label}
          </div>
        ) : (
          <div
            key={`o${i}`}
            id={`picker-opt-${i}`}
            data-row={i}
            role="option"
            aria-selected={r.value === el.value}
            aria-disabled={r.disabled || undefined}
            onMouseMove={() => !r.disabled && setActive(i)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => choose(i)}
            className={cx(
              "flex cursor-pointer items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-sm",
              r.disabled ? "cursor-not-allowed text-slate-400" : i === active ? "bg-navy-50 text-navy-900" : "text-slate-800",
              r.value === el.value && !r.disabled && "font-medium text-navy-900",
            )}
          >
            <span className="min-w-0 truncate" title={r.label}>
              {r.label || " "}
            </span>
            {r.value === el.value && <Icon name="check" className="h-4 w-4 shrink-0 text-gold-600" />}
          </div>
        ),
      )}
    </div>
  );
}

/* ---------------------------------- calendar ---------------------------------- */

function CalendarPopup({ el, close }: { el: HTMLInputElement; close: (returnFocus?: boolean) => void }) {
  const today = manilaToday();
  const min = el.min || undefined;
  const max = el.max || undefined;
  const selected = parseIso(el.value) ? el.value : "";
  const popupRef = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState(() => clampIso(selected || today, min, max)); // the day the keyboard is on
  const [view, setView] = useState(() => parseIso(selected || clampIso(today, min, max))!); // the month shown
  // Nov 17 (Wush): "years" added. Before, the title only opened the months and the arrows stepped one year at a time,
  // so a birth date in the 1970s took about 50 clicks. Now: click the year, pick it from 20 at a time, then the month.
  const [mode, setMode] = useState<"days" | "months" | "years">("days");
  const [yearStart, setYearStart] = useState(() => yearPageStart(view.year)); // first year on the year page
  const bounds = yearBounds(today, min, max); // the years this box allows (1900 to 50 years ahead when it has no limits)
  const gridRef = useRef<HTMLDivElement>(null);
  const pickGridRef = useRef<HTMLDivElement>(null); // the month or year buttons

  const showMonthOf = useCallback((iso: string) => {
    const p = parseIso(iso);
    if (p) setView({ year: p.year, month: p.month, day: 1 });
  }, []);

  const pick = useCallback(
    (iso: string) => {
      if (isDisabledDay(iso, min, max)) return;
      if (el.value !== iso) writeValue(el, iso);
      close();
    },
    [el, min, max, close],
  );

  const clear = useCallback(() => {
    if (el.required) return;
    if (el.value !== "") writeValue(el, "");
    close();
  }, [el, close]);

  useLayoutEffect(() => {
    if (popupRef.current) place(el, popupRef.current);
  }, [el, mode, view, yearStart]);

  // opening the month or year list puts the keyboard on the chosen one (or the first that can be picked)
  useEffect(() => {
    if (mode === "days") return;
    const grid = pickGridRef.current;
    const target = grid?.querySelector<HTMLButtonElement>("[data-current]:not(:disabled)") ?? grid?.querySelector<HTMLButtonElement>("[data-pick]:not(:disabled)");
    target?.focus({ preventScroll: true });
  }, [mode, yearStart]);

  // after a keyboard move, put the real focus on the day so the ring is visible
  useEffect(() => {
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-iso="${focus}"]`)?.focus({ preventScroll: true });
  }, [focus, view, mode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (mode !== "days") setMode("days");
        else close();
        return;
      }
      if (e.key === "Tab") {
        const inside = popupRef.current?.contains(document.activeElement);
        if (!inside) close(false);
        return; // Tab moves through the buttons of the calendar, like any dialog
      }
      if (mode !== "days") {
        // arrow keys move between the month or year buttons (3 or 4 across); Enter and Space press the button
        const cols = mode === "months" ? 3 : 4;
        const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[e.key as "ArrowLeft"];
        if (!step) return;
        const buttons = [...(pickGridRef.current?.querySelectorAll<HTMLButtonElement>("[data-pick]") ?? [])];
        const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (at < 0) return;
        e.preventDefault();
        e.stopPropagation();
        for (let i = at + step; i >= 0 && i < buttons.length; i += step) {
          if (!buttons[i].disabled) {
            buttons[i].focus({ preventScroll: true });
            break;
          }
        }
        return;
      }
      let next: string | null = null;
      switch (e.key) {
        case "ArrowLeft": next = addDays(focus, -1); break;
        case "ArrowRight": next = addDays(focus, 1); break;
        case "ArrowUp": next = addDays(focus, -7); break;
        case "ArrowDown": next = addDays(focus, 7); break;
        case "PageUp": next = addMonths(focus, e.shiftKey ? -12 : -1); break;
        case "PageDown": next = addMonths(focus, e.shiftKey ? 12 : 1); break;
        case "Home": next = addDays(focus, -(new Date(Date.UTC(parseIso(focus)!.year, parseIso(focus)!.month - 1, parseIso(focus)!.day)).getUTCDay())); break;
        case "End": next = addDays(focus, 6 - new Date(Date.UTC(parseIso(focus)!.year, parseIso(focus)!.month - 1, parseIso(focus)!.day)).getUTCDay()); break;
        case "Enter":
        case " ":
          if (document.activeElement?.closest("[data-iso]")) {
            e.preventDefault();
            e.stopPropagation();
            pick(focus);
          }
          return;
        default:
          return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (next) {
        setFocus(next);
        showMonthOf(next);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [focus, mode, close, pick, showMonthOf]);

  const rows = useMemo(() => monthGrid(view.year, view.month), [view.year, view.month]);
  const stepMonth = (n: number) => {
    const iso = addMonths(toIso(view.year, view.month, 1), n);
    showMonthOf(iso);
    setFocus(clampIso(addMonths(focus, n), min, max));
  };
  const prevDisabled = Boolean(min && toIso(view.year, view.month, 1) <= min);
  const nextDisabled = Boolean(max && addMonths(toIso(view.year, view.month, 1), 1) > max);
  const todayDisabled = isDisabledDay(today, min, max);

  return (
    <div
      id="picker-popup"
      ref={popupRef}
      role="dialog"
      aria-label="Choose a date"
      className="picker-pop fixed z-[70] w-[19rem] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 shadow-[0_16px_40px_-8px_rgba(10,22,40,0.32),0_2px_6px_rgba(10,22,40,0.08)] print:hidden"
    >
      <div className="mb-2 flex items-center justify-between gap-1">
        <button
          type="button"
          onClick={() => (mode === "years" ? setYearStart((y) => y - YEARS_PER_PAGE) : mode === "months" ? setView((v) => ({ ...v, year: v.year - 1 })) : stepMonth(-1))}
          disabled={mode === "years" ? yearStart <= bounds.first : mode === "months" ? view.year - 1 < bounds.first : prevDisabled}
          aria-label={mode === "years" ? `Previous ${YEARS_PER_PAGE} years` : mode === "months" ? "Previous year" : "Previous month"}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-navy-900 disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <Icon name="chevron-left" className="h-4 w-4" />
        </button>
        {/* the title: the month and the year are separate buttons, so either one is a single click away */}
        <div className="flex min-w-0 items-center gap-0.5" aria-live="polite">
          {mode === "years" ? (
            <span className="px-2.5 py-1 font-display text-[15px] font-semibold tabular-nums text-navy-900">
              {Math.max(yearStart, bounds.first)} – {Math.min(yearStart + YEARS_PER_PAGE - 1, bounds.last)}
            </span>
          ) : (
            <>
              {mode === "days" && (
                <button
                  type="button"
                  onClick={() => setMode("months")}
                  aria-label={`Choose the month (now ${MONTH_NAMES[view.month - 1]})`}
                  className="flex items-center gap-1 rounded-md px-2 py-1 font-display text-[15px] font-semibold text-navy-900 hover:bg-slate-100"
                >
                  {MONTH_NAMES[view.month - 1]}
                  <Icon name="chevron-down" className="h-3.5 w-3.5 text-slate-500" />
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setYearStart(yearPageStart(view.year));
                  setMode("years");
                }}
                aria-label={`Choose the year (now ${view.year})`}
                className="flex items-center gap-1 rounded-md px-2 py-1 font-display text-[15px] font-semibold tabular-nums text-navy-900 hover:bg-slate-100"
              >
                {view.year}
                <Icon name="chevron-down" className="h-3.5 w-3.5 text-slate-500" />
              </button>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={() => (mode === "years" ? setYearStart((y) => y + YEARS_PER_PAGE) : mode === "months" ? setView((v) => ({ ...v, year: v.year + 1 })) : stepMonth(1))}
          disabled={mode === "years" ? yearStart + YEARS_PER_PAGE > bounds.last : mode === "months" ? view.year + 1 > bounds.last : nextDisabled}
          aria-label={mode === "years" ? `Next ${YEARS_PER_PAGE} years` : mode === "months" ? "Next year" : "Next month"}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-navy-900 disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <Icon name="chevron-right" className="h-4 w-4" />
        </button>
      </div>

      {mode === "years" ? (
        // 20 years, 4 across. Years the box doesn't allow are greyed out. Picking one opens its months.
        <div ref={pickGridRef} className="grid grid-cols-4 gap-1 py-1" role="group" aria-label="Choose a year">
          {yearPage(yearStart).map((y) => {
            const off = y < bounds.first || y > bounds.last || isYearOutOfRange(y, min, max);
            const isCurrent = y === view.year;
            return (
              <button
                key={y}
                type="button"
                data-pick=""
                data-current={isCurrent ? "" : undefined}
                disabled={off}
                aria-pressed={isCurrent}
                onClick={() => {
                  // keep the month, unless that month isn't allowed in the new year: then the first allowed one
                  let month = view.month;
                  if (isMonthOutOfRange(y, month, min, max)) month = Array.from({ length: 12 }, (_, i) => i + 1).find((m) => !isMonthOutOfRange(y, m, min, max)) ?? month;
                  setView({ year: y, month, day: 1 });
                  setFocus(clampIso(toIso(y, month, Math.min(parseIso(focus)!.day, 28)), min, max));
                  setMode("months");
                }}
                className={cx(
                  "relative rounded-md py-2 text-sm tabular-nums",
                  isCurrent ? "bg-navy-800 font-medium text-white hover:bg-navy-800" : off ? "cursor-not-allowed text-slate-300" : "text-slate-700 hover:bg-navy-50",
                )}
              >
                {y}
                {y === parseIso(today)?.year && !isCurrent && <span className="absolute bottom-1 left-1/2 h-0.5 w-3.5 -translate-x-1/2 rounded-full bg-gold-500" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      ) : mode === "months" ? (
        <div ref={pickGridRef} className="grid grid-cols-3 gap-1 py-1" role="group" aria-label={`Choose a month in ${view.year}`}>
          {MONTH_NAMES.map((name, i) => {
            const isCurrent = view.month === i + 1;
            const off = isMonthOutOfRange(view.year, i + 1, min, max);
            return (
              <button
                key={name}
                type="button"
                data-pick=""
                data-current={isCurrent ? "" : undefined}
                disabled={off}
                aria-label={`${name} ${view.year}`}
                aria-pressed={isCurrent}
                onClick={() => {
                  setView((v) => ({ ...v, month: i + 1 }));
                  setFocus(clampIso(toIso(view.year, i + 1, Math.min(parseIso(focus)!.day, 28)), min, max));
                  setMode("days");
                }}
                className={cx(
                  "rounded-md py-2 text-sm",
                  isCurrent ? "bg-navy-800 font-medium text-white hover:bg-navy-800" : off ? "cursor-not-allowed text-slate-300" : "text-slate-700 hover:bg-navy-50",
                )}
              >
                {name.slice(0, 3)}
              </button>
            );
          })}
        </div>
      ) : (
        <div ref={gridRef} role="grid" aria-label={monthTitle(view.year, view.month)}>
          <div className="grid grid-cols-7 pb-1" role="row">
            {WEEKDAYS.map((d) => (
              <span key={d} role="columnheader" className="py-1 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {d}
              </span>
            ))}
          </div>
          {rows.map((week, r) => (
            <div key={r} className="grid grid-cols-7" role="row">
              {week.map((c) => {
                const off = isDisabledDay(c.iso, min, max);
                const isSel = c.iso === selected;
                const isToday = c.iso === today;
                return (
                  <button
                    key={c.iso}
                    type="button"
                    role="gridcell"
                    data-iso={c.iso}
                    tabIndex={c.iso === focus ? 0 : -1}
                    disabled={off}
                    aria-selected={isSel}
                    aria-current={isToday ? "date" : undefined}
                    aria-label={longDate(c.iso)}
                    onClick={() => pick(c.iso)}
                    className={cx(
                      "relative m-px flex h-9 items-center justify-center rounded-md text-sm tabular-nums transition-colors",
                      isSel
                        ? "bg-navy-800 font-semibold text-white hover:bg-navy-700"
                        : off
                          ? "cursor-not-allowed text-slate-300"
                          : c.inMonth
                            ? "text-slate-800 hover:bg-navy-50"
                            : "text-slate-400 hover:bg-slate-50",
                    )}
                  >
                    {c.day}
                    {isToday && !isSel && <span className="absolute bottom-1 h-0.5 w-3.5 rounded-full bg-gold-500" aria-hidden="true" />}
                    {isToday && isSel && <span className="absolute bottom-1 h-0.5 w-3.5 rounded-full bg-gold-300" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2">
        <button
          type="button"
          onClick={() => pick(today)}
          disabled={todayDisabled}
          className="rounded-md px-2.5 py-1.5 text-sm font-medium text-navy-700 hover:bg-navy-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
        >
          Today
        </button>
        {!el.required && (
          <button type="button" onClick={clear} className="rounded-md px-2.5 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
