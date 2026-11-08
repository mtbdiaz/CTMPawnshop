import { describe, expect, it } from "vitest";
import { buildQueue, type QueueLoan, type QueueLog } from "./reminder-queue";

const today = "2026-11-08";
// 4 loans: Ana has 2, due today and in 3 days; Ben due tomorrow; Cora due in 2 days
const loans: QueueLoan[] = [
  { id: "a1", customer_id: "ana", maturity_date: "2026-11-08" },
  { id: "a2", customer_id: "ana", maturity_date: "2026-11-11" },
  { id: "b1", customer_id: "ben", maturity_date: "2026-11-09" },
  { id: "c1", customer_id: "cora", maturity_date: "2026-11-10" },
];
const logs: QueueLog[] = [
  { loan_id: "b1", sent_at: "2026-11-08T01:00:00Z", created_by: "staff1" }, // Ben contacted today
  { loan_id: "c1", sent_at: "2026-10-09T01:00:00Z", created_by: "staff1" }, // Cora: last month, before a renewal
];
const run = (o: Partial<Parameters<typeof buildQueue>[2]> = {}) => buildQueue(loans, logs, { today, view: "all", due: "all", ...o });

describe("buildQueue (R1)", () => {
  it("summary counts loans and customers, whatever the filters", () => {
    expect(run({ view: "logged", due: "today" }).summary).toEqual({ dueToday: 1, dueSoon: 3, contacted: 1, total: 4, customers: 3 });
  });
  it("an old log from before a renewal doesn't count as contacted", () => {
    const cora = run().list.find((i) => i.id === "c1")!;
    expect(cora.contacted).toBe(false);
    expect(cora.allLogs).toHaveLength(1); // still in the history
  });
  it("tabs: To contact and Contact logged split the list", () => {
    expect(run({ view: "todo" }).list.map((i) => i.id)).toEqual(["a1", "c1", "a2"]);
    expect(run({ view: "logged" }).list.map((i) => i.id)).toEqual(["b1"]);
    expect(run().counts).toEqual({ todo: 3, logged: 1, all: 4 });
  });
  it("Due dropdown narrows the list and the tab counts", () => {
    expect(run({ due: "tomorrow" }).list.map((i) => i.id)).toEqual(["b1"]);
    expect(run({ due: "later" }).counts).toEqual({ todo: 2, logged: 0, all: 2 });
  });
  it("nearest due first, then not contacted first on the same day", () => {
    const sameDay = [...loans, { id: "b2", customer_id: "ben", maturity_date: "2026-11-09" }];
    const q = buildQueue(sameDay, logs, { today, view: "all", due: "all" });
    expect(q.list.map((i) => i.id)).toEqual(["a1", "b2", "b1", "c1", "a2"]);
  });
  it("shows how many loans one customer has on the list", () => {
    expect(run().list.find((i) => i.id === "a1")!.loansDue).toBe(2);
    expect(run().list.find((i) => i.id === "b1")!.loansDue).toBe(1);
  });
  it("search keeps only the found loans; counts ignore it", () => {
    const q = run({ matchIds: new Set(["a2"]) });
    expect(q.list.map((i) => i.id)).toEqual(["a2"]);
    expect(q.counts.all).toBe(4);
  });
  it("one customer's loans by their id (R2), each with its own status", () => {
    const q = run({ customerId: "ana" });
    expect(q.list.map((i) => i.id)).toEqual(["a1", "a2"]);
    expect(q.list.every((i) => !i.contacted)).toBe(true);
    // logging Ben's loan never marks anyone else's loan as contacted
    expect(run({ customerId: "ben" }).list.map((i) => [i.id, i.contacted])).toEqual([["b1", true]]);
  });
  it("same name, different customer: the id keeps them apart", () => {
    const twins: QueueLoan[] = [...loans, { id: "x1", customer_id: "ana-2", maturity_date: "2026-11-09" }];
    const q = buildQueue(twins, logs, { today, view: "all", due: "all", customerId: "ana" });
    expect(q.list.map((i) => i.id)).toEqual(["a1", "a2"]);
  });
  it("empty list", () => {
    const q = buildQueue([], [], { today, view: "todo", due: "all" });
    expect(q.list).toEqual([]);
    expect(q.summary).toEqual({ dueToday: 0, dueSoon: 0, contacted: 0, total: 0, customers: 0 });
  });
  it("hundreds of loans stay in a stable order", () => {
    const many: QueueLoan[] = Array.from({ length: 600 }, (_, i) => ({ id: `l${String(i).padStart(3, "0")}`, customer_id: `c${i % 250}`, maturity_date: `2026-11-${String(8 + (i % 4)).padStart(2, "0")}` }));
    const q = buildQueue(many, [], { today, view: "all", due: "all" });
    expect(q.list).toHaveLength(600);
    expect(q.list[0].maturity_date).toBe("2026-11-08");
    expect(q.list[599].maturity_date).toBe("2026-11-11");
    expect(q.summary.customers).toBe(250);
  });
});
