/**
 * PayPal REST client (sandbox by default). Used for:
 *  - Orders v2: AI apps top up their Footnote balance (and can save PayPal
 *    in the Vault so an agent can reload itself within a spending limit).
 *  - Payouts: creators are paid in batches.
 *  - Log in with PayPal: creators connect a verified PayPal account, and are
 *    paid by PayPal account ID rather than a typed email.
 *  - Webhooks: signature verification for every event we act on.
 *  - Transaction Search: nightly reconciliation of our ledger against PayPal.
 */
import { randomUUID } from "node:crypto";

export const PAYPAL_API = process.env.PAYPAL_API_BASE || "https://api-m.sandbox.paypal.com";
export const PAYPAL_WEB = process.env.PAYPAL_WEB_BASE || "https://www.sandbox.paypal.com";

export const paypalConfigured = () => !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);

export class PayPalError extends Error {
  constructor(
    public status: number,
    public body: unknown,
    public debugId?: string,
  ) {
    super(`PayPal API error ${status}${debugId ? ` (debug id ${debugId})` : ""}: ${JSON.stringify(body).slice(0, 400)}`);
  }
}

const basic = () => "Basic " + Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");

let cached: { token: string; until: number } | null = null;

async function accessToken(): Promise<string> {
  if (cached && cached.until > Date.now() + 60_000) return cached.token;
  const res = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: "POST",
    headers: { authorization: basic(), "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const body = await res.json();
  if (!res.ok) throw new PayPalError(res.status, body, res.headers.get("paypal-debug-id") ?? undefined);
  cached = { token: body.access_token, until: Date.now() + body.expires_in * 1000 };
  return cached.token;
}

/** Browser-safe client token for the v6 JavaScript SDK (valid ~15 minutes). */
export async function clientToken(domains: string[]): Promise<string> {
  const form = new URLSearchParams({ grant_type: "client_credentials", response_type: "client_token" });
  if (domains.length) form.append("domains[]", domains.join(","));
  const res = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: "POST",
    headers: { authorization: basic(), "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const body = await res.json();
  if (!res.ok) throw new PayPalError(res.status, body, res.headers.get("paypal-debug-id") ?? undefined);
  return body.access_token;
}

/** Authenticated call with an idempotency key on every write. */
export async function pp<T = any>(method: string, path: string, body?: unknown, opts: { requestId?: string; prefer?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" };
  if (method !== "GET") headers["paypal-request-id"] = opts.requestId ?? randomUUID();
  if (opts.prefer) headers.prefer = opts.prefer;
  const res = await fetch(`${PAYPAL_API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new PayPalError(res.status, json, res.headers.get("paypal-debug-id") ?? undefined);
  return json as T;
}

// ---------- Orders v2: top-ups ----------

export interface TopupOrderOptions {
  appId: string;
  amountValue: string; // "10.00"
  vault?: boolean; // save the PayPal wallet so the app can auto-reload later
  returnUrl: string;
  cancelUrl: string;
}

export function createTopupOrder(o: TopupOrderOptions) {
  return pp<{ id: string; status: string; links: { rel: string; href: string }[] }>(
    "POST",
    "/v2/checkout/orders",
    {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: o.appId,
          custom_id: o.appId,
          description: "Footnote balance top-up (pays creators per AI answer)",
          amount: { currency_code: "USD", value: o.amountValue },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: "Footnote",
            shipping_preference: "NO_SHIPPING",
            user_action: "PAY_NOW",
            return_url: o.returnUrl,
            cancel_url: o.cancelUrl,
          },
          ...(o.vault ? { attributes: { vault: { store_in_vault: "ON_SUCCESS", usage_type: "MERCHANT", customer_type: "CONSUMER" } } } : {}),
        },
      },
    },
    { requestId: `topup-${o.appId}-${randomUUID()}` },
  );
}

export interface CapturedOrder {
  id: string;
  status: string;
  payment_source?: { paypal?: { email_address?: string; account_id?: string; attributes?: { vault?: { id?: string; status?: string; customer?: { id?: string } } } } };
  purchase_units: {
    reference_id?: string;
    custom_id?: string;
    payments?: { captures?: { id: string; status: string; custom_id?: string; amount: { currency_code: string; value: string } }[] };
  }[];
}

export const captureOrder = (orderId: string) => pp<CapturedOrder>("POST", `/v2/checkout/orders/${orderId}/capture`, {}, { requestId: `capture-${orderId}` });
export const getOrder = (orderId: string) => pp<CapturedOrder & { purchase_units: { amount: { value: string; currency_code: string }; custom_id?: string }[] }>("GET", `/v2/checkout/orders/${orderId}`);

/** Charge a saved PayPal wallet with no buyer present (agent auto-reload). */
export function chargeVaulted(appId: string, vaultId: string, amountValue: string, requestId: string) {
  return pp<CapturedOrder>(
    "POST",
    "/v2/checkout/orders",
    {
      intent: "CAPTURE",
      purchase_units: [{ reference_id: appId, custom_id: appId, description: "Footnote auto-reload", amount: { currency_code: "USD", value: amountValue } }],
      payment_source: { paypal: { vault_id: vaultId } },
    },
    { requestId },
  );
}

// ---------- Payouts ----------

export interface PayoutItemInput {
  senderItemId: string;
  receiverType: "EMAIL" | "PAYPAL_ID";
  receiver: string;
  value: string;
  note: string;
}

export function createPayoutBatch(senderBatchId: string, items: PayoutItemInput[]) {
  return pp<{ batch_header: { payout_batch_id: string; batch_status: string } }>(
    "POST",
    "/v1/payments/payouts",
    {
      sender_batch_header: {
        sender_batch_id: senderBatchId,
        email_subject: "You earned money from AI answers",
        email_message: "AI apps used your work to answer questions. Your share, measured answer by answer, is attached. Check any receipt at Footnote.",
      },
      items: items.map((i) => ({
        recipient_type: i.receiverType,
        receiver: i.receiver,
        amount: { currency: "USD", value: i.value },
        sender_item_id: i.senderItemId,
        note: i.note,
        purpose: "SERVICES",
      })),
    },
    { requestId: senderBatchId },
  );
}

export interface PayoutBatchDetails {
  batch_header: { payout_batch_id: string; batch_status: string; sender_batch_header: { sender_batch_id: string } };
  items: { payout_item_id: string; transaction_id?: string; transaction_status: string; payout_item: { sender_item_id: string; receiver: string; amount: { value: string } } }[];
}
export const getPayoutBatch = (batchId: string) => pp<PayoutBatchDetails>("GET", `/v1/payments/payouts/${batchId}?page_size=1000`);

// ---------- Log in with PayPal (creators connect their account) ----------

export function connectUrl(redirectUri: string, state: string) {
  const p = new URLSearchParams({
    flowEntry: "static",
    client_id: process.env.PAYPAL_CLIENT_ID || "",
    response_type: "code",
    scope: "openid email https://uri.paypal.com/services/paypalattributes",
    redirect_uri: redirectUri,
    state,
  });
  return `${PAYPAL_WEB}/connect?${p}`;
}

export async function exchangeConnectCode(code: string) {
  const res = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: "POST",
    headers: { authorization: basic(), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code }).toString(),
  });
  const body = await res.json();
  if (!res.ok) throw new PayPalError(res.status, body);
  const info = await fetch(`${PAYPAL_API}/v1/identity/oauth2/userinfo?schema=paypalv1.1`, { headers: { authorization: `Bearer ${body.access_token}` } });
  const user = await info.json();
  if (!info.ok) throw new PayPalError(info.status, user);
  const email = (user.emails as { value: string; primary?: boolean }[] | undefined)?.find((e) => e.primary)?.value ?? user.emails?.[0]?.value ?? null;
  return { payerId: (user.payer_id as string) ?? null, email: email as string | null, verified: user.verified_account === true || user.verified_account === "true" };
}

// ---------- Webhooks ----------

export async function verifyWebhook(headers: Headers, event: unknown): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return false;
  const h = (k: string) => headers.get(k) || "";
  const out = await pp<{ verification_status: string }>("POST", "/v1/notifications/verify-webhook-signature", {
    auth_algo: h("paypal-auth-algo"),
    cert_url: h("paypal-cert-url"),
    transmission_id: h("paypal-transmission-id"),
    transmission_sig: h("paypal-transmission-sig"),
    transmission_time: h("paypal-transmission-time"),
    webhook_id: webhookId,
    webhook_event: event,
  });
  return out.verification_status === "SUCCESS";
}

// ---------- Transaction Search (reconciliation) ----------

export interface PayPalTxn {
  transaction_info: { transaction_id: string; transaction_event_code: string; transaction_amount: { value: string; currency_code: string }; transaction_status: string; custom_field?: string; transaction_initiation_date: string };
}

export async function searchTransactions(startIso: string, endIso: string): Promise<PayPalTxn[]> {
  const out: PayPalTxn[] = [];
  for (let page = 1; page <= 20; page++) {
    const p = new URLSearchParams({ start_date: startIso, end_date: endIso, fields: "transaction_info", page_size: "500", page: String(page) });
    const r = await pp<{ transaction_details: PayPalTxn[]; total_pages: number }>("GET", `/v1/reporting/transactions?${p}`);
    out.push(...(r.transaction_details ?? []));
    if (page >= (r.total_pages ?? 1)) break;
  }
  return out;
}
