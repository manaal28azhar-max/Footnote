/**
 * Licence terms a creator sets for their content. Prices change over time:
 * news is worth more while it is fresh, so a newsroom can charge a premium
 * for its first weeks and let the price fall after that (or go free).
 * These windows are what the Bryntum timeline shows and lets creators drag.
 */
export interface TermWindow {
  label: string;
  fromDays: number; // days after publication, inclusive
  toDays: number | null; // exclusive; null = forever
  multiplier: number; // x base price per answer; 0 = free
}
export interface Terms {
  windows: TermWindow[];
}

export const EVERGREEN: Terms = { windows: [{ label: "Standard", fromDays: 0, toDays: null, multiplier: 1 }] };

export const NEWSROOM: Terms = {
  windows: [
    { label: "Breaking", fromDays: 0, toDays: 30, multiplier: 4 },
    { label: "Recent", fromDays: 30, toDays: 120, multiplier: 2 },
    { label: "Archive", fromDays: 120, toDays: null, multiplier: 1 },
  ],
};

const DAY = 86_400_000;

export function activeWindow(terms: Terms, publishedAt: Date, now: Date = new Date()): TermWindow {
  const age = Math.max(0, (now.getTime() - publishedAt.getTime()) / DAY);
  return (
    terms.windows.find((w) => age >= w.fromDays && (w.toDays === null || age < w.toDays)) ??
    terms.windows[terms.windows.length - 1] ??
    EVERGREEN.windows[0]
  );
}

/** Validate terms coming from a creator's edit (Bryntum drag or form). */
export function validateTerms(t: Terms): string | null {
  if (!t || !Array.isArray(t.windows) || t.windows.length === 0 || t.windows.length > 6) return "1 to 6 windows required";
  const ws = [...t.windows].sort((a, b) => a.fromDays - b.fromDays);
  if (ws[0].fromDays !== 0) return "The first window must start at publication (day 0)";
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i];
    if (!w.label || w.label.length > 24) return "Each window needs a short label";
    if (!(w.multiplier >= 0 && w.multiplier <= 10)) return "Multiplier must be between 0 and 10";
    if (w.toDays !== null && !(w.toDays > w.fromDays)) return "Each window must end after it starts";
    const next = ws[i + 1];
    if (next && w.toDays !== next.fromDays) return "Windows must be back to back with no gaps";
    if (!next && w.toDays !== null) return "The last window must run forever";
  }
  return null;
}

export function sortTerms(t: Terms): Terms {
  return { windows: [...t.windows].sort((a, b) => a.fromDays - b.fromDays) };
}
