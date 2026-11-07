import { db } from "@/lib/db";
import { publicKeyPem } from "@/lib/sealing";

export const dynamic = "force-dynamic";

/** Footnote's public signing key: anyone can verify receipt batches with it. */
export async function GET() {
  return new Response(await publicKeyPem(await db()), { headers: { "content-type": "application/x-pem-file" } });
}
