"use client";
import { Grid, usdCell, centsCell, timeCell } from "./Grid";

const receiptLink = ({ value }: { value: unknown }) => (value ? <a href={`/verify?receipt=${value}`}>{String(value)}</a> : "");
const statusCell = ({ value }: { value: unknown }) => <span className={`status s-${String(value).toLowerCase()}`}>{String(value ?? "").toLowerCase().replace(/_/g, " ")}</span>;
const modeCell = ({ value }: { value: unknown }) => (value === "simulated" ? <span className="tag">simulated</span> : value === "claude" ? "Claude" : "offline");

export function EarningsGrid({ rows }: { rows: Record<string, unknown>[] }) {
  return (
    <Grid
      rows={rows}
      cols={[
        { field: "created_at", headerName: "When", cellRenderer: timeCell, sort: "desc", maxWidth: 150 },
        { field: "question", headerName: "Question asked", flex: 2 },
        { field: "source_id", headerName: "Article" },
        { field: "amount", headerName: "Earned", cellRenderer: usdCell(5), maxWidth: 120, comparator: (a, b) => Number(a) - Number(b) },
        { field: "mode", headerName: "Mode", cellRenderer: modeCell, maxWidth: 120 },
        { field: "receipt_id", headerName: "Receipt", cellRenderer: receiptLink },
      ]}
    />
  );
}

export function PayoutsGrid({ rows }: { rows: Record<string, unknown>[] }) {
  return (
    <Grid
      height={260}
      rows={rows}
      cols={[
        { field: "updated_at", headerName: "Updated", cellRenderer: timeCell },
        { field: "cents", headerName: "Amount", cellRenderer: centsCell, maxWidth: 120 },
        { field: "status", headerName: "PayPal status", cellRenderer: statusCell },
        { field: "paypal_batch_id", headerName: "PayPal batch ID" },
        { field: "paypal_item_id", headerName: "PayPal item ID" },
      ]}
    />
  );
}

export function AnswersGrid({ rows }: { rows: Record<string, unknown>[] }) {
  return (
    <Grid
      rows={rows}
      cols={[
        { field: "created_at", headerName: "When", cellRenderer: timeCell, sort: "desc", maxWidth: 150 },
        { field: "question", headerName: "Question", flex: 2 },
        { field: "creators", headerName: "Paid to" },
        { field: "price", headerName: "Cost", cellRenderer: usdCell(4), maxWidth: 110, comparator: (a, b) => Number(a) - Number(b) },
        { field: "mode", headerName: "Mode", cellRenderer: modeCell, maxWidth: 120 },
        { field: "receipt_id", headerName: "Receipt", cellRenderer: receiptLink },
      ]}
    />
  );
}

export function TopupsGrid({ rows }: { rows: Record<string, unknown>[] }) {
  return (
    <Grid
      height={240}
      rows={rows}
      cols={[
        { field: "created_at", headerName: "When", cellRenderer: timeCell },
        { field: "cents", headerName: "Amount", cellRenderer: centsCell, maxWidth: 120 },
        { field: "kind", headerName: "Type", valueFormatter: ({ value }) => (value === "auto" ? "Auto-reload" : "Top-up"), maxWidth: 130 },
        { field: "status", headerName: "Status", cellRenderer: statusCell },
        { field: "paypal_order_id", headerName: "PayPal order ID" },
        { field: "capture_id", headerName: "PayPal capture ID" },
      ]}
    />
  );
}

export function LedgerGrid({ rows, filter }: { rows: Record<string, unknown>[]; filter?: string }) {
  return (
    <Grid
      height={560}
      quickFilter={filter}
      rows={rows}
      cols={[
        { field: "id", headerName: "#", maxWidth: 90, comparator: (a, b) => Number(a) - Number(b) },
        { field: "created_at", headerName: "When", cellRenderer: timeCell },
        { field: "creator", headerName: "Creator" },
        { field: "kind", headerName: "Entry", valueFormatter: ({ value }) => ({ earning: "Earning", payout: "PayPal payout", payout_reversal: "Payout returned" })[String(value)] ?? String(value) },
        { field: "amount", headerName: "Amount", cellRenderer: usdCell(5), comparator: (a, b) => Number(a) - Number(b) },
        { field: "receipt_id", headerName: "Receipt", cellRenderer: receiptLink },
        { field: "payout_item_id", headerName: "Payout item" },
      ]}
    />
  );
}
