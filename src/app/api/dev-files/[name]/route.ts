import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { LOCAL_NAME, LOCAL_UPLOAD_DIR, storageMode } from '@/lib/storage';

// ─────────────────────────────────────────────────────────────────────────────
// LOCAL DEVELOPMENT ONLY: serves files written by /api/admin/dev-upload.
// Answers 404 whenever real Blob storage is configured. Supports Range requests
// so videos can seek, like the real CDN does.
// ─────────────────────────────────────────────────────────────────────────────

const TYPES: Record<string, string> = {
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.mp4': 'video/mp4',
};

export async function GET(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  let mode;
  try {
    mode = storageMode();
  } catch {
    mode = 'blob';
  }
  if (mode !== 'local') return new NextResponse(null, { status: 404 });

  const { name } = await params;
  if (!LOCAL_NAME.test(name)) return new NextResponse(null, { status: 404 });

  let file: Buffer;
  try {
    file = await fs.readFile(path.join(LOCAL_UPLOAD_DIR, name));
  } catch {
    return new NextResponse(null, { status: 404 });
  }

  const headers: Record<string, string> = {
    'Content-Type': TYPES[path.extname(name).toLowerCase()] ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=31536000, immutable',
  };

  const range = request.headers.get('range')?.match(/^bytes=(\d*)-(\d*)$/);
  if (range) {
    const size = file.length;
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      return new NextResponse(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    }
    return new NextResponse(new Uint8Array(file.subarray(start, end + 1)), {
      status: 206,
      headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) },
    });
  }

  return new NextResponse(new Uint8Array(file), {
    headers: { ...headers, 'Content-Length': String(file.length) },
  });
}
