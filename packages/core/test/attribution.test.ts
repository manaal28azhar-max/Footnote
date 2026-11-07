import { describe, it, expect } from "vitest";
import { attribute, maxGameShapley, supportValue, SentenceSupport } from "../src/attribution";
import { shapleyExact } from "../src/shapley";

describe("Sentence-support attribution", () => {
  it("gives a source full credit for a claim only it backs", () => {
    expect(maxGameShapley([1, 0, 0])).toEqual([1, 0, 0]);
  });

  it("splits a claim equally between two sources that both back it", () => {
    expect(maxGameShapley([1, 1, 0])).toEqual([0.5, 0.5, 0]);
  });

  it("handles partial support: a full and a partial source", () => {
    // First 0.5 of value is shared by both, the remaining 0.5 only by source 0.
    expect(maxGameShapley([1, 0.5])).toEqual([0.75, 0.25]);
  });

  it("closed form equals brute-force Shapley on random answers", async () => {
    let seed = 42;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const levels = [0, 0, 0.5, 1];
    for (let trial = 0; trial < 50; trial++) {
      const n = 2 + Math.floor(rand() * 7);
      const sentences: SentenceSupport[] = Array.from({ length: 1 + Math.floor(rand() * 6) }, () => ({
        text: "s",
        weight: 1 + Math.floor(rand() * 20),
        commonKnowledge: rand() < 0.15,
        support: Array.from({ length: n }, () => levels[Math.floor(rand() * 4)]),
      }));
      const fast = attribute(sentences, n);
      const slow = await shapleyExact(n, (c) => supportValue(sentences, c));
      fast.values.forEach((v, i) => expect(v).toBeCloseTo(slow.values[i], 9));
      expect(fast.total).toBeCloseTo(slow.total, 9);
    }
  });

  it("pays nobody for common knowledge and reports the sourced fraction", () => {
    const r = attribute(
      [
        { text: "Bread needs heat.", weight: 3, commonKnowledge: true, support: [1, 1] },
        { text: "Use the starter at its peak.", weight: 6, support: [1, 0] },
        { text: "Bake on a hot stone.", weight: 5, support: [1, 1] },
      ],
      2,
    );
    expect(r.values).toEqual([6 + 2.5, 2.5]);
    expect(r.shares[0]).toBeCloseTo(8.5 / 11, 12);
    expect(r.sourcedFraction).toBeCloseTo(11 / 14, 12);
  });

  it("returns zero shares when no source backs anything", () => {
    const r = attribute([{ text: "x", weight: 4, support: [0, 0] }], 2);
    expect(r.shares).toEqual([0, 0]);
  });
});
