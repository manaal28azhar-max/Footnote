"use client";
import { useState } from "react";

const JOBS = [
  { job: "payouts", label: "Run payouts now", help: "Pays every creator over the minimum through PayPal Payouts." },
  { job: "sync", label: "Check payout status", help: "Asks PayPal for the latest status of open payouts." },
  { job: "reconcile", label: "Reconcile with PayPal", help: "Compares our ledger with PayPal’s transaction records." },
  { job: "seal", label: "Seal receipts", help: "Signs all new receipts into a batch." },
] as const;

export function JobButtons({ paypal }: { paypal: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [out, setOut] = useState<string | null>(null);

  async function run(job: string) {
    setBusy(job);
    setOut(null);
    const res = await fetch(`/api/jobs/${job}`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setOut(body.message || "That job failed.");
    if (job === "payouts") setOut(body.message);
    else if (job === "sync") setOut(`Checked ${body.synced} open payout batch(es) with PayPal.`);
    else if (job === "seal") setOut(body.batch ? `Sealed ${body.batch.treeSize} receipts. Root ${String(body.batch.root).slice(0, 16)}…` : "No new receipts to seal.");
    else if (job === "reconcile")
      setOut(
        body.paypal
          ? `Checked ${body.paypal.checked} PayPal transactions: ${body.paypal.matched} matched, ${body.paypal.pending} not in PayPal’s report yet, ${body.paypal.mismatched} mismatched.`
          : "Books balance internally. PayPal isn’t connected, so there’s nothing external to compare.",
      );
    setTimeout(() => location.reload(), 2200);
  }

  return (
    <div>
      <div className="tries" style={{ marginTop: 0 }}>
        {JOBS.map((j) => (
          <button key={j.job} className={j.job === "payouts" ? "btn green" : "btn ghost"} disabled={!!busy || (!paypal && j.job !== "seal" && j.job !== "reconcile")} title={j.help} onClick={() => run(j.job)}>
            {busy === j.job ? "Working…" : j.label}
          </button>
        ))}
      </div>
      {out && (
        <p className="small" role="status">
          {out}
        </p>
      )}
    </div>
  );
}
