import { describe, it, expect } from "vitest";
import { auditCoverage, auditProgress, auditResultProblem, countDiscrepancies, followupProblems, followupStatus, moveCount, reasonLabel, resultLabel, scopeLabel } from "./audit";

describe("countDiscrepancies (PB-25)", () => {
  it("counts zero when everything is found", () => {
    expect(countDiscrepancies([{ found: true }, { found: true }])).toBe(0);
  });

  it("counts items not found", () => {
    expect(countDiscrepancies([{ found: true }, { found: false }, { found: false }])).toBe(2);
  });

  it("handles an empty list", () => {
    expect(countDiscrepancies([])).toBe(0);
  });
});

// AS1: the audit session rules
describe("auditProgress (AS1)", () => {
  it("a new audit has nothing checked", () => {
    expect(auditProgress({ found: 0, found_elsewhere: 0, not_located: 0, not_checked: 48 })).toEqual({ checked: 0, total: 48, percent: 0 });
  });

  it("every result counts as checked, also Not located", () => {
    expect(auditProgress({ found: 5, found_elsewhere: 1, not_located: 2, not_checked: 8 })).toEqual({ checked: 8, total: 16, percent: 50 });
  });

  it("is 100% only when nothing is left (rounds down)", () => {
    expect(auditProgress({ found: 199, found_elsewhere: 0, not_located: 0, not_checked: 1 }).percent).toBe(99);
    expect(auditProgress({ found: 200, found_elsewhere: 0, not_located: 0, not_checked: 0 }).percent).toBe(100);
  });

  it("an audit with no items to check is complete, not a division by zero", () => {
    expect(auditProgress({ found: 0, found_elsewhere: 0, not_located: 0, not_checked: 0 })).toEqual({ checked: 0, total: 0, percent: 100 });
  });
});

describe("moveCount (AS1)", () => {
  const start = { found: 1, found_elsewhere: 0, not_located: 0, not_checked: 3 };

  it("moves one item from Not checked to Found", () => {
    expect(moveCount(start, "not_checked", "found")).toEqual({ found: 2, found_elsewhere: 0, not_located: 0, not_checked: 2 });
  });

  it("moves an item back to Not checked", () => {
    expect(moveCount(start, "found", "not_checked")).toEqual({ found: 0, found_elsewhere: 0, not_located: 0, not_checked: 4 });
  });

  it("the same result changes nothing, and the total stays the same", () => {
    expect(moveCount(start, "found", "found")).toBe(start);
    const moved = moveCount(start, "not_checked", "not_located");
    expect(moved.found + moved.found_elsewhere + moved.not_located + moved.not_checked).toBe(4);
  });

  it("never goes below zero", () => {
    expect(moveCount({ found: 0, found_elsewhere: 0, not_located: 0, not_checked: 0 }, "found", "not_located").found).toBe(0);
  });
});

describe("auditResultProblem (AS1)", () => {
  it("Found and Not checked need nothing else", () => {
    expect(auditResultProblem("found", "", "", "")).toBeNull();
    expect(auditResultProblem("not_checked", "", "", "")).toBeNull();
  });

  it("Not located needs a reason from the list", () => {
    expect(auditResultProblem("not_located", "", "", "")).toBe("Pick a reason.");
    expect(auditResultProblem("not_located", "made_up", "", "")).toBe("Pick a reason.");
    expect(auditResultProblem("not_located", "not_at_location", "", "")).toBeNull();
  });

  it("the reason Other needs a note", () => {
    expect(auditResultProblem("not_located", "other", "  ", "")).toMatch(/note/);
    expect(auditResultProblem("not_located", "other", "Tag is torn off", "")).toBeNull();
  });

  it("Found elsewhere needs the place", () => {
    expect(auditResultProblem("found_elsewhere", "", "", " ")).toBe("Write where the item was found.");
    expect(auditResultProblem("found_elsewhere", "", "", "Vault B, shelf 2")).toBeNull();
    expect(auditResultProblem("found_elsewhere", "", "", "x".repeat(121))).toMatch(/120/);
  });

  it("a note longer than 500 characters is refused", () => {
    expect(auditResultProblem("found", "", "x".repeat(501), "")).toMatch(/500/);
  });
});

describe("labels (AS1)", () => {
  it("no result means Not checked, never missing", () => {
    expect(resultLabel(null)).toBe("Not checked");
    expect(resultLabel(undefined)).toBe("Not checked");
    expect(resultLabel("not_located")).toBe("Not located");
    expect(resultLabel("found_elsewhere")).toBe("Found elsewhere");
  });

  it("reason and scope words", () => {
    expect(reasonLabel("label_mismatch")).toMatch(/label/i);
    expect(reasonLabel(null)).toBe("");
    expect(scopeLabel(null)).toBe("All locations");
    expect(scopeLabel("Safe 1")).toBe("Safe 1");
  });
});

// AD1: following up a problem after the audit
describe("followupStatus (AD1)", () => {
  it("nobody checked again yet = Pending verification", () => {
    expect(followupStatus([]).label).toBe("Pending verification");
  });

  it("the newest check decides", () => {
    expect(followupStatus([{ outcome: "still_not_located" }]).label).toBe("Under investigation");
    expect(followupStatus([{ outcome: "still_not_located" }, { outcome: "escalated" }]).label).toBe("Escalated");
    expect(followupStatus([{ outcome: "escalated" }, { outcome: "still_not_located" }]).label).toBe("Under investigation");
  });

  it("found in the wrong place is not hidden: it shows Location to correct (0047)", () => {
    expect(followupStatus([{ outcome: "found_elsewhere" }]).label).toBe("Location to correct");
    expect(followupStatus([], "found_elsewhere").label).toBe("Location to correct"); // the audit itself found it elsewhere
    expect(followupStatus([], "not_located").label).toBe("Pending verification");
  });
});

describe("followupProblems (AD1)", () => {
  const note = "Checked shelf 2 again";

  it("a found answer needs the confirm tick", () => {
    expect(followupProblems("found_expected", note, "", false)).toHaveProperty("confirm");
    expect(followupProblems("found_expected", note, "", true)).toEqual({});
  });

  it("found at another location needs the place", () => {
    expect(followupProblems("found_elsewhere", note, " ", true)).toHaveProperty("found_location");
    expect(followupProblems("found_elsewhere", note, "Vault B, shelf 2", true)).toEqual({});
    expect(followupProblems("found_elsewhere", note, "Vault B, shelf 2", false)).toHaveProperty("confirm"); // the item was seen, so the tick is needed
  });

  it("still not located and escalate need a real note but no tick", () => {
    expect(followupProblems("still_not_located", note, "", false)).toEqual({});
    expect(followupProblems("escalated", "short", "", false)).toHaveProperty("notes");
  });

  it("an unknown answer or no answer is refused", () => {
    expect(followupProblems("", note, "", true)).toHaveProperty("outcome");
    expect(followupProblems("sold", note, "", true)).toHaveProperty("outcome");
  });
});

// AV1: the scope of an audit and how much of it was checked are two labels
describe("auditCoverage (AV1)", () => {
  const base = { started_at: "2026-11-11T13:00:00+00:00", submitted_at: "2026-11-11T14:00:00+00:00", is_partial: false };

  it("one location, everything checked: not called a full vault count", () => {
    const c = auditCoverage({ ...base, scope_vault: "Safe 1", expected_count: 48 });
    expect(c.scope).toBe("Location: Safe 1 · 48 items expected");
    expect(c.done).toBe("All listed items checked");
    expect(c.scope + c.done).not.toMatch(/full/i);
  });

  it("every location", () => {
    expect(auditCoverage({ ...base, scope_vault: null, expected_count: 495 }).scope).toBe("All locations · 495 items expected");
  });

  it("partial is said plainly", () => {
    expect(auditCoverage({ ...base, scope_vault: null, expected_count: 495, is_partial: true }).done).toBe("Partial");
  });

  it("an older audit (saved in one go) does not claim a scope", () => {
    const c = auditCoverage({ scope_vault: null, started_at: "2026-10-09T13:26:05+00:00", submitted_at: "2026-10-09T13:26:05+00:00", expected_count: 9, is_partial: false });
    expect(c.legacy).toBe(true);
    expect(c.scope).toBe("Older audit: 9 items listed (scope not recorded)");
  });
});
