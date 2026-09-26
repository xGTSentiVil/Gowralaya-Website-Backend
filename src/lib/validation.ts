import 'server-only';
import { z } from 'zod';
import { LIMITS, isYoutubeId } from './shared/media';
import { isOurMediaUrl } from './storage';
import { PROJECT_ID } from './projects';

// ─────────────────────────────────────────────────────────────────────────────
// Server-side validation of a post. The composer checks the same things, but
// the browser is never trusted: every Server Action re-validates here.
// ─────────────────────────────────────────────────────────────────────────────

const storedUrl = z
  .string()
  .max(600)
  .refine(isOurMediaUrl, { error: 'A media file did not come from this site’s storage.' });

const dimension = z.number().int().min(1).max(10000);
const bytes = z.number().int().min(0).max(200 * 1024 * 1024);

const mediaItem = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('image'),
    url: storedUrl,
    thumb: storedUrl,
    w: dimension,
    h: dimension,
    bytes,
  }),
  z.object({
    kind: z.literal('video'),
    url: storedUrl,
    poster: storedUrl,
    w: dimension,
    h: dimension,
    durationSec: z.number().min(0).max(LIMITS.videoMaxSeconds + 5),
    bytes,
  }),
  z.object({
    kind: z.literal('youtube'),
    id: z.string().refine(isYoutubeId, { error: 'That YouTube link is not valid.' }),
  }),
]);

function isPlausibleDate(value: string): boolean {
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  const inTwoDays = Date.now() + 2 * 24 * 60 * 60 * 1000;
  return d.getUTCFullYear() >= 2000 && d.getTime() <= inTwoDays;
}

export const updateInputSchema = z
  .object({
    projectId: z.string().regex(PROJECT_ID).nullable(),
    caption: z.string().max(LIMITS.captionMax).transform((s) => s.trim()),
    takenOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine(isPlausibleDate, { error: 'Pick a date that isn’t in the future.' }),
    isPublished: z.boolean(),
    media: z.array(mediaItem).max(LIMITS.mediaPerPost, {
      error: `A post can hold up to ${LIMITS.mediaPerPost} photos and videos.`,
    }),
  })
  .refine((v) => v.caption.length > 0 || v.media.length > 0, {
    error: 'Add a caption, or at least one photo or video.',
  });

export type ValidUpdateInput = z.infer<typeof updateInputSchema>;
