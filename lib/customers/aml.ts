// PB-8: Verify Customer Identity (AML check).
//
// TODO: no real AML/sanctions-list provider is wired up (out of scope for
// this project without a client-provided data source). This is a
// placeholder rule-based check so the workflow (flag -> warn Operator ->
// Admin can review) is fully built and testable; swap `runAmlCheck`'s body
// for a real provider call when one is available.

const MOCK_WATCHLIST_KEYWORDS = ["test-flag", "sanctioned", "doe-blacklist"];

export type AmlCheckResult = {
  status: "clear" | "flagged";
  notes: string;
};

export function runAmlCheck(fullName: string, idNumber: string): AmlCheckResult {
  const haystack = `${fullName} ${idNumber}`.toLowerCase();
  const hit = MOCK_WATCHLIST_KEYWORDS.find((keyword) => haystack.includes(keyword));

  if (hit) {
    return { status: "flagged", notes: `Matched watchlist keyword: "${hit}" (placeholder check)` };
  }
  return { status: "clear", notes: "No watchlist match (placeholder check)" };
}
