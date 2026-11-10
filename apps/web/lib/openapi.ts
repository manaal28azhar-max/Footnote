/**
 * OpenAPI 3.1 description of Footnote's public API, served at /openapi.json.
 * Import it into APIMatic to generate typed SDKs (TypeScript, Python, Java,
 * C#, Go, PHP, Ruby) and a docs portal, or into any OpenAPI tool.
 */
const err = (description: string) => ({ description, content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } });
const money = (description: string) => ({ type: "string", pattern: "^-?\\d+$", description: `${description} Integer micro-cents as a string (1 USD = 100,000,000).` });

export function openapi(server: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Footnote API",
      version: "1.0.0",
      summary: "Every AI answer pays the people it came from.",
      description:
        "Footnote answers questions from licensed creator content, measures how much each creator's work shaped the answer (exact Shapley values over audited sentence support), charges the AI app's prepaid balance, and pays creators through PayPal Payouts. Every answer returns a receipt sealed in an Ed25519-signed Merkle tree. Balances are funded with PayPal.",
      license: { name: "MIT", identifier: "MIT" },
    },
    servers: [{ url: server }],
    security: [{ appKey: [] }],
    tags: [
      { name: "Answers", description: "Answer a question and pay its sources." },
      { name: "Balance", description: "Fund and withdraw the balance with PayPal." },
      { name: "Receipts", description: "Verify what was paid, to whom." },
    ],
    paths: {
      "/api/v1/answer": {
        post: {
          tags: ["Answers"],
          operationId: "createAnswer",
          summary: "Answer a question and pay the creators whose work shaped it",
          description:
            "Retrieves creator content, writes an answer, audits per-sentence support, splits credit with Shapley values, charges the app's balance and returns a receipt. If the balance cannot cover the answer and the app has a saved PayPal account, Footnote first auto-reloads within the weekly limit; otherwise it returns 402.",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object", required: ["question"], properties: { question: { type: "string", minLength: 1, maxLength: 500 } } }, example: { question: "Why is my sourdough flat and dense?" } } },
          },
          responses: {
            "200": { description: "The answer, who was paid and the receipt.", content: { "application/json": { schema: { $ref: "#/components/schemas/Answer" } } } },
            "400": err("The question is missing or too long."),
            "401": err("The API key is not valid."),
            "402": { description: "The balance cannot cover this answer. Nothing was charged.", content: { "application/json": { schema: { $ref: "#/components/schemas/PaymentRequired" } } } },
          },
        },
      },
      "/api/v1/topups": {
        post: {
          tags: ["Balance"],
          operationId: "createTopup",
          summary: "Start a PayPal top-up of the balance",
          description: "Creates a PayPal order (Orders v2). The payer approves it at approveUrl (or with the PayPal JavaScript SDK); then call captureTopup. Tick save_for_autoreload to save the PayPal account in the PayPal Vault for agent auto-reloads.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { type: "object", required: ["amount_usd"], properties: { amount_usd: { type: "string", enum: ["5.00", "10.00", "25.00"] }, save_for_autoreload: { type: "boolean", default: false } } },
              },
            },
          },
          responses: {
            "200": {
              description: "The PayPal order to approve.",
              content: { "application/json": { schema: { type: "object", required: ["orderId"], properties: { orderId: { type: "string" }, status: { type: "string" }, approveUrl: { type: "string", format: "uri" } } } } },
            },
            "400": err("Invalid amount."),
            "502": err("PayPal could not create the order."),
            "503": err("PayPal is not configured on this deployment."),
          },
        },
      },
      "/api/v1/topups/{orderId}/capture": {
        post: {
          tags: ["Balance"],
          operationId: "captureTopup",
          summary: "Capture an approved top-up and credit the balance",
          description: "Idempotent: the balance is credited exactly once whether this call or PayPal's PAYMENT.CAPTURE.COMPLETED webhook arrives first. The captured amount is checked against the order.",
          security: [],
          parameters: [{ name: "orderId", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Captured.", content: { "application/json": { schema: { type: "object", properties: { credited: { type: "boolean" }, appId: { type: "string" } } } } } },
            "400": err("Unknown order, or the amount does not match."),
          },
        },
      },
      "/api/v1/refunds": {
        post: {
          tags: ["Balance"],
          operationId: "refundBalance",
          summary: "Refund unused balance to PayPal",
          description: "Refunds unused balance to the PayPal account(s) that paid it, newest top-up first, through the PayPal Payments refund API. Only money topped up through PayPal can be refunded. A refund PayPal rejects is put back on the balance.",
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["amount_usd"], properties: { amount_usd: { type: "string", pattern: "^\\d+(\\.\\d{1,2})?$" } } } } } },
          responses: {
            "200": { description: "Refunded.", content: { "application/json": { schema: { $ref: "#/components/schemas/RefundResult" } } } },
            "400": err("More than the refundable balance."),
            "502": { description: "PayPal refused some refunds; that money is back on the balance.", content: { "application/json": { schema: { $ref: "#/components/schemas/RefundResult" } } } },
          },
        },
      },
      "/api/receipts/{receiptId}": {
        get: {
          tags: ["Receipts"],
          operationId: "getReceipt",
          summary: "Get a receipt with its Merkle proof and signed batch",
          description: "Everything needed to verify a receipt offline: hash it (SHA-256 of 0x00 + canonical JSON), rebuild the root from the RFC 6962 proof, and check the Ed25519 signature over {date, root, treeSize} with the key at /.well-known/footnote-key.pem.",
          security: [],
          parameters: [{ name: "receiptId", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "The receipt bundle.", content: { "application/json": { schema: { $ref: "#/components/schemas/ReceiptBundle" } } } }, "404": err("No receipt with that ID.") },
        },
      },
      "/.well-known/footnote-key.pem": {
        get: { tags: ["Receipts"], operationId: "getSigningKey", summary: "Footnote's public Ed25519 signing key", security: [], responses: { "200": { description: "PEM (SPKI).", content: { "application/x-pem-file": { schema: { type: "string" } } } } } },
      },
    },
    components: {
      securitySchemes: { appKey: { type: "http", scheme: "bearer", description: "The AI app's Footnote API key. Without one, calls act as the public demo app." } },
      schemas: {
        Error: { type: "object", required: ["error", "message"], properties: { error: { type: "string" }, message: { type: "string" } } },
        PaymentRequired: {
          type: "object",
          required: ["error", "price_usd", "balance_usd", "top_up"],
          properties: {
            error: { const: "payment_required" },
            message: { type: "string" },
            price_usd: { type: "string" },
            balance_usd: { type: "string" },
            top_up: { type: "object", properties: { method: { const: "POST" }, url: { type: "string", format: "uri" }, body: { type: "object" }, console: { type: "string", format: "uri" } } },
          },
        },
        Sentence: {
          type: "object",
          required: ["text", "support"],
          properties: {
            text: { type: "string" },
            weight: { type: "number", description: "Words in the sentence." },
            commonKnowledge: { type: "boolean", description: "Earns nobody anything." },
            support: { type: "array", items: { type: "number", minimum: 0, maximum: 1 }, description: "Support from each source (1 full, 0.5 partial, 0 none), after the quote check." },
            evidence: {
              type: "array",
              items: { type: "object", properties: { level: { enum: ["full", "partial", "none"] }, quote: { type: "string" }, quoteVerified: { type: "boolean" } } },
            },
            split: { type: "array", items: { type: "number" }, description: "Shapley value of each source for this sentence." },
          },
        },
        Source: {
          type: "object",
          properties: {
            index: { type: "integer" },
            id: { type: "string" },
            creatorId: { type: "string" },
            paidCreatorId: { type: "string", description: "Who is paid: the creator, or the original author if this is a copy." },
            title: { type: "string" },
            url: { type: "string", format: "uri" },
            creatorName: { type: "string" },
            window: { type: "object", properties: { label: { type: "string" }, multiplier: { type: "number" } } },
            copyOf: { type: ["object", "null"], properties: { sourceId: { type: "string" }, creatorName: { type: "string" }, similarity: { type: "number" } } },
            injectionRemoved: { type: ["array", "null"], items: { type: "string" }, description: "Hidden instructions to AI systems removed from this page before any model read it." },
            share: { type: "number", description: "Shapley share of the answer." },
          },
        },
        Credit: {
          type: "object",
          required: ["creatorId", "share", "amountMicro"],
          properties: { creatorId: { type: "string" }, creatorName: { type: "string" }, sourceIds: { type: "array", items: { type: "string" } }, share: { type: "number" }, multiplier: { type: "number" }, amountMicro: money("Paid to this creator.") },
        },
        Answer: {
          type: "object",
          required: ["id", "sentences", "credits", "priceMicro"],
          properties: {
            id: { type: "string" },
            receiptId: { type: ["string", "null"] },
            question: { type: "string" },
            mode: { enum: ["claude", "offline"] },
            sentences: { type: "array", items: { $ref: "#/components/schemas/Sentence" } },
            sources: { type: "array", items: { $ref: "#/components/schemas/Source" } },
            credits: { type: "array", items: { $ref: "#/components/schemas/Credit" } },
            priceMicro: money("What this answer cost the app."),
            feeMicro: money("Footnote's fee, included in the price."),
            sourcedFraction: { type: "number", description: "Share of the answer's words that creator content backs." },
            balanceMicro: money("The app's balance after this answer."),
            autoReload: { type: "string", description: "Present if the balance was reloaded from saved PayPal to pay for this answer." },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        RefundResult: {
          type: "object",
          properties: {
            requestedCents: { type: "string" },
            message: { type: "string" },
            refunds: { type: "array", items: { type: "object", properties: { captureId: { type: "string" }, refundId: { type: "string" }, status: { type: "string" }, cents: { type: "string" }, error: { type: "string" } } } },
          },
        },
        ReceiptBundle: {
          type: "object",
          properties: {
            receipt: { type: "object", description: "The signed receipt: who was paid, how much, for which answer (hashed)." },
            proof: { type: "object", properties: { index: { type: "integer" }, treeSize: { type: "integer" }, path: { type: "array", items: { type: "string" } } } },
            batch: { type: "object", properties: { date: { type: "string" }, treeSize: { type: "integer" }, root: { type: "string" }, signature: { type: "string" }, publicKey: { type: "string" } } },
            check: { type: "object", properties: { ok: { type: "boolean" }, reason: { type: "string" } } },
          },
        },
      },
    },
  };
}
