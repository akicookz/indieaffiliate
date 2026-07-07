// Currency amounts are stored as dollars in D1 `real` columns. Computed values
// (revenue * rate, sums, etc.) must be rounded to whole cents so per-row
// displays, ledger totals, and payout amounts never disagree by fractions.
export function roundToCents(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}
