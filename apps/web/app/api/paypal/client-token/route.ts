import { clientToken, paypalConfigured } from "@/lib/paypal";
import { baseUrl, json } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Browser-safe token for the PayPal v6 JavaScript SDK. */
export async function GET() {
  if (!paypalConfigured()) return json({ error: "paypal_not_configured", message: "This deployment has no PayPal credentials yet." }, 503);
  const host = new URL(baseUrl()).host;
  return json({ accessToken: await clientToken([host]), clientId: process.env.PAYPAL_CLIENT_ID });
}
