import { DEMO_APP_ID } from "@/lib/seed";
import { clientIp, json, rateLimited } from "@/lib/http";
import { handleAsk } from "@/lib/ask-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The public demo page asks as the demo AI app, "Answerly". */
export async function POST(req: Request) {
  if (rateLimited(`demo:${clientIp(req)}`, 40)) return json({ error: "rate_limited", message: "You've asked a lot this hour. Try again later, or use the API with your own key." }, 429);
  const body = await req.json().catch(() => ({}));
  return handleAsk(DEMO_APP_ID, (body as { question?: unknown }).question);
}
