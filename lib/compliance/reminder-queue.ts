// R1: builds the Reminders list from plain data (no database here), so it can be tested.
// The page loads the loans due today up to 3 days from now that still owe money, and their reminder logs,
// then this file works out the summary, the tab counts, and which loans show, in what order.
import { daysUntilDue, dueRange, logsThisCycle, type DueFilter } from "./reminders";

export type QueueLoan = { id: string; customer_id: string; maturity_date: string }; // the light columns the page loads first
export type QueueLog = { loan_id: string; sent_at: string; created_by: string | null }; // one reminder_log row
export type ReminderView = "todo" | "logged" | "all"; // the 3 tabs: To contact, Contact logged, All

export type QueueItem = QueueLoan & {
  daysLeft: number; // 0 = due today
  cycleLogs: QueueLog[]; // logs for THIS due date, newest first
  allLogs: QueueLog[]; // every log for this loan (older due dates too), newest first
  contacted: boolean; // true when at least one log counts for this due date
  loansDue: number; // how many loans on the list belong to the same customer (1 = just this one)
};

export function buildQueue(
  loans: QueueLoan[], // every loan on the list (today up to 3 days)
  logs: QueueLog[], // every reminder log for those loans
  opts: {
    today: string;
    view: ReminderView;
    due: DueFilter;
    matchIds?: Set<string> | null; // loans the search found (null = not searching)
    customerId?: string | null; // R2: only this customer's loans (the "3 loans due" link). Uses the customer's id, not the name
  },
) {
  // group the logs by loan, newest first
  const byLoan = new Map<string, QueueLog[]>();
  for (const log of [...logs].sort((a, b) => b.sent_at.localeCompare(a.sent_at))) {
    const list = byLoan.get(log.loan_id) ?? [];
    list.push(log);
    byLoan.set(log.loan_id, list);
  }
  // how many loans each customer has on the list (for the "3 loans due" badge)
  const perCustomer = new Map<string, number>();
  for (const l of loans) perCustomer.set(l.customer_id, (perCustomer.get(l.customer_id) ?? 0) + 1);

  // one item per loan, with its status for this due date
  const items: QueueItem[] = loans.map((l) => {
    const allLogs = byLoan.get(l.id) ?? [];
    const cycleLogs = logsThisCycle(allLogs, l.maturity_date);
    return {
      ...l,
      daysLeft: daysUntilDue(l.maturity_date, opts.today),
      cycleLogs,
      allLogs,
      contacted: cycleLogs.length > 0,
      loansDue: perCustomer.get(l.customer_id) ?? 1,
    };
  });

  // the summary strip: always the whole list (the tabs, dropdown and search don't change it). Counts are LOANS
  const summary = {
    dueToday: items.filter((i) => i.daysLeft === 0).length,
    dueSoon: items.filter((i) => i.daysLeft >= 1).length, // due in 1 to 3 days
    contacted: items.filter((i) => i.contacted).length,
    total: items.length,
    customers: perCustomer.size, // different customers on the list
  };

  // the "Due" dropdown
  const [from, to] = dueRange(opts.due, opts.today);
  const inDue = items.filter((i) => i.maturity_date >= from && i.maturity_date <= to); // YYYY-MM-DD compares as text

  // tab counts follow the Due dropdown but not the search (same as the other pages' tabs)
  const counts = {
    todo: inDue.filter((i) => !i.contacted).length,
    logged: inDue.filter((i) => i.contacted).length,
    all: inDue.length,
  };

  // the list: this tab + Due + search
  const list = inDue
    .filter((i) => (opts.view === "todo" ? !i.contacted : opts.view === "logged" ? i.contacted : true))
    .filter((i) => !opts.matchIds || opts.matchIds.has(i.id))
    .filter((i) => !opts.customerId || i.customer_id === opts.customerId) // R2: one customer's loans
    // nearest due date first; on the same day, the ones still to contact first; then always the same order
    .sort((a, b) => a.maturity_date.localeCompare(b.maturity_date) || Number(a.contacted) - Number(b.contacted) || a.id.localeCompare(b.id));

  return { summary, counts, list };
}
