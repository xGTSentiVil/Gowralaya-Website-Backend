import 'server-only';
import { SCHEMA_STATEMENTS } from './schema';

// ─────────────────────────────────────────────────────────────────────────────
// Database access.
//
// Production: Neon Postgres, via DATABASE_URL (set automatically when you
// connect Neon to this project in the Vercel dashboard).
//
// Local development without DATABASE_URL: PGlite, a real Postgres compiled to
// WebAssembly that runs in-process and stores its data in ./.data/pglite. The
// same SQL runs in both, so the portal can be tried locally without touching
// the production database. It is never used in production.
// ─────────────────────────────────────────────────────────────────────────────

export type Row = Record<string, unknown>;
type QueryFn = (text: string, params?: unknown[]) => Promise<Row[]>;

// Survives Next's dev-mode module reloads, so we don't open a new connection
// (or a second PGlite instance on the same directory) on every edit.
const g = globalThis as unknown as { __sgDb?: Promise<QueryFn> };

async function connect(): Promise<QueryFn> {
  const url = process.env.DATABASE_URL;
  let query: QueryFn;

  if (url) {
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(url);
    query = (text, params = []) => sql.query(text, params) as Promise<Row[]>;
  } else {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'DATABASE_URL is not set. Connect a Neon Postgres database to this project in the Vercel dashboard.'
      );
    }
    // A variable specifier keeps this dev-only dependency out of the
    // production bundle and its file trace.
    const pgliteModule = '@electric-sql/pglite';
    const { PGlite } = (await import(pgliteModule)) as typeof import('@electric-sql/pglite');
    const { mkdirSync } = await import('node:fs');
    mkdirSync('./.data', { recursive: true }); // PGlite won't create parent folders
    const local = new PGlite('./.data/pglite');
    query = async (text, params = []) => (await local.query<Row>(text, params)).rows;
  }

  await applySchema(query);
  return query;
}

async function applySchema(query: QueryFn): Promise<void> {
  for (const statement of SCHEMA_STATEMENTS) {
    try {
      await query(statement);
    } catch (err) {
      // Two cold starts racing on `create index if not exists` can collide in
      // the system catalog. The object exists either way, so retry once.
      await query(statement).catch(() => {
        throw err;
      });
    }
  }
}

function db(): Promise<QueryFn> {
  g.__sgDb ??= connect().catch((err) => {
    g.__sgDb = undefined; // let the next request try again
    throw err;
  });
  return g.__sgDb;
}

/** Run one parameterised statement. Always pass values as params, never interpolate. */
export async function sql<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  const query = await db();
  return (await query(text, params)) as T[];
}
