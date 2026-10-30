// P3: rules for showing government ID numbers. Shared by the Customers list, the profile and the server action.
import type { StaffRole } from "@/lib/auth/roles";

// Who may see a FULL ID number. Admin always passes too (the hasRole rule).
// Operator registers and checks IDs; Cashier checks the ID when a customer lost their pawn ticket.
// Appraiser doesn't need full IDs, so it isn't in this list. Change this one line if the shop decides otherwise.
export const ID_REVEAL_ROLES: StaffRole[] = ["operator", "cashier"];

// Hides most of an ID number: "0000-000418" -> "•••• 0418". Very short IDs are hidden completely.
export function maskId(idNumber: string) {
  const clean = idNumber.replace(/[^a-z0-9]/gi, ""); // letters and digits only
  return clean.length > 4 ? `•••• ${clean.slice(-4)}` : "••••"; // keep only the last 4
}

// The last 4 characters, for screen readers ("ending in 0418")
export function idEnding(idNumber: string) {
  return idNumber.replace(/[^a-z0-9]/gi, "").slice(-4);
}