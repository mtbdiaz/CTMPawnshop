// Item 10: customer search-as-you-type ranking. Case-insensitive; matches
// name, contact number and ID number; prefix matches rank above substring
// matches. Phone/ID matching ignores spaces and dashes.

export type SearchableCustomer = {
  id: string;
  full_name: string;
  contact_number: string;
  id_number: string;
};

const digits = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function matchRank(customer: SearchableCustomer, query: string): number | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const name = customer.full_name.toLowerCase();
  const words = name.split(/\s+/);
  const qd = digits(q);

  if (name.startsWith(q)) return 0;
  if (words.some((w) => w.startsWith(q))) return 1;
  if (qd && (digits(customer.contact_number).startsWith(qd) || digits(customer.id_number).startsWith(qd))) return 2;
  if (name.includes(q)) return 3;
  if (qd.length >= 3 && (digits(customer.contact_number).includes(qd) || digits(customer.id_number).includes(qd))) return 4;
  return null;
}

export function rankCustomers<T extends SearchableCustomer>(customers: T[], query: string, limit = 8): T[] {
  return customers
    .map((c) => ({ c, rank: matchRank(c, query) }))
    .filter((r): r is { c: T; rank: number } => r.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.c.full_name.localeCompare(b.c.full_name))
    .slice(0, limit)
    .map((r) => r.c);
}
