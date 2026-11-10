"use client";
import { useState } from "react";

/** Withdraw unused balance back to PayPal (Payments refund API). */
export function Refund({ refundableCents, paypal }: { refundableCents: number; paypal: boolean }) {
  const max = (refundableCents / 100).toFixed(2);
  const [amount, setAmount] = useState(max);
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setOut(null);
    const res = await fetch("/api/v1/refunds", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ amount_usd: amount }) });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    setOut(body.message || (res.ok ? "Refunded." : "The refund failed."));
    if (res.ok) setTimeout(() => location.reload(), 1800);
  }

  if (!refundableCents) return <p className="muted small">Nothing to refund yet: only money topped up through PayPal can go back to PayPal.</p>;
  return (
    <div>
      <p className="muted small">Up to ${max} of the balance came from PayPal and can go back to the account that paid it.</p>
      <div className="tries" style={{ marginTop: 8, alignItems: "center" }}>
        <input className="input" style={{ width: 110 }} value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount to refund in US dollars" inputMode="decimal" />
        <button className="btn ghost" disabled={busy || !paypal} onClick={go}>
          {busy ? "Refunding…" : "Refund to PayPal"}
        </button>
      </div>
      {out && <p className="small" role="status">{out}</p>}
    </div>
  );
}
