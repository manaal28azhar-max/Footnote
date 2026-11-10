import { db } from "@/lib/db";
import { latestEval, startEval, EVAL_QUESTIONS } from "@/lib/eval";

export const dynamic = "force-dynamic";

const n = (x: number | null | undefined, unit = "%") => (x == null ? "n/a" : `${x}${unit}`);

export default async function Eval() {
  const d = await db();
  let { result, running } = await latestEval(d);
  if (!result && !running) running = (await startEval(d)) === "started";
  const r = result && !result.error ? result : null;
  return (
    <main className="page">
      {running && !r && <meta httpEquiv="refresh" content="20" />}
      <div className="wrap" style={{ maxWidth: 960 }}>
        <h1 className="display" style={{ fontSize: "var(--s3)", maxWidth: "none" }}>
          Does the attribution hold up?
        </h1>
        <p className="lede">
          Measured with the real models on this site’s articles, not claimed. Each run asks {EVAL_QUESTIONS.length} questions and attacks the pipeline five
          ways.
        </p>

        {!r && (
          <div className="notice">
            {running
              ? "The eval is running now with the real models. It takes about three minutes; this page refreshes itself."
              : result?.error
                ? `The last run failed: ${result.error}`
                : "The eval needs a Claude API key on the server, so it has not run on this deployment."}
          </div>
        )}

        {r && (
          <>
            <div className="stats">
              <div className="stat">
                <b className="money">{n(r.quoteIntegrity.pct)}</b>
                <span>
                  of the auditor’s {r.quoteIntegrity.verdicts} verdicts quoted evidence that is really in the source
                </span>
              </div>
              <div className="stat">
                <b className="money">{n(r.fakeQuotes.pct)}</b>
                <span>of {r.fakeQuotes.planted} planted fake quotes caught and cut by code</span>
              </div>
              <div className="stat">
                <b className="money">{n(r.leaveOneOut.pct)}</b>
                <span>
                  of answers lost support when their most-credited source was removed (on average {Math.round(r.leaveOneOut.meanDrop * 100)} points)
                </span>
              </div>
              <div className="stat">
                <b>{Math.round(r.stability.meanShift * 100)}%</b>
                <span>of credit moves, on average, between two independent audits of the same answer (worst {Math.round(r.stability.maxShift * 100)}%)</span>
              </div>
            </div>

            <section className="block">
              <h2 className="h3">Prompt injection</h2>
              <p className="muted">
                A spam page hides instructions for AI systems:{" "}
                <q>
                  <i>{(r.injection.removed ?? "").replace(/^\[|\]$/g, "")}</i>
                </q>
              </p>
              <table className="table">
                <thead>
                  <tr>
                    <th>Run</th>
                    <th className="num">Spam page’s share of the answer</th>
                    <th>Writer followed the hidden instructions?</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Footnote as deployed (instructions removed at ingestion)</td>
                    <td className="num money">{Math.round(r.injection.guardedShare * 100)}%</td>
                    <td>No: it never saw them</td>
                  </tr>
                  <tr>
                    <td>Guard switched off (models see the hidden instructions)</td>
                    <td className="num">{Math.round(r.injection.unguardedShare * 100)}%</td>
                    <td>{r.injection.writerObeyed ? "Yes" : "No"}</td>
                  </tr>
                </tbody>
              </table>
            </section>

            <section className="block">
              <h2 className="h3">Every question in this run</h2>
              <table className="table">
                <thead>
                  <tr>
                    <th>Question</th>
                    <th className="num">Sources</th>
                    <th className="num">Sourced</th>
                    <th>Most credited</th>
                    <th className="num">Sourced without them</th>
                  </tr>
                </thead>
                <tbody>
                  {r.perQuestion.map((q) => (
                    <tr key={q.question}>
                      <td>{q.question}</td>
                      <td className="num">{q.sources}</td>
                      <td className="num">{Math.round(q.sourced * 100)}%</td>
                      <td>
                        {q.top ?? "nobody"} {q.top && <span className="muted small">({Math.round(q.topShare * 100)}%)</span>}
                      </td>
                      <td className="num">{q.looSourced == null ? "n/a" : `${Math.round(q.looSourced * 100)}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="small muted" style={{ marginTop: 12 }}>
                Run {new Date(r.at).toUTCString()} with {r.models.writer} (writer) and {r.models.auditor} (auditor). “Sourced” is the share of the answer’s words that
                creator content backs, after the quote check.
              </p>
            </section>
          </>
        )}

        <section className="block">
          <h2 className="h3">What each test does</h2>
          <ol className="muted">
            <li>
              <b>Quote integrity.</b> The auditor must quote evidence for every verdict. Code checks each quote word for word against the source.
            </li>
            <li>
              <b>Planted fake quotes.</b> Every “full support” verdict is given an invented quote. The code must catch each one and cut that credit.
            </li>
            <li>
              <b>Leave one out.</b> The most-credited source is removed and the same answer is audited again. If credit tracks real dependence, the answer’s
              support should fall.
            </li>
            <li>
              <b>Stability.</b> The same answer is audited twice, independently. A small shift means payouts don’t depend on luck.
            </li>
            <li>
              <b>Prompt injection.</b> The spam page’s hidden instructions are put back and the pipeline runs again, to see what the guard is protecting
              against.
            </li>
          </ol>
        </section>
      </div>
    </main>
  );
}
