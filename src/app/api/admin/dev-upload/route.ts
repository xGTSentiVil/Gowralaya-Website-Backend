import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { isAdmin } from '@/lib/dal';
import { LOCAL_FILE_ROUTE, LOCAL_UPLOAD_DIR, storageMode } from '@/lib/storage';
import { LIMITS, type UploadKind } from '@/lib/shared/media';

// ─────────────────────────────────────────────────────────────────────────────
// LOCAL DEVELOPMENT ONLY. Stands in for Vercel Blob when no Blob token is set,
// so the portal can be tried end to end on a laptop. Answers 404 whenever real
// Blob storage is configured, and storageMode() refuses to run it in production.
// ─────────────────────────────────────────────────────────────────────────────

const RULES: Record<UploadKind, { types: string[]; maxBytes: number }> = {
  image: { types: ['image/webp', 'image/jpeg'], maxBytes: LIMITS.imageMaxBytes },
  poster: { types: ['image/webp', 'image/jpeg'], maxBytes: LIMITS.imageMaxBytes },
  video: { types: ['video/mp4'], maxBytes: LIMITS.videoMaxBytes },
};

export async function PUT(request: NextRequest) {
  let mode;
  try {
    mode = storageMode();
  } catch {
    mode = 'blob';
  }
  if (mode !== 'local') return new NextResponse(null, { status: 404 });
  if (!(await isAdmin())) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const kind = request.nextUrl.searchParams.get('kind') as UploadKind | null;
  const rule = kind ? RULES[kind] : undefined;
  const contentType = request.headers.get('content-type') ?? '';
  const requested = request.nextUrl.searchParams.get('pathname') ?? '';

  if (!rule) return NextResponse.json({ error: 'Unknown upload type' }, { status: 400 });
  if (!rule.types.includes(contentType)) {
    return NextResponse.json({ error: `Content type ${contentType} not allowed` }, { status: 400 });
  }
  if (!/^updates\/[A-Za-z0-9._-]{1,120}$/.test(requested)) {
    return NextResponse.json({ error: 'Invalid file name' }, { status: 400 });
  }

  const body = Buffer.from(await request.arrayBuffer());
  if (body.length > rule.maxBytes) return NextResponse.json({ error: 'File too large' }, { status: 413 });

  // Same idea as Blob's addRandomSuffix: names are unguessable and never reused.
  const base = path.basename(requested);
  const ext = path.extname(base);
  const name = `${base.slice(0, base.length - ext.length)}-${randomBytes(8).toString('hex')}${ext}`;

  await fs.mkdir(LOCAL_UPLOAD_DIR, { recursive: true });
  await fs.writeFile(path.join(LOCAL_UPLOAD_DIR, name), body);

  const url = `${request.nextUrl.origin}${LOCAL_FILE_ROUTE}${name}`;
  return NextResponse.json({ url, pathname: `updates/${name}`, contentType });
}
