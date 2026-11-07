"use client";
/**
 * Bryntum Scheduler as a licence-terms editor. Each row is one article; each
 * bar is a price window measured from its publication date (for example
 * "Breaking x4" for the first 30 days). Drag the end of a bar to change when
 * the price steps down; click a bar to change its multiplier. Saved terms
 * change what AI apps pay for that article from the next answer on.
 *
 * Bryntum's prebuilt bundle is served from /vendor/bryntum (copied at build
 * time) and loaded on demand, rather than bundled.
 */
import { useEffect, useRef, useState } from "react";
import type { Terms } from "@/lib/terms";

const DAY = 86_400_000;
const VIEW_DAYS = 200;
export interface TimelineSource {
  id: string;
  title: string;
  published_at: string;
  terms: Terms;
}

type BryntumGlobal = { scheduler: { Scheduler: new (cfg: Record<string, unknown>) => SchedulerLike; StringHelper: { encodeHtml(s: string): string } } };
interface SchedulerLike {
  destroy(): void;
  events: unknown;
  eventStore: { data: unknown; removeAll(): void; add(e: unknown[]): void };
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

function toEvents(sources: TimelineSource[]) {
  return sources.flatMap((s) => {
    const pub = new Date(s.published_at).getTime();
    return s.terms.windows.map((w, k) => {
      const start = pub + w.fromDays * DAY;
      const end = w.toDays === null ? Math.max(start + 30 * DAY, Date.now() + VIEW_DAYS * DAY) : pub + w.toDays * DAY;
      return {
        id: `${s.id}::${k}`,
        resourceId: s.id,
        name: w.multiplier === 0 ? `${w.label}: free` : `${w.label} ×${w.multiplier}`,
        startDate: new Date(start),
        endDate: new Date(end),
        eventColor: colorFor(w.multiplier),
        resizable: w.toDays === null ? false : "end",
        draggable: false,
      };
    });
  });
}

export default function TermsTimeline({ creatorId, sources: initial, editable }: { creatorId: string; sources: TimelineSource[]; editable: boolean }) {
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
          viewPreset: "monthAndYear",
          rowHeight: 52,
          barMargin: 10,
          eventStyle: "rounded",
          columns: [{ text: "Article", field: "name", width: 280 }],
          resources: initial.map((s) => ({ id: s.id, name: s.title })),
          events: toEvents(initial),
          features: {
            timeRanges: { showCurrentTimeLine: { name: "Today" } },
            eventEdit: false,
            eventDragCreate: false,
            eventDrag: false,
            eventMenu: false,
            scheduleMenu: false,
            eventTooltip: {
              template: ({ eventRecord }: { eventRecord: { name: string } }) =>
                `${b.scheduler.StringHelper.encodeHtml(eventRecord.name)}${editable ? ". Drag the end to change when the price steps down; click to change the price." : ""}`,
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
    s.eventStore.add(toEvents(sources));
  }, [sources]);

  const sel = selected ? sources.find((s) => s.id === selected.sourceId)?.terms.windows[selected.index] : null;
  function setMultiplier(m: number) {
    if (!selected) return;
    const s = sources.find((x) => x.id === selected.sourceId)!;
    save(selected.sourceId, { windows: s.terms.windows.map((w, i) => (i === selected.index ? { ...w, multiplier: m } : w)) });
  }

  return (
    <div>
      {failed ? (
        <div className="notice err">The timeline could not load. Refresh the page to try again.</div>
      ) : (
        <div className="timeline" ref={host} style={{ height: Math.max(220, 90 + sources.length * 52) }} />
      )}
      <div className="timeline-bar">
        {sel && editable ? (
          <>
            <span>
              <b>{sel.label}</b> ({sel.toDays === null ? `day ${sel.fromDays} onward` : `days ${sel.fromDays} to ${sel.toDays}`}) price:
            </span>
            {[0, 1, 2, 4].map((m) => (
              <button key={m} className={`chip ${sel.multiplier === m ? "on" : ""}`} onClick={() => setMultiplier(m)}>
                {m === 0 ? "Free" : `×${m}`}
              </button>
            ))}
          </>
        ) : (
          <span className="muted">{editable ? "Click a price window to change its price, or drag its end to change when it steps down." : "Price windows for each article."}</span>
        )}
        {status && <span className="small">{status}</span>}
      </div>
    </div>
  );
}
