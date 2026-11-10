"use client";
import { Grid, usdCell, centsCell, timeCell, bigCompare } from "./Grid";

const receiptLink = ({ value }: { value: unknown }) => (value ? <a href={`/verify?receipt=${value}`}>{String(value)}</a> : "");
const statusCell = ({ value }: { value: unknown }) =>
  value ? <span className={`status s-${String(value).toLowerCase()}`}>{String(value).toLowerCase().replace(/_/g, " ")}</span> : "";
const modeCell = ({ value }: { value: unknown }) => (value === "simulated" ? <span className="tag">simulated</span> : value === "claude" ? "Claude" : value ? "offline" : "");
const signedUsd = ({ value }: { value: unknown }) =>
  value == null || value === "" ? "" : <span className={String(value).startsWith("-") ? "amt-neg" : "amt-pos"}>{usdCell(5)({ value })}</span>;
const money = { comparator: bigCompare, type: "rightAligned" as const };
// valueFormatter is what CSV export uses; cellRenderer is what the screen shows.
const microFmt = (dp: number) => ({ valueFormatter: ({ value }: { value: unknown }) => usdCell(dp)({ value }) as string });
const centsFmt = { valueFormatter: ({ value }: { value: unknown }) => centsCell({ value }) as string };

export function EarningsGrid({ rows }: { rows: Record<string, unknown>[] }) {
  return (
    <Grid
      rows={rows}
      totals={["amount"]}
      csv="footnote-earnings.csv"
      searchPlaceholder="Search questions or articles"
      cols={[
        { field: "created_at", headerName: "When", cellRenderer: timeCell, sort: "desc", maxWidth: 160 },
        { field: "question", headerName: "Question asked", flex: 2 },
        { field: "source_id", headerName: "Article" },
        { field: "amount", headerName: "Earned", cellRenderer: usdCell(5), maxWidth: 130, ...money, ...microFmt(5) },
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
      totals={["cents"]}
      csv="footnote-payouts.csv"
      cols={[
        { field: "updated_at", headerName: "Updated", cellRenderer: timeCell },
        { field: "cents", headerName: "Amount", cellRenderer: centsCell, maxWidth: 130, ...money, ...centsFmt },
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
      totals={["price"]}
      csv="footnote-answers.csv"
      searchPlaceholder="Search questions or creators"
      cols={[
        { field: "created_at", headerName: "When", cellRenderer: timeCell, sort: "desc", maxWidth: 160 },
        { field: "question", headerName: "Question", flex: 2 },
        { field: "creators", headerName: "Paid to" },
        { field: "price", headerName: "Cost", cellRenderer: usdCell(4), maxWidth: 120, ...money, ...microFmt(4) },
        { field: "mode", headerName: "Mode", cellRenderer: modeCell, maxWidth: 120 },
        { field: "receipt_id", headerName: "Receipt", cellRenderer: receiptLink },
      ]}
    />
  );
}

export function TopupsGrid({ rows }: { rows: Record<string, unknown>[] }) {
  return (
    <Grid
      height={260}
      rows={rows}
      totals={["cents", "refunded"]}
      csv="footnote-topups.csv"
      cols={[
        { field: "created_at", headerName: "When", cellRenderer: timeCell },
        { field: "cents", headerName: "Amount", cellRenderer: centsCell, maxWidth: 130, ...money, ...centsFmt },
        { field: "refunded", headerName: "Refunded", cellRenderer: centsCell, maxWidth: 130, ...money, ...centsFmt },
        { field: "kind", headerName: "Type", valueFormatter: ({ value }) => (value === "auto" ? "Auto-reload" : value ? "Top-up" : ""), maxWidth: 140 },
        { field: "status", headerName: "Status", cellRenderer: statusCell },
        { field: "paypal_order_id", headerName: "PayPal order ID" },
        { field: "capture_id", headerName: "PayPal capture ID" },
      ]}
    />
  );
}

const KIND: Record<string, string> = { earning: "Earning", payout: "PayPal payout", payout_reversal: "Payout returned" };

export function LedgerGrid({ rows }: { rows: Record<string, unknown>[] }) {
  return (
    <Grid
      height={560}
      rows={rows}
      totals={["amount"]}
      csv="footnote-ledger.csv"
      searchPlaceholder="Search creator, receipt or payout"
      cols={[
        { field: "id", headerName: "#", maxWidth: 110, comparator: (a, b) => Number(a) - Number(b) },
        { field: "created_at", headerName: "When", cellRenderer: timeCell },
        { field: "creator", headerName: "Creator" },
        { field: "kind", headerName: "Entry", valueFormatter: ({ value }) => (value ? (KIND[String(value)] ?? String(value)) : "") },
        { field: "amount", headerName: "Amount", cellRenderer: signedUsd, ...money, ...microFmt(5) },
        { field: "receipt_id", headerName: "Receipt", cellRenderer: receiptLink },
        { field: "payout_item_id", headerName: "Payout item" },
      ]}
    />
  );
}

const RESULT: Record<string, string> = { matched: "Matches PayPal", pending: "Not in PayPal’s report yet", mismatch: "Amounts differ" };

/** Our ledger next to PayPal's own records (Transaction Search), line by line. */
export function ReconcileGrid({ rows }: { rows: Record<string, unknown>[] }) {
  return (
    <Grid
      height={320}
      rows={rows}
      totals={["ours_cents", "paypal_cents"]}
      csv="footnote-reconciliation.csv"
      searchPlaceholder="Search PayPal IDs"
      rowClassRules={{ "row-bad": (p) => p.data?.result === "mismatch", "row-wait": (p) => p.data?.result === "pending" }}
      cols={[
        { field: "kind", headerName: "What" },
        { field: "id", headerName: "PayPal transaction ID", flex: 1.4 },
        { field: "ours_cents", headerName: "Our ledger", cellRenderer: centsCell, ...money, ...centsFmt },
        { field: "paypal_cents", headerName: "PayPal says", cellRenderer: centsCell, ...money, ...centsFmt },
        { field: "paypal_code", headerName: "PayPal event code", maxWidth: 150 },
        { field: "result", headerName: "Result", valueFormatter: ({ value }) => (value ? (RESULT[String(value)] ?? String(value)) : ""), sort: "desc" },
      ]}
    />
  );
}
