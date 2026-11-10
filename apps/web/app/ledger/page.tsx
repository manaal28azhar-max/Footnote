import { db } from "@/lib/db";
import { ledgerRows, payoutBatches } from "@/lib/queries";
import { internalChecks } from "@/lib/reconcile";
import { paypalConfigured } from "@/lib/paypal";
import { LedgerGrid, ReconcileGrid } from "@/components/Grids";
import { JobButtons } from "@/components/JobButtons";

export const dynamic = "force-dynamic";
const usd = (m: string, dp = 4) => `$${(Number(m) / 1e8).toFixed(dp)}`;

export default async function Ledger() {
  const d = await db();
  const [rows, batches, checks] = await Promise.all([ledgerRows(d), payoutBatches(d), internalChecks(d)]);
  const [last] = await d.query<{ value: string }>("SELECT value FROM settings WHERE key = 'last_reconcile'");
  const recon = last ? (JSON.parse(last.value) as { checked: number; matched: number; pending: number; mismatched: number; at: string; rows?: Record<string, unknown>[] }) : null;
  const paypal = paypalConfigured();

  return (
    <main className="page">
      <div className="wrap">
        <h1 className="display" style={{ fontSize: "var(--s3)", maxWidth: "none" }}>
          Ledger
        </h1>
        <p className="lede">Every micro-cent Footnote has moved: what AI apps paid, what each creator earned, and what PayPal paid out.</p>

        <div className="split block" style={{ marginTop: 28 }}>
          <section className="panel">
            <h2 className="h3">Do the books balance?</h2>
            <div className="checks" style={{ marginTop: 12 }}>
              <div className="check">
                <b className={checks.answersBalance ? "ok" : "s-failed"}>{checks.answersBalance ? "Yes" : "No"}</b>
                <span>
                  AI apps paid {usd(checks.detail.chargedMicro)}. Creators earned {usd(checks.detail.earnedMicro)} and Footnote’s fee was{" "}
                  {usd(checks.detail.feesMicro)}, which adds up exactly.
                </span>
              </div>
              <div className="check">
                <b className={checks.appsBalance ? "ok" : "s-failed"}>{checks.appsBalance ? "Yes" : "No"}</b>
                <span>App balances plus what they spent equal what was put in through PayPal (plus the demo’s starting balance).</span>
              </div>
              <div className="check">
                <b className={!recon ? "muted" : recon.mismatched ? "s-failed" : "ok"}>{!recon ? "n/a" : recon.mismatched ? "No" : "Yes"}</b>
                <span>
                  {recon
                    ? `Matches PayPal: ${recon.matched} of ${recon.checked} transactions found in PayPal’s records with the same amount${recon.pending ? `, ${recon.pending} not in PayPal’s report yet (it can lag a few hours)` : ""}. Checked ${new Date(recon.at).toLocaleString("en-GB")}.`
                    : "Not yet compared with PayPal’s transaction records."}
                </span>
              </div>
            </div>
          </section>
          <section className="panel">
            <h2 className="h3">Run the nightly jobs now</h2>
            <p className="muted small">These run on a schedule on Render. You can trigger them here to see each step happen.</p>
            <JobButtons paypal={paypal} />
            {!paypal && <p className="small muted">PayPal isn’t connected on this deployment, so payouts are switched off.</p>}
          </section>
        </div>

        {batches.length > 0 && (
          <section className="block">
            <h2 className="h3">PayPal payout batches</h2>
            <table className="table" style={{ marginTop: 12 }}>
              <thead>
                <tr>
                  <th>Sent</th>
                  <th>Our batch ID</th>
                  <th>PayPal batch ID</th>
                  <th className="num">Creators</th>
                  <th className="num">Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={String(b.sender_batch_id)}>
                    <td>{new Date(String(b.created_at)).toLocaleString("en-GB")}</td>
                    <td>{String(b.sender_batch_id)}</td>
                    <td>{String(b.paypal_batch_id ?? "")}</td>
                    <td className="num">{String(b.item_count)}</td>
                    <td className="num">${(Number(b.cents) / 100).toFixed(2)}</td>
                    <td className={`status s-${String(b.status).toLowerCase()}`}>{String(b.status).toLowerCase()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {recon?.rows?.length ? (
          <section className="block">
            <h2 className="h3">Our books next to PayPal’s</h2>
            <p className="muted">
              Every capture, payout and refund in Footnote’s ledger, looked up in PayPal’s own records with Transaction Search. A mismatch is highlighted red; a
              transaction PayPal hasn’t reported yet is yellow.
            </p>
            <ReconcileGrid rows={recon.rows} />
          </section>
        ) : null}

        <section className="block">
          <h2 className="h3">All entries</h2>
          <LedgerGrid rows={rows} />
        </section>
      </div>
    </main>
  );
}
