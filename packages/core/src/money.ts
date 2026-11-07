/**
 * Money is never a float. Every amount is an integer number of micro-cents
 * (1 USD = 100 cents = 100,000,000 micro-cents), held in a bigint.
 * A single AI answer may be worth a fraction of a cent, so cents alone are
 * too coarse; micro-cents keep every share exact until payout time.
 */

export type MicroCents = bigint;

export const MICRO_PER_CENT = 1_000_000n;
export const MICRO_PER_DOLLAR = 100n * MICRO_PER_CENT;

/** Parse a decimal dollar string like "0.0041" or "12.50" exactly. */
export function dollars(amount: string): MicroCents {
  const m = /^(-)?(\d+)(?:\.(\d{1,8}))?$/.exec(amount.trim());
  if (!m) throw new Error(`Invalid dollar amount: ${amount}`);
  const [, neg, whole, frac = ""] = m;
  const v = BigInt(whole) * MICRO_PER_DOLLAR + BigInt(frac.padEnd(8, "0"));
  return neg ? -v : v;
}

/** Format micro-cents as dollars, e.g. 410000n -> "0.0041". */
export function formatDollars(v: MicroCents, decimals = 8): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const whole = a / MICRO_PER_DOLLAR;
  const frac = (a % MICRO_PER_DOLLAR).toString().padStart(8, "0").slice(0, decimals).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}

/**
 * Split `total` across recipients in proportion to `weights`, exactly.
 * Largest-remainder (Hamilton) method: everyone gets the floor of their
 * exact quota, then leftover units go to the largest fractional remainders
 * (ties broken by lower index, so results are deterministic).
 * The parts always sum to `total` exactly.
 */
export function splitByWeights(total: MicroCents, weights: number[]): MicroCents[] {
  if (total < 0n) throw new RangeError("total must be non-negative");
  if (weights.some((w) => !Number.isFinite(w) || w < 0)) throw new RangeError("weights must be finite and >= 0");
  // Fix weights to integers at 1e-12 resolution so all further maths is exact.
  const SCALE = 1_000_000_000_000;
  const w = weights.map((x) => BigInt(Math.round(x * SCALE)));
  const W = w.reduce((a, b) => a + b, 0n);
  if (W === 0n) return weights.map(() => 0n);

  const parts = w.map((wi) => (total * wi) / W);
  const rems = w.map((wi, i) => ({ i, r: (total * wi) % W }));
  let leftover = total - parts.reduce((a, b) => a + b, 0n);
  rems.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (let k = 0; leftover > 0n; k++, leftover--) parts[rems[k].i] += 1n;
  return parts;
}

/**
 * Payouts must be whole cents. Convert an accrued micro-cent balance into a
 * payable cent amount plus the carry that stays in the ledger for next time.
 * Nothing is rounded away: carry + paid*MICRO_PER_CENT === balance.
 */
export function payableCents(balance: MicroCents, minimumCents = 100n): { cents: bigint; carry: MicroCents } {
  const cents = balance / MICRO_PER_CENT;
  if (cents < minimumCents) return { cents: 0n, carry: balance };
  return { cents, carry: balance - cents * MICRO_PER_CENT };
}

export const centsToPayPalValue = (cents: bigint) => `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
