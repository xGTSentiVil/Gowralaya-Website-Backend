// ─────────────────────────────────────────────────────────────────────────────
// Browser-side media handling for the portal: runs on the phone, before upload.
//
// Photos → resized and re-encoded (WebP, or JPEG where the browser can't make
//          WebP — iPhone Safari). Two sizes: full for the lightbox, a small
//          thumbnail for the timeline. Re-encoding also strips EXIF/GPS data.
// Videos → transcoded with WebCodecs (via Mediabunny) to 720p H.264. This keeps
//          files small enough for the free storage tier and converts iPhone
//          HEVC video, which many Android browsers can't play.
// ─────────────────────────────────────────────────────────────────────────────

import { LIMITS, type UploadKind } from '@/lib/shared/media';

/** An error whose message is written for the person using the portal. */
export class FriendlyError extends Error {}

type Encoded = { blob: Blob; ext: 'webp' | 'jpg'; type: 'image/webp' | 'image/jpeg' };

function canvasToBlob(canvas: HTMLCanvasElement | OffscreenCanvas, type: string, quality: number): Promise<Blob | null> {
  if ('convertToBlob' in canvas) {
    return canvas.convertToBlob({ type, quality }).catch(() => null);
  }
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * WebP where the browser can encode it; otherwise JPEG. Safari quietly hands
 * back a PNG when asked for WebP, so the result's type is checked, not assumed.
 */
async function encodeCanvas(canvas: HTMLCanvasElement | OffscreenCanvas, quality: number): Promise<Encoded> {
  const webp = await canvasToBlob(canvas, 'image/webp', quality);
  if (webp && webp.type === 'image/webp') return { blob: webp, ext: 'webp', type: 'image/webp' };

  const jpeg = await canvasToBlob(canvas, 'image/jpeg', quality);
  if (jpeg && jpeg.type === 'image/jpeg') return { blob: jpeg, ext: 'jpg', type: 'image/jpeg' };

  throw new FriendlyError('This browser couldn’t process the photo. Try Chrome or Safari.');
}

type Drawable = ImageBitmap | HTMLImageElement | HTMLCanvasElement;

async function decodeImage(file: File): Promise<{ source: Drawable; width: number; height: number; release: () => void }> {
  try {
    // Applies the EXIF rotation, so portrait phone photos come out upright.
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
  } catch {
    // Some browsers only decode certain files through <img>.
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      await img.decode();
      return {
        source: img,
        width: img.naturalWidth,
        height: img.naturalHeight,
        release: () => URL.revokeObjectURL(url),
      };
    } catch {
      URL.revokeObjectURL(url);
      const heic = /\.(heic|heif)$/i.test(file.name) || /hei[cf]/i.test(file.type);
      throw new FriendlyError(
        heic
          ? 'This browser can’t read HEIC photos. Upload from the iPhone itself, or save the photo as JPEG.'
          : 'This file couldn’t be read as a photo.'
      );
    }
  }
}

/** Draw into a canvas no larger than `maxEdge`, halving first for big downscales (sharper result). */
function resizeTo(source: Drawable, width: number, height: number, maxEdge: number): HTMLCanvasElement {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const targetW = Math.max(1, Math.round(width * scale));
  const targetH = Math.max(1, Math.round(height * scale));

  let current: CanvasImageSource = source;
  let curW = width;
  let curH = height;

  while (curW / 2 >= targetW && curH / 2 >= targetH) {
    const step = document.createElement('canvas');
    step.width = Math.round(curW / 2);
    step.height = Math.round(curH / 2);
    const ctx = step.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(current, 0, 0, step.width, step.height);
    current = step;
    curW = step.width;
    curH = step.height;
  }

  const out = document.createElement('canvas');
  out.width = targetW;
  out.height = targetH;
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(current, 0, 0, targetW, targetH);
  return out;
}

export interface ProcessedImage {
  full: Encoded;
  thumb: Encoded;
  width: number;
  height: number;
  /** For an instant on-screen preview. Revoke when done. */
  previewUrl: string;
}

export async function processImage(file: File): Promise<ProcessedImage> {
  const decoded = await decodeImage(file);
  try {
    const fullCanvas = resizeTo(decoded.source, decoded.width, decoded.height, 1600);
    const thumbCanvas = resizeTo(fullCanvas, fullCanvas.width, fullCanvas.height, 640);
    const [full, thumb] = await Promise.all([encodeCanvas(fullCanvas, 0.82), encodeCanvas(thumbCanvas, 0.75)]);
    return {
      full,
      thumb,
      width: fullCanvas.width,
      height: fullCanvas.height,
      previewUrl: URL.createObjectURL(thumb.blob),
    };
  } finally {
    decoded.release();
  }
}

// ── Video ───────────────────────────────────────────────────────────────────

export interface ProcessedVideo {
  video: Blob;
  poster: Encoded;
  width: number;
  height: number;
  durationSec: number;
  hasAudio: boolean;
  previewUrl: string;
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export function canCompressVideo(): boolean {
  return typeof window !== 'undefined' && 'VideoEncoder' in window && 'VideoDecoder' in window;
}

export async function processVideo(file: File, onProgress: (fraction: number) => void): Promise<ProcessedVideo> {
  if (!canCompressVideo()) {
    throw new FriendlyError('This browser can’t compress video. Use a YouTube link instead, or try Chrome or Safari.');
  }

  // Loaded only when a video is picked: it's the heaviest part of the portal.
  const { Input, Output, Conversion, BlobSource, BufferTarget, Mp4OutputFormat, CanvasSink, ALL_FORMATS } =
    await import('mediabunny');

  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack().catch(() => null);
    if (!track) throw new FriendlyError('That file doesn’t look like a video this browser can read.');

    const durationSec = await input.computeDuration();
    if (durationSec > LIMITS.videoMaxSeconds + 1) {
      const minutes = Math.round(durationSec / 60);
      throw new FriendlyError(
        `This video is about ${minutes} minute${minutes === 1 ? '' : 's'} long. Clips up to 2 minutes can be uploaded here — put longer videos on YouTube and add the link instead.`
      );
    }

    // 720p: 1280 on the long edge, preserving orientation (displayWidth/Height
    // already account for the rotation flag phones write on portrait clips).
    const scale = Math.min(1, 1280 / Math.max(track.displayWidth, track.displayHeight));
    const width = even(track.displayWidth * scale);
    const height = even(track.displayHeight * scale);

    const output = new Output({
      format: new Mp4OutputFormat({ fastStart: 'in-memory' }), // plays before fully downloaded
      target: new BufferTarget(),
    });

    const conversion = await Conversion.init({
      input,
      output,
      video: {
        width,
        height,
        fit: 'fill',
        codec: 'avc', // H.264: plays on every phone and browser
        bitrate: 2_500_000, // ~19 MB per minute
        frameRate: 30,
        forceTranscode: true,
      },
      // Phones record AAC, which is copied as-is; only re-encoded if needed.
      audio: { codec: 'aac' },
    });

    const videoDropped = conversion.discardedTracks.find((d) => d.track.isVideoTrack());
    if (videoDropped) {
      throw new FriendlyError(
        videoDropped.reason === 'undecodable_source_codec'
          ? 'This browser can’t read this video’s format (often iPhone HEVC on a computer). Open the portal on the phone that recorded it, or use a YouTube link.'
          : 'This browser can’t compress video. Use a YouTube link instead, or try Chrome or Safari.'
      );
    }
    const hasAudio = conversion.utilizedTracks.some((t) => t.isAudioTrack());

    conversion.onProgress = (p) => onProgress(Math.min(1, Math.max(0, p)));
    await conversion.execute();

    const buffer = (output.target as InstanceType<typeof BufferTarget>).buffer;
    if (!buffer) throw new FriendlyError('Video compression didn’t finish. Please try again.');
    const video = new Blob([buffer], { type: 'video/mp4' });

    if (video.size > LIMITS.videoMaxBytes) {
      throw new FriendlyError('Even compressed, this video is too large to store. Use a YouTube link instead.');
    }

    // Poster: a frame about a second in (the very first frame is often black),
    // decoded with WebCodecs — more reliable on iPhone than seeking a <video>.
    const posterScale = Math.min(1, 640 / Math.max(width, height));
    const sink = new CanvasSink(track, {
      width: even(width * posterScale),
      height: even(height * posterScale),
      fit: 'fill',
    });
    const frame =
      (await sink.getCanvas(Math.min(1, durationSec / 3))) ?? (await sink.getCanvas(0));
    if (!frame) throw new FriendlyError('Couldn’t make a preview image for this video.');
    const poster = await encodeCanvas(frame.canvas, 0.78);

    return {
      video,
      poster,
      width,
      height,
      durationSec: Math.round(durationSec * 10) / 10,
      hasAudio,
      previewUrl: URL.createObjectURL(poster.blob),
    };
  } finally {
    input.dispose();
  }
}

// ── Upload ──────────────────────────────────────────────────────────────────

export type StorageMode = 'blob' | 'local';

/** `name` is already extension-free (the composer passes file stems). */
const safeName = (name: string) =>
  name
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'file';

/** Upload one processed file; resolves to its public URL. */
export async function uploadFile(
  blob: Blob,
  baseName: string,
  ext: string,
  kind: UploadKind,
  mode: StorageMode,
  onProgress: (fraction: number) => void
): Promise<string> {
  const pathname = `updates/${safeName(baseName)}.${ext}`;

  if (mode === 'blob') {
    const { upload } = await import('@vercel/blob/client');
    const result = await upload(pathname, blob, {
      access: 'public',
      handleUploadUrl: '/api/admin/upload',
      clientPayload: JSON.stringify({ kind }),
      contentType: blob.type,
      // Parts are retried individually — kinder to patchy site mobile data.
      multipart: blob.size > 8 * 1024 * 1024,
      onUploadProgress: ({ percentage }) => onProgress(percentage / 100),
    });
    return result.url;
  }

  // Local development stand-in for Blob.
  const res = await fetch(`/api/admin/dev-upload?kind=${kind}&pathname=${encodeURIComponent(pathname)}`, {
    method: 'PUT',
    headers: { 'Content-Type': blob.type },
    body: blob,
  });
  const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !json.url) throw new FriendlyError(json.error ?? 'Upload failed');
  onProgress(1);
  return json.url;
}
