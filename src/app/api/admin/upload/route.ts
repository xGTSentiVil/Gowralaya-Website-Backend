import { NextResponse } from 'next/server';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { isAdmin } from '@/lib/dal';
import { storageBytes } from '@/lib/updates';
import { LIMITS, type UploadKind } from '@/lib/shared/media';

// ─────────────────────────────────────────────────────────────────────────────
// Issues short-lived tokens so the portal can upload straight from the phone to
// Vercel Blob. File bodies never pass through this function, so large videos
// don't hit the serverless request-size limit, and uploads cost no transfer.
//
// The token itself enforces the rules — file type, maximum size, the updates/
// folder — so a tampered browser can't upload anything else.
// ─────────────────────────────────────────────────────────────────────────────

const RULES: Record<UploadKind, { types: string[]; maxBytes: number }> = {
  image: { types: ['image/webp', 'image/jpeg'], maxBytes: LIMITS.imageMaxBytes },
  poster: { types: ['image/webp', 'image/jpeg'], maxBytes: LIMITS.imageMaxBytes },
  video: { types: ['video/mp4'], maxBytes: LIMITS.videoMaxBytes },
};

function parseKind(payload: string | null): UploadKind {
  try {
    const kind = (JSON.parse(payload ?? '{}') as { kind?: string }).kind;
    if (kind === 'image' || kind === 'poster' || kind === 'video') return kind;
  } catch {
    /* fall through */
  }
  throw new Error('Unknown upload type');
}

export async function POST(request: Request) {
  // Reject signed-out callers before anything else. (onBeforeGenerateToken
  // checks again, as that is where the token is actually issued.)
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'You’ve been signed out. Please sign in again.' }, { status: 401 });
  }
  const body = (await request.json()) as HandleUploadBody;

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        if (!(await isAdmin())) throw new Error('You’ve been signed out. Please sign in again.');
        if (!/^updates\/[A-Za-z0-9._-]{1,120}$/.test(pathname)) throw new Error('Invalid file name');

        const kind = parseKind(clientPayload);
        if (kind === 'video') {
          const used = await storageBytes();
          if (used >= LIMITS.storageBudgetBytes * LIMITS.storageBlockVideoRatio) {
            throw new Error('Storage is almost full, so direct video uploads are paused. Use a YouTube link instead.');
          }
        }

        const rule = RULES[kind];
        return {
          allowedContentTypes: rule.types,
          maximumSizeInBytes: rule.maxBytes,
          addRandomSuffix: true,
          // Files never change once uploaded (edits upload new files), so cache
          // them for a year. Repeat views are then served from the browser.
          cacheControlMaxAge: 60 * 60 * 24 * 365,
        };
      },
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upload could not start';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
