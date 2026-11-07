import { db } from "@/lib/db";
import { clientIp, json, rateLimited } from "@/lib/http";
import { sortTerms, validateTerms, Terms } from "@/lib/terms";

export const dynamic = "force-dynamic";

/** Save a creator's licence terms for one article (validated in code). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (rateLimited(`terms:${clientIp(req)}`, 60)) return json({ error: "rate_limited", message: "Too many changes. Try again later." }, 429);
  const body = (await req.json().catch(() => ({}))) as { sourceId?: string; terms?: Terms };
  if (!body.sourceId || !body.terms) return json({ error: "invalid_request", message: "Send sourceId and terms." }, 400);
  const terms = sortTerms(body.terms);
  const problem = validateTerms(terms);
  if (problem) return json({ error: "invalid_terms", message: problem }, 400);
  const d = await db();
  const rows = await d.query("UPDATE sources SET terms = $1 WHERE id = $2 AND creator_id = $3 RETURNING id", [JSON.stringify(terms), body.sourceId, id]);
  if (!rows.length) return json({ error: "not_found", message: "That article doesn't belong to this creator." }, 404);
  return json({ ok: true, terms });
}
