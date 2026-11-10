# Footnote

**Every AI answer pays the people it came from.**

AI apps answer questions with other people's writing and almost never send a reader back. Footnote measures how much each creator's work shaped an AI answer, pays them their share through **PayPal Payouts**, and gives everyone a receipt they can verify without trusting us.

- **Live demo:** `https://footnote.onrender.com` _(PayPal sandbox: no real money moves)_
- **Video:** _link added on submission_
- **Built for:** PayPal AI Hackathon 2026 · **License:** MIT

---

## The problem

For 25 years the web ran on a trade: let search engines read your page, and they send you readers. AI answer engines broke it.

- In July 2026 Cloudflare measured AI crawlers reading **hundreds to thousands of pages for every visitor they send back** (OpenAI ~251, Perplexity ~289, Anthropic ~1,917), against Google's ~4.7. [1]
- Google Search referrals to publishers fell **40.2%** year on year to July 2026; AI chatbots sent back about **0.01%** of publisher traffic. [2]
- Big publishers sign licensing deals and lawsuits settle for billions [3], but **the long tail gets nothing**: the blogger, the tutorial writer, the small newsroom. Nobody can negotiate with millions of them, and nobody else can pay them in their own countries. PayPal can.

## What Footnote does

| For **creators** | For **AI apps and agents** |
|---|---|
| Add the **Footnote gate** to your site: people read free, AI crawlers get `402 Payment Required` and can only use your work through Footnote. | One API call (or MCP tool) answers a question from licensed content and settles what it owes. |
| **Connect with PayPal** (Log in with PayPal) so payouts go to a verified account. | **Top up with PayPal** (JS SDK v6). Save PayPal in the **Vault** and agents reload themselves within a weekly limit. |
| Set **licence terms over time** on a Bryntum timeline: e.g. news at ×4 for 30 days, then ×2, then ×1. | Out of balance? The API returns a machine-readable **402** an agent can act on. |
| See every answer your work shaped, with a **signed receipt**, and get paid through **PayPal Payouts**. | Every answer has a receipt: an audit trail you can show a court or a regulator. |

## How one answer works

```mermaid
flowchart LR
  Q[Question] --> R[Retrieve<br/>Postgres full-text + Claude keyword expansion]
  R --> W[Writer model<br/>answers only from sources]
  W --> A[Auditor model<br/>marks support per sentence,<br/>must quote evidence]
  A --> S[Exact Shapley split<br/>per sentence]
  S --> P[Price<br/>base x freshness window]
  P --> M[Exact micro-cent split<br/>largest remainder]
  M --> T[(One transaction:<br/>charge app, write receipt,<br/>credit creators)]
  T --> B[Seal receipts<br/>Merkle tree + Ed25519]
  T --> O[PayPal Payouts<br/>batch, webhooks, reversals]
```

1. **Retrieve.** Postgres full-text search over registered creators' work. Claude adds synonyms so a question about "flat sourdough" also finds a guide about "dough spreading".
2. **Write, then audit.** A writer model (`claude-sonnet-5-5`) answers only from the sources. A **separate** auditor model (`claude-haiku-5-5`) marks how strongly each source backs each sentence (full / partial / none) and **must quote its evidence**. Code checks every quote against the source text; an invented quote cuts that credit.
3. **Split credit fairly.** Each sentence is a cooperative game where a set of sources is worth the strongest support any of them gives (`v(S) = max support`). Its **Shapley values** have an exact closed form, so there is no 2ⁿ enumeration: sort the supports, and each step down is shared equally by the sources above it. A claim only one source makes earns that source all of it; a claim three sources share is split three ways. Common-knowledge sentences earn nobody anything. The closed form is checked against brute-force Shapley on random answers in the test suite.
4. **Catch copies.** MinHash (128 hashes over 5-word shingles) finds near-duplicates at ingestion. A copy earns nothing; its share goes to the earliest original.
5. **Price and pay exactly.** Price = base × each source's current **licence window** (fresh news can cost more). Money is **integer micro-cents** (1 USD = 10⁸), never floats, split with the largest-remainder method so shares always add up to the cent. Charging the app, writing the receipt and crediting creators happen in **one database transaction**; an overdraft rolls back and returns 402.
6. **Prove it.** Receipts are sealed into batches: an RFC 6962 Merkle tree whose root is signed with Ed25519. The [receipt checker](https://footnote.onrender.com/verify) re-verifies the proof and signature **in your browser with WebCrypto**. The public key is at `/.well-known/footnote-key.pem`.
7. **Pay out.** A nightly Render cron job seals receipts, pays every creator over the minimum through **PayPal Payouts**, syncs payout status, and reconciles our ledger with PayPal's **Transaction Search** records.

## How PayPal is used

| PayPal capability | Where | What it does in Footnote |
|---|---|---|
| **Payouts API** (`/v1/payments/payouts`) | `lib/money-ops.ts` | Batch-pays creators. Ledger is debited *before* the call, inside a transaction; idempotent `sender_batch_id`; a rejected batch is reversed. |
| **Payouts webhooks** (`PAYMENT.PAYOUTS-ITEM.*`, `PAYMENT.PAYOUTSBATCH.*`) | `app/api/paypal/webhook` | Tracks every item. `RETURNED`, `FAILED`, `BLOCKED`, `REFUNDED` put the money back on the creator's balance, exactly once. |
| **Orders v2** + **JavaScript SDK v6** | `components/TopUp.tsx`, `app/api/v1/topups` | AI apps top up their balance. The server creates and captures; the capture amount is checked against the order before crediting. |
| **Vault** (save PayPal with purchase, `store_in_vault: ON_SUCCESS`) | `tryAutoReload` | Agents reload themselves from a saved PayPal account when they run out, capped per week **in code**. |
| **Log in with PayPal** (`openid email paypalattributes`) | `app/api/creators/[id]/connect` | Creators connect a verified account; payouts go by PayPal account ID, not a typed email. |
| **Webhook signature verification** (`/v1/notifications/verify-webhook-signature`) | `lib/paypal.ts` | Every event is verified with PayPal before we act; duplicates are ignored by event ID. |
| **Transaction Search** (`/v1/reporting/transactions`) | `lib/reconcile.ts` | Checks every capture and payout we recorded exists in PayPal's records with the same amount. |
| `PayPal-Request-Id` idempotency | every write | Retries can't double-charge or double-pay. |

## How AI is used

- **Claude Sonnet 5.5 (writer):** answers only from retrieved creator content, as standalone sentences.
- **Claude Haiku 5.5 (auditor):** a separate call that marks per-sentence support for each source and quotes evidence; also expands search keywords.
- **The model never decides money.** Shapley shares, prices, splits, limits and payouts are deterministic code. Model output is structured (tool use), validated, and quote-checked.
- Without an API key, or past the daily demo budget, Footnote falls back to an offline extractive mode so the demo never breaks.

## Sponsor tools

- **Render:** web service, Postgres, and the nightly cron job that seals receipts, runs payouts, syncs status and reconciles. Deploy everything from `render.yaml`.
- **Bryntum Scheduler:** creators edit each article's licence windows on a timeline. Drag the end of a window to change when the price steps down; click it to change the price. Changes apply from the next answer.
- **AG Grid:** creator earnings, payouts, AI-app answers and top-ups, and the full ledger, with sorting, filtering and pagination.

## Try it (judges)

1. Open the live demo and press **Ask**. Hover a sentence to see who it came from; hover a creator to see their sentences. The sourdough question shows **copy detection**: a content farm's copy earns nothing and its share goes to Priya.
2. Press **Check receipt**: your browser verifies the Merkle proof and Footnote's signature.
3. **The gate:** `curl -i https://footnote.onrender.com/s/priya-flat-loaf -A "GPTBot/1.2"` returns `402 Payment Required`. The same URL in a browser shows the article.
4. **AI app console:** top up with PayPal using the sandbox buyer below, ticking "Save this PayPal account" to enable agent auto-reload.
5. **Ledger:** press **Run payouts now**, then **Check payout status**, then **Reconcile with PayPal**. Payout and PayPal IDs appear in the tables and on each creator's page.
6. **Creators → The Harbour Ledger:** edit licence windows on the Bryntum timeline, then ask the Halifax question again and see the price change.
7. **MCP:** add `https://footnote.onrender.com/api/mcp` to any MCP client.

**PayPal sandbox buyer:** _email and password listed in the Devpost testing instructions._

## Run it yourself

No database or keys needed for a local run: it uses PGlite (Postgres in WebAssembly) and offline mode.

```bash
git clone https://github.com/manaal28azhar-max/Footnote && cd footnote
npm install
npm run build && npm start      # http://localhost:3000
npm test                        # 36 tests: engine + pipeline + money flows
```

Environment variables (all optional locally):

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres. Without it, PGlite in memory. |
| `ANTHROPIC_API_KEY` | Claude writer and auditor. Without it, offline mode. |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | PayPal sandbox REST app (enable Payouts, Log in with PayPal, Vault). |
| `PAYPAL_WEBHOOK_ID` | Webhook ID from the PayPal dashboard, for signature verification. |
| `SANDBOX_CREATOR_EMAILS` | Comma-separated sandbox personal accounts for the demo creators. |
| `CRON_SECRET` | Authorises the nightly jobs. |
| `FOOTNOTE_SIGNING_KEY` | Ed25519 private key (PEM). Without it, one is generated and stored. |

Deploy on Render: **New → Blueprint →** this repo. Then in the PayPal dashboard add a webhook to `https://<your-host>/api/paypal/webhook` for *Payment capture completed* and all *Payouts* events, and set `PAYPAL_WEBHOOK_ID`.

## Repository

```
packages/core     the engine: Shapley attribution, exact money, Merkle receipts, MinHash   (20 tests)
apps/web          Next.js app, API, MCP server, PayPal integration, pages                  (16 tests)
  lib/answer.ts       the pipeline for one answer
  lib/ai.ts           writer + auditor + quote check + offline mode
  lib/money-ops.ts    top-ups, auto-reload, payouts, reversals
  lib/paypal.ts       PayPal REST client
  lib/sealing.ts      receipt batches and proofs
  lib/gate.ts         the creator-site gate
  app/api/mcp         remote MCP server
render.yaml       web service + Postgres + nightly cron
```

## Honest limits

- All creators, sites and articles are **fictional and written for this demo**. 160 answers of history were generated through the real pipeline in offline mode at setup and are labelled **simulated** everywhere.
- Retrieval is keyword search with model-expanded synonyms; production would add embeddings.
- The auditor's verdicts are model judgements, constrained by the quote check; a production system would sample audits and let creators dispute them.
- Sandbox payouts use a 10-cent minimum so payouts are visible in a demo; production would batch to a higher minimum to keep fees sensible.

## Sources

1. Forbes, *Cloudflare moves to make AI pay for the content it consumes* (July 2026): https://www.forbes.com/sites/sandycarter/2026/07/01/cloudflare-moves-to-make-ai-pay-for-the-content-it-consumes/
2. Worth, *Who pays for AI's inputs?*: https://worth.com/who-pays-for-ais-inputs/
3. Bloomberg Law, *Anthropic to pay $1.5 billion to settle author copyright claims*: https://news.bloomberglaw.com/litigation/anthropic-to-pay-1-5-billion-to-settle-author-copyright-claims
