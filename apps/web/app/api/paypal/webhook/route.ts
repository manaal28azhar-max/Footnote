import { db } from "@/lib/db";
import { json } from "@/lib/http";
import { verifyWebhook, getOrder } from "@/lib/paypal";
import { applyItemStatus, creditCapture } from "@/lib/money-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PayPalEvent {
  id: string;
  event_type: string;
  resource: Record<string, any>;
}

/** PayPal calls this. Every event is signature-checked with PayPal before we act on it. */
export async function POST(req: Request) {
  const event = (await req.json().catch(() => null)) as PayPalEvent | null;
  if (!event?.id || !event.event_type) return json({ error: "invalid_event" }, 400);
  const d = await db();
  const verified = await verifyWebhook(req.headers, event).catch(() => false);
  const fresh = await d.query(
    "INSERT INTO webhook_events (id, event_type, verified, payload) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING RETURNING id",
    [event.id, event.event_type, verified, JSON.stringify(event)],
  );
  if (!verified) return json({ error: "signature_not_verified" }, 400);
  if (!fresh.length) return json({ ok: true, duplicate: true });

  const r = event.resource;
  if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
    const orderId = r?.supplementary_data?.related_ids?.order_id;
    if (orderId) await creditCapture(d, await getOrder(orderId));
  } else if (event.event_type.startsWith("PAYMENT.PAYOUTS-ITEM.")) {
    const senderItemId = r?.payout_item?.sender_item_id;
    if (senderItemId) await applyItemStatus(d, senderItemId, r.payout_item_id ?? null, String(r.transaction_status || event.event_type.split(".").pop()).toUpperCase());
  } else if (event.event_type.startsWith("PAYMENT.PAYOUTSBATCH.")) {
    const id = r?.batch_header?.payout_batch_id;
    if (id) await d.query("UPDATE payout_batches SET status = $1, updated_at = now() WHERE paypal_batch_id = $2", [r.batch_header.batch_status, id]);
  }
  return json({ ok: true });
}
