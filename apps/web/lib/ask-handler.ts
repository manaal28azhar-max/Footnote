import { formatDollars } from "@footnote/core";
import { db } from "./db";
import { answer, PaymentRequired } from "./answer";
import { baseUrl, json } from "./http";
import { tryAutoReload } from "./money-ops";

/** Shared by the public API and the demo page. Turns errors into clear HTTP answers. */
export async function handleAsk(appId: string, question: unknown) {
  if (typeof question !== "string" || !question.trim()) return json({ error: "invalid_request", message: "Send a JSON body with a non-empty \"question\"." }, 400);
  const d = await db();
  try {
    try {
      return json(await answer(d, appId, question));
    } catch (e) {
      // Out of balance: try the owner's auto-reload (saved PayPal + weekly limit), then retry once.
      if (!(e instanceof PaymentRequired)) throw e;
      const reload = await tryAutoReload(d, appId).catch((err) => ({ reloaded: false, reason: (err as Error).message }));
      if (!reload.reloaded) throw e;
      return json({ ...(await answer(d, appId, question)), autoReload: reload.reason });
    }
  } catch (e) {
    if (e instanceof PaymentRequired) {
      // Agent-readable: an AI agent can read this, top up through PayPal and retry.
      return json(
        {
          error: "payment_required",
          message: `This answer costs $${formatDollars(e.priceMicro)} and the balance is $${formatDollars(e.balanceMicro)}. Top up with PayPal and retry.`,
          price_usd: formatDollars(e.priceMicro),
          balance_usd: formatDollars(e.balanceMicro),
          top_up: { method: "POST", url: `${baseUrl()}/api/v1/topups`, body: { amount_usd: "10.00" }, console: `${baseUrl()}/console` },
        },
        402,
      );
    }
    const msg = (e as Error).message;
    if (/longer question/.test(msg)) return json({ error: "invalid_request", message: msg }, 400);
    console.error("[footnote] answer failed", e);
    return json({ error: "internal_error", message: "Footnote could not answer this question. Try again in a moment." }, 500);
  }
}
