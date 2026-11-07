import { db } from "@/lib/db";
import { appFromRequest, json, rateLimited } from "@/lib/http";
import { handleAsk } from "@/lib/ask-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/answer  { "question": "..." }  with  Authorization: Bearer <app key> */
export async function POST(req: Request) {
  const app = await appFromRequest(await db(), req);
  if (!app) return json({ error: "unauthorized", message: "Send your Footnote app key as: Authorization: Bearer fn_..." }, 401);
  if (rateLimited(`app:${app.id}`, 600)) return json({ error: "rate_limited", message: "Too many requests. Try again in a few minutes." }, 429);
  const body = await req.json().catch(() => ({}));
  return handleAsk(app.id, (body as { question?: unknown }).question);
}
