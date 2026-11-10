import { createHash, randomBytes } from "node:crypto";
import { resolveOriginals, dollars } from "@footnote/core";
import type { Db } from "./db";
import { answer } from "./answer";
import { CREATORS, SOURCES } from "./seed-data";

export const DEMO_APP_ID = "answerly";
export const DEMO_APP_KEY = process.env.DEMO_APP_KEY || "fn_demo_answerly_public";

export const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

function resolveDate(s: string): string {
  const rel = /^-(\d+)d$/.exec(s);
  return rel ? new Date(Date.now() - Number(rel[1]) * 86_400_000).toISOString() : new Date(s + "T09:00:00Z").toISOString();
}

/** Insert the demo world once. Safe to call on every boot. */
/**
 * Demo creators share the PayPal sandbox personal accounts in rotation
 * (SANDBOX_CREATOR_EMAILS, comma-separated). The content farm never gets one.
 */
function sandboxEmailFor(creatorId: string): string | null {
  const emails = (process.env.SANDBOX_CREATOR_EMAILS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!emails.length || creatorId === "farm") return null;
  const k = CREATORS.filter((c) => c.id !== "farm").findIndex((c) => c.id === creatorId);
  return k < 0 ? null : emails[k % emails.length];
}

export async function seed(d: Db) {
  const [{ n }] = await d.query<{ n: string }>("SELECT count(*)::text AS n FROM creators");
  if (Number(n) > 0) {
    // Emails added after the first deploy: fill in creators who have no PayPal yet.
    for (const c of CREATORS) {
      const email = sandboxEmailFor(c.id);
      if (email) await d.query("UPDATE creators SET paypal_email = $1 WHERE id = $2 AND paypal_email IS NULL AND paypal_payer_id IS NULL", [email, c.id]);
    }
    return;
  }

  await d.tx(async (q) => {
    for (const c of CREATORS) {
      // Demo creators are pre-verified so the demo works end to end.
      const email = sandboxEmailFor(c.id);
      await q(
        `INSERT INTO creators (id, name, handle, site, city, country, bio, paypal_email, verify_token, verified_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())`,
        [c.id, c.name, c.handle, c.site, c.city, c.country, c.bio, email, randomBytes(12).toString("hex")],
      );
    }

    // Copy detection runs once at ingestion: a copy's credit is routed to the
    // earliest original in its near-duplicate group.
    const docs = SOURCES.map((s) => ({ id: s.id, text: s.body, publishedAt: resolveDate(s.publishedAt) }));
    const { creditTo, groups } = resolveOriginals(docs);
    const simOf = new Map(groups.flatMap((g) => g.copies.map((c) => [c.id, c.similarity] as const)));

    for (const s of SOURCES) {
      const creator = CREATORS.find((c) => c.id === s.creatorId)!;
      const original = creditTo[s.id] !== s.id ? creditTo[s.id] : null;
      await q(
        `INSERT INTO sources (id, creator_id, title, url, body, published_at, terms, credit_to, copy_similarity)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [s.id, s.creatorId, s.title, `https://${creator.site}${s.path}`, s.body, resolveDate(s.publishedAt), JSON.stringify(s.terms), original, simOf.get(s.id) ?? null],
      );
    }

    // The demo AI app starts with a sandbox balance so the demo works before
    // anyone tops up. Real balances come from PayPal top-ups.
    await q(`INSERT INTO apps (id, name, api_key_hash, balance_micro) VALUES ($1,$2,$3,$4)`, [
      DEMO_APP_ID,
      "Answerly (demo AI app)",
      hashKey(DEMO_APP_KEY),
      SEED_BALANCE.toString(),
    ]);
    await q(`INSERT INTO settings (key, value) VALUES ('seed_balance_micro', $1) ON CONFLICT (key) DO NOTHING`, [SEED_BALANCE.toString()]);
  });

  if (process.env.SIMULATE_HISTORY !== "0") await simulateHistory(d);
}

const SEED_BALANCE = dollars("20.00");

export const SIM_QUESTIONS = [
  "Why is my sourdough flat and dense?",
  "How do I stop my sourdough loaf spreading?",
  "What hydration should a beginner use for bread dough?",
  "How do I shape a loaf so it rises up, not out?",
  "My monstera's leaves are turning yellow",
  "How often should I water a monstera?",
  "How much light does a houseplant need?",
  "Why does my espresso taste sour?",
  "Does a burr grinder matter for espresso?",
  "How often should I lube my bike chain?",
  "When should I replace my disc brake pads?",
  "Why do my disc brakes squeal?",
];
const NEWS_QUESTIONS = ["Is the Halifax bike lane network open yet?", "Why is the Robie Street bike lane delayed?"];

/**
 * Labelled simulated history: real answers through the real pipeline (offline
 * mode, no model calls), spread over the past two weeks, so dashboards are
 * not empty on first visit. Every one is stored with mode = 'simulated'.
 */
export async function simulateHistory(d: Db, count = 160) {
  let seedN = 7;
  const rand = () => ((seedN = (seedN * 16807) % 2147483647) / 2147483647);
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    const news = rand() < 0.18;
    const q = news ? NEWS_QUESTIONS[Math.floor(rand() * NEWS_QUESTIONS.length)] : SIM_QUESTIONS[Math.floor(rand() * SIM_QUESTIONS.length)];
    const ageMs = news ? rand() * 40 * 3_600_000 : rand() * 14 * 86_400_000;
    await answer(d, DEMO_APP_ID, q, new Date(now - ageMs), { simulated: true });
  }
}
