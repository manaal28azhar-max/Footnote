/**
 * Shapley attribution.
 *
 * A "coalition" is a subset of the sources the AI was given. The value
 * function v(S) says how well the final answer is supported when the model
 * only sees the sources in S (in production: the log-likelihood of the
 * answer given S, minus the log-likelihood with no sources).
 *
 * The Shapley value of source i is its average marginal contribution over
 * every order in which sources could be added. It is the unique credit rule
 * that is efficient (credits sum to v(all) - v(none)), symmetric, gives zero
 * to sources that never help, and is additive.
 */

export type Coalition = number; // bitmask over source indices
export type ValueFn = (coalition: Coalition) => Promise<number> | number;

export interface ShapleyResult {
  /** Raw Shapley values, same order as the sources. Can be negative. */
  values: number[];
  /** v(all) - v(none): the total that the values add up to. */
  total: number;
  /** Number of distinct coalitions actually evaluated (cost of the run). */
  evaluations: number;
  method: "exact" | "permutation-sampling";
  /** Permutations used, for the sampling method. */
  permutations?: number;
}

/** Memoising wrapper so each coalition is scored at most once. */
function memo(v: ValueFn) {
  const cache = new Map<Coalition, Promise<number>>();
  const get = (c: Coalition) => {
    let hit = cache.get(c);
    if (!hit) {
      hit = Promise.resolve(v(c));
      cache.set(c, hit);
    }
    return hit;
  };
  return { get, size: () => cache.size };
}

function factorials(n: number): number[] {
  const f = [1];
  for (let i = 1; i <= n; i++) f.push(f[i - 1] * i);
  return f;
}

function popcount(x: number): number {
  let c = 0;
  while (x) {
    x &= x - 1;
    c++;
  }
  return c;
}

/** Exact Shapley values by enumerating all 2^n coalitions. Use for n <= 12. */
export async function shapleyExact(n: number, v: ValueFn): Promise<ShapleyResult> {
  if (n < 1 || n > 16) throw new RangeError(`shapleyExact supports 1..16 sources, got ${n}`);
  const m = memo(v);
  const full = (1 << n) - 1;
  const f = factorials(n);
  const values = new Array<number>(n).fill(0);

  // Score every coalition once (in parallel), then combine.
  const scores = new Float64Array(full + 1);
  await Promise.all(
    Array.from({ length: full + 1 }, async (_, c) => {
      scores[c] = await m.get(c);
    }),
  );

  for (let i = 0; i < n; i++) {
    const bit = 1 << i;
    for (let s = 0; s <= full; s++) {
      if (s & bit) continue;
      const k = popcount(s);
      const weight = (f[k] * f[n - k - 1]) / f[n];
      values[i] += weight * (scores[s | bit] - scores[s]);
    }
  }

  return { values, total: scores[full] - scores[0], evaluations: m.size(), method: "exact" };
}

/** Small, fast, seedable PRNG (mulberry32) so runs are reproducible. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(n: number, rand: () => number): number[] {
  const p = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  return p;
}

/**
 * Approximate Shapley values by sampling permutations (antithetic pairs:
 * every sampled order is also walked in reverse, which cancels much of the
 * variance). Each permutation's marginals sum exactly to v(all) - v(none),
 * so the estimate stays efficient: credits always add up to the total.
 */
export async function shapleySampled(
  n: number,
  v: ValueFn,
  opts: { permutations?: number; seed?: number } = {},
): Promise<ShapleyResult> {
  if (n < 1 || n > 30) throw new RangeError(`shapleySampled supports 1..30 sources, got ${n}`);
  const pairs = Math.max(1, Math.ceil((opts.permutations ?? 32) / 2));
  const rand = rng(opts.seed ?? 20261113);
  const m = memo(v);
  const sums = new Array<number>(n).fill(0);

  const walk = async (order: number[]) => {
    let coalition = 0;
    let prev = await m.get(0);
    for (const i of order) {
      coalition |= 1 << i;
      const next = await m.get(coalition);
      sums[i] += next - prev;
      prev = next;
    }
  };

  for (let k = 0; k < pairs; k++) {
    const order = shuffle(n, rand);
    await walk(order);
    await walk([...order].reverse());
  }

  const permutations = pairs * 2;
  const values = sums.map((s) => s / permutations);
  const full = (1 << n) - 1;
  const total = (await m.get(full)) - (await m.get(0));
  return { values, total, evaluations: m.size(), method: "permutation-sampling", permutations };
}

/** Exact for small n, sampled above the threshold. */
export function shapley(n: number, v: ValueFn, opts: { exactUpTo?: number; permutations?: number; seed?: number } = {}) {
  return n <= (opts.exactUpTo ?? 8) ? shapleyExact(n, v) : shapleySampled(n, v, opts);
}

/**
 * Turn Shapley values into payment shares. Sources that made the answer
 * worse (negative value) earn nothing; the rest split 100% in proportion to
 * their positive contribution. Returns all zeros if nothing helped.
 */
export function toShares(values: number[]): number[] {
  const pos = values.map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
  const sum = pos.reduce((a, b) => a + b, 0);
  return sum > 0 ? pos.map((x) => x / sum) : pos.map(() => 0);
}

/** Helpers for callers working with arrays of selected indices. */
export const coalitionOf = (indices: number[]): Coalition => indices.reduce((c, i) => c | (1 << i), 0);
export const membersOf = (c: Coalition, n: number): number[] =>
  Array.from({ length: n }, (_, i) => i).filter((i) => c & (1 << i));
