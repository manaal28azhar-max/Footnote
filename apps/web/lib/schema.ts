/**
 * All money columns are BIGINT micro-cents (1 USD = 100,000,000), read back
 * with ::text and parsed as BigInt so no amount ever passes through a float.
 */
export const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS creators (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    handle TEXT UNIQUE NOT NULL,
    site TEXT NOT NULL,
    city TEXT NOT NULL,
    country TEXT NOT NULL,
    bio TEXT NOT NULL DEFAULT '',
    paypal_email TEXT,
    verify_token TEXT NOT NULL,
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    creator_id TEXT NOT NULL REFERENCES creators(id),
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    body TEXT NOT NULL,
    published_at TIMESTAMPTZ NOT NULL,
    terms JSONB NOT NULL,
    credit_to TEXT,
    copy_similarity REAL,
    tsv TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', title || ' ' || body)) STORED
  )`,
  `CREATE INDEX IF NOT EXISTS sources_tsv ON sources USING GIN (tsv)`,
  `CREATE TABLE IF NOT EXISTS apps (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    api_key_hash TEXT UNIQUE NOT NULL,
    balance_micro BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS topups (
    paypal_order_id TEXT PRIMARY KEY,
    app_id TEXT NOT NULL REFERENCES apps(id),
    amount_cents BIGINT NOT NULL,
    status TEXT NOT NULL,
    capture_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    captured_at TIMESTAMPTZ
  )`,
  `CREATE TABLE IF NOT EXISTS answers (
    id TEXT PRIMARY KEY,
    app_id TEXT NOT NULL REFERENCES apps(id),
    question TEXT NOT NULL,
    answer JSONB NOT NULL,
    price_micro BIGINT NOT NULL,
    fee_micro BIGINT NOT NULL,
    mode TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS receipts (
    id TEXT PRIMARY KEY,
    answer_id TEXT NOT NULL REFERENCES answers(id),
    body JSONB NOT NULL,
    batch_date TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS ledger (
    id BIGSERIAL PRIMARY KEY,
    creator_id TEXT NOT NULL REFERENCES creators(id),
    kind TEXT NOT NULL,
    amount_micro BIGINT NOT NULL,
    receipt_id TEXT,
    source_id TEXT,
    payout_item_id TEXT,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS ledger_creator ON ledger (creator_id)`,
  `CREATE TABLE IF NOT EXISTS payout_batches (
    sender_batch_id TEXT PRIMARY KEY,
    paypal_batch_id TEXT,
    status TEXT NOT NULL,
    total_cents BIGINT NOT NULL,
    item_count INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS payout_items (
    sender_item_id TEXT PRIMARY KEY,
    sender_batch_id TEXT NOT NULL REFERENCES payout_batches(sender_batch_id),
    creator_id TEXT NOT NULL REFERENCES creators(id),
    paypal_item_id TEXT,
    amount_cents BIGINT NOT NULL,
    status TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS receipt_batches (
    date TEXT PRIMARY KEY,
    tree_size INT NOT NULL,
    root TEXT NOT NULL,
    signature TEXT NOT NULL,
    public_key TEXT NOT NULL,
    receipt_ids JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS webhook_events (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    verified BOOLEAN NOT NULL,
    payload JSONB NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS llm_cache (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `ALTER TABLE creators ADD COLUMN IF NOT EXISTS paypal_payer_id TEXT`,
  `ALTER TABLE creators ADD COLUMN IF NOT EXISTS gate_hits INT NOT NULL DEFAULT 0`,
  `ALTER TABLE apps ADD COLUMN IF NOT EXISTS vault_id TEXT`,
  `ALTER TABLE apps ADD COLUMN IF NOT EXISTS vault_payer TEXT`,
  `ALTER TABLE apps ADD COLUMN IF NOT EXISTS reload_cents BIGINT NOT NULL DEFAULT 1000`,
  `ALTER TABLE apps ADD COLUMN IF NOT EXISTS reload_weekly_cap_cents BIGINT NOT NULL DEFAULT 3000`,
  `ALTER TABLE topups ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'manual'`,
  `ALTER TABLE payout_items ADD COLUMN IF NOT EXISTS paypal_txn_id TEXT`,
  `ALTER TABLE topups ADD COLUMN IF NOT EXISTS refunded_cents BIGINT NOT NULL DEFAULT 0`,
  `CREATE TABLE IF NOT EXISTS refunds (
     id TEXT PRIMARY KEY,
     app_id TEXT NOT NULL REFERENCES apps(id),
     capture_id TEXT NOT NULL,
     amount_cents BIGINT NOT NULL,
     status TEXT NOT NULL,
     paypal_refund_id TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
];
