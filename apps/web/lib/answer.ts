/**
 * The Footnote pipeline for one AI answer:
 *   retrieve -> write -> audit -> Shapley -> price -> exact split -> charge
 *   -> receipt -> ledger, with charge + receipt + ledger in one transaction.
 */
import { createHash, randomBytes } from "node:crypto";
import { attribute, splitByWeights, MICRO_PER_DOLLAR, dollars, normalise } from "@footnote/core";
import type { Receipt } from "@footnote/core";
import type { Db } from "./db";
import { retrieve, RetrievedSource } from "./retrieve";
import { generate, expandQuery, AuditedSentence } from "./ai";
import { activeWindow, Terms } from "./terms";

export const BASE_PRICE_MICRO = dollars(process.env.BASE_PRICE_USD || "0.005"); // per fully sourced answer
export const FEE_BPS = BigInt(process.env.FOOTNOTE_FEE_BPS || 1000); // 10% to run Footnote
export const METHOD = "sentence-support-shapley/v1";

export const newId = (prefix: string) => `${prefix}_${randomBytes(9).toString("base64url")}`;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export class PaymentRequired extends Error {
  constructor(public priceMicro: bigint, public balanceMicro: bigint) {
    super("Insufficient Footnote balance");
  }
}

export interface AnswerSource {
  index: number;
  id: string;
  creatorId: string;
  /** Who is paid for this source: its own creator, or the original it copied. */
  paidCreatorId: string;
  title: string;
  url: string;
  creatorName: string;
  creatorCity: string;
  creatorCountry: string;
  publishedAt: string;
  window: { label: string; multiplier: number };
  copyOf: { sourceId: string; creatorId: string; creatorName: string; similarity: number } | null;
  /** Hidden instructions to AI systems removed from this page before any model saw it. */
  injectionRemoved: string[] | null;
  /** Shapley share of this source (before copy credit is routed). */
  share: number;
}
export interface Credit {
  creatorId: string;
  creatorName: string;
  sourceIds: string[];
  share: number;
  multiplier: number;
  amountMicro: string;
}
export interface AnswerResult {
  id: string;
  receiptId: string | null;
  question: string;
  mode: "claude" | "offline";
  offlineReason?: string;
  simulated?: boolean;
  models?: { writer: string; auditor: string };
  sentences: (AuditedSentence & { split: number[] })[];
  sources: AnswerSource[];
  credits: Credit[];
  priceMicro: string;
  feeMicro: string;
  sourcedFraction: number;
  balanceMicro: string;
  createdAt: string;
}

interface Owner {
  creatorId: string;
  creatorName: string;
  terms: Terms;
  publishedAt: string;
}

/** Who gets paid for a source: itself, or the original it was copied from. */
async function ownersOf(d: Db, sources: RetrievedSource[]) {
  const ids = [...new Set(sources.map((s) => s.creditTo).filter(Boolean))] as string[];
  const originals = ids.length
    ? await d.query<{ id: string; creator_id: string; name: string; terms: Terms | string; published_at: string }>(
        `SELECT s.id, s.creator_id, c.name, s.terms, s.published_at FROM sources s JOIN creators c ON c.id = s.creator_id WHERE s.id = ANY($1)`,
        [ids],
      )
    : [];
  const byId = new Map(originals.map((o) => [o.id, o]));
  return sources.map((s): Owner => {
    const o = s.creditTo ? byId.get(s.creditTo) : undefined;
    return o
      ? { creatorId: o.creator_id, creatorName: o.name, terms: typeof o.terms === "string" ? JSON.parse(o.terms) : o.terms, publishedAt: new Date(o.published_at).toISOString() }
      : { creatorId: s.creatorId, creatorName: s.creatorName, terms: s.terms, publishedAt: s.publishedAt };
  });
}

export async function answer(d: Db, appId: string, question: string, now = new Date(), opts: { simulated?: boolean } = {}): Promise<AnswerResult> {
  const q = question.trim().slice(0, 500);
  if (normalise(q).length < 2) throw new Error("Please ask a longer question.");

  const sources = await retrieve(d.query, q, 5, opts.simulated ? [] : await expandQuery(d.query, q));
  const gen = await generate(d.query, q, sources, { offline: opts.simulated });
  const attr = attribute(gen.sentences, sources.length);
  const owners = await ownersOf(d, sources);

  // Price: each source's share is weighted by its licence window (fresh news
  // can cost more), summed per credited creator.
  const perCreator = new Map<string, { name: string; weight: number; share: number; sourceIds: string[]; multiplier: number }>();
  sources.forEach((s, i) => {
    const share = attr.shares[i];
    if (share <= 0) return;
    const o = owners[i];
    const w = activeWindow(o.terms, new Date(o.publishedAt), now);
    const cur = perCreator.get(o.creatorId) ?? { name: o.creatorName, weight: 0, share: 0, sourceIds: [], multiplier: w.multiplier };
    cur.weight += share * w.multiplier;
    cur.share += share;
    cur.sourceIds.push(s.id);
    cur.multiplier = Math.max(cur.multiplier, w.multiplier);
    perCreator.set(o.creatorId, cur);
  });

  const entries = [...perCreator.entries()].filter(([, v]) => v.weight > 0);
  const weightSum = entries.reduce((a, [, v]) => a + v.weight, 0);
  // Price scales with how much of the answer was sourced, and with freshness.
  const price = BigInt(Math.round(Number(BASE_PRICE_MICRO) * weightSum * attr.sourcedFraction));
  const fee = (price * FEE_BPS) / 10_000n;
  const pool = price - fee;
  const amounts = splitByWeights(pool, entries.map(([, v]) => v.weight));

  const credits: Credit[] = entries.map(([creatorId, v], k) => ({
    creatorId,
    creatorName: v.name,
    sourceIds: v.sourceIds,
    share: v.share,
    multiplier: v.multiplier,
    amountMicro: amounts[k].toString(),
  }));

  const id = newId("ans");
  const receiptId = price > 0n ? newId("rcpt") : null;
  const createdAt = now.toISOString();

  const result: Omit<AnswerResult, "balanceMicro"> = {
    id,
    receiptId,
    question: q,
    mode: gen.mode,
    simulated: opts.simulated || undefined,
    models: gen.models,
    offlineReason: gen.offlineReason,
    sentences: gen.sentences.map((s, j) => ({ ...s, split: attr.perSentence[j] })),
    sources: sources.map((s, i) => ({
      index: i,
      id: s.id,
      creatorId: s.creatorId,
      paidCreatorId: owners[i].creatorId,
      title: s.title,
      url: s.url,
      creatorName: s.creatorName,
      creatorCity: s.creatorCity,
      creatorCountry: s.creatorCountry,
      publishedAt: s.publishedAt,
      window: (({ label, multiplier }) => ({ label, multiplier }))(activeWindow(owners[i].terms, new Date(owners[i].publishedAt), now)),
      copyOf: s.creditTo ? { sourceId: s.creditTo, creatorId: owners[i].creatorId, creatorName: owners[i].creatorName, similarity: s.copySimilarity ?? 0 } : null,
      injectionRemoved: s.injectionRemoved,
      share: attr.shares[i],
    })),
    credits,
    priceMicro: price.toString(),
    feeMicro: fee.toString(),
    sourcedFraction: attr.sourcedFraction,
    createdAt,
  };

  const receipt: Receipt | null = receiptId
    ? {
        id: receiptId,
        appId,
        queryHash: sha(q),
        answerHash: sha(JSON.stringify(gen.sentences.map((s) => s.text))),
        createdAt,
        priceMicro: price.toString(),
        feeMicro: fee.toString(),
        method: METHOD,
        lines: credits.map((c) => ({ sourceId: c.sourceIds.join(","), creatorId: c.creatorId, share: Number(c.share.toFixed(6)), amountMicro: c.amountMicro })),
      }
    : null;

  const balance = await d.tx(async (t) => {
    const rows = await t<{ balance: string }>(
      `UPDATE apps SET balance_micro = balance_micro - $1 WHERE id = $2 AND balance_micro >= $1 RETURNING balance_micro::text AS balance`,
      [price.toString(), appId],
    );
    if (!rows[0]) {
      const [cur] = await t<{ balance: string }>("SELECT balance_micro::text AS balance FROM apps WHERE id = $1", [appId]);
      throw new PaymentRequired(price, BigInt(cur?.balance ?? "0"));
    }
    await t(`INSERT INTO answers (id, app_id, question, answer, price_micro, fee_micro, mode, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [
      id,
      appId,
      q,
      JSON.stringify(result),
      price.toString(),
      fee.toString(),
      opts.simulated ? "simulated" : gen.mode,
      createdAt,
    ]);
    if (receipt) {
      await t(`INSERT INTO receipts (id, answer_id, body, created_at) VALUES ($1,$2,$3,$4)`, [receipt.id, id, JSON.stringify(receipt), createdAt]);
      for (const c of credits) {
        if (c.amountMicro === "0") continue;
        await t(`INSERT INTO ledger (creator_id, kind, amount_micro, receipt_id, source_id, created_at) VALUES ($1,'earning',$2,$3,$4,$5)`, [
          c.creatorId,
          c.amountMicro,
          receipt.id,
          c.sourceIds.join(","),
          createdAt,
        ]);
      }
    }
    return rows[0].balance;
  });

  return { ...result, balanceMicro: balance };
}

export const microToUsd = (m: string | bigint) => Number(BigInt(m)) / Number(MICRO_PER_DOLLAR);
