import type { Db } from "./db";
import { hashKey } from "./seed";

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

export const baseUrl = () => (process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || "http://localhost:3000").replace(/\/$/, "");

/** Find the AI app for a `Authorization: Bearer fn_...` header. */
export async function appFromRequest(d: Db, req: Request): Promise<{ id: string; name: string } | null> {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") || "");
  if (!m) return null;
  const rows = await d.query<{ id: string; name: string }>("SELECT id, name FROM apps WHERE api_key_hash = $1", [hashKey(m[1])]);
  return rows[0] ?? null;
}

const hits = new Map<string, number[]>();
/** Sliding-window rate limit, per process. Protects the public demo's AI budget. */
export function rateLimited(key: string, limit: number, windowMs = 3_600_000): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.set(key, recent);
  return false;
}

export const clientIp = (req: Request) => (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "local";
