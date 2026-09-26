import 'server-only';
import path from 'node:path';
import { promises as fs } from 'node:fs';

// ─────────────────────────────────────────────────────────────────────────────
// Where uploaded photos and videos live.
//
// Production: Vercel Blob (BLOB_READ_WRITE_TOKEN is set automatically when a
// Blob store is connected to this project). Files upload straight from the
// browser to Blob, never through our functions.
//
// Local development without a token: files are written to ./.data/uploads and
// served by /api/dev-files. That mode refuses to run in production.
// ─────────────────────────────────────────────────────────────────────────────

export type StorageMode = 'blob' | 'local';

export function storageMode(): StorageMode {
  if (process.env.BLOB_READ_WRITE_TOKEN) return 'blob';
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'BLOB_READ_WRITE_TOKEN is not set. Create a Blob store and connect it to this project in the Vercel dashboard.'
    );
  }
  return 'local';
}

export const LOCAL_UPLOAD_DIR = path.join(process.cwd(), '.data', 'uploads');
export const LOCAL_FILE_ROUTE = '/api/dev-files/';

/** A safe local filename: no directories, no traversal. */
export const LOCAL_NAME = /^[A-Za-z0-9._-]{1,160}$/;

/**
 * True for files we stored ourselves. Media URLs arriving from the composer are
 * checked against this, so a post can never embed an arbitrary external file.
 */
export function isOurMediaUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol === 'https:' && u.hostname.endsWith('.public.blob.vercel-storage.com')) {
    return u.pathname.startsWith('/updates/');
  }
  if (storageMode() === 'local') {
    return (
      (u.hostname === 'localhost' || u.hostname === '127.0.0.1') &&
      u.pathname.startsWith(LOCAL_FILE_ROUTE) &&
      LOCAL_NAME.test(u.pathname.slice(LOCAL_FILE_ROUTE.length))
    );
  }
  return false;
}

/** Delete stored files. Unknown or foreign URLs are ignored, never touched. */
export async function deleteMedia(urls: string[]): Promise<void> {
  const ours = [...new Set(urls.filter(isOurMediaUrl))];
  if (!ours.length) return;

  if (storageMode() === 'blob') {
    const { del } = await import('@vercel/blob');
    await del(ours);
    return;
  }

  await Promise.all(
    ours.map((url) => {
      const name = new URL(url).pathname.slice(LOCAL_FILE_ROUTE.length);
      return fs.rm(path.join(LOCAL_UPLOAD_DIR, name), { force: true });
    })
  );
}

export interface StoredFile {
  url: string;
  bytes: number;
  uploadedAt: Date;
}

/** Everything in storage under updates/ — for the "tidy up" sweep. */
export async function listStoredFiles(): Promise<StoredFile[]> {
  if (storageMode() === 'blob') {
    const { list } = await import('@vercel/blob');
    const files: StoredFile[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: 'updates/', cursor, limit: 1000 });
      for (const b of page.blobs) files.push({ url: b.url, bytes: b.size, uploadedAt: new Date(b.uploadedAt) });
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return files;
  }

  const names = await fs.readdir(LOCAL_UPLOAD_DIR).catch(() => [] as string[]);
  const port = process.env.PORT ?? '3000';
  return Promise.all(
    names.map(async (name) => {
      const stat = await fs.stat(path.join(LOCAL_UPLOAD_DIR, name));
      return { url: `http://localhost:${port}${LOCAL_FILE_ROUTE}${name}`, bytes: stat.size, uploadedAt: stat.mtime };
    })
  );
}
