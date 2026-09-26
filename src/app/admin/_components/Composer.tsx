'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { discardUploads, savePost } from '../actions';
import { LIMITS, parseYoutubeId, youtubeThumb, type MediaItem } from '@/lib/shared/media';
import {
  FriendlyError,
  canCompressVideo,
  processImage,
  processVideo,
  uploadFile,
  type StorageMode,
} from './media-client';
import { formatBytes } from './format';

interface ProjectOption {
  id: string;
  name: string;
  location: string;
}

export interface ComposerProps {
  postId: string | null;
  initial: {
    projectId: string | null;
    caption: string;
    takenOn: string;
    isPublished: boolean;
    media: MediaItem[];
  };
  projects: ProjectOption[];
  projectsOk: boolean;
  storageMode: StorageMode;
  storageUsed: number;
}

type Status = 'processing' | 'uploading' | 'ready' | 'error';

interface Draft {
  key: string;
  kind: MediaItem['kind'];
  status: Status;
  /** 0–1 progress of the current step. */
  progress: number;
  label: string;
  preview: string | null;
  item: MediaItem | null;
  /** Uploaded during this visit, so it must be cleaned up if not saved. */
  isNew: boolean;
  /** Bytes this draft adds to storage (0 for existing items and YouTube). */
  newBytes: number;
  error?: string;
  note?: string;
}

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

/** "IMG_2041.JPG" → "IMG_2041", so suffixes like -thumb survive the upload's own extension handling. */
const stemOf = (name: string) => name.replace(/\.[^.]+$/, '');

const formatDuration = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

function describe(item: MediaItem): string {
  if (item.kind === 'image') return `Photo · ${item.w}×${item.h}`;
  if (item.kind === 'video') return `Video · ${formatDuration(item.durationSec)}`;
  return 'YouTube video';
}

function previewOf(item: MediaItem): string {
  if (item.kind === 'image') return item.thumb;
  if (item.kind === 'video') return item.poster;
  return youtubeThumb(item.id);
}

function messageOf(err: unknown): string {
  if (err instanceof FriendlyError) return err.message;
  if (err instanceof Error && /signed out|sign in/i.test(err.message)) return err.message;
  if (err instanceof Error && /storage is almost full/i.test(err.message)) return err.message;
  return 'Upload failed. Check the connection and try again.';
}

export default function Composer(props: ComposerProps) {
  const { postId, initial, projects, projectsOk, storageMode, storageUsed } = props;
  const router = useRouter();

  const [projectId, setProjectId] = useState<string>(initial.projectId ?? '');
  const [caption, setCaption] = useState(initial.caption);
  const [takenOn, setTakenOn] = useState(initial.takenOn);
  const [isPublished, setIsPublished] = useState(initial.isPublished);
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    initial.media.map((item) => ({
      key: uid(),
      kind: item.kind,
      status: 'ready',
      progress: 1,
      label: describe(item),
      preview: previewOf(item),
      item,
      isNew: false,
      newBytes: 0,
    }))
  );

  const [youtubeOpen, setYoutubeOpen] = useState(false);
  const [youtubeText, setYoutubeText] = useState('');
  const [youtubeError, setYoutubeError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // WebCodecs can't be detected on the server; assume support there, check in the browser.
  const videoSupported = useSyncExternalStore(noSubscribe, canCompressVideo, () => true);

  const photoInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);

  // Work happens one file at a time: decoding several 12 MP photos or a video
  // at once can exhaust a phone's memory.
  const queue = useRef<Promise<void>>(Promise.resolve());
  // URLs uploaded per draft, and drafts removed mid-upload. Refs, because the
  // async upload code must see the latest values, not a render's snapshot.
  const uploads = useRef(new Map<string, string[]>());
  const removed = useRef(new Set<string>());
  const saved = useRef(false);
  const objectUrls = useRef<string[]>([]);

  const patch = useCallback((key: string, changes: Partial<Draft>) => {
    setDrafts((list) => list.map((d) => (d.key === key ? { ...d, ...changes } : d)));
  }, []);

  /** Record an upload; if its draft was removed meanwhile, delete it straight away. */
  const track = useCallback((key: string, url: string): boolean => {
    if (removed.current.has(key)) {
      void discardUploads([url]);
      return false;
    }
    uploads.current.set(key, [...(uploads.current.get(key) ?? []), url]);
    return true;
  }, []);

  const unsavedUploads = () => [...uploads.current.values()].flat();

  // Leaving without saving: clean up whatever was uploaded, and warn on reload/close.
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (!saved.current && unsavedUploads().length) e.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    const urlsToRevoke = objectUrls.current;
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      if (!saved.current) {
        const leftovers = unsavedUploads();
        if (leftovers.length) void discardUploads(leftovers);
      }
      urlsToRevoke.forEach((u) => URL.revokeObjectURL(u));
    };
  }, []);

  // ── Adding media ──────────────────────────────────────────────────────────

  const pendingBytes = drafts.reduce((sum, d) => sum + d.newBytes, 0);
  const projectedUse = storageUsed + pendingBytes;
  const videoBlocked = projectedUse >= LIMITS.storageBudgetBytes * LIMITS.storageBlockVideoRatio;
  const full = drafts.length >= LIMITS.mediaPerPost;

  function addDraft(draft: Draft) {
    setDrafts((list) => [...list, draft]);
  }

  function enqueue(job: () => Promise<void>) {
    queue.current = queue.current.then(job, job);
  }

  function onPhotosChosen(files: FileList | null) {
    if (!files?.length) return;
    const room = LIMITS.mediaPerPost - drafts.length;
    [...files].slice(0, room).forEach((file) => {
      const key = uid();
      addDraft({
        key,
        kind: 'image',
        status: 'processing',
        progress: 0,
        label: 'Waiting…',
        preview: null,
        item: null,
        isNew: true,
        newBytes: 0,
      });
      enqueue(() => handlePhoto(key, file));
    });
  }

  async function handlePhoto(key: string, file: File) {
    if (removed.current.has(key)) return;
    patch(key, { label: 'Preparing photo…' });
    try {
      const img = await processImage(file);
      objectUrls.current.push(img.previewUrl);
      const total = img.full.blob.size + img.thumb.blob.size;
      patch(key, { preview: img.previewUrl, status: 'uploading', progress: 0, label: 'Uploading…' });

      const fullUrl = await uploadFile(img.full.blob, stemOf(file.name), img.full.ext, 'image', storageMode, (f) =>
        patch(key, { progress: (f * img.full.blob.size) / total })
      );
      if (!track(key, fullUrl)) return;

      const thumbUrl = await uploadFile(img.thumb.blob, `${stemOf(file.name)}-thumb`, img.thumb.ext, 'image', storageMode, (f) =>
        patch(key, { progress: (img.full.blob.size + f * img.thumb.blob.size) / total })
      );
      if (!track(key, thumbUrl)) return;

      const item: MediaItem = { kind: 'image', url: fullUrl, thumb: thumbUrl, w: img.width, h: img.height, bytes: total };
      patch(key, { status: 'ready', progress: 1, item, newBytes: total, label: describe(item) });
    } catch (err) {
      patch(key, { status: 'error', error: messageOf(err), label: 'Photo' });
    }
  }

  function onVideoChosen(files: FileList | null) {
    const file = files?.[0];
    if (!file || full) return;
    const key = uid();
    addDraft({
      key,
      kind: 'video',
      status: 'processing',
      progress: 0,
      label: 'Waiting…',
      preview: null,
      item: null,
      isNew: true,
      newBytes: 0,
    });
    enqueue(() => handleVideo(key, file));
  }

  async function handleVideo(key: string, file: File) {
    if (removed.current.has(key)) return;
    patch(key, { label: 'Reading video…' });
    try {
      const v = await processVideo(file, (f) => patch(key, { progress: f, label: `Compressing… ${Math.round(f * 100)}%` }));
      if (removed.current.has(key)) return;
      objectUrls.current.push(v.previewUrl);
      const total = v.video.size + v.poster.blob.size;
      patch(key, { preview: v.previewUrl, status: 'uploading', progress: 0, label: `Uploading ${formatBytes(v.video.size)}…` });

      const videoUrl = await uploadFile(v.video, stemOf(file.name), 'mp4', 'video', storageMode, (f) =>
        patch(key, { progress: (f * v.video.size) / total })
      );
      if (!track(key, videoUrl)) return;

      const posterUrl = await uploadFile(v.poster.blob, `${stemOf(file.name)}-poster`, v.poster.ext, 'poster', storageMode, (f) =>
        patch(key, { progress: (v.video.size + f * v.poster.blob.size) / total })
      );
      if (!track(key, posterUrl)) return;

      const item: MediaItem = {
        kind: 'video',
        url: videoUrl,
        poster: posterUrl,
        w: v.width,
        h: v.height,
        durationSec: v.durationSec,
        bytes: total,
      };
      patch(key, {
        status: 'ready',
        progress: 1,
        item,
        newBytes: total,
        label: describe(item),
        note: v.hasAudio ? undefined : 'No sound',
      });
    } catch (err) {
      patch(key, { status: 'error', error: messageOf(err), label: 'Video' });
    }
  }

  function addYoutube() {
    const id = parseYoutubeId(youtubeText);
    if (!id) {
      setYoutubeError('That doesn’t look like a YouTube link.');
      return;
    }
    if (drafts.some((d) => d.item?.kind === 'youtube' && d.item.id === id)) {
      setYoutubeError('That video is already in this update.');
      return;
    }
    const item: MediaItem = { kind: 'youtube', id };
    addDraft({
      key: uid(),
      kind: 'youtube',
      status: 'ready',
      progress: 1,
      label: describe(item),
      preview: youtubeThumb(id),
      item,
      isNew: false,
      newBytes: 0,
    });
    setYoutubeText('');
    setYoutubeError(null);
    setYoutubeOpen(false);
  }

  // ── Editing the list ──────────────────────────────────────────────────────

  function remove(key: string) {
    removed.current.add(key);
    setDrafts((list) => list.filter((d) => d.key !== key));
    const urls = uploads.current.get(key);
    uploads.current.delete(key);
    if (urls?.length) void discardUploads(urls);
  }

  function move(index: number, by: -1 | 1) {
    setDrafts((list) => {
      const next = [...list];
      const target = index + by;
      if (target < 0 || target >= next.length) return list;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  // ── Saving ────────────────────────────────────────────────────────────────

  const busy = drafts.some((d) => d.status === 'processing' || d.status === 'uploading');
  const failed = drafts.some((d) => d.status === 'error');
  const empty = !caption.trim() && drafts.length === 0;

  async function save() {
    setSaving(true);
    setSaveError(null);
    const media = drafts.map((d) => d.item).filter((m): m is MediaItem => m !== null);
    const result = await savePost(postId, {
      projectId: projectId || null,
      caption,
      takenOn,
      isPublished,
      media,
    });
    if (!result.ok) {
      setSaveError(result.error);
      setSaving(false);
      return;
    }
    // Everything uploaded now belongs to a saved post: keep it.
    saved.current = true;
    uploads.current.clear();
    router.push('/admin?saved=1');
  }

  function cancel() {
    // Unmount cleanup discards unsaved uploads.
    router.push('/admin');
  }

  const saveLabel = saving
    ? 'Saving…'
    : busy
      ? 'Waiting for uploads…'
      : failed
        ? 'Remove failed items to post'
        : postId
          ? 'Save changes'
          : 'Post update';

  const knownProject = !initial.projectId || projects.some((p) => p.id === initial.projectId);

  return (
    <main className="admin-shell composer">
      <header className="admin-bar">
        <Link href="/admin" className="admin-brand">
          <strong>Sri Gowralaya</strong>
          <span>Site updates</span>
        </Link>
      </header>

      <h1>{postId ? 'Edit update' : 'New update'}</h1>

      {!projectsOk && (
        <p className="notice notice-warn">
          Couldn’t load the project list from the website, so only “General” is available right now.
        </p>
      )}

      <div className="field-row">
        <div className="field">
          <label htmlFor="project">Project</label>
          <select id="project" className="select" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">General (not one project)</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {p.location}
              </option>
            ))}
            {!knownProject && initial.projectId && <option value={initial.projectId}>{initial.projectId}</option>}
          </select>
        </div>
        <div className="field">
          <label htmlFor="date">Date</label>
          <input id="date" type="date" className="input" value={takenOn} onChange={(e) => setTakenOn(e.target.value)} required />
        </div>
      </div>

      <div className="field">
        <label htmlFor="caption">Caption</label>
        <textarea
          id="caption"
          className="textarea"
          value={caption}
          maxLength={LIMITS.captionMax}
          placeholder="e.g. Second floor roof slab cast today. Curing for the next 14 days."
          onChange={(e) => setCaption(e.target.value)}
        />
        <span className="counter">
          {caption.length}/{LIMITS.captionMax}
        </span>
      </div>

      <div className="field">
        <span className="field-label">Photos &amp; videos</span>

        {drafts.length > 0 && (
          <div className="media-grid">
            {drafts.map((d, i) => (
              <div key={d.key} className="media-card" data-status={d.status}>
                <div className="media-preview">
                  {d.preview ? (
                    // eslint-disable-next-line @next/next/no-img-element -- local previews and storage URLs
                    <img src={d.preview} alt="" />
                  ) : (
                    <span>{d.kind === 'video' ? 'Video' : 'Photo'}</span>
                  )}
                  <span className="media-kind">{d.kind === 'youtube' ? 'YouTube' : d.kind === 'video' ? 'Video' : 'Photo'}</span>
                </div>
                <div className="media-status" data-status={d.status}>
                  {d.status === 'error' ? d.error : d.label}
                  {d.note && d.status === 'ready' ? ` · ${d.note}` : ''}
                </div>
                {(d.status === 'processing' || d.status === 'uploading') && (
                  <div className="progress" aria-hidden="true">
                    <span style={{ width: `${Math.round(d.progress * 100)}%` }} />
                  </div>
                )}
                <div className="media-controls">
                  <button type="button" className="icon-btn" aria-label="Move earlier" disabled={i === 0} onClick={() => move(i, -1)}>
                    ‹
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Move later"
                    disabled={i === drafts.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    ›
                  </button>
                  <button type="button" className="icon-btn icon-btn-remove" aria-label="Remove" onClick={() => remove(d.key)}>
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="add-row">
          <button type="button" className="btn" disabled={full} onClick={() => photoInput.current?.click()}>
            <span>📷</span>
            <span>Photos</span>
          </button>
          <button
            type="button"
            className="btn"
            disabled={full || videoBlocked || !videoSupported}
            onClick={() => videoInput.current?.click()}
          >
            <span>🎬</span>
            <span>Video clip</span>
          </button>
          <button type="button" className="btn" disabled={full} onClick={() => setYoutubeOpen((o) => !o)}>
            <span>▶</span>
            <span>YouTube</span>
          </button>
        </div>

        <input
          ref={photoInput}
          type="file"
          accept="image/*"
          multiple
          className="hidden-input"
          onChange={(e) => {
            onPhotosChosen(e.target.files);
            e.target.value = '';
          }}
        />
        <input
          ref={videoInput}
          type="file"
          accept="video/*"
          className="hidden-input"
          onChange={(e) => {
            onVideoChosen(e.target.files);
            e.target.value = '';
          }}
        />

        {youtubeOpen && (
          <>
            <div className="youtube-row">
              <input
                type="url"
                inputMode="url"
                className="input"
                placeholder="Paste a YouTube link"
                value={youtubeText}
                onChange={(e) => setYoutubeText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addYoutube())}
                autoFocus
              />
              <button type="button" className="btn btn-primary" onClick={addYoutube}>
                Add
              </button>
            </div>
            {youtubeError && (
              <p className="notice notice-error" role="alert">
                {youtubeError}
              </p>
            )}
          </>
        )}

        <p className="muted" style={{ margin: 0 }}>
          {full
            ? `That’s the maximum of ${LIMITS.mediaPerPost} items for one update.`
            : videoBlocked
              ? 'Storage is nearly full, so video clips are paused. YouTube links still work.'
              : !videoSupported
                ? 'This browser can’t compress video, so use a YouTube link — or open the portal in Chrome or Safari.'
              : 'Photos are resized automatically. Video clips up to 2 minutes are compressed on this phone before uploading; for longer videos, add a YouTube link.'}
        </p>
      </div>

      <label className="check">
        <input type="checkbox" checked={isPublished} onChange={(e) => setIsPublished(e.target.checked)} />
        Show on the website
      </label>

      {saveError && (
        <p className="notice notice-error" role="alert">
          {saveError}
        </p>
      )}

      <div className="sticky-save">
        <div className="sticky-save-inner">
          <button type="button" className="btn btn-quiet" onClick={cancel} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={saving || busy || failed || empty} onClick={save}>
            {saveLabel}
          </button>
        </div>
      </div>
    </main>
  );
}

const noSubscribe = () => () => {};
