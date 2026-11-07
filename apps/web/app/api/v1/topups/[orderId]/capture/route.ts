import { db } from "@/lib/db";
import { json } from "@/lib/http";
import { finishTopup } from "@/lib/money-ops";
import { PayPalError } from "@/lib/paypal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Capture an approved top-up and credit the balance (idempotent). */
export async function POST(_req: Request, ctx: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await ctx.params;
  const d = await db();
  try {
    const r = await finishTopup(d, orderId);
    const [app] = await d.query<{ balance: string }>("SELECT balance_micro::text AS balance FROM apps WHERE id = $1", [r.appId]);
    return json({ ok: true, credited: r.credited, balanceMicro: app?.balance });
  } catch (e) {
    if (e instanceof PayPalError) return json({ error: "paypal_error", message: "PayPal could not capture this payment.", debugId: e.debugId }, 502);
    return json({ error: "invalid_request", message: (e as Error).message }, 400);
  }
}
