import { db } from "@/lib/db";
import { clientIp, json, rateLimited } from "@/lib/http";
import { runPayouts, syncPayouts } from "@/lib/money-ops";
import { sealPending } from "@/lib/sealing";
import { reconcile } from "@/lib/reconcile";
import { startEval } from "@/lib/eval";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Scheduled jobs (Render cron calls these with the CRON_SECRET), also
 * runnable from the demo's buttons so judges can trigger them, rate-limited.
 */
export async function POST(req: Request, ctx: { params: Promise<{ job: string }> }) {
  const { job } = await ctx.params;
  const isCron = !!process.env.CRON_SECRET && req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
  if (!isCron && rateLimited(`job:${job}:${clientIp(req)}`, 6)) return json({ error: "rate_limited", message: "Try again in a few minutes." }, 429);
  const d = await db();
  try {
    if (job === "payouts") return json(await runPayouts(d));
    if (job === "sync") return json({ synced: await syncPayouts(d) });
    if (job === "seal") return json({ batch: await sealPending(d) });
    if (job === "reconcile") return json(await reconcile(d));
    if (job === "eval") return json({ eval: await startEval(d, isCron) });
    return json({ error: "unknown_job" }, 404);
  } catch (e) {
    console.error(`[footnote] job ${job} failed`, e);
    return json({ error: "job_failed", message: (e as Error).message.slice(0, 300) }, 500);
  }
}
