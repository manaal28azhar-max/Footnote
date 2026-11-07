import { db } from "@/lib/db";
import { creatorsOverview } from "@/lib/queries";

export const dynamic = "force-dynamic";
const usd = (m: string, dp = 2) => `$${(Number(m) / 1e8).toFixed(dp)}`;

export default async function Creators() {
  const rows = await creatorsOverview(await db());
  const totalEarned = rows.reduce((a, r) => a + Number(r.earned), 0);
  const blocked = rows.reduce((a, r) => a + r.gate_hits, 0);
  return (
    <main className="page">
      <div className="wrap">
        <h1 className="display" style={{ fontSize: "var(--s3)", maxWidth: "none" }}>
          Creators
        </h1>
        <p className="lede">Everyone whose work AI apps answered with, what it earned them, and how much was paid out through PayPal.</p>
        <div className="stats">
          <div className="stat">
            <b>{usd(String(totalEarned), 4)}</b>
            <span>earned by creators so far</span>
          </div>
          <div className="stat">
            <b>{rows.length - 1}</b>
            <span>creators in {new Set(rows.map((r) => r.country)).size} countries</span>
          </div>
          <div className="stat">
            <b>{blocked}</b>
            <span>AI crawler visits turned away by the gate</span>
          </div>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Creator</th>
              <th>Based in</th>
              <th className="num">Answers</th>
              <th className="num">Earned</th>
              <th className="num">Paid out</th>
              <th className="num">Waiting</th>
              <th>PayPal</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <a href={`/creators/${r.id}`}>
                    <b>{r.name}</b>
                  </a>
                  <div className="small muted">{r.site}</div>
                </td>
                <td>
                  {r.city}, {r.country}
                </td>
                <td className="num">{r.answers}</td>
                <td className="num money">{usd(r.earned, 4)}</td>
                <td className="num">{usd(r.paid)}</td>
                <td className="num">{usd(r.balance, 4)}</td>
                <td>{r.id === "farm" ? <span className="tag copy">copies others</span> : r.connected ? <span className="ok">connected</span> : <span className="muted">not yet</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small muted" style={{ marginTop: 16 }}>
          Some history here is simulated: 160 answers run through the real pipeline in offline mode when the demo was set up. Those answers are labelled
          “simulated” wherever they appear.
        </p>
      </div>
    </main>
  );
}
