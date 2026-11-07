import { db } from "@/lib/db";
import { baseUrl } from "@/lib/http";
import { exchangeConnectCode } from "@/lib/paypal";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") || "";
  const d = await db();
  const [s] = await d.query<{ value: string }>("DELETE FROM settings WHERE key = $1 RETURNING value", [`connect:${state}`]);
  if (!code || !s) return Response.redirect(`${baseUrl()}/creators?connect=failed`, 302);
  try {
    const who = await exchangeConnectCode(code);
    await d.query("UPDATE creators SET paypal_payer_id = $1, paypal_email = coalesce($2, paypal_email) WHERE id = $3", [who.payerId, who.email, s.value]);
    return Response.redirect(`${baseUrl()}/creators/${s.value}?connected=1`, 302);
  } catch (e) {
    console.error("[footnote] PayPal connect failed", e);
    return Response.redirect(`${baseUrl()}/creators/${s.value}?connect=failed`, 302);
  }
}
