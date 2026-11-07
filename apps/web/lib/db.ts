/**
 * One tiny database interface, two engines:
 *  - Postgres (pg) in production, when DATABASE_URL is set (Render Postgres).
 *  - PGlite (Postgres compiled to WebAssembly) for local runs and tests, so
 *    anyone can clone the repo and run it with no database to install.
 * Both speak the same SQL and use $1-style parameters.
 */
import { SCHEMA } from "./schema";
import { seed } from "./seed";

export type Row = Record<string, unknown>;
export type Query = <T extends Row = Row>(sql: string, params?: unknown[]) => Promise<T[]>;
export interface Db {
  query: Query;
  tx<T>(fn: (q: Query) => Promise<T>): Promise<T>;
}

async function connect(): Promise<Db> {
  if (process.env.DATABASE_URL) {
    const { Pool } = (await import("pg")).default ?? (await import("pg"));
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
      max: 5,
    });
    const query: Query = async (sql, params) => (await pool.query(sql, params as unknown[])).rows;
    return {
      query,
      async tx(fn) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const out = await fn(async (sql, params) => (await client.query(sql, params as unknown[])).rows);
          await client.query("COMMIT");
          return out;
        } catch (e) {
          await client.query("ROLLBACK");
          throw e;
        } finally {
          client.release();
        }
      },
    };
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite(process.env.PGLITE_DIR || undefined);
  const query: Query = async (sql, params) => (await pg.query(sql, params as unknown[])).rows as never;
  return {
    query,
    tx: (fn) => pg.transaction((t) => fn(async (sql, params) => (await t.query(sql, params as unknown[])).rows as never)),
  };
}

const g = globalThis as unknown as { __footnoteDb?: Promise<Db> };

/** Shared connection; runs migrations and seeds demo data on first use. */
export function db(): Promise<Db> {
  if (!g.__footnoteDb) {
    g.__footnoteDb = (async () => {
      const d = await connect();
      for (const stmt of SCHEMA) await d.query(stmt);
      await seed(d);
      return d;
    })().catch((e) => {
      g.__footnoteDb = undefined;
      throw e;
    });
  }
  return g.__footnoteDb;
}

/** Test helper: a fresh, isolated in-memory database. */
export async function freshDb(): Promise<Db> {
  delete process.env.DATABASE_URL;
  g.__footnoteDb = undefined;
  return db();
}
