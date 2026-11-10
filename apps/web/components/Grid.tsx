"use client";
import { useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef, type RowClassRules } from "ag-grid-community";

ModuleRegistry.registerModules([AllCommunityModule]);

const theme = themeQuartz.withParams({
  fontFamily: "Schibsted Grotesk, system-ui, sans-serif",
  fontSize: 14,
  foregroundColor: "#172036",
  headerTextColor: "#4a5470",
  headerBackgroundColor: "#f6f7f9",
  borderColor: "#dfe3ea",
  rowHoverColor: "#f2f5fb",
  accentColor: "#0e7c5a",
  wrapperBorderRadius: 12,
  spacing: 7,
});

/** Amounts stay exact integers in the data (micro-cents or cents); they are only formatted for display. */
const MICRO = 100_000_000n;
const fmtMicro = (v: unknown, dp: number) => {
  if (v == null || v === "") return "";
  const n = BigInt(String(v));
  const neg = n < 0n;
  const a = neg ? -n : n;
  const frac = (a % MICRO).toString().padStart(8, "0").slice(0, dp);
  return `${neg ? "−" : ""}$${a / MICRO}${dp ? "." + frac : ""}`;
};
export const usdCell = (dp = 5) => ({ value }: { value: unknown }) => fmtMicro(value, dp);
export const centsCell = ({ value }: { value: unknown }) => (value == null || value === "" ? "" : `$${(Number(value) / 100).toFixed(2)}`);
export const timeCell = ({ value }: { value: unknown }) =>
  value ? new Date(String(value)).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
/** Exact comparator for integer-string amounts. */
export const bigCompare = (a: unknown, b: unknown) => {
  const x = BigInt(String(a ?? 0));
  const y = BigInt(String(b ?? 0));
  return x < y ? -1 : x > y ? 1 : 0;
};

export interface GridProps<T> {
  rows: T[];
  cols: ColDef<T>[];
  height?: number;
  /** Integer-amount fields to total in a pinned row (over the rows currently shown). */
  totals?: string[];
  /** File name for the CSV download. */
  csv?: string;
  rowClassRules?: RowClassRules<T>;
  searchPlaceholder?: string;
}

export function Grid<T extends Record<string, unknown>>({ rows, cols, height = 460, totals, csv, rowClassRules, searchPlaceholder = "Search" }: GridProps<T>) {
  const ref = useRef<AgGridReact<T>>(null);
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(rows.length);
  const [pinned, setPinned] = useState<T[] | undefined>(undefined);

  const sum = () => {
    const api = ref.current?.api;
    if (!api) return;
    let count = 0;
    const acc: Record<string, bigint> = {};
    api.forEachNodeAfterFilter((n) => {
      count++;
      for (const f of totals ?? []) acc[f] = (acc[f] ?? 0n) + BigInt(String((n.data as Record<string, unknown>)?.[f] ?? 0));
    });
    setShown(count);
    if (totals?.length) {
      const first = String(cols[0]?.field ?? "");
      setPinned([{ [first]: `Total (${count})`, ...Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, v.toString()])) } as T]);
    }
  };

  const exportCsv = () =>
    ref.current?.api.exportDataAsCsv({
      fileName: csv,
      // Amounts as dollars (via each column's valueFormatter), dates as ISO for spreadsheets.
      processCellCallback: (p) => {
        const col = p.column.getColDef();
        if (typeof col.valueFormatter === "function") return String((col.valueFormatter as (x: { value: unknown }) => unknown)({ value: p.value }) ?? "");
        return p.value == null ? "" : String(p.value);
      },
    });

  // The pinned totals row only shows its label and the totalled amounts.
  const columns = useMemo<ColDef<T>[]>(
    () =>
      cols.map((c) => {
        const r = c.cellRenderer;
        if (typeof r !== "function") return c;
        const isTotal = (totals ?? []).includes(String(c.field));
        return {
          ...c,
          cellRenderer: (p: { value: unknown; node: { rowPinned?: string | null } }) =>
            p.node.rowPinned && !isTotal ? (typeof p.value === "string" ? p.value : "") : (r as (x: unknown) => unknown)(p),
        } as ColDef<T>;
      }),
    [cols, totals],
  );

  const defaultColDef = useMemo<ColDef<T>>(() => ({ sortable: true, filter: true, resizable: true, flex: 1, minWidth: 110 }), []);

  return (
    <div className="grid-box">
      <div className="grid-tools">
        <input className="input" placeholder={searchPlaceholder} aria-label="Search this table" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="small muted">
          {shown === rows.length ? `${rows.length} rows` : `${shown} of ${rows.length} rows`}
        </span>
        <span className="grow" />
        {csv && (
          <button className="btn ghost small-btn" onClick={exportCsv}>
            Download CSV
          </button>
        )}
      </div>
      <div style={{ height }}>
        <AgGridReact<T>
          ref={ref}
          theme={theme}
          rowData={rows}
          columnDefs={columns}
          defaultColDef={defaultColDef}
          quickFilterText={q}
          pagination={rows.length > 100}
          paginationPageSize={100}
          pinnedBottomRowData={pinned}
          rowClassRules={rowClassRules}
          getRowClass={(p) => (p.node.rowPinned ? "grid-total" : undefined)}
          onGridReady={sum}
          onFilterChanged={sum}
          onRowDataUpdated={sum}
          animateRows
        />
      </div>
    </div>
  );
}
