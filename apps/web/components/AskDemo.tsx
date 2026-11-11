"use client";
import { useEffect, useMemo, useState } from "react";
import type { AnswerResult } from "@/lib/answer";

const INKS = ["var(--hl-0)", "var(--hl-1)", "var(--hl-2)", "var(--hl-3)", "var(--hl-4)"];
const EXAMPLES = [
  "Why is my sourdough flat and dense?",
  "My monstera's leaves are turning yellow. What am I doing wrong?",
  "Why does my espresso taste sour?",
  "Is Halifax's protected bike lane network open yet?",
  "How often should I clean and lube my bike chain?",
];

export const usd = (micro: string | number, dp = 4) => `$${(Number(micro) / 1e8).toFixed(dp)}`;

interface Note {
  num: number;
  creatorId: string;
  name: string;
  place: string;
  share: number;
  amountMicro: string;
  multiplier: number;
  color: string;
  sources: AnswerResult["sources"];
}

function buildNotes(r: AnswerResult): { notes: Note[]; unused: AnswerResult["sources"] } {
  const notes: Note[] = r.credits.map((c, k) => {
    const own = r.sources.filter((s) => s.paidCreatorId === c.creatorId);
    const home = own.find((s) => !s.copyOf) ?? own[0];
    return {
      num: k + 1,
      creatorId: c.creatorId,
      name: c.creatorName,
      place: home ? `${home.creatorCity}, ${home.creatorCountry}` : "",
      share: c.share,
      amountMicro: c.amountMicro,
      multiplier: c.multiplier,
      color: INKS[k % INKS.length],
      sources: own,
    };
  });
  const paid = new Set(notes.map((n) => n.creatorId));
  return { notes, unused: r.sources.filter((s) => !paid.has(s.paidCreatorId)) };
}

/** Which notes a sentence draws on, and in what proportion. */
function sentenceMix(r: AnswerResult, j: number, noteOf: Map<string, Note>) {
  const byNote = new Map<number, number>();
  r.sentences[j].split.forEach((v, i) => {
    if (v <= 0) return;
    const n = noteOf.get(r.sources[i].paidCreatorId);
    if (n) byNote.set(n.num, (byNote.get(n.num) ?? 0) + v);
  });
  const total = [...byNote.values()].reduce((a, b) => a + b, 0);
  return [...byNote.entries()].sort((a, b) => a[0] - b[0]).map(([num, v]) => ({ num, frac: total ? v / total : 0 }));
}

function highlighter(mix: { num: number; frac: number }[], notes: Note[]): React.CSSProperties {
  if (!mix.length) return {};
  let at = 0;
  const stops = mix.flatMap(({ num, frac }) => {
    const c = notes[num - 1].color;
    const from = at * 100;
    at += frac;
    return [`${c} ${from}%`, `${c} ${at * 100}%`];
  });
  return {
    backgroundImage: `linear-gradient(to right, ${stops.join(", ")})`,
    backgroundSize: "100% 0.42em",
    backgroundPosition: "0 94%",
  };
}

export function AskDemo({ initial }: { initial?: string }) {
  const [question, setQuestion] = useState(initial ?? EXAMPLES[0]);
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [error, setError] = useState<{ text: string; payment?: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [go, setGo] = useState(false);
  const [hoverNote, setHoverNote] = useState<number | null>(null);
  const [hoverSent, setHoverSent] = useState<number | null>(null);

  async function ask(q: string) {
    setQuestion(q);
    setLoading(true);
    setError(null);
    setResult(null);
    setGo(false);
    try {
      const res = await fetch("/api/demo/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q }) });
      const body = await res.json();
      if (!res.ok) setError({ text: body.message || "Something went wrong.", payment: res.status === 402 });
      else setResult(body);
    } catch {
      setError({ text: "Could not reach Footnote. Check your connection and try again." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (result) {
      const t = setTimeout(() => setGo(true), 60);
      return () => clearTimeout(t);
    }
  }, [result]);

  const view = useMemo(() => {
    if (!result) return null;
    const { notes, unused } = buildNotes(result);
    const noteOf = new Map(notes.map((n) => [n.creatorId, n]));
    const mixes = result.sentences.map((_, j) => sentenceMix(result, j, noteOf));
    return { notes, unused, mixes };
  }, [result]);

  const copies = result?.sources.filter((s) => s.copyOf) ?? [];
  const injected = result?.sources.filter((s) => s.injectionRemoved?.length) ?? [];

  return (
    <div>
      <form
        className="ask"
        onSubmit={(e) => {
          e.preventDefault();
          if (question.trim()) ask(question.trim());
        }}
      >
        <input aria-label="Ask a question" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask anything about baking, plants, bikes, coffee or Halifax news" />
        <button className="btn" disabled={loading}>
          {loading ? "Answering…" : "Ask"}
        </button>
      </form>
      <div className="tries">
        Try:
        {EXAMPLES.map((q) => (
          <button key={q} type="button" className="chip" onClick={() => ask(q)} disabled={loading}>
            {q}
          </button>
        ))}
      </div>

      {error && (
        <div className={`notice ${error.payment ? "" : "err"}`} role="alert">
          {error.text} {error.payment && <a href="/console">Top up Answerly with PayPal</a>}
        </div>
      )}

      {loading && (
        <div className="result" aria-busy="true">
          <div>
            <div className="skeleton" style={{ width: "92%" }} />
            <div className="skeleton" style={{ width: "86%" }} />
            <div className="skeleton" style={{ width: "74%" }} />
            <p className="small muted">Finding sources, writing the answer, then auditing where every sentence came from.</p>
          </div>
          <div />
        </div>
      )}

      {result && view && (
        <div className="result">
          <div>
            {result.sentences.length === 0 ? (
              <p className="answer-text">Footnote found no creator content that answers this. Try one of the example questions.</p>
            ) : (
              <p className="answer-text">
                {result.sentences.map((s, j) => {
                  const mix = view.mixes[j];
                  const dim = hoverNote !== null && !mix.some((m) => m.num === hoverNote);
                  return (
                    <span key={j}>
                      <span
                        className={`sent ${s.commonKnowledge ? "common" : ""} ${dim ? "dim" : ""}`}
                        style={highlighter(mix, view.notes)}
                        onMouseEnter={() => setHoverSent(j)}
                        onMouseLeave={() => setHoverSent(null)}
                        title={s.commonKnowledge ? "Common knowledge: no one is paid for this sentence" : undefined}
                      >
                        {s.text}
                        {mix.length > 0 && <sup>{mix.map((m) => m.num).join(",")}</sup>}
                      </span>{" "}
                    </span>
                  );
                })}
              </p>
            )}
            <p className="answer-meta">
              {result.mode === "claude"
                ? `Written by ${result.models?.writer}. Audited separately by ${result.models?.auditor}, which had to quote its evidence. ${Math.round(result.sourcedFraction * 100)}% of the answer is backed by creators.`
                : `Offline demo mode${result.offlineReason ? ` (${result.offlineReason})` : ""}: the answer is assembled from source sentences without a model. ${Math.round(result.sourcedFraction * 100)}% of the answer is backed by creators.`}
            </p>
          </div>

          <aside className="notes" aria-label="Who this answer pays">
            {view.notes.map((n) => {
              const dim = hoverSent !== null && !view.mixes[hoverSent].some((m) => m.num === n.num);
              const evidence =
                hoverSent !== null
                  ? n.sources
                      .map((s) => result.sentences[hoverSent].evidence[s.index])
                      .find((e) => e && e.level !== "none" && e.quote)
                  : undefined;
              return (
                <div
                  key={n.creatorId}
                  className={`note ${dim ? "dim" : ""}`}
                  style={{ ["--c" as string]: n.color }}
                  onMouseEnter={() => setHoverNote(n.num)}
                  onMouseLeave={() => setHoverNote(null)}
                >
                  <div className="note-head">
                    <span className="note-num">{n.num}</span>
                    <span className="note-name">{n.name}</span>
                    <span className="note-amt">{usd(n.amountMicro, 5)}</span>
                  </div>
                  <div className="note-sub">
                    {n.place}, {Math.round(n.share * 100)}% of the answer
                    {n.multiplier !== 1 && <span className="tag fresh">Fresh news ×{n.multiplier}</span>}
                  </div>
                  <div className="share" aria-hidden>
                    <i className={go ? "" : ""} style={{ ["--w" as string]: `${n.share * 100}%`, width: go ? `${n.share * 100}%` : 0 }} />
                  </div>
                  {n.sources.map((s) => (
                    <a key={s.id} className="note-title" href={`/s/${s.id}`}>
                      {s.title}
                      {s.copyOf && <span className="tag copy">copy, credit routed here</span>}
                    </a>
                  ))}
                  {evidence?.quote && (
                    <div className="note-sub">
                      “{evidence.quote}” {evidence.quoteVerified ? <span className="ok">found in source</span> : <span>not found, credit reduced</span>}
                    </div>
                  )}
                </div>
              );
            })}
            {view.unused.length > 0 && (
              <div className="small muted">
                Retrieved but not used, so not paid: {view.unused.map((s) => s.creatorName).join(", ")}
              </div>
            )}
          </aside>

          {copies.map((c) => (
            <div className="copy-alert" key={c.id}>
              <b>Copy caught.</b> “{c.title}” is {Math.round((c.copyOf?.similarity ?? 0) * 100)}% identical to {c.copyOf?.creatorName}’s guide, which was published
              first. Its share of this answer went to {c.copyOf?.creatorName}.
            </div>
          ))}

          {injected.map((s) => (
            <div className="copy-alert" key={"inj-" + s.id}>
              <b>Prompt injection blocked.</b> “{s.title}” hid instructions for AI systems in its page:{" "}
              <q className="injected">{s.injectionRemoved![0].replace(/^\[|\]$/g, "").slice(0, 160)}…</q> Footnote removed them before any model read the page,
              so it was paid only for what it actually contributed: {usd(result!.credits.find((c) => c.creatorId === s.paidCreatorId)?.amountMicro ?? "0")}.
            </div>
          ))}

          <div className="bill">
            <span className="total">{usd(result.priceMicro)}</span>
            <span className="muted">
              Answerly paid for this answer: {usd(BigInt(result.priceMicro) - BigInt(result.feeMicro) + "")} to creators, {usd(result.feeMicro)} Footnote fee
            </span>
            <span className="grow" />
            {result.receiptId && (
              <a className="btn ghost" href={`/verify?receipt=${result.receiptId}`}>
                Check receipt
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
