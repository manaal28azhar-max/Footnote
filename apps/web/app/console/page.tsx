import { db } from "@/lib/db";
import { appDetail } from "@/lib/queries";
import { DEMO_APP_ID, DEMO_APP_KEY } from "@/lib/seed";
import { TopUp } from "@/components/TopUp";
import { Refund } from "@/components/Refund";
import { paypalConfigured } from "@/lib/paypal";
import { AnswersGrid, TopupsGrid } from "@/components/Grids";
import { baseUrl } from "@/lib/http";

export const dynamic = "force-dynamic";

export default async function Console({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const d = await db();
  const { app, answers, topups } = await appDetail(d, DEMO_APP_ID);
  const [{ left }] = await d.query<{ left: string }>(
    "SELECT coalesce(sum(amount_cents - refunded_cents), 0)::text AS left FROM topups WHERE app_id = $1 AND status = 'COMPLETED' AND capture_id IS NOT NULL AND captured_at > now() - interval '180 days'",
    [DEMO_APP_ID],
  );
  const refundableCents = Math.min(Number(left), Math.floor(Number(app.balance) / 1e6));
  const spent = answers.reduce((a, r) => a + Number(r.price), 0);
  return (
    <main className="page">
      <div className="wrap">
        <h1 className="display" style={{ fontSize: "var(--s3)", maxWidth: "none" }}>
          {app.name}
        </h1>
        <p className="lede">The console an AI company uses: fund the balance that pays creators, see what every answer cost, and let agents reload themselves within a limit.</p>
        {sp.paid && <div className="notice ok-notice">Payment received. Your balance updates as soon as PayPal confirms the capture.</div>}

        <div className="stats">
          <div className="stat">
            <b className="money">${(Number(app.balance) / 1e8).toFixed(2)}</b>
            <span>balance for paying creators</span>
          </div>
          <div className="stat">
            <b>{answers.length}</b>
            <span>answers served</span>
          </div>
          <div className="stat">
            <b>${(spent / 1e8).toFixed(4)}</b>
            <span>paid for those answers</span>
          </div>
          <div className="stat">
            <b>{answers.length ? `$${(spent / answers.length / 1e8).toFixed(4)}` : "n/a"}</b>
            <span>average per answer</span>
          </div>
        </div>

        <div className="split">
          <section className="panel">
            <h2 className="h3">Top up with PayPal</h2>
            <p className="muted small">Sandbox only. Log in with a PayPal sandbox personal account to pay with test money.</p>
            <TopUp hasVault={!!app.vault_id} />
            <h3 className="small" style={{ margin: "22px 0 4px" }}>
              Withdraw unused balance
            </h3>
            <Refund refundableCents={refundableCents} paypal={paypalConfigured()} />
          </section>
          <section className="panel">
            <h2 className="h3">Agent auto-reload</h2>
            {app.vault_id ? (
              <p className="muted">
                PayPal account saved{app.vault_payer ? ` (${app.vault_payer})` : ""}. When an answer would overdraw the balance, Footnote charges it{" "}
                <b>${(Number(app.reload_cents) / 100).toFixed(2)}</b>, at most <b>${(Number(app.cap) / 100).toFixed(2)} a week</b>. The limit is enforced in
                code; no model can raise it.
              </p>
            ) : (
              <p className="muted">
                Not set up. Tick “Save this PayPal account” on a top-up, and agents using this app can reload themselves up to $
                {(Number(app.cap) / 100).toFixed(2)} a week without a person stepping in.
              </p>
            )}
            <h3 className="small" style={{ margin: "18px 0 6px" }}>
              What an agent sees when the balance runs out
            </h3>
            <pre className="code">{`HTTP/1.1 402 Payment Required
{
  "error": "payment_required",
  "price_usd": "0.005",
  "top_up": { "method": "POST", "url": "${baseUrl()}/api/v1/topups" }
}`}</pre>
          </section>
        </div>

        <section className="block">
          <h2 className="h3">API key</h2>
          <p className="muted">This is the public demo app’s key, so anyone can try the API. A real app gets a secret key.</p>
          <pre className="code">{`curl -X POST ${baseUrl()}/api/v1/answer \\
  -H "Authorization: Bearer ${DEMO_APP_KEY}" \\
  -H "Content-Type: application/json" \\
  -d '{"question":"Why does my espresso taste sour?"}'`}</pre>
        </section>

        <section className="block">
          <h2 className="h3">PayPal top-ups</h2>
          {topups.length ? <TopupsGrid rows={topups} /> : <p className="muted">No top-ups yet. The demo app started with a $20.00 sandbox balance.</p>}
        </section>

        <section className="block">
          <h2 className="h3">Every answer and what it cost</h2>
          <AnswersGrid rows={answers} />
        </section>
      </div>
    </main>
  );
}
