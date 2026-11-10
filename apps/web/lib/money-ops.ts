/**
 * Everything that moves real (sandbox) money, kept idempotent so retries,
 * double clicks and duplicate webhooks can never pay or credit twice.
 */
import { MICRO_PER_CENT, payableCents, centsToPayPalValue } from "@footnote/core";
import type { Db, Query } from "./db";
import * as PP from "./paypal";
import { randomUUID } from "node:crypto";

const usdToCents = (v: string) => {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(v);
  if (!m) throw new Error(`Bad amount ${v}`);
  return BigInt(m[1]) * 100n + BigInt((m[2] ?? "").padEnd(2, "0"));
};

// ---------- Top-ups ----------

export const TOPUP_CHOICES = ["5.00", "10.00", "25.00"] as const;

export async function startTopup(d: Db, appId: string, amount: string, vault: boolean, baseUrl: string) {
  if (!TOPUP_CHOICES.includes(amount as never)) throw new Error("Choose a top-up of $5, $10 or $25.");
  const order = await PP.createTopupOrder({ appId, amountValue: amount, vault, returnUrl: `${baseUrl}/console?paid=1`, cancelUrl: `${baseUrl}/console` });
  await d.query(`INSERT INTO topups (paypal_order_id, app_id, amount_cents, status, kind) VALUES ($1,$2,$3,$4,'manual') ON CONFLICT DO NOTHING`, [
    order.id,
    appId,
    usdToCents(amount).toString(),
    order.status,
  ]);
  return order;
}

/**
 * Credit a captured order to the app's balance, exactly once. Called from the
 * capture endpoint and again from the PAYMENT.CAPTURE.COMPLETED webhook;
 * whichever arrives second changes nothing.
 */
export async function creditCapture(d: Db, captured: PP.CapturedOrder): Promise<{ credited: boolean; appId: string | null }> {
  const pu = captured.purchase_units[0];
  const cap = pu?.payments?.captures?.[0];
  if (!cap || cap.status !== "COMPLETED") return { credited: false, appId: null };
  const appId = cap.custom_id || pu.custom_id || pu.reference_id || null;
  if (!appId) return { credited: false, appId: null };
  const cents = usdToCents(cap.amount.value);
  const vault = captured.payment_source?.paypal?.attributes?.vault;

  return d.tx(async (q) => {
    // Upsert so a webhook that arrives before our own capture call still works.
    await q(`INSERT INTO topups (paypal_order_id, app_id, amount_cents, status) VALUES ($1,$2,$3,'APPROVED') ON CONFLICT DO NOTHING`, [captured.id, appId, cents.toString()]);
    const rows = await q(
      `UPDATE topups SET status = 'COMPLETED', capture_id = $2, captured_at = now() WHERE paypal_order_id = $1 AND status <> 'COMPLETED' RETURNING app_id`,
      [captured.id, cap.id],
    );
    if (!rows.length) return { credited: false, appId };
    await q(`UPDATE apps SET balance_micro = balance_micro + $1 WHERE id = $2`, [(cents * MICRO_PER_CENT).toString(), appId]);
    if (vault?.id && vault.status !== "DENIED") {
      await q(`UPDATE apps SET vault_id = $1, vault_payer = $2 WHERE id = $3`, [vault.id, captured.payment_source?.paypal?.email_address ?? null, appId]);
    }
    return { credited: true, appId };
  });
}

/** Capture an approved order, after checking it is one of ours and untampered. */
export async function finishTopup(d: Db, orderId: string) {
  const [row] = await d.query<{ app_id: string; amount_cents: string; status: string }>(
    "SELECT app_id, amount_cents::text, status FROM topups WHERE paypal_order_id = $1",
    [orderId],
  );
  if (!row) throw new Error("Unknown order.");
  if (row.status === "COMPLETED") return { credited: false, appId: row.app_id };
  const captured = await PP.captureOrder(orderId);
  const value = captured.purchase_units[0]?.payments?.captures?.[0]?.amount.value;
  if (!value || usdToCents(value) !== BigInt(row.amount_cents)) throw new Error("Captured amount does not match the order.");
  return creditCapture(d, captured);
}

// ---------- Agent auto-reload (Vault + spending limit in code) ----------

/**
 * Called when an answer would overdraw the balance. Charges the saved PayPal
 * wallet once, only if the owner's weekly limit allows it. The limit is
 * enforced here, in code, not by any model.
 */
export async function tryAutoReload(d: Db, appId: string): Promise<{ reloaded: boolean; reason: string }> {
  if (!PP.paypalConfigured()) return { reloaded: false, reason: "PayPal is not configured" };
  const [app] = await d.query<{ vault_id: string | null; reload_cents: string; cap: string; spent: string }>(
    `SELECT a.vault_id, a.reload_cents::text, a.reload_weekly_cap_cents::text AS cap,
            coalesce((SELECT sum(amount_cents) FROM topups t WHERE t.app_id = a.id AND t.kind = 'auto' AND t.status = 'COMPLETED' AND t.created_at > now() - interval '7 days'), 0)::text AS spent
       FROM apps a WHERE a.id = $1`,
    [appId],
  );
  if (!app?.vault_id) return { reloaded: false, reason: "No saved PayPal wallet. Top up once with 'Save for auto-reload' ticked." };
  const amount = BigInt(app.reload_cents);
  if (BigInt(app.spent) + amount > BigInt(app.cap)) return { reloaded: false, reason: "Weekly auto-reload limit reached" };

  const requestId = `reload-${appId}-${Math.floor(Date.now() / 60_000)}`; // at most one reload per app per minute
  const captured = await PP.chargeVaulted(appId, app.vault_id, centsToPayPalValue(amount), requestId);
  await d.query(`INSERT INTO topups (paypal_order_id, app_id, amount_cents, status, kind) VALUES ($1,$2,$3,'APPROVED','auto') ON CONFLICT DO NOTHING`, [
    captured.id,
    appId,
    amount.toString(),
  ]);
  const r = await creditCapture(d, captured);
  return { reloaded: r.credited, reason: r.credited ? `Reloaded $${centsToPayPalValue(amount)} from saved PayPal` : "Reload was not completed" };
}

// ---------- Refunds: an app withdraws unused balance ----------

/**
 * Refund unused balance back to the PayPal account that paid it, newest
 * top-ups first. Only money that came from PayPal can go back to PayPal (the
 * demo's starting sandbox credit cannot). The balance is debited first, inside
 * a transaction; any refund PayPal rejects is put back.
 */
export async function refundBalance(d: Db, appId: string, amountUsd: string) {
  if (!PP.paypalConfigured()) throw new Error("PayPal is not configured on this deployment.");
  const want = usdToCents(amountUsd);
  if (want <= 0n) throw new Error("Choose an amount above zero.");

  const plan = await d.tx(async (q) => {
    const [app] = await q<{ balance: string }>("SELECT balance_micro::text AS balance FROM apps WHERE id = $1 FOR UPDATE", [appId]);
    if (!app) throw new Error("Unknown app.");
    if (BigInt(app.balance) < want * MICRO_PER_CENT) throw new Error("That is more than the unused balance.");
    const caps = await q<{ capture_id: string; left: string }>(
      `SELECT capture_id, (amount_cents - refunded_cents)::text AS left FROM topups
        WHERE app_id = $1 AND status = 'COMPLETED' AND capture_id IS NOT NULL AND amount_cents > refunded_cents
          AND captured_at > now() - interval '180 days'
        ORDER BY captured_at DESC`,
      [appId],
    );
    const parts: { id: string; captureId: string; cents: bigint }[] = [];
    let need = want;
    for (const c of caps) {
      if (need === 0n) break;
      const take = BigInt(c.left) < need ? BigInt(c.left) : need;
      parts.push({ id: `rf-${randomUUID()}`, captureId: c.capture_id, cents: take });
      need -= take;
    }
    if (need > 0n) throw new Error("Only money topped up through PayPal can be refunded, and there is not that much to refund.");
    await q("UPDATE apps SET balance_micro = balance_micro - $1 WHERE id = $2", [(want * MICRO_PER_CENT).toString(), appId]);
    for (const p of parts) {
      await q("UPDATE topups SET refunded_cents = refunded_cents + $1 WHERE capture_id = $2", [p.cents.toString(), p.captureId]);
      await q("INSERT INTO refunds (id, app_id, capture_id, amount_cents, status) VALUES ($1,$2,$3,$4,'CREATING')", [p.id, appId, p.captureId, p.cents.toString()]);
    }
    return parts;
  });

  const results = [];
  for (const p of plan) {
    try {
      const r = await PP.refundCapture(p.captureId, centsToPayPalValue(p.cents), p.id, "Unused Footnote balance returned.");
      await d.query("UPDATE refunds SET status = $1, paypal_refund_id = $2 WHERE id = $3", [r.status, r.id, p.id]);
      results.push({ captureId: p.captureId, refundId: r.id, status: r.status, cents: p.cents.toString() });
    } catch (e) {
      // Put the money back exactly once.
      await d.tx(async (q) => {
        const rows = await q("UPDATE refunds SET status = 'FAILED' WHERE id = $1 AND status = 'CREATING' RETURNING 1", [p.id]);
        if (!rows.length) return;
        await q("UPDATE topups SET refunded_cents = refunded_cents - $1 WHERE capture_id = $2", [p.cents.toString(), p.captureId]);
        await q("UPDATE apps SET balance_micro = balance_micro + $1 WHERE id = $2", [(p.cents * MICRO_PER_CENT).toString(), appId]);
      });
      results.push({ captureId: p.captureId, status: "FAILED", cents: p.cents.toString(), error: (e as Error).message.slice(0, 200) });
    }
  }
  return { requestedCents: want.toString(), refunds: results };
}

// ---------- Payouts ----------

/** Sandbox demo default is 10 cents so payouts are visible; production would use a higher minimum. */
export const payoutMinimumCents = () => BigInt(process.env.PAYOUT_MINIMUM_CENTS || 10);
const REVERSE_ON = new Set(["FAILED", "RETURNED", "BLOCKED", "CANCELED", "REFUNDED"]);

export async function balances(q: Query) {
  return q<{ creator_id: string; name: string; paypal_email: string | null; paypal_payer_id: string | null; balance: string }>(
    `SELECT c.id AS creator_id, c.name, c.paypal_email, c.paypal_payer_id, coalesce(sum(l.amount_micro), 0)::text AS balance
       FROM creators c LEFT JOIN ledger l ON l.creator_id = c.id
      GROUP BY c.id ORDER BY c.name`,
  );
}

/**
 * Pay every creator whose balance has reached the minimum. The ledger is
 * debited first, inside a transaction, so a crash can never pay twice; if
 * PayPal rejects the batch, the debits are reversed.
 */
export async function runPayouts(d: Db, now = new Date()) {
  if (!PP.paypalConfigured()) throw new Error("PayPal is not configured on this deployment.");
  const senderBatchId = `fn-${now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;

  const items = await d.tx(async (q) => {
    const out: (PP.PayoutItemInput & { creatorId: string; cents: bigint })[] = [];
    for (const b of await balances(q)) {
      const receiver = b.paypal_payer_id || b.paypal_email;
      if (!receiver) continue;
      const { cents } = payableCents(BigInt(b.balance), payoutMinimumCents());
      if (cents === 0n) continue;
      const senderItemId = `${senderBatchId}-${b.creator_id}`.slice(0, 63);
      out.push({
        creatorId: b.creator_id,
        cents,
        senderItemId,
        receiverType: b.paypal_payer_id ? "PAYPAL_ID" : "EMAIL",
        receiver,
        value: centsToPayPalValue(cents),
        note: `Footnote: your share of AI answers that used your work. Batch ${senderBatchId}.`,
      });
    }
    if (!out.length) return out;
    await q(`INSERT INTO payout_batches (sender_batch_id, status, total_cents, item_count) VALUES ($1,'CREATING',$2,$3)`, [
      senderBatchId,
      out.reduce((a, i) => a + i.cents, 0n).toString(),
      out.length,
    ]);
    for (const i of out) {
      await q(`INSERT INTO payout_items (sender_item_id, sender_batch_id, creator_id, amount_cents, status) VALUES ($1,$2,$3,$4,'CREATING')`, [
        i.senderItemId,
        senderBatchId,
        i.creatorId,
        i.cents.toString(),
      ]);
      await q(`INSERT INTO ledger (creator_id, kind, amount_micro, payout_item_id, note) VALUES ($1,'payout',$2,$3,$4)`, [
        i.creatorId,
        (-(i.cents * MICRO_PER_CENT)).toString(),
        i.senderItemId,
        `PayPal payout ${senderBatchId}`,
      ]);
    }
    return out;
  });

  if (!items.length) return { senderBatchId: null, items: 0, message: "No creator has reached the payout minimum yet." };

  try {
    const res = await PP.createPayoutBatch(senderBatchId, items);
    await d.query(`UPDATE payout_batches SET paypal_batch_id = $1, status = $2, updated_at = now() WHERE sender_batch_id = $3`, [
      res.batch_header.payout_batch_id,
      res.batch_header.batch_status,
      senderBatchId,
    ]);
    await d.query(`UPDATE payout_items SET status = 'PENDING', updated_at = now() WHERE sender_batch_id = $1`, [senderBatchId]);
    return { senderBatchId, paypalBatchId: res.batch_header.payout_batch_id, items: items.length, message: `Sent ${items.length} payouts to PayPal.` };
  } catch (e) {
    await d.tx(async (q) => {
      await q(`UPDATE payout_batches SET status = 'REJECTED', updated_at = now() WHERE sender_batch_id = $1`, [senderBatchId]);
      for (const i of items) await reverseItem(q, i.senderItemId, "REJECTED");
    });
    throw e;
  }
}

/** Put a failed payout's money back on the creator's balance, once. */
async function reverseItem(q: Query, senderItemId: string, status: string) {
  const rows = await q<{ creator_id: string; amount_cents: string }>(
    `UPDATE payout_items SET status = $2, updated_at = now() WHERE sender_item_id = $1 RETURNING creator_id, amount_cents::text`,
    [senderItemId, status],
  );
  if (!rows[0]) return;
  const already = await q(`SELECT 1 FROM ledger WHERE payout_item_id = $1 AND kind = 'payout_reversal'`, [senderItemId]);
  if (already.length) return;
  await q(`INSERT INTO ledger (creator_id, kind, amount_micro, payout_item_id, note) VALUES ($1,'payout_reversal',$2,$3,$4)`, [
    rows[0].creator_id,
    (BigInt(rows[0].amount_cents) * MICRO_PER_CENT).toString(),
    senderItemId,
    `Payout ${status.toLowerCase()}: returned to balance`,
  ]);
}

/** Apply one payout item status from PayPal (webhook or polling). */
export async function applyItemStatus(d: Db, senderItemId: string, payoutItemId: string | null, status: string) {
  await d.tx(async (q) => {
    if (payoutItemId) await q(`UPDATE payout_items SET paypal_item_id = $2 WHERE sender_item_id = $1`, [senderItemId, payoutItemId]);
    if (REVERSE_ON.has(status)) return reverseItem(q, senderItemId, status);
    await q(`UPDATE payout_items SET status = $2, updated_at = now() WHERE sender_item_id = $1 AND status <> $2`, [senderItemId, status]);
  });
}

/** Poll PayPal for open batches (backup for webhooks). */
export async function syncPayouts(d: Db) {
  const open = await d.query<{ paypal_batch_id: string }>(
    `SELECT paypal_batch_id FROM payout_batches WHERE paypal_batch_id IS NOT NULL AND status NOT IN ('SUCCESS','DENIED') AND created_at > now() - interval '30 days'`,
  );
  for (const b of open) {
    const det = await PP.getPayoutBatch(b.paypal_batch_id);
    for (const it of det.items ?? []) {
      await applyItemStatus(d, it.payout_item.sender_item_id, it.payout_item_id, it.transaction_status);
      if (it.transaction_id) await d.query(`UPDATE payout_items SET paypal_txn_id = $1 WHERE sender_item_id = $2`, [it.transaction_id, it.payout_item.sender_item_id]);
    }
    await d.query(`UPDATE payout_batches SET status = $1, updated_at = now() WHERE paypal_batch_id = $2`, [det.batch_header.batch_status, b.paypal_batch_id]);
  }
  return open.length;
}
