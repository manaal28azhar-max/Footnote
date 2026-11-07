"use client";
/**
 * Re-checks a receipt in the visitor's own browser with WebCrypto:
 * recompute the Merkle root from the receipt and its proof, then check the
 * Ed25519 signature on that root with Footnote's public key. Nothing here
 * trusts the server's own "ok".
 */
import { useEffect, useState } from "react";

interface Bundle {
  receipt: Record<string, unknown> & { id: string; priceMicro: string; feeMicro?: string; createdAt: string; method: string; lines: { creatorId: string; sourceId: string; share: number; amountMicro: string }[] };
  proof: { index: number; treeSize: number; path: string[] };
  batch: { date: string; treeSize: number; root: string; signature: string; publicKey: string };
  check: { ok: boolean; reason?: string };
}

function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
}
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (h: string) => new Uint8Array(h.match(/../g)!.map((x) => parseInt(x, 16)));
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) (out.set(p, o), (o += p.length));
  return out;
};
const sha = async (...parts: Uint8Array[]) => new Uint8Array(await crypto.subtle.digest("SHA-256", cat(...parts)));

async function rootFromProof(leaf: Uint8Array, index: number, size: number, path: string[]) {
  let fn = index, sn = size - 1, r = leaf;
  for (const h of path) {
    const p = unhex(h);
    if (fn & 1 || fn === sn) {
      r = await sha(new Uint8Array([1]), p, r);
      if (!(fn & 1)) while (fn !== 0 && !(fn & 1)) ((fn >>= 1), (sn >>= 1));
    } else r = await sha(new Uint8Array([1]), r, p);
    fn >>= 1;
    sn >>= 1;
  }
  return r;
}

type Step = { label: string; ok: boolean | null; detail: string };

async function verifyInBrowser(b: Bundle): Promise<Step[]> {
  const steps: Step[] = [];
  const leaf = await sha(new Uint8Array([0]), new TextEncoder().encode(canonical(b.receipt)));
  steps.push({ label: "Hash the receipt", ok: true, detail: `SHA-256 of the receipt’s exact contents: ${hex(leaf.buffer as ArrayBuffer).slice(0, 24)}…` });
  const root = hex((await rootFromProof(leaf, b.proof.index, b.proof.treeSize, b.proof.path)).buffer as ArrayBuffer);
  steps.push({
    label: "Rebuild the batch’s fingerprint",
    ok: root === b.batch.root,
    detail: `Combined with ${b.proof.path.length} neighbouring hashes, this gives ${root.slice(0, 24)}…, ${root === b.batch.root ? "the same as" : "NOT the same as"} the batch’s published root.`,
  });
  try {
    const der = Uint8Array.from(atob(b.batch.publicKey.replace(/-----[^-]+-----|\s/g, "")), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey("spki", der, { name: "Ed25519" }, false, ["verify"]);
    const msg = new TextEncoder().encode(canonical({ date: b.batch.date, root: b.batch.root, treeSize: b.batch.treeSize }));
    const sig = Uint8Array.from(atob(b.batch.signature), (c) => c.charCodeAt(0));
    const ok = await crypto.subtle.verify({ name: "Ed25519" }, key, sig, msg);
    steps.push({ label: "Check Footnote’s signature", ok, detail: ok ? "The batch root is signed with Footnote’s published Ed25519 key." : "The signature does not match." });
  } catch {
    steps.push({ label: "Check Footnote’s signature", ok: null, detail: `This browser can’t check Ed25519 signatures. Footnote’s server reports: ${b.check.ok ? "valid" : "invalid"}.` });
  }
  const lines = b.receipt.lines.reduce((a, l) => a + BigInt(l.amountMicro), 0n) + BigInt(b.receipt.feeMicro ?? "0");
  steps.push({
    label: "Check the money adds up",
    ok: lines === BigInt(b.receipt.priceMicro),
    detail: `Creator shares plus the fee equal the price exactly: ${lines === BigInt(b.receipt.priceMicro) ? "yes" : "no"}.`,
  });
  return steps;
}

export function Verifier({ initial }: { initial?: string }) {
  const [id, setId] = useState(initial ?? "");
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function check(rid: string) {
    setErr(null);
    setBundle(null);
    setSteps(null);
    const res = await fetch(`/api/receipts/${encodeURIComponent(rid.trim())}`);
    const body = await res.json();
    if (!res.ok) return setErr(body.message || "Receipt not found.");
    setBundle(body);
    setSteps(await verifyInBrowser(body));
  }

  useEffect(() => {
    if (initial) check(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allOk = steps?.every((s) => s.ok !== false);
  return (
    <div>
      <form
        className="ask"
        onSubmit={(e) => {
          e.preventDefault();
          if (id.trim()) check(id);
        }}
      >
        <input aria-label="Receipt ID" placeholder="rcpt_..." value={id} onChange={(e) => setId(e.target.value)} />
        <button className="btn">Check receipt</button>
      </form>
      {err && <div className="notice err">{err}</div>}
      {bundle && steps && (
        <div className="result" style={{ gridTemplateColumns: "1fr" }}>
          <h2 className="h2" style={{ color: allOk ? "var(--money)" : "var(--bad)" }}>
            {allOk ? "This receipt is genuine and unaltered." : "This receipt does not check out."}
          </h2>
          <p className="muted small" style={{ margin: 0 }}>
            Checked in your browser, not on Footnote’s server.
          </p>
          <ol className="checks" style={{ paddingLeft: 18 }}>
            {steps.map((s) => (
              <li key={s.label}>
                <b>{s.label}</b>: <span className={s.ok === false ? "s-failed" : ""}>{s.detail}</span>
              </li>
            ))}
          </ol>
          <dl className="kv">
            <dt>Receipt</dt>
            <dd>{bundle.receipt.id}</dd>
            <dt>Issued</dt>
            <dd>{new Date(bundle.receipt.createdAt).toLocaleString("en-GB")}</dd>
            <dt>Price</dt>
            <dd>${(Number(bundle.receipt.priceMicro) / 1e8).toFixed(5)}</dd>
            <dt>Paid to</dt>
            <dd>
              {bundle.receipt.lines.map((l) => (
                <div key={l.creatorId}>
                  {l.creatorId}: {Math.round(l.share * 100)}% = ${(Number(l.amountMicro) / 1e8).toFixed(5)}
                </div>
              ))}
            </dd>
            <dt>Method</dt>
            <dd>{bundle.receipt.method}</dd>
            <dt>Batch</dt>
            <dd>
              {bundle.batch.date}, receipt {bundle.proof.index + 1} of {bundle.batch.treeSize}
            </dd>
            <dt>Batch root</dt>
            <dd>{bundle.batch.root}</dd>
          </dl>
          <a className="btn ghost" style={{ justifySelf: "start" }} download={`${bundle.receipt.id}.json`} href={`data:application/json,${encodeURIComponent(JSON.stringify(bundle, null, 2))}`}>
            Download proof as JSON
          </a>
        </div>
      )}
    </div>
  );
}
