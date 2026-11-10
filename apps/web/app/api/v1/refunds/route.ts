import { db } from "@/lib/db";
import { appFromRequest, clientIp, json, rateLimited } from "@/lib/http";
import { refundBalance } from "@/lib/money-ops";
import { paypalConfigured } from "@/lib/paypal";
import { DEMO_APP_ID } from "@/lib/seed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { amount_usd: "3.00" }
 * Refunds unused balance to the PayPal account(s) that paid it, newest
 * top-up first, through the PayPal Payments refund API.
 */
export async function POST(req: Request) {
  if (!paypalConfigured()) return json({ error: "paypal_not_configured", message: "This deployment has no PayPal credentials yet." }, 503);
  if (rateLimited(`refund:${clientIp(req)}`, 20)) return json({ error: "rate_limited", message: "Too many refunds this hour." }, 429);
  const d = await db();
  const app = (await appFromRequest(d, req)) ?? { id: DEMO_APP_ID };
  const body = (await req.json().catch(() => ({}))) as { amount_usd?: string };
  try {
    const out = await refundBalance(d, app.id, String(body.amount_usd ?? ""));
    const failed = out.refunds.filter((r) => r.status === "FAILED").length;
    return json({ ...out, message: failed ? `PayPal refused ${failed} refund(s); that money is back on the balance.` : `Refunded to PayPal.` }, failed ? 502 : 200);
  } catch (e) {
    return json({ error: "invalid_request", message: (e as Error).message }, 400);
  }
}
