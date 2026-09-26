import 'server-only';

// ─────────────────────────────────────────────────────────────────────────────
// The website's project list, for the portal's project picker and for
// validating a post's project.
//
// The source of truth is the frontend's data/projects.ts. Its build publishes
// /data/projects.json, so adding a project there updates the portal without any
// change here.
// ─────────────────────────────────────────────────────────────────────────────

export interface SiteProject {
  id: string;
  name: string;
  location: string;
  status: string;
}

export const SITE_ORIGIN = (process.env.SITE_ORIGIN ?? 'https://www.srigowralayabuilders.in').replace(/\/+$/, '');

const TTL_MS = 5 * 60 * 1000;
let cached: { at: number; list: SiteProject[] } | null = null;

/** `ok` is false when the site could not be reached and no earlier copy exists. */
export async function getSiteProjects(): Promise<{ list: SiteProject[]; ok: boolean }> {
  if (cached && Date.now() - cached.at < TTL_MS) return { list: cached.list, ok: true };

  try {
    const res = await fetch(`${SITE_ORIGIN}/data/projects.json`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as SiteProject[];
    if (!Array.isArray(data)) throw new Error('not an array');
    cached = { at: Date.now(), list: data.filter((p) => p && typeof p.id === 'string') };
    return { list: cached.list, ok: true };
  } catch (err) {
    console.warn('[projects] could not load', `${SITE_ORIGIN}/data/projects.json`, err);
    // A stale list beats none; only report failure when there is nothing at all.
    return cached ? { list: cached.list, ok: true } : { list: [], ok: false };
  }
}

/** Shape check used when the list itself is unavailable. */
export const PROJECT_ID = /^[A-Za-z0-9_-]{1,60}$/;
