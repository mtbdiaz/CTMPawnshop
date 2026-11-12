import { describe, expect, it } from "vitest";
import { actionsFor, cleanNote, customerLabel, eventLabel, flagFilters, flagSource, reasonProblem, ruleEvidence, shortReason } from "./flags";

const RULE = "Unusually high number of loans opened by this customer in a short window";

describe("flag reasons", () => {
  it("shortens the reason for the list and keeps unknown ones whole", () => {
    expect(shortReason(RULE, RULE)).toBe("Many loans in a short time");
    expect(shortReason("Lost ticket used at redemption; ID checked against records", RULE)).toBe("Lost ticket used at redemption");
    expect(shortReason("High-value loan (PHP 30,950) for a customer with little history", RULE)).toBe("High-value loan (PHP 30,950)");
    expect(shortReason("Repeated defaults; recommend blacklisting", RULE)).toBe("Repeated defaults");
    expect(shortReason("SELFTEST", RULE)).toBe("SELFTEST");
  });
  it("names the customer with the C-number", () => {
    expect(customerLabel({ customer_name: "Juan Cruz", customer_no: 12 })).toBe("Juan Cruz · C-0012");
    expect(customerLabel({ customer_name: null, customer_no: null })).toBe("Unknown customer");
  });
});

describe("rule evidence", () => {
  it("compares the loan count with the 3-loan rule, only for rule flags", () => {
    expect(ruleEvidence({ rule_flag: true, loans_24h: 3 })).toBe("matches");
    expect(ruleEvidence({ rule_flag: true, loans_24h: 1 })).toBe("below");
    expect(ruleEvidence({ rule_flag: false, loans_24h: null })).toBe("none");
  });
});

describe("decisions", () => {
  it("offers the same steps the database allows", () => {
    expect(actionsFor("open")).toEqual({ investigate: true, dismiss: true, blacklist: true });
    expect(actionsFor("investigating")).toEqual({ investigate: false, dismiss: true, blacklist: true });
    expect(actionsFor("dismissed")).toEqual({ investigate: false, dismiss: false, blacklist: false });
    expect(actionsFor("blacklisted")).toEqual({ investigate: false, dismiss: false, blacklist: false });
  });
  it("cleans the address filters", () => {
    expect(flagFilters({})).toEqual({ view: "open", q: "", status: "" });
    expect(flagFilters({ view: "resolved", status: "open" })).toEqual({ view: "resolved", q: "", status: "" }); // no status filter on Resolved
    expect(flagFilters({ status: "investigating", q: "  Cruz " })).toEqual({ view: "open", q: "Cruz", status: "investigating" });
    expect(flagFilters({ view: "x", status: "blacklisted" })).toEqual({ view: "open", q: "", status: "" });
  });
});

// SA7 (migration 0062): the reason rule is the same as the database's (ctm_flag_reason_ok)
describe("reasonProblem", () => {
  it("refuses an empty, spaces-only, too short or letter-free reason", () => {
    expect(reasonProblem("")).not.toBeNull();
    expect(reasonProblem("        ")).not.toBeNull();
    expect(reasonProblem("too short")).not.toBeNull(); // 9 characters
    expect(reasonProblem(".......... !!")).not.toBeNull();
    expect(reasonProblem("x".repeat(501))).not.toBeNull();
  });
  it("accepts a real reason, counting squeezed spaces", () => {
    expect(reasonProblem("False alarm")).toBeNull();
    expect(reasonProblem("  Customer   explained the loans  ")).toBeNull();
    expect(reasonProblem("Pamilya niya ang nag-loan")).toBeNull();
    expect(cleanNote("  a   b \n c ")).toBe("a b c");
  });
});
describe("flag words", () => {
  it("names how the flag was raised", () => {
    expect(flagSource({ rule_flag: true })).toMatch(/Automatic rule/);
    expect(flagSource({ rule_flag: false })).toMatch(/not made by a rule/);
  });
  it("labels each history line", () => {
    expect(eventLabel({ action: "INSERT", status: "open", note: null }, null)).toBe("Flag recorded");
    expect(eventLabel({ action: "INSERT", status: "investigating", note: null }, null)).toBe("Recorded as Investigating");
    expect(eventLabel({ action: "UPDATE", status: "investigating", note: null }, { status: "open", note: null })).toBe("Marked investigating");
    expect(eventLabel({ action: "UPDATE", status: "dismissed", note: "x" }, { status: "investigating", note: null })).toBe("Dismissed");
    expect(eventLabel({ action: "UPDATE", status: "investigating", note: "new" }, { status: "investigating", note: "old" })).toBe("Note changed");
    expect(eventLabel({ action: "UPDATE", status: "blacklisted", note: null }, { status: "blacklisted", note: null })).toBe("Details updated");
  });
});
