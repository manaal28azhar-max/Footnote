import { describe, it, expect, beforeAll } from "vitest";
import { freshDb, Db } from "../lib/db";
import { answer, PaymentRequired } from "../lib/answer";
import { retrieve } from "../lib/retrieve";
import { quoteInSource, toSupport } from "../lib/ai";
import { DEMO_APP_ID } from "../lib/seed";
import { activeWindow, NEWSROOM, validateTerms } from "../lib/terms";

let d: Db;
beforeAll(async () => {
  delete process.env.ANTHROPIC_API_KEY; // offline mode: deterministic
  d = await freshDb();
});

describe("seeding and copy detection", () => {
  it("marks the content farm's copy as a copy of Priya's guide", async () => {
    const [row] = await d.query<{ credit_to: string; copy_similarity: number }>("SELECT credit_to, copy_similarity FROM sources WHERE id = 'farm-flat-loaf'");
    expect(row.credit_to).toBe("priya-flat-loaf");
    expect(Number(row.copy_similarity)).toBeGreaterThan(0.6);
    const originals = await d.query("SELECT id FROM sources WHERE credit_to IS NOT NULL");
    expect(originals).toHaveLength(1);
  });
});

describe("retrieval", () => {
  it("finds the sourdough sources for a sourdough question", async () => {
    const r = await retrieve(d.query, "Why is my sourdough flat and dense?");
    const ids = r.map((s) => s.id);
    expect(ids).toContain("priya-flat-loaf");
    expect(ids).not.toContain("dev-sour-espresso");
  });
  it("returns nothing for a question with no matching content", async () => {
    expect(await retrieve(d.query, "quantum chromodynamics lattice")).toEqual([]);
  });
});

describe("the full pipeline", () => {
  it("answers, credits Priya for her copied text, and balances to the micro-cent", async () => {
    const [{ before }] = await d.query<{ before: string }>("SELECT balance_micro::text AS before FROM apps WHERE id = $1", [DEMO_APP_ID]);
    const r = await answer(d, DEMO_APP_ID, "Why is my sourdough flat and dense?");
    expect(r.sentences.length).toBeGreaterThan(0);
    expect(r.receiptId).toBeTruthy();

    // The content farm earns nothing; its share is routed to Priya.
    expect(r.credits.map((c) => c.creatorId)).not.toContain("farm");
    expect(r.credits.map((c) => c.creatorId)).toContain("priya");

    // Money adds up exactly: credits + fee = price = balance change.
    const sum = r.credits.reduce((a, c) => a + BigInt(c.amountMicro), 0n) + BigInt(r.feeMicro);
    expect(sum).toBe(BigInt(r.priceMicro));
    expect(BigInt(before) - BigInt(r.balanceMicro)).toBe(BigInt(r.priceMicro));

    const ledger = await d.query<{ total: string }>("SELECT coalesce(sum(amount_micro),0)::text AS total FROM ledger WHERE receipt_id = $1", [r.receiptId]);
    expect(BigInt(ledger[0].total) + BigInt(r.feeMicro)).toBe(BigInt(r.priceMicro));
  });

  it("charges fresh news at its premium window", async () => {
    const r = await answer(d, DEMO_APP_ID, "Is the Halifax protected bike lane network open yet?");
    const news = r.sources.find((s) => s.id === "harbour-bike-lanes");
    expect(news?.window).toEqual({ label: "Breaking", multiplier: 4 });
  });

  it("refuses with 402 semantics when the balance cannot cover the answer", async () => {
    await d.query("UPDATE apps SET balance_micro = 0 WHERE id = $1", [DEMO_APP_ID]);
    await expect(answer(d, DEMO_APP_ID, "How often should I lube my bike chain?")).rejects.toBeInstanceOf(PaymentRequired);
    const [{ n }] = await d.query<{ n: string }>("SELECT count(*)::text AS n FROM answers WHERE question LIKE 'How often should I lube%'");
    expect(n).toBe("0"); // nothing was written: the transaction rolled back
    await d.query("UPDATE apps SET balance_micro = 500000000 WHERE id = $1", [DEMO_APP_ID]);
  });
});

describe("auditor safeguards", () => {
  const src = [{ body: "Use your starter at its peak, not after it. A starter at its peak has roughly doubled." }] as never;
  it("accepts an exact quote and rejects an invented one", () => {
    expect(quoteInSource("use your starter at its peak, not after it", "Use your starter at its peak, not after it.")).toBe(true);
    expect(quoteInSource("always bake at 300 degrees for best results", "Use your starter at its peak.")).toBe(false);
  });
  it("downgrades full credit when the quote is not really in the source", () => {
    const out = toSupport(
      ["Use the starter when it peaks.", "Bake it hot."],
      [
        { sentence: 1, common_knowledge: false, support: [{ source: "S1", level: "full", quote: "Use your starter at its peak, not after it" }] },
        { sentence: 2, common_knowledge: false, support: [{ source: "S1", level: "full", quote: "bake at 300 degrees for a crisp crust" }] },
      ],
      src,
    );
    expect(out[0].support).toEqual([1]);
    expect(out[1].support).toEqual([0.5]);
  });
});

describe("licence terms", () => {
  it("validates windows and finds the active one", () => {
    expect(validateTerms(NEWSROOM)).toBeNull();
    expect(validateTerms({ windows: [{ label: "x", fromDays: 3, toDays: null, multiplier: 1 }] })).toMatch(/day 0/);
    const pub = new Date("2026-11-01T00:00:00Z");
    expect(activeWindow(NEWSROOM, pub, new Date("2026-11-05T00:00:00Z")).label).toBe("Breaking");
    expect(activeWindow(NEWSROOM, pub, new Date("2027-06-01T00:00:00Z")).label).toBe("Archive");
  });
});
