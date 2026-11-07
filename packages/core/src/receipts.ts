/**
 * Verifiable receipts.
 *
 * Every answer produces a receipt (who contributed, what share, how much).
 * At the end of each day the receipts are hashed into a Merkle tree
 * (RFC 6962 layout, the same structure Certificate Transparency logs use)
 * and the root is signed with Footnote's Ed25519 key.
 *
 * A creator holding one receipt can check, with ~log2(N) hashes and the
 * published signed root, that their receipt is in the official record and
 * has not been altered, without trusting Footnote's database.
 */
import { createHash, generateKeyPairSync, sign, verify, KeyObject, createPublicKey } from "node:crypto";

export interface ReceiptLine {
  sourceId: string;
  creatorId: string;
  share: number; // 0..1
  amountMicro: string; // bigint as string, so JSON stays exact
}

export interface Receipt {
  id: string;
  appId: string;
  queryHash: string; // sha256 of the question, so the query itself stays private
  answerHash: string;
  createdAt: string; // ISO time
  priceMicro: string;
  /** Footnote's fee; lines add up to priceMicro - feeMicro exactly. */
  feeMicro?: string;
  method: string;
  lines: ReceiptLine[];
}

/** Deterministic JSON: object keys sorted at every level. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "bigint") return JSON.stringify(value.toString());
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(",")}}`;
}

const sha256 = (...parts: Buffer[]) => createHash("sha256").update(Buffer.concat(parts)).digest();
const LEAF = Buffer.from([0x00]);
const NODE = Buffer.from([0x01]);

export const leafHash = (receipt: Receipt) => sha256(LEAF, Buffer.from(canonicalJson(receipt), "utf8"));
const nodeHash = (l: Buffer, r: Buffer) => sha256(NODE, l, r);

/** Largest power of two strictly less than n (n >= 2). */
function split(n: number): number {
  let k = 1;
  while (k << 1 < n) k <<= 1;
  return k;
}

function rootOf(leaves: Buffer[]): Buffer {
  if (leaves.length === 0) return sha256();
  if (leaves.length === 1) return leaves[0];
  const k = split(leaves.length);
  return nodeHash(rootOf(leaves.slice(0, k)), rootOf(leaves.slice(k)));
}

/** Audit path for leaf `index` (RFC 6962 section 2.1.1). */
function pathOf(index: number, leaves: Buffer[]): Buffer[] {
  if (leaves.length <= 1) return [];
  const k = split(leaves.length);
  return index < k
    ? [...pathOf(index, leaves.slice(0, k)), rootOf(leaves.slice(k))]
    : [...pathOf(index - k, leaves.slice(k)), rootOf(leaves.slice(0, k))];
}

export interface InclusionProof {
  index: number;
  treeSize: number;
  path: string[]; // hex hashes, leaf-to-root order
}

/** Recompute the root from a leaf and its audit path (RFC 9162 algorithm). */
export function rootFromProof(leaf: Buffer, proof: InclusionProof): Buffer {
  const { index, treeSize } = proof;
  if (index < 0 || index >= treeSize) throw new RangeError("index out of range");
  let fn = index;
  let sn = treeSize - 1;
  let r = leaf;
  for (const hex of proof.path) {
    const p = Buffer.from(hex, "hex");
    if (sn === 0) throw new Error("proof too long");
    if (fn & 1 || fn === sn) {
      r = nodeHash(p, r);
      if (!(fn & 1)) {
        while (fn !== 0 && !(fn & 1)) {
          fn >>= 1;
          sn >>= 1;
        }
      }
    } else {
      r = nodeHash(r, p);
    }
    fn >>= 1;
    sn >>= 1;
  }
  if (sn !== 0) throw new Error("proof too short");
  return r;
}

export interface SignedBatch {
  date: string; // e.g. "2026-11-12"
  treeSize: number;
  root: string; // hex
  signature: string; // base64 Ed25519 over canonical {date, root, treeSize}
  publicKey: string; // PEM, published so anyone can verify
}

const batchPayload = (b: Pick<SignedBatch, "date" | "root" | "treeSize">) =>
  Buffer.from(canonicalJson({ date: b.date, root: b.root, treeSize: b.treeSize }), "utf8");

export class ReceiptLog {
  private leaves: Buffer[];
  constructor(private receipts: Receipt[]) {
    this.leaves = receipts.map(leafHash);
  }
  root(): string {
    return rootOf(this.leaves).toString("hex");
  }
  proof(receiptId: string): InclusionProof {
    const index = this.receipts.findIndex((r) => r.id === receiptId);
    if (index < 0) throw new Error(`Receipt ${receiptId} is not in this batch`);
    return { index, treeSize: this.leaves.length, path: pathOf(index, this.leaves).map((h) => h.toString("hex")) };
  }
  sign(date: string, privateKey: KeyObject): SignedBatch {
    const unsigned = { date, root: this.root(), treeSize: this.leaves.length };
    return {
      ...unsigned,
      signature: sign(null, batchPayload(unsigned), privateKey).toString("base64"),
      publicKey: createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString(),
    };
  }
}

export const newSigningKey = () => generateKeyPairSync("ed25519").privateKey;

/** Everything a creator needs to check one receipt, with no trust in Footnote. */
export function verifyReceipt(receipt: Receipt, proof: InclusionProof, batch: SignedBatch): { ok: boolean; reason?: string } {
  const sigOk = verify(null, batchPayload(batch), createPublicKey(batch.publicKey), Buffer.from(batch.signature, "base64"));
  if (!sigOk) return { ok: false, reason: "Batch signature is invalid" };
  if (proof.treeSize !== batch.treeSize) return { ok: false, reason: "Proof is for a different batch size" };
  let root: Buffer;
  try {
    root = rootFromProof(leafHash(receipt), proof);
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
  return root.toString("hex") === batch.root ? { ok: true } : { ok: false, reason: "Receipt does not match the signed record" };
}
