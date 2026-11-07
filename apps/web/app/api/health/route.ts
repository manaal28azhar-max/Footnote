import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const d = await db();
  await d.query("SELECT 1");
  return Response.json({ ok: true, database: process.env.DATABASE_URL ? "postgres" : "pglite", ai: !!process.env.ANTHROPIC_API_KEY, paypal: !!process.env.PAYPAL_CLIENT_ID });
}
