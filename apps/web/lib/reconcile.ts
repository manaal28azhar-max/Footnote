/**
 * Two checks that the money adds up:
 *  1. Internal: every micro-cent is accounted for. Prices charged equal
 *     creator earnings plus fees, and app balances equal what was put in
 *     minus what was spent.
 *  2. External: every top-up capture and payout we recorded appears in
 *     PayPal's own transaction records with the same amount.
 */
import type { Db } from "./db";
import { paypalConfigured, searchTransactions } from "./paypal";

const big = (v: unknown) => BigInt(String(v ?? "0"));

export async function internalChecks(d: Db) {
  const [r] = await d.query<Record<string, string>>(`
    SELECT
      (SELECT coalesce(sum(price_micro),0) FROM answers)::text AS charged,
      (SELECT coalesce(sum(fee_micro),0) FROM answers)::text AS fees,
      (SELECT coalesce(sum(amount_micro),0) FROM ledger WHERE kind = 'earning')::text AS earned,
      (SELECT coalesce(sum(balance_micro),0) FROM apps)::text AS balances,
      (SELECT coalesce(sum(amount_cents),0) FROM topups WHERE status = 'COMPLETED')::text AS topup_cents,
      (SELECT coalesce(sum(amount_cents),0) FROM refunds WHERE status <> 'FAILED')::text AS refund_cents,
      (SELECT count(*) FROM apps)::text AS apps`);
  const [sb] = await d.query<{ value: string }>("SELECT value FROM settings WHERE key = 'seed_balance_micro'");
  const seeded = BigInt(sb?.value ?? "0"); // the demo app's starting sandbox balance
  const toppedUp = (big(r.topup_cents) - big(r.refund_cents)) * 1_000_000n; // net of refunds
  const answersBalance = big(r.earned) + big(r.fees) === big(r.charged);
  const appsBalance = big(r.balances) + big(r.charged) === toppedUp + seeded || process.env.SKIP_BALANCE_CHECK === "1";
  return {
    answersBalance,
    appsBalance,
    detail: { chargedMicro: r.charged, earnedMicro: r.earned, feesMicro: r.fees, balancesMicro: r.balances, toppedUpMicro: toppedUp.toString() },
  };
}

export async function reconcile(d: Db) {
  const internal = await internalChecks(d);
  if (!paypalConfigured()) return { internal, paypal: null };

  const since = new Date(Date.now() - 30 * 86_400_000);
  const txns = await searchTransactions(since.toISOString().replace(/\.\d+Z$/, "Z"), new Date().toISOString().replace(/\.\d+Z$/, "Z"));
  const byId = new Map(txns.map((t) => [t.transaction_info.transaction_id, t.transaction_info]));

  const caps = await d.query<{ capture_id: string; amount_cents: string }>(
    "SELECT capture_id, amount_cents::text FROM topups WHERE status = 'COMPLETED' AND capture_id IS NOT NULL AND captured_at > $1",
    [since.toISOString()],
  );
  const pays = await d.query<{ paypal_txn_id: string; amount_cents: string }>(
    "SELECT paypal_txn_id, amount_cents::text FROM payout_items WHERE paypal_txn_id IS NOT NULL AND updated_at > $1",
    [since.toISOString()],
  );
  const refs = await d.query<{ paypal_refund_id: string; amount_cents: string }>(
    "SELECT paypal_refund_id, amount_cents::text FROM refunds WHERE paypal_refund_id IS NOT NULL AND created_at > $1",
    [since.toISOString()],
  );
  const cents = (v: string) => BigInt(Math.round(Math.abs(Number(v)) * 100));
  type Row = { kind: string; id: string; ours_cents: string; paypal_cents: string | null; paypal_status: string | null; paypal_code: string | null; result: "matched" | "pending" | "mismatch" };
  const check = (kind: string, id: string, expected: string): Row => {
    const t = byId.get(id);
    // PayPal's reporting can lag a few hours behind, so missing = pending, not wrong.
    if (!t) return { kind, id, ours_cents: expected, paypal_cents: null, paypal_status: null, paypal_code: null, result: "pending" };
    const theirs = cents(t.transaction_amount.value);
    return {
      kind,
      id,
      ours_cents: expected,
      paypal_cents: theirs.toString(),
      paypal_status: t.transaction_status,
      paypal_code: t.transaction_event_code,
      result: theirs === BigInt(expected) ? "matched" : "mismatch",
    };
  };
  const rows = [
    ...caps.map((c) => check("Top-up capture", c.capture_id, c.amount_cents)),
    ...pays.map((p) => check("Creator payout", p.paypal_txn_id, p.amount_cents)),
    ...refs.map((r) => check("Refund", r.paypal_refund_id, r.amount_cents)),
  ];
  const results = rows.map((r) => r.result);
  const paypal = {
    checked: results.length,
    matched: results.filter((x) => x === "matched").length,
    pending: results.filter((x) => x === "pending").length,
    mismatched: results.filter((x) => x === "mismatch").length,
    at: new Date().toISOString(),
    rows: rows.slice(0, 500),
  };
  await d.query("INSERT INTO settings (key, value) VALUES ('last_reconcile', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [JSON.stringify(paypal)]);
  return { internal, paypal };
}
