// PB-25: count physical-audit discrepancies (items not found where expected).
export function countDiscrepancies(items: { found: boolean }[]): number {
  return items.filter((item) => !item.found).length;
}
