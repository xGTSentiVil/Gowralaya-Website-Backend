import { NextRequest, NextResponse } from 'next/server';
import { GENERAL, listPublished, toPublic } from '@/lib/updates';
import { PROJECT_ID } from '@/lib/projects';

// ─────────────────────────────────────────────────────────────────────────────
// Public feed of published site updates.
//
//   GET /api/updates                      all posts, newest first
//   GET /api/updates?project=Kamakotiagam  one project
//   GET /api/updates?project=general       company-wide posts
//   &limit=20&before=<cursor>              paging ("Load more")
//
// CORS is `*`: this is public, credential-free data, and a wildcard is the only
// value that is safe to cache on the CDN (a per-origin value would be served to
// every other origin too).
//
// Cached at Vercel's edge for 30 s, so a new post shows up on the site within
// about half a minute while repeat visits don't hit the database. Browsers are
// told not to reuse their own copy (see the headers below).
// ─────────────────────────────────────────────────────────────────────────────

const PUBLIC_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const project = params.get('project');
  if (project !== null && project !== GENERAL && !PROJECT_ID.test(project)) {
    return NextResponse.json({ error: 'Unknown project' }, { status: 400, headers: PUBLIC_HEADERS });
  }

  const limitParam = Number(params.get('limit') ?? 20);
  const limit = Number.isFinite(limitParam) ? Math.trunc(limitParam) : 20;

  try {
    const { updates, nextCursor } = await listPublished({
      projectId: project,
      limit,
      before: params.get('before'),
    });

    return NextResponse.json(
      { updates: updates.map(toPublic), nextCursor },
      {
        headers: {
          ...PUBLIC_HEADERS,
          // Vercel's edge: fresh for 30 s, then serve stale while refreshing.
          // Vercel consumes this header; it never reaches the browser.
          'Vercel-CDN-Cache-Control': 'max-age=30, stale-while-revalidate=300',
          // Browsers: always ask again. Otherwise a browser's own
          // stale-while-revalidate would show someone yesterday's feed right
          // after a new post (the edge answers these re-checks cheaply).
          'Cache-Control': 'no-cache',
        },
      }
    );
  } catch (err) {
    console.error('[updates] feed failed', err);
    return NextResponse.json(
      { error: 'Updates are unavailable right now.' },
      { status: 503, headers: { ...PUBLIC_HEADERS, 'Cache-Control': 'no-store' } }
    );
  }
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: PUBLIC_HEADERS });
}
