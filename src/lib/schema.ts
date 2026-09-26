// ─────────────────────────────────────────────────────────────────────────────
// Database schema: the updates timeline + login rate limiting.
//
// Applied automatically the first time the app talks to the database (see
// db.ts), so there is no separate migration step to remember. Every statement
// is idempotent. Kept as separate statements because the Neon HTTP driver runs
// one statement per call.
// ─────────────────────────────────────────────────────────────────────────────

export const SCHEMA_STATEMENTS: string[] = [
  `create table if not exists updates (
     id            uuid primary key default gen_random_uuid(),
     -- A project id from the website's projects.ts. NULL = a general company
     -- update that isn't about one project.
     project_id    text,
     caption       text not null default '' check (char_length(caption) <= 2000),
     -- The date shown on the timeline. Editable, because photos are often
     -- posted a few days after they were taken.
     taken_on      date not null default current_date,
     is_published  boolean not null default true,
     -- Ordered media items, see MediaItem in media.ts.
     media         jsonb not null default '[]'::jsonb,
     created_at    timestamptz not null default now(),
     updated_at    timestamptz not null default now()
   )`,

  // The public feed: newest first, published only.
  `create index if not exists updates_feed_idx
     on updates (taken_on desc, created_at desc, id desc)
     where is_published`,

  // The per-project feed.
  `create index if not exists updates_project_feed_idx
     on updates (project_id, taken_on desc, created_at desc, id desc)
     where is_published`,

  // Failed login attempts, for rate limiting.
  `create table if not exists login_attempts (
     ip            text not null,
     attempted_at  timestamptz not null default now()
   )`,

  `create index if not exists login_attempts_ip_idx
     on login_attempts (ip, attempted_at)`,
];
