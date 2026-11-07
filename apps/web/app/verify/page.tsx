import { Verifier } from "@/components/Verifier";

export default async function Verify({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  return (
    <main className="page">
      <div className="wrap">
        <h1 className="display" style={{ fontSize: "var(--s3)", maxWidth: "none" }}>
          Check a receipt
        </h1>
        <p className="lede">
          Every answer gets a receipt saying who was paid and how much. Receipts are sealed into signed batches, so you can prove one is genuine without
          trusting Footnote.
        </p>
        <Verifier initial={sp.receipt} />
      </div>
    </main>
  );
}
