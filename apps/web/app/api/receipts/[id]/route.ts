import { db } from "@/lib/db";
import { json } from "@/lib/http";
import { receiptBundle } from "@/lib/sealing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The receipt, its Merkle inclusion proof and the signed batch: everything needed to verify it offline. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const b = await receiptBundle(await db(), id);
  return b ? json(b) : json({ error: "not_found", message: "No receipt with that ID." }, 404);
}
