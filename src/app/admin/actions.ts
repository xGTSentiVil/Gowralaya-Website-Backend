'use server';

import { after } from 'next/server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { isAdmin } from '@/lib/dal';
import { verifyPassword } from '@/lib/password';
import { createSession, deleteSession } from '@/lib/session';
import { getSiteProjects } from '@/lib/projects';
import { deleteMedia, listStoredFiles } from '@/lib/storage';
import { triggerSiteRebuild } from '@/lib/rebuild';
import { storedUrls } from '@/lib/shared/media';
import { updateInputSchema } from '@/lib/validation';
import {
  clearLoginFailures,
  createUpdate,
  deleteUpdate,
  getUpdate,
  loginBlockedFor,
  recordLoginFailure,
  referencedUrls,
  saveUpdate,
  setPublished,
} from '@/lib/updates';

// ─────────────────────────────────────────────────────────────────────────────
// Every action here is a public endpoint as far as the network is concerned,
// so each one checks the session itself (Next's guidance: never rely on proxy).
// ─────────────────────────────────────────────────────────────────────────────

export type ActionResult = { ok: true; id?: string } | { ok: false; error: string };

const SIGNED_OUT_MESSAGE = 'You’ve been signed out. Please sign in again.';
const SIGNED_OUT: ActionResult = { ok: false, error: SIGNED_OUT_MESSAGE };

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'local';
}

function rebuildLater(reason: string): void {
  // Respond to the phone immediately; ask Vercel for a rebuild afterwards.
  after(() => triggerSiteRebuild(reason));
}

// ── Sign in / out ───────────────────────────────────────────────────────────

export interface LoginState {
  error?: string;
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const hash = process.env.ADMIN_PASSWORD_HASH;
  if (!hash) {
    return { error: 'The portal password hasn’t been set up yet (ADMIN_PASSWORD_HASH in Vercel).' };
  }

  const ip = await clientIp();
  const waitMinutes = await loginBlockedFor(ip);
  if (waitMinutes) {
    return {
      error: `Too many wrong attempts. Try again in ${waitMinutes} minute${waitMinutes === 1 ? '' : 's'}.`,
    };
  }

  const password = String(formData.get('password') ?? '');
  const ok = password.length > 0 && password.length <= 200 && (await verifyPassword(password, hash));
  if (!ok) {
    await recordLoginFailure(ip);
    return { error: 'That password isn’t right.' };
  }

  await clearLoginFailures(ip);
  await createSession();
  redirect('/admin');
}

export async function logout(): Promise<void> {
  await deleteSession();
  redirect('/admin/login');
}

// ── Posts ───────────────────────────────────────────────────────────────────

/** Create (id = null) or edit a post. */
export async function savePost(id: string | null, input: unknown): Promise<ActionResult> {
  if (!(await isAdmin())) return SIGNED_OUT;

  const parsed = updateInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Something in the post isn’t valid.' };
  }
  const data = parsed.data;

  if (data.projectId) {
    const { list, ok } = await getSiteProjects();
    // If the site can't be reached we fall back to the shape check the schema
    // already did, rather than blocking posting entirely.
    if (ok && !list.some((p) => p.id === data.projectId)) {
      return { ok: false, error: 'That project isn’t on the website anymore. Pick another.' };
    }
  }

  let postId = id;
  if (id) {
    const existing = await getUpdate(id);
    if (!existing) return { ok: false, error: 'This post no longer exists.' };
    await saveUpdate(id, data);

    // Files that were in the post before but aren't now.
    const kept = new Set(data.media.flatMap(storedUrls));
    const removed = existing.media.flatMap(storedUrls).filter((url) => !kept.has(url));
    if (removed.length) after(() => deleteMedia(removed).catch((e) => console.error('[media] delete failed', e)));
  } else {
    postId = await createUpdate(data);
  }

  revalidatePath('/admin');
  rebuildLater(id ? 'post edited' : 'post created');
  return { ok: true, id: postId ?? undefined };
}

export async function setPostPublished(id: string, published: boolean): Promise<ActionResult> {
  if (!(await isAdmin())) return SIGNED_OUT;
  if (!(await setPublished(id, published))) return { ok: false, error: 'This post no longer exists.' };
  revalidatePath('/admin');
  rebuildLater(published ? 'post shown' : 'post hidden');
  return { ok: true };
}

export async function deletePost(id: string): Promise<ActionResult> {
  if (!(await isAdmin())) return SIGNED_OUT;
  const removed = await deleteUpdate(id);
  if (!removed) return { ok: false, error: 'This post no longer exists.' };

  const urls = removed.media.flatMap(storedUrls);
  if (urls.length) after(() => deleteMedia(urls).catch((e) => console.error('[media] delete failed', e)));

  revalidatePath('/admin');
  rebuildLater('post deleted');
  return { ok: true };
}

/**
 * Files uploaded in the composer but then removed, or abandoned by leaving
 * without saving. Anything a saved post still uses is never deleted.
 */
export async function discardUploads(urls: string[]): Promise<ActionResult> {
  if (!(await isAdmin())) return SIGNED_OUT;
  if (!Array.isArray(urls) || !urls.length) return { ok: true };

  const inUse = await referencedUrls();
  await deleteMedia(urls.filter((u) => typeof u === 'string' && !inUse.has(u)).slice(0, 100));
  return { ok: true };
}

export interface TidyResult {
  ok: boolean;
  removed: number;
  freedBytes: number;
  error?: string;
}

/**
 * Remove stored files no post uses — left behind when an upload was abandoned
 * (a closed tab, a dropped connection). Files under a day old are skipped so a
 * post being written right now is never affected.
 */
export async function tidyStorage(): Promise<TidyResult> {
  if (!(await isAdmin())) return { ok: false, removed: 0, freedBytes: 0, error: SIGNED_OUT_MESSAGE };

  const inUse = await referencedUrls();
  // Compare by path: in local development the host/port can differ.
  const usedPaths = new Set([...inUse].map((u) => new URL(u).pathname));
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;

  const orphans = (await listStoredFiles()).filter(
    (f) => !usedPaths.has(new URL(f.url).pathname) && f.uploadedAt.getTime() < dayAgo
  );
  if (orphans.length) await deleteMedia(orphans.map((f) => f.url));

  return { ok: true, removed: orphans.length, freedBytes: orphans.reduce((sum, f) => sum + f.bytes, 0) };
}
