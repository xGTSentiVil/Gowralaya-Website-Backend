import 'server-only';
import { sql } from './db';
import type { MediaItem } from './shared/media';

// ─────────────────────────────────────────────────────────────────────────────
// The updates timeline: every query in one place.
// ─────────────────────────────────────────────────────────────────────────────

export interface UpdateRecord {
  id: string;
  projectId: string | null;
  caption: string;
  /** YYYY-MM-DD */
  takenOn: string;
  isPublished: boolean;
  media: MediaItem[];
  createdAt: string;
}

/** What the public API returns: no storage sizes, no hidden posts. */
export interface PublicUpdate {
  id: string;
  projectId: string | null;
  caption: string;
  date: string;
  media: PublicMedia[];
}

export type PublicMedia =
  | { kind: 'image'; url: string; thumb: string; w: number; h: number }
  | { kind: 'video'; url: string; poster: string; w: number; h: number; durationSec: number }
  | { kind: 'youtube'; id: string };

/** The filter value the site uses for company-wide posts with no project. */
export const GENERAL = 'general';

const COLUMNS = `
  id::text as id,
  project_id,
  caption,
  to_char(taken_on, 'YYYY-MM-DD') as taken_on,
  is_published,
  media,
  created_at::text as created_at`;

interface RawRow {
  id: string;
  project_id: string | null;
  caption: string;
  taken_on: string;
  is_published: boolean;
  media: unknown;
  created_at: string;
}

function toRecord(row: RawRow): UpdateRecord {
  const media = typeof row.media === 'string' ? JSON.parse(row.media) : row.media;
  return {
    id: row.id,
    projectId: row.project_id,
    caption: row.caption,
    takenOn: row.taken_on,
    isPublished: row.is_published,
    media: Array.isArray(media) ? (media as MediaItem[]) : [],
    createdAt: row.created_at,
  };
}

export function toPublic(u: UpdateRecord): PublicUpdate {
  return {
    id: u.id,
    projectId: u.projectId,
    caption: u.caption,
    date: u.takenOn,
    media: u.media.map((m): PublicMedia => {
      if (m.kind === 'image') return { kind: 'image', url: m.url, thumb: m.thumb, w: m.w, h: m.h };
      if (m.kind === 'video')
        return { kind: 'video', url: m.url, poster: m.poster, w: m.w, h: m.h, durationSec: m.durationSec };
      return { kind: 'youtube', id: m.id };
    }),
  };
}

// ── Cursor pagination (stable under inserts: taken_on, created_at, id) ─────

interface Cursor {
  t: string;
  c: string;
  i: string;
}

export function encodeCursor(u: UpdateRecord): string {
  const c: Cursor = { t: u.takenOn, c: u.createdAt, i: u.id };
  return Buffer.from(JSON.stringify(c)).toString('base64url');
}

function decodeCursor(value: string | null): Cursor | null {
  if (!value) return null;
  try {
    const c = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Cursor;
    const ok =
      /^\d{4}-\d{2}-\d{2}$/.test(c.t) &&
      typeof c.c === 'string' &&
      /^[0-9a-f-]{36}$/i.test(c.i);
    return ok ? c : null;
  } catch {
    return null;
  }
}

// ── Public feed ─────────────────────────────────────────────────────────────

export async function listPublished(opts: {
  projectId: string | null;
  limit: number;
  before: string | null;
}): Promise<{ updates: UpdateRecord[]; nextCursor: string | null }> {
  const cursor = decodeCursor(opts.before);
  const limit = Math.min(Math.max(opts.limit, 1), 100);

  const rows = await sql<RawRow>(
    `select ${COLUMNS}
       from updates
      where is_published
        and ($1::text is null
             or ($1::text = '${GENERAL}' and project_id is null)
             or project_id = $1::text)
        and ($2::date is null
             or (taken_on, created_at, id) < ($2::date, $3::timestamptz, $4::uuid))
      order by taken_on desc, created_at desc, id desc
      limit $5`,
    [opts.projectId, cursor?.t ?? null, cursor?.c ?? null, cursor?.i ?? null, limit + 1]
  );

  const records = rows.map(toRecord);
  const hasMore = records.length > limit;
  const page = records.slice(0, limit);
  return { updates: page, nextCursor: hasMore ? encodeCursor(page[page.length - 1]) : null };
}

// ── Admin ───────────────────────────────────────────────────────────────────

export async function listAll(): Promise<UpdateRecord[]> {
  const rows = await sql<RawRow>(
    `select ${COLUMNS} from updates order by taken_on desc, created_at desc, id desc limit 500`
  );
  return rows.map(toRecord);
}

export async function getUpdate(id: string): Promise<UpdateRecord | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = await sql<RawRow>(`select ${COLUMNS} from updates where id = $1::uuid`, [id]);
  return rows[0] ? toRecord(rows[0]) : null;
}

export interface UpdateInput {
  projectId: string | null;
  caption: string;
  takenOn: string;
  isPublished: boolean;
  media: MediaItem[];
}

export async function createUpdate(input: UpdateInput): Promise<string> {
  const rows = await sql<{ id: string }>(
    `insert into updates (project_id, caption, taken_on, is_published, media)
     values ($1, $2, $3::date, $4, $5::jsonb)
     returning id::text as id`,
    [input.projectId, input.caption, input.takenOn, input.isPublished, JSON.stringify(input.media)]
  );
  return rows[0].id;
}

export async function saveUpdate(id: string, input: UpdateInput): Promise<boolean> {
  const rows = await sql(
    `update updates
        set project_id = $2, caption = $3, taken_on = $4::date,
            is_published = $5, media = $6::jsonb, updated_at = now()
      where id = $1::uuid
      returning id`,
    [id, input.projectId, input.caption, input.takenOn, input.isPublished, JSON.stringify(input.media)]
  );
  return rows.length > 0;
}

export async function setPublished(id: string, published: boolean): Promise<boolean> {
  const rows = await sql(
    `update updates set is_published = $2, updated_at = now() where id = $1::uuid returning id`,
    [id, published]
  );
  return rows.length > 0;
}

export async function deleteUpdate(id: string): Promise<UpdateRecord | null> {
  const rows = await sql<RawRow>(`delete from updates where id = $1::uuid returning ${COLUMNS}`, [id]);
  return rows[0] ? toRecord(rows[0]) : null;
}

/** Bytes held in storage by every post, published or hidden. */
export async function storageBytes(): Promise<number> {
  const rows = await sql<{ bytes: number }>(
    `select coalesce(sum((m->>'bytes')::float8), 0)::float8 as bytes
       from updates, jsonb_array_elements(media) as m`
  );
  return Number(rows[0]?.bytes ?? 0);
}

/** Every stored URL any post still references. */
export async function referencedUrls(): Promise<Set<string>> {
  const rows = await sql<{ url: string }>(
    `select distinct v as url
       from updates, jsonb_array_elements(media) as m,
            lateral (values (m->>'url'), (m->>'thumb'), (m->>'poster')) as x(v)
      where v is not null`
  );
  return new Set(rows.map((r) => r.url));
}

// ── Login rate limiting ─────────────────────────────────────────────────────

const LOGIN_WINDOW_MINUTES = 15;
const LOGIN_MAX_FAILURES = 5;

export async function loginBlockedFor(ip: string): Promise<number> {
  const rows = await sql<{ fails: number; oldest: string | null }>(
    `select count(*)::int as fails, min(attempted_at)::text as oldest
       from login_attempts
      where ip = $1 and attempted_at > now() - make_interval(mins => $2)`,
    [ip, LOGIN_WINDOW_MINUTES]
  );
  const { fails, oldest } = rows[0] ?? { fails: 0, oldest: null };
  if (fails < LOGIN_MAX_FAILURES || !oldest) return 0;
  const unblockAt = new Date(oldest).getTime() + LOGIN_WINDOW_MINUTES * 60_000;
  return Math.max(1, Math.ceil((unblockAt - Date.now()) / 60_000));
}

export async function recordLoginFailure(ip: string): Promise<void> {
  await sql(`insert into login_attempts (ip) values ($1)`, [ip]);
  await sql(`delete from login_attempts where attempted_at < now() - interval '1 day'`);
}

export async function clearLoginFailures(ip: string): Promise<void> {
  await sql(`delete from login_attempts where ip = $1`, [ip]);
}
