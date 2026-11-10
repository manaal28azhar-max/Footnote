import { baseUrl } from "@/lib/http";
import { DEMO_APP_KEY } from "@/lib/seed";
import { CRAWLER_LIST } from "@/lib/gate";

export const dynamic = "force-dynamic";

export default function Docs() {
  const b = baseUrl();
  return (
    <main className="page">
      <div className="wrap" style={{ maxWidth: 860 }}>
        <h1 className="display" style={{ fontSize: "var(--s3)", maxWidth: "none" }}>
          Docs
        </h1>
        <p className="lede">Footnote has two sides: AI apps call one API to answer and pay, and creators add a gate so AI can only use their work through Footnote.</p>

        <section className="block">
          <h2 className="h3">Answer a question and pay its sources</h2>
          <p className="muted">
            One call retrieves creator content, writes the answer, audits where every sentence came from, charges your balance and returns a receipt. Try it
            with the public demo key.
          </p>
          <pre className="code">{`curl -X POST ${b}/api/v1/answer \\
  -H "Authorization: Bearer ${DEMO_APP_KEY}" \\
  -H "Content-Type: application/json" \\
  -d '{"question":"Why is my sourdough flat and dense?"}'`}</pre>
          <p className="muted">The response includes:</p>
          <ul className="muted">
            <li>
              <code>sentences</code>: the answer, each sentence with its support from each source and the auditor’s quoted evidence
            </li>
            <li>
              <code>credits</code>: who is paid, their share and the exact amount in micro-cents (1 USD = 100,000,000)
            </li>
            <li>
              <code>priceMicro</code>, <code>feeMicro</code>, <code>receiptId</code> and your remaining <code>balanceMicro</code>
            </li>
          </ul>
        </section>

        <section className="block">
          <h2 className="h3">When the balance runs out: 402</h2>
          <p className="muted">
            If an answer would overdraw your balance, nothing is charged and the API returns <b>402 Payment Required</b> with what it costs and how to top up,
            in a form an agent can act on. If the app has a saved PayPal account, Footnote first tries an auto-reload within the owner’s weekly limit.
          </p>
          <pre className="code">{`{
  "error": "payment_required",
  "price_usd": "0.005",
  "balance_usd": "0.002",
  "top_up": { "method": "POST", "url": "${b}/api/v1/topups", "body": { "amount_usd": "10.00" } }
}`}</pre>
        </section>

        <section className="block">
          <h2 className="h3">Top up with PayPal</h2>
          <pre className="code">{`# 1. Create a PayPal order (amount_usd: 5.00, 10.00 or 25.00)
curl -X POST ${b}/api/v1/topups -H "Authorization: Bearer <key>" \\
  -H "Content-Type: application/json" -d '{"amount_usd":"10.00","save_for_autoreload":true}'
# -> { "orderId": "...", "approveUrl": "https://www.sandbox.paypal.com/..." }

# 2. After the payer approves, capture it. The balance is credited once,
#    whether this call or PayPal's webhook arrives first.
curl -X POST ${b}/api/v1/topups/<orderId>/capture`}</pre>
        </section>

        <section className="block">
          <h2 className="h3">Check any receipt</h2>
          <pre className="code">{`curl ${b}/api/receipts/<receiptId>      # receipt + Merkle proof + signed batch
curl ${b}/.well-known/footnote-key.pem    # Footnote's public signing key`}</pre>
          <p className="muted">
            To verify: hash the receipt (SHA-256 of 0x00 followed by its canonical JSON), rebuild the root with the proof (RFC 6962 layout), and check the
            Ed25519 signature on <code>{`{"date","root","treeSize"}`}</code>. The <a href="/verify">receipt checker</a> does all three in your browser.
          </p>
        </section>

        <section className="block">
          <h2 className="h3">For creators: the gate</h2>
          <p className="muted">
            Add this to your site’s middleware. People read for free. Known AI crawlers get a 402 that points them to Footnote. Detected crawlers:{" "}
            {CRAWLER_LIST.join(", ")}.
          </p>
          <pre className="code">{`// Next.js middleware (middleware.ts), or adapt to Express/Cloudflare
import { NextResponse } from "next/server";
const AI = /gptbot|claudebot|perplexitybot|ccbot|google-extended|bytespider/i;

export function middleware(req) {
  if (AI.test(req.headers.get("user-agent") ?? "")) {
    return NextResponse.json(
      { error: "payment_required", license: { via: "footnote", api: "${b}/api/v1/answer" } },
      { status: 402 },
    );
  }
}`}</pre>
          <p className="muted">See it on a demo creator’s article:</p>
          <pre className="code">{`curl -i ${b}/s/priya-flat-loaf -A "GPTBot/1.2"         # 402 Payment Required
curl -i ${b}/s/priya-flat-loaf -H "X-Footnote-Probe: ai"  # same, from any client`}</pre>
        </section>

        <section className="block">
          <h2 className="h3">For AI agents: MCP</h2>
          <p className="muted">
            Footnote is also a remote MCP server. Add it to any MCP client and an agent can answer questions with paid attribution, check receipts, see its
            balance and ask a human to top up with PayPal. Tools: <code>ask_with_attribution</code>, <code>verify_receipt</code>, <code>get_balance</code>,{" "}
            <code>top_up_with_paypal</code>.
          </p>
          <pre className="code">{`# Remote MCP URL (Streamable HTTP)
${b}/api/mcp

# Claude Desktop / any stdio client, via mcp-remote:
{
  "mcpServers": {
    "footnote": { "command": "npx", "args": ["-y", "mcp-remote", "${b}/api/mcp"] }
  }
}`}</pre>
        </section>

        <section className="block">
          <h2 className="h3">How credit is split</h2>
          <p className="muted">
            A writer model answers from the retrieved sources. A separate auditor model marks how strongly each source backs each sentence (full, partial or
            none) and must quote its evidence; if the quote isn’t really in the source, the credit is cut. Each sentence’s value is then split with exact
            Shapley values of a max game: a claim only one source makes earns that source all of it, and a claim several sources share is split between them.
            Common-knowledge sentences earn nobody anything. Copies found by MinHash earn nothing; their share goes to the original. Money is integer
            micro-cents, split with the largest-remainder method so every share adds up exactly.
          </p>
        </section>
      </div>
    </main>
  );
}
