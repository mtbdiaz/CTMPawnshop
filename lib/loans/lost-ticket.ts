// PB-22: when a customer has lost their physical ticket, verify their
// identity against the customer record's ID number instead.
export function verifyLostTicketId(enteredIdNumber: string, customerIdNumber: string): boolean {
  return enteredIdNumber.trim().toLowerCase() === customerIdNumber.trim().toLowerCase();
}
