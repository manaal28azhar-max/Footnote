/**
 * Money tests run against a fake PayPal (fetch is stubbed) so they are
 * deterministic and need no credentials. The live sandbox is exercised
 * separately by scripts/sandbox-smoke.ts on the deployed app.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { freshDb, Db } from "../lib/db";
import { answer } from "../lib/answer";
import { creditCapture, runPayouts, applyItemStatus, balances, tryAutoReload } from "../lib/money-ops";
import { sealPending, receiptBundle } from "../lib/sealing";
import { internalChecks } from "../lib/reconcile";
import { DEMO_APP_ID } from "../lib/seed";
import type { CapturedOrder } from "../lib/paypal";

let d: Db;
const calls: { url: string; body: any }[] = [];

function fakePayPal() {
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const body = init?.body && typeof init.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : init?.body;
    calls.push({ url, body });
    const ok = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
    if (url.endsWith("/v1/oauth2/token")) return ok({ access_token: "tok", expires_in: 3600 });
    if (url.endsWith("/v1/payments/payouts")) return ok({ batch_header: { payout_batch_id: "PB-" + body.sender_batch_header.sender_batch_id, batch_status: "PENDING" } }, 201);
    if (url.endsWith("/v2/checkout/orders") && body?.payment_source?.paypal?.vault_id)
      return ok(captured("AUTO-" + calls.length, body.purchase_units[0].custom_id, body.purchase_units[0].amount.value), 201);
    return ok({}, 404);
  });
}

function captured(orderId: string, appId: string, value: string, vaultId?: string): CapturedOrder {
  return {
    id: orderId,
    status: "COMPLETED",
    payment_source: vaultId ? { paypal: { email_address: "buyer@example.com", attributes: { vault: { id: vaultId, status: "VAULTED" } } } } : undefined,
    purchase_units: [{ reference_id: appId, payments: { captures: [{ id: "CAP-" + orderId, status: "COMPLETED", custom_id: appId, amount: { currency_code: "USD", value } }] } }],
  };
}

beforeAll(async () => {
  delete process.env.ANTHROPIC_API_KEY;
  process.env.PAYPAL_CLIENT_ID = "test";
  process.env.PAYPAL_CLIENT_SECRET = "test";
  process.env.SIMULATE_HISTORY = "0";
  d = await freshDb();
  await d.query("UPDATE creators SET paypal_email = id || '@sandbox.example' WHERE id <> 'farm'");
});
beforeEach(() => {
  calls.length = 0;
  fakePayPal();
});

describe("top-ups", () => {
  it("credits a capture exactly once, even if the webhook repeats it", async () => {
    const before = BigInt((await d.query<{ b: string }>("SELECT balance_micro::text AS b FROM apps WHERE id = $1", [DEMO_APP_ID]))[0].b);
    const order = captured("ORDER-1", DEMO_APP_ID, "10.00", "VAULT-1");
    expect((await creditCapture(d, order)).credited).toBe(true);
    expect((await creditCapture(d, order)).credited).toBe(false);
    const [row] = await d.query<{ b: string; vault_id: string }>("SELECT balance_micro::text AS b, vault_id FROM apps WHERE id = $1", [DEMO_APP_ID]);
    expect(BigInt(row.b) - before).toBe(1_000_000_000n); // $10.00 in micro-cents
    expect(row.vault_id).toBe("VAULT-1");
  });

  it("auto-reloads from the saved wallet, but never past the weekly limit", async () => {
    // Default: $10 per reload, $30 per week.
    for (let i = 0; i < 3; i++) expect((await tryAutoReload(d, DEMO_APP_ID)).reloaded).toBe(true);
    const fourth = await tryAutoReload(d, DEMO_APP_ID);
    expect(fourth.reloaded).toBe(false);
    expect(fourth.reason).toMatch(/limit/);
  });
});

describe("payouts", () => {
  it("pays creators who reached the minimum, debiting the ledger first", async () => {
    for (let i = 0; i < 30; i++) await answer(d, DEMO_APP_ID, i % 2 ? "Why is my sourdough flat and dense?" : "Is the Halifax bike lane network open yet?");
    const r = await runPayouts(d);
    expect(r.items).toBeGreaterThan(0);
    const sent = calls.find((c) => c.url.endsWith("/v1/payments/payouts"))!.body;
    expect(sent.items.every((i: any) => /^\d+\.\d{2}$/.test(i.amount.value))).toBe(true);
    expect(sent.items.map((i: any) => i.receiver)).not.toContain("farm@sandbox.example");
    // After paying, nobody is left with a full dollar unpaid.
    for (const b of await balances(d.query)) expect(BigInt(b.balance) < 100_000_000n || !b.paypal_email).toBe(true);
  });

  it("returns a bounced payout to the creator's balance, once", async () => {
    const [item] = await d.query<{ sender_item_id: string; creator_id: string; amount_cents: string }>("SELECT sender_item_id, creator_id, amount_cents::text FROM payout_items LIMIT 1");
    const bal = async () => BigInt((await balances(d.query)).find((b) => b.creator_id === item.creator_id)!.balance);
    const before = await bal();
    await applyItemStatus(d, item.sender_item_id, "ITEM-1", "RETURNED");
    await applyItemStatus(d, item.sender_item_id, "ITEM-1", "RETURNED");
    expect((await bal()) - before).toBe(BigInt(item.amount_cents) * 1_000_000n);
  });
});

describe("receipts and books", () => {
  it("seals receipts and every one verifies", async () => {
    const batch = await sealPending(d);
    expect(batch?.treeSize).toBeGreaterThan(10);
    const ids = await d.query<{ id: string }>("SELECT id FROM receipts ORDER BY random() LIMIT 5");
    for (const { id } of ids) expect((await receiptBundle(d, id))!.check.ok).toBe(true);
  });

  it("the books balance to the micro-cent", async () => {
    const c = await internalChecks(d);
    expect(c.answersBalance).toBe(true);
    expect(c.appsBalance).toBe(true);
  });
});
