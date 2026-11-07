import type { Query } from "./db";
import type { Terms } from "./terms";

export interface RetrievedSource {
  id: string;
  creatorId: string;
  creatorName: string;
  creatorCity: string;
  creatorCountry: string;
  title: string;
  url: string;
  body: string;
  publishedAt: string;
  terms: Terms;
  creditTo: string | null;
  copySimilarity: number | null;
  rank: number;
}

const STOP = new Set(
  "a an and are as at be but by can do does for from how i if in into is it its me my of on or our so that the their them then there these this to was what when where which who why will with you your should would could".split(" "),
);

/** Turn a natural question into an OR query so partial matches still rank. */
export function toTsQuery(question: string): string | null {
  const words = question
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
  const uniq = [...new Set(words)].slice(0, 16);
  return uniq.length ? uniq.join(" | ") : null;
}

/**
 * Full-text retrieval with Postgres ranking (cover density, length-normalised).
 * `expansion` is optional extra search words (synonyms) from the model.
 */
export async function retrieve(q: Query, question: string, k = 5, expansion: string[] = []): Promise<RetrievedSource[]> {
  const tsq = toTsQuery([question, ...expansion].join(" "));
  if (!tsq) return [];
  const rows = await q<Record<string, unknown>>(
    `SELECT s.id, s.creator_id, c.name AS creator_name, c.city, c.country, s.title, s.url, s.body,
            s.published_at, s.terms, s.credit_to, s.copy_similarity,
            ts_rank_cd(s.tsv, to_tsquery('english', $1), 32) AS rank
       FROM sources s JOIN creators c ON c.id = s.creator_id
      WHERE s.tsv @@ to_tsquery('english', $1)
      ORDER BY rank DESC, s.published_at ASC
      LIMIT $2`,
    [tsq, k * 2],
  );
  if (!rows.length) return [];
  // Keep sources whose rank is a meaningful fraction of the best match, so a
  // passing mention of one word does not end up in the context.
  const best = Number(rows[0].rank);
  return rows
    .filter((r) => Number(r.rank) >= best * 0.2)
    .slice(0, k)
    .map((r) => ({
      id: String(r.id),
      creatorId: String(r.creator_id),
      creatorName: String(r.creator_name),
      creatorCity: String(r.city),
      creatorCountry: String(r.country),
      title: String(r.title),
      url: String(r.url),
      body: String(r.body),
      publishedAt: new Date(r.published_at as string).toISOString(),
      terms: (typeof r.terms === "string" ? JSON.parse(r.terms) : r.terms) as Terms,
      creditTo: (r.credit_to as string) ?? null,
      copySimilarity: r.copy_similarity == null ? null : Number(r.copy_similarity),
      rank: Number(r.rank),
    }));
}
