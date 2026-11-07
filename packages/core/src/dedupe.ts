/**
 * Copy detection with MinHash.
 *
 * If someone republishes a creator's article, both pages may be retrieved
 * for the same question. Without this step the copier would earn a share of
 * the original author's credit. We estimate how similar two pages are
 * (Jaccard similarity of their 5-word shingles) and, within a group of
 * near-duplicates, give all the credit to the earliest-published page.
 */

const NUM_HASHES = 128;
const MERSENNE = 0x7fffffff; // 2^31 - 1

/** Deterministic hash parameters (a, b) for h(x) = (a*x + b) mod p. */
const PARAMS = (() => {
  let s = 0x9e3779b9;
  const next = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) % MERSENNE;
  };
  return Array.from({ length: NUM_HASHES }, () => [next() || 1, next()] as const);
})();

/** FNV-1a 32-bit hash of a string. */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function normalise(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function shingles(text: string, size = 5): Set<string> {
  const w = normalise(text);
  const out = new Set<string>();
  if (w.length < size) {
    if (w.length) out.add(w.join(" "));
    return out;
  }
  for (let i = 0; i <= w.length - size; i++) out.add(w.slice(i, i + size).join(" "));
  return out;
}

/** (a*x + b) mod p without overflow, using BigInt only for the product. */
const affine = (a: number, x: number, b: number) => Number((BigInt(a) * BigInt(x) + BigInt(b)) % BigInt(MERSENNE));

export function signature(text: string): Uint32Array {
  const sig = new Uint32Array(NUM_HASHES).fill(0xffffffff);
  for (const sh of shingles(text)) {
    const x = fnv1a(sh) % MERSENNE;
    for (let k = 0; k < NUM_HASHES; k++) {
      const h = affine(PARAMS[k][0], x, PARAMS[k][1]);
      if (h < sig[k]) sig[k] = h;
    }
  }
  return sig;
}

/** Estimated Jaccard similarity, 0..1. */
export function similarity(a: Uint32Array, b: Uint32Array): number {
  let eq = 0;
  for (let k = 0; k < NUM_HASHES; k++) if (a[k] === b[k]) eq++;
  return eq / NUM_HASHES;
}

export interface Doc {
  id: string;
  text: string;
  publishedAt: string; // ISO date
}

export interface DedupeResult {
  /** For each doc id, the id of the original that should receive its credit. */
  creditTo: Record<string, string>;
  /** Groups of near-duplicates, original first. */
  groups: { original: string; copies: { id: string; similarity: number }[] }[];
}

/**
 * Group near-duplicates (similarity >= threshold, transitively) and route
 * every copy's credit to the earliest-published member of its group.
 */
export function resolveOriginals(docs: Doc[], threshold = 0.6): DedupeResult {
  const sigs = docs.map((d) => signature(d.text));
  const parent = docs.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const sims = new Map<string, number>();

  for (let i = 0; i < docs.length; i++)
    for (let j = i + 1; j < docs.length; j++) {
      const s = similarity(sigs[i], sigs[j]);
      if (s >= threshold) {
        parent[find(i)] = find(j);
        sims.set(`${i}:${j}`, s);
      }
    }

  const groups = new Map<number, number[]>();
  docs.forEach((_, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), i]));

  const creditTo: Record<string, string> = {};
  const out: DedupeResult["groups"] = [];
  for (const members of groups.values()) {
    members.sort((a, b) => docs[a].publishedAt.localeCompare(docs[b].publishedAt) || a - b);
    const orig = members[0];
    for (const m of members) creditTo[docs[m].id] = docs[orig].id;
    if (members.length > 1)
      out.push({
        original: docs[orig].id,
        copies: members.slice(1).map((m) => ({ id: docs[m].id, similarity: similarity(sigs[orig], sigs[m]) })),
      });
  }
  return { creditTo, groups: out };
}
