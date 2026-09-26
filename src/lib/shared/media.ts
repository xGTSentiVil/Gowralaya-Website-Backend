// ─────────────────────────────────────────────────────────────────────────────
// Media types and limits, shared by the server and the browser composer.
// No server-only imports here: the admin UI bundles this file.
// ─────────────────────────────────────────────────────────────────────────────

export interface ImageItem {
  kind: 'image';
  /** Full size, ≤1600 px on the long edge. Shown in the lightbox. */
  url: string;
  /** 640 px version. Shown in the timeline grid. */
  thumb: string;
  w: number;
  h: number;
  /** Stored size of url + thumb, for the storage meter. */
  bytes: number;
}

export interface VideoItem {
  kind: 'video';
  /** H.264 MP4, compressed in the browser before upload. */
  url: string;
  /** Still frame shown until the visitor presses play. */
  poster: string;
  w: number;
  h: number;
  durationSec: number;
  /** Stored size of url + poster, for the storage meter. */
  bytes: number;
}

export interface YoutubeItem {
  kind: 'youtube';
  /** The 11-character video id. Hosted by YouTube; costs no storage. */
  id: string;
}

export type MediaItem = ImageItem | VideoItem | YoutubeItem;

/** What each kind of upload is, so the token route can apply the right limits. */
export type UploadKind = 'image' | 'video' | 'poster';

export const LIMITS = {
  captionMax: 2000,
  mediaPerPost: 12,
  /** Per stored image file, after in-browser compression (normally ~250 KB). */
  imageMaxBytes: 3 * 1024 * 1024,
  /** Per compressed video file. ~2 minutes at 720p. */
  videoMaxBytes: 45 * 1024 * 1024,
  /** Longest clip accepted for direct upload; longer ones belong on YouTube. */
  videoMaxSeconds: 120,
  /** Vercel Blob on the Hobby plan: 1 GB stored. Exceeding it locks Blob for 30 days. */
  storageBudgetBytes: 1024 * 1024 * 1024,
  storageWarnRatio: 0.7,
  /** Above this, direct video uploads are refused in favour of YouTube links. */
  storageBlockVideoRatio: 0.9,
} as const;

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

export const isYoutubeId = (id: string): boolean => YOUTUBE_ID.test(id);

/**
 * Pull the video id out of anything a person is likely to paste: watch URLs,
 * youtu.be short links, Shorts, live streams, embeds, or a bare id.
 */
export function parseYoutubeId(input: string): string | null {
  const text = input.trim();
  if (YOUTUBE_ID.test(text)) return text;

  let url: URL;
  try {
    url = new URL(text.startsWith('http') ? text : `https://${text}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^(www|m|music)\./, '');
  let id: string | null = null;

  if (host === 'youtu.be') {
    id = url.pathname.split('/')[1] ?? null;
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') {
      id = url.searchParams.get('v');
    } else {
      const match = url.pathname.match(/^\/(shorts|live|embed|v)\/([^/?#]+)/);
      id = match ? match[2] : null;
    }
  }

  return id && YOUTUBE_ID.test(id) ? id : null;
}

/** Every stored file an item owns — what must be deleted along with it. */
export function storedUrls(item: MediaItem): string[] {
  if (item.kind === 'image') return [item.url, item.thumb];
  if (item.kind === 'video') return [item.url, item.poster];
  return [];
}

export const youtubeThumb = (id: string): string => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
