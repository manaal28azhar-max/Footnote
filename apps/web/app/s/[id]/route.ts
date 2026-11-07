import { db } from "@/lib/db";
import { isAiCrawler } from "@/lib/gate";
import { activeWindow, Terms } from "@/lib/terms";
import { BASE_PRICE_MICRO } from "@/lib/answer";
import { baseUrl } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * A creator's article, served the way a creator's site would serve it with
 * the Footnote gate installed: people read it; AI crawlers get a 402 that
 * explains how to licence it through Footnote.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const d = await db();
  const [s] = await d.query<{ id: string; title: string; body: string; published_at: string; terms: Terms | string; creator_id: string; name: string; site: string; credit_to: string | null }>(
    `SELECT s.id, s.title, s.body, s.published_at, s.terms, s.creator_id, s.credit_to, c.name, c.site FROM sources s JOIN creators c ON c.id = s.creator_id WHERE s.id = $1`,
    [id],
  );
  if (!s) return new Response("Not found", { status: 404 });
  const terms: Terms = typeof s.terms === "string" ? JSON.parse(s.terms) : s.terms;
  const w = activeWindow(terms, new Date(s.published_at));

  if (isAiCrawler(req.headers)) {
    await d.query("UPDATE creators SET gate_hits = gate_hits + 1 WHERE id = $1", [s.creator_id]);
    const body = {
      error: "payment_required",
      message: `${s.name} licenses this content to AI systems through Footnote. Use the Footnote answer API: you pay only for the share of each answer this work shapes, and ${s.name} is paid through PayPal.`,
      creator: s.name,
      license: {
        via: "footnote",
        api: `${baseUrl()}/api/v1/answer`,
        docs: `${baseUrl()}/docs`,
        current_window: w.label,
        price_multiplier: w.multiplier,
        base_price_usd_per_answer: (Number(BASE_PRICE_MICRO) / 1e8).toFixed(4),
      },
    };
    return new Response(JSON.stringify(body, null, 2), {
      status: 402,
      headers: { "content-type": "application/json", link: `<${baseUrl()}/docs>; rel="license"`, "x-footnote-license": "required" },
    });
  }

  const paras = s.body.split(/\n\s*\n/).map((p) => `<p>${esc(p)}</p>`).join("");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="footnote-license" content="${esc(baseUrl())}/docs">
<title>${esc(s.title)} | ${esc(s.site)}</title>
<style>
body{margin:0;background:#fffdf9;color:#222;font:18px/1.7 Georgia,serif}
main{max-width:640px;margin:0 auto;padding:48px 20px}
.site{font:600 14px system-ui,sans-serif;color:#666}
h1{font-size:34px;line-height:1.15;margin:12px 0 6px}
.by{font:14px system-ui,sans-serif;color:#666;margin-bottom:28px}
.gate{font:14px/1.5 system-ui,sans-serif;background:#eef7f2;border:1px solid #cfe7da;border-radius:10px;padding:12px 14px;margin-top:36px}
.copy{font:14px/1.5 system-ui,sans-serif;background:#fdf0ef;border:1px solid #f1cdc9;border-radius:10px;padding:12px 14px;margin-bottom:24px}
a{color:#0e7c5a}
</style></head><body><main>
<div class="site">${esc(s.site)} (a demo creator site)</div>
${s.credit_to ? `<div class="copy">Footnote detected that this page copies an earlier article. AI earnings from it go to the original author.</div>` : ""}
<h1>${esc(s.title)}</h1>
<div class="by">By ${esc(s.name)} · ${new Date(s.published_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</div>
${paras}
<div class="gate">This site uses the Footnote gate. You're reading it for free. AI crawlers get a <b>402 Payment Required</b> and can only use this work through Footnote, which pays ${esc(s.name)} for every answer it shapes. <a href="/">How Footnote works</a></div>
</main></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
