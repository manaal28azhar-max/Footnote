/**
 * Sentence-support attribution.
 *
 * The AI marks, for every sentence of an answer, how strongly each source
 * backs it: 0 (not at all), 0.5 (partly) or 1 (fully). Sentences that are
 * common knowledge need no source and earn nobody anything.
 *
 * The value of a set of sources S is how much of the answer they can back:
 *
 *     v(S) = sum over sentences j of  w_j * max_{i in S} support[j][i]
 *
 * Shapley values of this "max game" have an exact closed form, so we never
 * need to enumerate 2^n coalitions. For one sentence, sort the supports
 * from high to low: a1 >= a2 >= ... >= an, with a(n+1) = 0. The step
 * (a_k - a_(k+1)) is earned jointly by the top k sources and split equally
 * between them. So a source that alone backs a claim takes all its value,
 * and two sources that back the same claim split it in half.
 *
 * Cost: O(sentences * n log n). It is checked against brute-force Shapley in
 * the tests.
 */

export interface SentenceSupport {
  text: string;
  /** Weight of the sentence (we use its length in words). */
  weight: number;
  /** Common knowledge: earns no one anything. */
  commonKnowledge?: boolean;
  /** support[i] in [0, 1] for source i. */
  support: number[];
}

export interface Attribution {
  /** Exact Shapley value per source. */
  values: number[];
  /** Shares that sum to 1 (or all 0 if nothing was sourced). */
  shares: number[];
  /** v(all sources): the sourced part of the answer. */
  total: number;
  /** For each sentence, the Shapley split of its value across sources. */
  perSentence: number[][];
  /** Fraction of the answer's weight that came from sources (0..1). */
  sourcedFraction: number;
}

function clamp01(x: number) {
  return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0;
}

/** Shapley values of one sentence's max game, exact. */
export function maxGameShapley(supports: number[]): number[] {
  const n = supports.length;
  const a = supports.map(clamp01);
  const order = a.map((v, i) => ({ v, i })).sort((x, y) => y.v - x.v || x.i - y.i);
  const out = new Array<number>(n).fill(0);
  for (let k = 0; k < n; k++) {
    const step = order[k].v - (k + 1 < n ? order[k + 1].v : 0);
    if (step <= 0) continue;
    const each = step / (k + 1);
    for (let m = 0; m <= k; m++) out[order[m].i] += each;
  }
  return out;
}

/** v(S) for a coalition bitmask: used by tests to check the closed form. */
export function supportValue(sentences: SentenceSupport[], coalition: number): number {
  let v = 0;
  for (const s of sentences) {
    if (s.commonKnowledge) continue;
    let best = 0;
    s.support.forEach((x, i) => {
      if (coalition & (1 << i)) best = Math.max(best, clamp01(x));
    });
    v += s.weight * best;
  }
  return v;
}

export function attribute(sentences: SentenceSupport[], sourceCount: number): Attribution {
  const values = new Array<number>(sourceCount).fill(0);
  let totalWeight = 0;
  const perSentence = sentences.map((s) => {
    totalWeight += Math.max(0, s.weight);
    if (s.commonKnowledge || s.weight <= 0) return new Array<number>(sourceCount).fill(0);
    const padded = Array.from({ length: sourceCount }, (_, i) => s.support[i] ?? 0);
    const split = maxGameShapley(padded).map((x) => x * s.weight);
    split.forEach((x, i) => (values[i] += x));
    return split;
  });
  const total = values.reduce((a, b) => a + b, 0);
  const shares = total > 0 ? values.map((x) => x / total) : values.map(() => 0);
  return { values, shares, total, perSentence, sourcedFraction: totalWeight > 0 ? total / totalWeight : 0 };
}

export const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;
