import { db } from "@/lib/db";
import { appFromRequest, baseUrl, clientIp, json, rateLimited } from "@/lib/http";
import { startTopup } from "@/lib/money-ops";
import { paypalConfigured, PayPalError } from "@/lib/paypal";
import { DEMO_APP_ID } from "@/lib/seed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { amount_usd: "10.00", save_for_autoreload?: boolean }
 * With an app key: tops up that app. Without one: tops up the public demo app.
 * Returns { orderId, approveUrl } for the PayPal v6 SDK or a redirect.
 */
export async function POST(req: Request) {
  if (!paypalConfigured()) return json({ error: "paypal_not_configured", message: "This deployment has no PayPal credentials yet." }, 503);
  if (rateLimited(`topup:${clientIp(req)}`, 30)) return json({ error: "rate_limited", message: "Too many top-ups this hour." }, 429);
  const d = await db();
  const app = (await appFromRequest(d, req)) ?? { id: DEMO_APP_ID };
  const body = (await req.json().catch(() => ({}))) as { amount_usd?: string; save_for_autoreload?: boolean };
  try {
    const order = await startTopup(d, app.id, body.amount_usd ?? "10.00", !!body.save_for_autoreload, baseUrl());
    return json({ orderId: order.id, status: order.status, approveUrl: order.links.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href });
  } catch (e) {
    if (e instanceof PayPalError) return json({ error: "paypal_error", message: "PayPal could not create the order.", debugId: e.debugId }, 502);
    return json({ error: "invalid_request", message: (e as Error).message }, 400);
  }
}
