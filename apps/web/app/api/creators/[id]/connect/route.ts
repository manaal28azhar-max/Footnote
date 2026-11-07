import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { baseUrl, json } from "@/lib/http";
import { connectUrl, paypalConfigured } from "@/lib/paypal";

export const dynamic = "force-dynamic";

/** Start "Log in with PayPal" so a creator connects a verified PayPal account. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!paypalConfigured()) return json({ error: "paypal_not_configured" }, 503);
  const d = await db();
  const [c] = await d.query("SELECT id FROM creators WHERE id = $1", [id]);
  if (!c) return json({ error: "not_found" }, 404);
  const nonce = randomBytes(16).toString("hex");
  await d.query("INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = $2", [`connect:${nonce}`, id]);
  const res = Response.redirect(connectUrl(`${baseUrl()}/api/paypal/connect/callback`, nonce), 302);
  return res;
}
