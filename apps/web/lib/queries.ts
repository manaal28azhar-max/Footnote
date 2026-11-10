import type { Db } from "./db";
import type { Terms } from "./terms";

const n = (v: unknown) => String(v ?? "0");

export async function creatorsOverview(d: Db) {
  return d.query<{
    id: string; name: string; handle: string; city: string; country: string; site: string; connected: boolean;
    earned: string; paid: string; balance: string; answers: string; gate_hits: number;
  }>(`
    SELECT c.id, c.name, c.handle, c.city, c.country, c.site, (c.paypal_payer_id IS NOT NULL OR c.paypal_email IS NOT NULL) AS connected,
      coalesce(sum(l.amount_micro) FILTER (WHERE l.kind = 'earning'), 0)::text AS earned,
      (-coalesce(sum(l.amount_micro) FILTER (WHERE l.kind IN ('payout','payout_reversal')), 0))::text AS paid,
      coalesce(sum(l.amount_micro), 0)::text AS balance,
      count(DISTINCT l.receipt_id)::text AS answers,
      c.gate_hits
    FROM creators c LEFT JOIN ledger l ON l.creator_id = c.id
    GROUP BY c.id ORDER BY coalesce(sum(l.amount_micro) FILTER (WHERE l.kind = 'earning'), 0) DESC`);
}

export async function creatorDetail(d: Db, id: string) {
  const [c] = await d.query<{
    id: string; name: string; handle: string; city: string; country: string; site: string; bio: string;
    paypal_email: string | null; paypal_payer_id: string | null; gate_hits: number; verify_token: string; verified_at: string | null;
  }>("SELECT * FROM creators WHERE id = $1", [id]);
  if (!c) return null;
  const all = (await creatorsOverview(d)).find((x) => x.id === id)!;
  const sources = await d.query<{ id: string; title: string; url: string; published_at: string; terms: Terms | string; credit_to: string | null; copy_similarity: number | null }>(
    "SELECT id, title, url, published_at, terms, credit_to, copy_similarity FROM sources WHERE creator_id = $1 ORDER BY published_at DESC",
    [id],
  );
  const earnings = await d.query<Record<string, unknown>>(
    `SELECT l.created_at, l.amount_micro::text AS amount, l.receipt_id, l.source_id, a.question, a.mode, r.body->>'priceMicro' AS price,
            (SELECT string_agg(DISTINCT coalesce(s.credit_to, s.id), ',') FROM sources s WHERE s.id = ANY(string_to_array(l.source_id, ','))) AS for_sources
       FROM ledger l JOIN receipts r ON r.id = l.receipt_id JOIN answers a ON a.id = r.answer_id
      WHERE l.creator_id = $1 AND l.kind = 'earning' ORDER BY l.created_at DESC LIMIT 500`,
    [id],
  );
  const payouts = await d.query<Record<string, unknown>>(
    `SELECT p.sender_item_id, p.sender_batch_id, p.paypal_item_id, p.amount_cents::text AS cents, p.status, p.updated_at, b.paypal_batch_id
       FROM payout_items p JOIN payout_batches b USING (sender_batch_id) WHERE p.creator_id = $1 ORDER BY p.updated_at DESC`,
    [id],
  );
  return {
    creator: c,
    totals: { earned: n(all.earned), paid: n(all.paid), balance: n(all.balance), answers: n(all.answers) },
    sources: sources.map((s) => ({ ...s, published_at: new Date(s.published_at).toISOString(), terms: (typeof s.terms === "string" ? JSON.parse(s.terms) : s.terms) as Terms })),
    earnings: earnings.map((e): Record<string, unknown> => ({ ...e, created_at: new Date(e.created_at as string).toISOString() })),
    payouts: payouts.map((p): Record<string, unknown> => ({ ...p, updated_at: new Date(p.updated_at as string).toISOString() })),
  };
}

export async function appDetail(d: Db, appId: string) {
  const [app] = await d.query<{ id: string; name: string; balance: string; vault_id: string | null; vault_payer: string | null; reload_cents: string; cap: string }>(
    "SELECT id, name, balance_micro::text AS balance, vault_id, vault_payer, reload_cents::text, reload_weekly_cap_cents::text AS cap FROM apps WHERE id = $1",
    [appId],
  );
  const answers = await d.query<Record<string, unknown>>(
    `SELECT a.id, a.created_at, a.question, a.mode, a.price_micro::text AS price, a.fee_micro::text AS fee, r.id AS receipt_id,
            (SELECT string_agg(x->>'creatorId', ', ') FROM jsonb_array_elements(r.body->'lines') x) AS creators
       FROM answers a LEFT JOIN receipts r ON r.answer_id = a.id WHERE a.app_id = $1 ORDER BY a.created_at DESC LIMIT 500`,
    [appId],
  );
  const topups = await d.query<Record<string, unknown>>(
    "SELECT paypal_order_id, amount_cents::text AS cents, refunded_cents::text AS refunded, status, kind, capture_id, created_at FROM topups WHERE app_id = $1 ORDER BY created_at DESC",
    [appId],
  );
  return {
    app,
    answers: answers.map((a): Record<string, unknown> => ({ ...a, created_at: new Date(a.created_at as string).toISOString() })),
    topups: topups.map((t): Record<string, unknown> => ({ ...t, created_at: new Date(t.created_at as string).toISOString() })),
  };
}

export async function ledgerRows(d: Db) {
  const rows = await d.query<Record<string, unknown>>(
    `SELECT l.id, l.created_at, c.name AS creator, l.kind, l.amount_micro::text AS amount, l.receipt_id, l.source_id, l.payout_item_id, l.note
       FROM ledger l JOIN creators c ON c.id = l.creator_id ORDER BY l.id DESC LIMIT 2000`,
  );
  return rows.map((r): Record<string, unknown> => ({ ...r, id: String(r.id), created_at: new Date(r.created_at as string).toISOString() }));
}

export async function payoutBatches(d: Db) {
  const rows = await d.query<Record<string, unknown>>(
    "SELECT sender_batch_id, paypal_batch_id, status, total_cents::text AS cents, item_count, created_at FROM payout_batches ORDER BY created_at DESC LIMIT 50",
  );
  return rows.map((r): Record<string, unknown> => ({ ...r, created_at: new Date(r.created_at as string).toISOString() }));
}
