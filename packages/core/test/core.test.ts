import { describe, it, expect } from "vitest";
import { shapleyExact, shapleySampled, toShares, coalitionOf, membersOf } from "../src/shapley";
import { dollars, formatDollars, splitByWeights, payableCents, centsToPayPalValue } from "../src/money";
import { ReceiptLog, newSigningKey, verifyReceipt, Receipt } from "../src/receipts";
import { resolveOriginals, signature, similarity } from "../src/dedupe";

describe("Shapley attribution", () => {
  it("matches the textbook glove game (left glove + two right gloves)", async () => {
    // Player 0 has a left glove, players 1 and 2 have right gloves. A pair is worth 1.
    const v = (c: number) => ((c & 1) && (c & 6) ? 1 : 0);
    const r = await shapleyExact(3, v);
    expect(r.values[0]).toBeCloseTo(2 / 3, 10);
    expect(r.values[1]).toBeCloseTo(1 / 6, 10);
    expect(r.values[2]).toBeCloseTo(1 / 6, 10);
  });

  it("is efficient: values sum to v(all) - v(none)", async () => {
    const weights = [3, 1, 4, 1, 5, 9];
    const v = (c: number) => Math.sqrt(membersOf(c, 6).reduce((s, i) => s + weights[i], 0)) + 2;
    const r = await shapleyExact(6, v);
    expect(r.values.reduce((a, b) => a + b, 0)).toBeCloseTo(r.total, 10);
  });

  it("gives zero to a source that never changes the answer (null player)", async () => {
    const v = (c: number) => (c & 1 ? 5 : 0) + (c & 2 ? 2 : 0); // source 2 is irrelevant
    const r = await shapleyExact(3, v);
    expect(r.values[2]).toBeCloseTo(0, 12);
  });

  it("sampling stays efficient and lands close to exact", async () => {
    const weights = [0.5, 2, 1, 3, 0.2, 1.5, 0.8, 2.2, 1.1, 0.4];
    const v = (c: number) => Math.log1p(membersOf(c, 10).reduce((s, i) => s + weights[i], 0));
    const exact = await shapleyExact(10, v);
    const approx = await shapleySampled(10, v, { permutations: 400, seed: 7 });
    expect(approx.values.reduce((a, b) => a + b, 0)).toBeCloseTo(approx.total, 10);
    approx.values.forEach((x, i) => expect(Math.abs(x - exact.values[i])).toBeLessThan(0.02));
    expect(approx.evaluations).toBeLessThan(exact.evaluations);
  });

  it("is reproducible with the same seed", async () => {
    const v = (c: number) => membersOf(c, 9).length ** 1.3;
    const a = await shapleySampled(9, v, { permutations: 20, seed: 1 });
    const b = await shapleySampled(9, v, { permutations: 20, seed: 1 });
    expect(a.values).toEqual(b.values);
  });

  it("turns values into shares, zeroing harmful sources", () => {
    expect(toShares([2, -1, 6])).toEqual([0.25, 0, 0.75]);
    expect(toShares([-1, -2])).toEqual([0, 0]);
    expect(coalitionOf([0, 2])).toBe(5);
  });
});

describe("Money", () => {
  it("parses and formats exact amounts", () => {
    expect(dollars("0.0041")).toBe(410000n);
    expect(formatDollars(410000n)).toBe("0.0041");
    expect(dollars("12.50")).toBe(1_250_000_000n);
    expect(() => dollars("1.123456789")).toThrow();
  });

  it("splits so the parts always sum exactly to the total", () => {
    for (let t = 0; t < 200; t++) {
      const total = BigInt(Math.floor(Math.random() * 1e9));
      const w = Array.from({ length: 1 + Math.floor(Math.random() * 8) }, () => Math.random());
      const parts = splitByWeights(total, w);
      expect(parts.reduce((a, b) => a + b, 0n)).toBe(total);
      parts.forEach((p) => expect(p >= 0n).toBe(true));
    }
  });

  it("splits 1 unit three ways deterministically", () => {
    expect(splitByWeights(1n, [1, 1, 1])).toEqual([1n, 0n, 0n]);
    expect(splitByWeights(10n, [1, 1, 1])).toEqual([4n, 3n, 3n]);
  });

  it("only pays whole cents above the minimum and carries the rest", () => {
    expect(payableCents(99_999_999n)).toEqual({ cents: 0n, carry: 99_999_999n });
    const r = payableCents(dollars("3.14159265"));
    expect(r.cents).toBe(314n);
    expect(r.carry + r.cents * 1_000_000n).toBe(dollars("3.14159265"));
    expect(centsToPayPalValue(314n)).toBe("3.14");
    expect(centsToPayPalValue(5n)).toBe("0.05");
  });
});

describe("Verifiable receipts", () => {
  const make = (i: number): Receipt => ({
    id: `r${i}`,
    appId: "demo-app",
    queryHash: `q${i}`,
    answerHash: `a${i}`,
    createdAt: "2026-11-12T10:00:00Z",
    priceMicro: "500000",
    method: "exact",
    lines: [{ sourceId: "s1", creatorId: "priya", share: 0.41, amountMicro: "205000" }],
  });

  it("proves inclusion for every receipt in batches of every size", () => {
    const key = newSigningKey();
    for (const size of [1, 2, 3, 5, 8, 13, 31]) {
      const receipts = Array.from({ length: size }, (_, i) => make(i));
      const log = new ReceiptLog(receipts);
      const batch = log.sign("2026-11-12", key);
      receipts.forEach((r) => expect(verifyReceipt(r, log.proof(r.id), batch).ok).toBe(true));
    }
  });

  it("rejects a tampered receipt or a forged batch", () => {
    const key = newSigningKey();
    const receipts = Array.from({ length: 6 }, (_, i) => make(i));
    const log = new ReceiptLog(receipts);
    const batch = log.sign("2026-11-12", key);
    const proof = log.proof("r3");

    const tampered = { ...receipts[3], lines: [{ ...receipts[3].lines[0], amountMicro: "999999" }] };
    expect(verifyReceipt(tampered, proof, batch).ok).toBe(false);

    const forged = { ...batch, root: "00".repeat(32) };
    expect(verifyReceipt(receipts[3], proof, forged)).toEqual({ ok: false, reason: "Batch signature is invalid" });
  });
});

describe("Copy detection", () => {
  const original =
    "A flat sourdough usually means the starter was past its peak or the dough was over-proofed. Feed the starter and use it when it has doubled and smells sweet, then shorten the bulk ferment in a warm kitchen. Shape with more surface tension and bake on a preheated stone.";

  it("sees a lightly reworded copy as near-identical and unrelated text as different", () => {
    const copy = original.replace("usually means", "often means").replace("warm kitchen", "hot kitchen");
    const other = "Tomato plants need six to eight hours of direct sunlight, deep watering twice a week, and a stake once the first flowers appear.";
    expect(similarity(signature(original), signature(copy))).toBeGreaterThan(0.6);
    expect(similarity(signature(original), signature(other))).toBeLessThan(0.1);
  });

  it("routes a copier's credit to the earliest original", () => {
    const r = resolveOriginals([
      { id: "copycat", text: original, publishedAt: "2026-10-30" },
      { id: "priya", text: original, publishedAt: "2025-03-14" },
      { id: "other", text: "Completely different writing about tomato plants and sunlight and watering.", publishedAt: "2026-01-01" },
    ]);
    expect(r.creditTo).toEqual({ copycat: "priya", priya: "priya", other: "other" });
    expect(r.groups[0].original).toBe("priya");
  });
});
