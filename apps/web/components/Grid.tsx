"use client";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef } from "ag-grid-community";

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

export const usdCell = (dp = 5) => ({ value }: { value: unknown }) => (value == null ? "" : `$${(Number(value) / 1e8).toFixed(dp)}`);
export const centsCell = ({ value }: { value: unknown }) => (value == null ? "" : `$${(Number(value) / 100).toFixed(2)}`);
export const timeCell = ({ value }: { value: unknown }) =>
  value ? new Date(String(value)).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";

export function Grid<T>({ rows, cols, height = 460, quickFilter }: { rows: T[]; cols: ColDef<T>[]; height?: number; quickFilter?: string }) {
  return (
    <div style={{ height }}>
      <AgGridReact<T>
        theme={theme}
        rowData={rows}
        columnDefs={cols}
        defaultColDef={{ sortable: true, filter: true, resizable: true, flex: 1, minWidth: 110 }}
        quickFilterText={quickFilter}
        pagination={rows.length > 100}
        paginationPageSize={100}
        animateRows
      />
    </div>
  );
}
