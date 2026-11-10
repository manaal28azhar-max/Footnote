"use client";
/**
 * Bryntum Scheduler as a licence-terms editor. Each row is one article; each
 * bar is a price window measured from its publication date (for example
 * "Breaking x4" for the first 30 days), labelled with what that window has
 * actually earned. Drag the end of a bar to change when the price steps down;
 * click a bar to change its price, split it in two, or remove it; or apply a
 * preset to the whole article. Windows always stay back to back (checked here
 * and again on the server). Saved terms change what AI apps pay for that
 * article from the next answer on.
 *
 * Bryntum's prebuilt bundle is served from /vendor/bryntum (copied at build
 * time) and loaded on demand, rather than bundled.
 */
import { useEffect, useRef, useState } from "react";
import type { Terms } from "@/lib/terms";

const DAY = 86_400_000;
const VIEW_DAYS = 150;
export interface TimelineSource {
  id: string;
  title: string;
  published_at: string;
  terms: Terms;
}
export interface TimelineEarning {
  created_at: string;
  source_id: string;
  /** The articles this earning is for, with copies mapped to their originals. */
  for_sources?: string | null;
  amount: string; // micro-cents
}

/** What each price window has earned so far, from the creator's ledger. */
function earnedIn(earnings: TimelineEarning[], s: TimelineSource, fromDays: number, toDays: number | null) {
  const pub = new Date(s.published_at).getTime();
  let micro = 0n;
  let n = 0;
  for (const e of earnings) {
    const ids = String(e.for_sources || e.source_id || "").split(",").filter(Boolean);
    if (!ids.includes(s.id)) continue;
    const age = (new Date(e.created_at).getTime() - pub) / DAY;
    if (age >= fromDays && (toDays === null || age < toDays)) {
      micro += BigInt(e.amount) / BigInt(ids.length); // one earning can cover several of the creator's articles
      n++;
    }
  }
  return { micro, n };
}
const fmt = (micro: bigint) => `$${(Number(micro) / 1e8).toFixed(4)}`;

const PRESETS: { name: string; terms: Terms }[] = [
  { name: "One price", terms: { windows: [{ label: "Standard", fromDays: 0, toDays: null, multiplier: 1 }] } },
  {
    name: "News pricing",
    terms: {
      windows: [
        { label: "Breaking", fromDays: 0, toDays: 30, multiplier: 4 },
        { label: "Recent", fromDays: 30, toDays: 120, multiplier: 2 },
        { label: "Archive", fromDays: 120, toDays: null, multiplier: 1 },
      ],
    },
  },
  {
    name: "Paid, then free",
    terms: {
      windows: [
        { label: "Licensed", fromDays: 0, toDays: 365, multiplier: 1 },
        { label: "Free", fromDays: 365, toDays: null, multiplier: 0 },
      ],
    },
  },
];

type BryntumGlobal = { scheduler: { Scheduler: new (cfg: Record<string, unknown>) => SchedulerLike; StringHelper: { encodeHtml(s: string): string } } };
interface SchedulerLike {
  destroy(): void;
  events: unknown;
  eventStore: { data: unknown; removeAll(): void; add(e: unknown[]): void };
  zoomToSpan(span: { startDate: Date; endDate: Date }): void;
}

let loading: Promise<BryntumGlobal> | null = null;
function loadBryntum(): Promise<BryntumGlobal> {
  const w = window as unknown as { bryntum?: BryntumGlobal };
  if (w.bryntum?.scheduler) return Promise.resolve(w.bryntum);
  if (loading) return loading;
  for (const href of ["/vendor/bryntum/scheduler.css", "/vendor/bryntum/svalbard-light.css", "/vendor/bryntum/fontawesome/css/fontawesome.css", "/vendor/bryntum/fontawesome/css/solid.css"]) {
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = href;
    document.head.appendChild(l);
  }
  loading = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "/vendor/bryntum/scheduler.umd.js";
    s.onload = () => (w.bryntum?.scheduler ? resolve(w.bryntum) : reject(new Error("Bryntum did not load")));
    s.onerror = () => reject(new Error("Could not load Bryntum"));
    document.head.appendChild(s);
  });
  return loading;
}

const colorFor = (m: number) => (m === 0 ? "gray" : m >= 4 ? "red" : m >= 2 ? "orange" : m > 1 ? "yellow" : "green");

function toEvents(sources: TimelineSource[], earnings: TimelineEarning[]) {
  return sources.flatMap((s) => {
    const pub = new Date(s.published_at).getTime();
    return s.terms.windows.map((w, k) => {
      const start = pub + w.fromDays * DAY;
      const end = w.toDays === null ? Math.max(start + 30 * DAY, Date.now() + VIEW_DAYS * DAY) : pub + w.toDays * DAY;
      const got = earnedIn(earnings, s, w.fromDays, w.toDays);
      return {
        id: `${s.id}::${k}`,
        resourceId: s.id,
        name: w.multiplier === 0 ? `${w.label}: free` : `${w.label} ×${w.multiplier}`,
        earned: got.n ? `${fmt(got.micro)} from ${got.n} answer${got.n === 1 ? "" : "s"}` : "no answers yet",
        startDate: new Date(start),
        endDate: new Date(end),
        eventColor: colorFor(w.multiplier),
        resizable: w.toDays === null ? false : "end",
        draggable: false,
      };
    });
  });
}

export default function TermsTimeline({
  creatorId,
  sources: initial,
  editable,
  earnings = [],
}: {
  creatorId: string;
  sources: TimelineSource[];
  editable: boolean;
  earnings?: TimelineEarning[];
}) {
  const [sources, setSources] = useState(initial);
  const [selected, setSelected] = useState<{ sourceId: string; index: number } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const sched = useRef<SchedulerLike | null>(null);
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;

  async function save(sourceId: string, terms: Terms) {
    setStatus("Saving…");
    const res = await fetch(`/api/creators/${creatorId}/terms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceId, terms }) });
    const body = await res.json();
    const next = res.ok ? sourcesRef.current.map((s) => (s.id === sourceId ? { ...s, terms: body.terms } : s)) : [...sourcesRef.current];
    setSources(next);
    setStatus(res.ok ? "Saved. AI apps pay the new price from the next answer." : body.message || "Could not save these terms.");
  }

  // Create the scheduler once.
  useEffect(() => {
    let alive = true;
    loadBryntum()
      .then((b) => {
        if (!alive || !host.current) return;
        const earliest = Math.min(...initial.map((s) => new Date(s.published_at).getTime()), Date.now() - 30 * DAY);
        sched.current = new b.scheduler.Scheduler({
          appendTo: host.current,
          readOnly: !editable,
          startDate: new Date(earliest - 7 * DAY),
          endDate: new Date(Date.now() + VIEW_DAYS * DAY),
          // Recent news gets a week-by-week zoom so its short price windows are readable.
          viewPreset: "monthAndYear",

          rowHeight: 52,
          barMargin: 10,
          eventStyle: "rounded",
          columns: [{ text: "Article", field: "name", width: 280 }],
          resources: initial.map((s) => ({ id: s.id, name: s.title })),
          events: toEvents(initial, earnings),
          eventRenderer: ({ eventRecord }: { eventRecord: { name: string; earned: string } }) =>
            `<div class="fn-bar"><b>${b.scheduler.StringHelper.encodeHtml(eventRecord.name)}</b><span>${b.scheduler.StringHelper.encodeHtml(eventRecord.earned)}</span></div>`,
          features: {
            timeRanges: { showCurrentTimeLine: { name: "Today" } },
            eventEdit: false,
            eventDragCreate: false,
            eventDrag: false,
            eventMenu: false,
            scheduleMenu: false,
            eventTooltip: {
              template: ({ eventRecord }: { eventRecord: { name: string; earned: string; startDate: Date; endDate: Date } }) =>
                `<b>${b.scheduler.StringHelper.encodeHtml(eventRecord.name)}</b><br>Earned ${b.scheduler.StringHelper.encodeHtml(eventRecord.earned)}` +
                (editable ? "<br><span style='opacity:.75'>Drag the end to change when the price steps down. Click to edit.</span>" : ""),
            },
          },
          listeners: {
            eventResizeEnd({ eventRecord, changed }: { eventRecord: { id: unknown; endDate: Date }; changed: boolean }) {
              if (!changed) return;
              const [sourceId, k] = String(eventRecord.id).split("::");
              const s = sourcesRef.current.find((x) => x.id === sourceId)!;
              const pub = new Date(s.published_at).getTime();
              const ws = s.terms.windows.map((w) => ({ ...w }));
              const i = Number(k);
              const newTo = Math.max(ws[i].fromDays + 1, Math.round((eventRecord.endDate.getTime() - pub) / DAY));
              const nextTo = ws[i + 1]?.toDays;
              ws[i].toDays = nextTo != null ? Math.min(newTo, nextTo - 1) : newTo;
              if (ws[i + 1]) ws[i + 1].fromDays = ws[i].toDays!;
              save(sourceId, { windows: ws });
            },
            eventClick({ eventRecord }: { eventRecord: { id: unknown } }) {
              const [sourceId, k] = String(eventRecord.id).split("::");
              setSelected({ sourceId, index: Number(k) });
            },
          },
        });
        // Open on the part that matters: recent history and the next four months.
        sched.current.zoomToSpan({ startDate: new Date(Math.max(earliest - 7 * DAY, Date.now() - 60 * DAY)), endDate: new Date(Date.now() + 120 * DAY) });
      })
      .catch(() => setFailed(true));
    return () => {
      alive = false;
      sched.current?.destroy();
      sched.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redraw bars whenever terms change.
  useEffect(() => {
    const s = sched.current;
    if (!s) return;
    s.eventStore.removeAll();
    s.eventStore.add(toEvents(sources, earnings));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources]);

  const selSource = selected ? sources.find((s) => s.id === selected.sourceId) : undefined;
  const sel = selSource && selected ? selSource.terms.windows[selected.index] : null;
  const edit = (windows: Terms["windows"]) => selected && save(selected.sourceId, { windows });

  function setMultiplier(m: number) {
    if (!selSource || !selected) return;
    edit(selSource.terms.windows.map((w, i) => (i === selected.index ? { ...w, multiplier: m } : w)));
  }
  /** Split the selected window in two at its middle (an open-ended one at +30 days). */
  function split() {
    if (!selSource || !selected || !sel || selSource.terms.windows.length >= 6) return;
    const mid = sel.toDays === null ? sel.fromDays + 30 : Math.floor((sel.fromDays + sel.toDays) / 2);
    if (mid <= sel.fromDays) return;
    const ws = selSource.terms.windows.flatMap((w, i) =>
      i === selected.index
        ? [
            { ...w, toDays: mid },
            { ...w, label: w.toDays === null ? "Later" : `${w.label} 2`.slice(0, 24), fromDays: mid },
          ]
        : [w],
    );
    edit(ws);
  }
  /** Remove the selected window; its days go to the window before it (or after, for the first). */
  function remove() {
    if (!selSource || !selected) return;
    const ws = selSource.terms.windows.map((w) => ({ ...w }));
    if (ws.length < 2) return;
    const i = selected.index;
    if (i === 0) ws[1].fromDays = 0;
    else ws[i - 1].toDays = ws[i].toDays;
    ws.splice(i, 1);
    setSelected(null);
    edit(ws);
  }

  return (
    <div>
      {failed ? (
        <div className="notice err">The timeline could not load. Refresh the page to try again.</div>
      ) : (
        <div className="timeline" ref={host} style={{ height: Math.max(220, 90 + sources.length * 52) }} />
      )}
      <div className="timeline-bar">
        {sel && selSource && editable ? (
          <>
            <span>
              <b>{selSource.title}</b>: {sel.label} ({sel.toDays === null ? `day ${sel.fromDays} onward` : `days ${sel.fromDays} to ${sel.toDays}`})
            </span>
            {[0, 1, 2, 4].map((m) => (
              <button key={m} className={`chip ${sel.multiplier === m ? "on" : ""}`} onClick={() => setMultiplier(m)}>
                {m === 0 ? "Free" : `×${m}`}
              </button>
            ))}
            <button className="chip" onClick={split} disabled={selSource.terms.windows.length >= 6}>
              Split in two
            </button>
            <button className="chip" onClick={remove} disabled={selSource.terms.windows.length < 2}>
              Remove window
            </button>
            <span className="muted small">Presets:</span>
            {PRESETS.map((p) => (
              <button key={p.name} className="chip" onClick={() => edit(p.terms.windows)}>
                {p.name}
              </button>
            ))}
          </>
        ) : (
          <span className="muted">
            {editable ? "Click a price window to change its price, split it or apply a preset. Drag its end to change when it steps down." : "Price windows for each article."}
          </span>
        )}
        {status && <span className="small">{status}</span>}
      </div>
    </div>
  );
}
