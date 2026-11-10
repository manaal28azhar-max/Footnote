/**
 * Footnote as a remote MCP server (Streamable HTTP, stateless JSON mode).
 * Any MCP client (Claude, an agent framework) can add
 *   https://<host>/api/mcp
 * and get tools to answer questions with paid attribution, check receipts,
 * see a site's licence, and top up with PayPal. Without an app key it acts as
 * the public demo app.
 */
import { db } from "@/lib/db";
import { appFromRequest, baseUrl, clientIp, json, rateLimited } from "@/lib/http";
import { answer, PaymentRequired } from "@/lib/answer";
import { receiptBundle } from "@/lib/sealing";
import { tryAutoReload, startTopup, TOPUP_CHOICES } from "@/lib/money-ops";
import { paypalConfigured } from "@/lib/paypal";
import { DEMO_APP_ID } from "@/lib/seed";
import { formatDollars } from "@footnote/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROTOCOL = "2025-06-18";

const TOOLS = [
  {
    name: "ask_with_attribution",
    description:
      "Answer a question from licensed creator content. Footnote measures how much each creator's work shaped the answer and pays them from this app's balance through PayPal. Returns the answer, who was paid and how much, and a receipt ID.",
    inputSchema: { type: "object", properties: { question: { type: "string", description: "The question to answer" } }, required: ["question"] },
  },
  {
    name: "verify_receipt",
    description: "Check that a Footnote receipt is genuine: its Merkle inclusion proof and Ed25519 batch signature. Returns who was paid and whether it verifies.",
    inputSchema: { type: "object", properties: { receipt_id: { type: "string" } }, required: ["receipt_id"] },
  },
  {
    name: "get_balance",
    description: "Show this app's Footnote balance, used to pay creators per answer, and whether auto-reload from a saved PayPal account is set up.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "top_up_with_paypal",
    description: "Start a PayPal top-up of the Footnote balance. Returns a PayPal link a human must open to approve the payment. Amounts: 5.00, 10.00 or 25.00 USD.",
    inputSchema: { type: "object", properties: { amount_usd: { type: "string", enum: [...TOPUP_CHOICES] } }, required: ["amount_usd"] },
  },
];

type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, any> };
const ok = (id: Rpc["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });
const fail = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
const text = (t: string, isError = false) => ({ content: [{ type: "text", text: t }], isError });

async function callTool(appId: string, name: string, args: Record<string, any>) {
  const d = await db();
  if (name === "ask_with_attribution") {
    const q = String(args.question ?? "").trim();
    if (!q) return text("Provide a question.", true);
    let r;
    try {
      r = await answer(d, appId, q);
    } catch (e) {
      if (!(e instanceof PaymentRequired)) throw e;
      const reload = await tryAutoReload(d, appId).catch((err) => ({ reloaded: false, reason: (err as Error).message }));
      if (!reload.reloaded)
        return text(
          `Payment required: this answer costs $${formatDollars(e.priceMicro)} and the balance is $${formatDollars(e.balanceMicro)}. Auto-reload: ${reload.reason}. Use top_up_with_paypal to add funds.`,
          true,
        );
      r = await answer(d, appId, q);
    }
    const credits = r.credits.map((c) => `- ${c.creatorName}: ${Math.round(c.share * 100)}% of the answer, paid $${(Number(c.amountMicro) / 1e8).toFixed(5)}`).join("\n");
    return {
      content: [
        {
          type: "text",
          text:
            `${r.sentences.map((s) => s.text).join(" ")}\n\n` +
            `Paid to the creators whose work shaped this answer:\n${credits || "- nobody (no creator content backed this answer)"}\n\n` +
            `Cost $${(Number(r.priceMicro) / 1e8).toFixed(4)}. Receipt ${r.receiptId ?? "none"} (check at ${baseUrl()}/verify?receipt=${r.receiptId}).`,
        },
      ],
      structuredContent: { answer: r.sentences.map((s) => s.text).join(" "), credits: r.credits, priceMicro: r.priceMicro, receiptId: r.receiptId },
    };
  }
  if (name === "verify_receipt") {
    const b = await receiptBundle(d, String(args.receipt_id ?? ""));
    if (!b) return text("No receipt with that ID.", true);
    return text(
      `${b.check.ok ? "Genuine and unaltered" : `Does NOT verify: ${b.check.reason}`}. Receipt ${b.receipt.id}, sealed in batch ${b.batch.date} (${b.proof.index + 1} of ${b.batch.treeSize}), root ${b.batch.root}.\n` +
        b.receipt.lines.map((l) => `- ${l.creatorId}: ${Math.round(l.share * 100)}% = $${(Number(l.amountMicro) / 1e8).toFixed(5)}`).join("\n"),
    );
  }
  if (name === "get_balance") {
    const [a] = await d.query<{ balance: string; vault_id: string | null; reload_cents: string; cap: string }>(
      "SELECT balance_micro::text AS balance, vault_id, reload_cents::text, reload_weekly_cap_cents::text AS cap FROM apps WHERE id = $1",
      [appId],
    );
    return text(
      `Balance $${(Number(a.balance) / 1e8).toFixed(4)}. Auto-reload: ${a.vault_id ? `on, $${(Number(a.reload_cents) / 100).toFixed(2)} per reload, up to $${(Number(a.cap) / 100).toFixed(2)} a week` : "off (no saved PayPal account)"}.`,
    );
  }
  if (name === "top_up_with_paypal") {
    if (!paypalConfigured()) return text("PayPal is not configured on this deployment.", true);
    const order = await startTopup(d, appId, String(args.amount_usd ?? "10.00"), false, baseUrl());
    const link = order.links.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
    return text(`Ask the user to approve this PayPal payment of $${args.amount_usd}: ${link}\nAfter approval, the balance is credited automatically when PayPal confirms the capture (order ${order.id}).`);
  }
  return text(`Unknown tool ${name}`, true);
}

async function handle(appId: string, msg: Rpc) {
  switch (msg.method) {
    case "initialize":
      return ok(msg.id, {
        protocolVersion: msg.params?.protocolVersion || PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: "footnote", version: "1.0.0" },
        instructions: "Use ask_with_attribution to answer questions from licensed creator content; every answer pays its sources through PayPal and returns a verifiable receipt.",
      });
    case "ping":
      return ok(msg.id, {});
    case "tools/list":
      return ok(msg.id, { tools: TOOLS });
    case "tools/call":
      try {
        return ok(msg.id, await callTool(appId, msg.params?.name, msg.params?.arguments ?? {}));
      } catch (e) {
        console.error("[footnote] mcp tool failed", e);
        return ok(msg.id, text("Footnote hit an error running that tool. Try again.", true));
      }
    default:
      return msg.id === undefined ? null : fail(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

export async function POST(req: Request) {
  if (rateLimited(`mcp:${clientIp(req)}`, 120)) return json(fail(null, -32000, "Rate limited"), 429);
  const app = (await appFromRequest(await db(), req)) ?? { id: DEMO_APP_ID };
  const body = await req.json().catch(() => null);
  if (!body) return json(fail(null, -32700, "Parse error"), 400);
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handle(app.id, m)))).filter(Boolean);
    return out.length ? json(out) : new Response(null, { status: 202 });
  }
  const out = await handle(app.id, body as Rpc);
  return out ? json(out) : new Response(null, { status: 202 });
}

export async function GET() {
  // No server-initiated stream in stateless mode.
  return new Response("Footnote MCP server. POST JSON-RPC here.", { status: 405, headers: { allow: "POST" } });
}
