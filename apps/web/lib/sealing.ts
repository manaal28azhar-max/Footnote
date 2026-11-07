/**
 * Receipts are sealed into append-only batches: every unsealed receipt goes
 * into a Merkle tree whose root is signed with Footnote's Ed25519 key. The
 * public key is published at /.well-known/footnote-key.pem, so anyone can
 * check a receipt without trusting this server.
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync, KeyObject } from "node:crypto";
import { ReceiptLog, verifyReceipt } from "@footnote/core";
import type { Receipt, SignedBatch, InclusionProof } from "@footnote/core";
import type { Db } from "./db";

let key: KeyObject | null = null;

export async function signingKey(d: Db): Promise<KeyObject> {
  if (key) return key;
  if (process.env.FOOTNOTE_SIGNING_KEY) {
    key = createPrivateKey(process.env.FOOTNOTE_SIGNING_KEY.replace(/\\n/g, "\n"));
    return key;
  }
  // Fallback: generate once and keep it in the database (fine for a demo;
  // production should set FOOTNOTE_SIGNING_KEY).
  const [row] = await d.query<{ value: string }>("SELECT value FROM settings WHERE key = 'signing_key'");
  if (row) return (key = createPrivateKey(row.value));
  const pem = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  await d.query("INSERT INTO settings (key, value) VALUES ('signing_key', $1) ON CONFLICT (key) DO NOTHING", [pem]);
  const [again] = await d.query<{ value: string }>("SELECT value FROM settings WHERE key = 'signing_key'");
  return (key = createPrivateKey(again.value));
}

export async function publicKeyPem(d: Db) {
  return createPublicKey(await signingKey(d)).export({ type: "spki", format: "pem" }).toString();
}

const parse = <T>(v: unknown): T => (typeof v === "string" ? JSON.parse(v) : (v as T));

/** Seal every unsealed receipt into a new signed batch. */
export async function sealPending(d: Db, now = new Date()): Promise<SignedBatch | null> {
  const k = await signingKey(d);
  return d.tx(async (q) => {
    const rows = await q<{ id: string; body: unknown }>(`SELECT id, body FROM receipts WHERE batch_date IS NULL ORDER BY created_at, id FOR UPDATE`);
    if (!rows.length) return null;
    const receipts = rows.map((r) => parse<Receipt>(r.body));
    const batchId = now.toISOString().replace(/\.\d+Z$/, "Z");
    const log = new ReceiptLog(receipts);
    const batch = log.sign(batchId, k);
    await q(`INSERT INTO receipt_batches (date, tree_size, root, signature, public_key, receipt_ids) VALUES ($1,$2,$3,$4,$5,$6)`, [
      batch.date,
      batch.treeSize,
      batch.root,
      batch.signature,
      batch.publicKey,
      JSON.stringify(receipts.map((r) => r.id)),
    ]);
    await q(`UPDATE receipts SET batch_date = $1 WHERE id = ANY($2)`, [batchId, receipts.map((r) => r.id)]);
    return batch;
  });
}

export interface ReceiptBundle {
  receipt: Receipt;
  proof: InclusionProof;
  batch: SignedBatch;
  check: { ok: boolean; reason?: string };
}

/** Everything needed to verify one receipt independently. Seals it first if needed. */
export async function receiptBundle(d: Db, receiptId: string): Promise<ReceiptBundle | null> {
  const [r] = await d.query<{ body: unknown; batch_date: string | null }>("SELECT body, batch_date FROM receipts WHERE id = $1", [receiptId]);
  if (!r) return null;
  if (!r.batch_date) await sealPending(d);
  const [rr] = await d.query<{ batch_date: string }>("SELECT batch_date FROM receipts WHERE id = $1", [receiptId]);
  const [b] = await d.query<{ date: string; tree_size: number; root: string; signature: string; public_key: string; receipt_ids: unknown }>(
    "SELECT * FROM receipt_batches WHERE date = $1",
    [rr.batch_date],
  );
  const ids = parse<string[]>(b.receipt_ids);
  const all = await d.query<{ id: string; body: unknown }>("SELECT id, body FROM receipts WHERE id = ANY($1)", [ids]);
  const byId = new Map(all.map((x) => [x.id, parse<Receipt>(x.body)]));
  const log = new ReceiptLog(ids.map((id) => byId.get(id)!));
  const batch: SignedBatch = { date: b.date, treeSize: Number(b.tree_size), root: b.root, signature: b.signature, publicKey: b.public_key };
  const receipt = parse<Receipt>(r.body);
  const proof = log.proof(receiptId);
  return { receipt, proof, batch, check: verifyReceipt(receipt, proof, batch) };
}
