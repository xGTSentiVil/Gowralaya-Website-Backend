import 'server-only';
import { scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Admin password check.
//
// ADMIN_PASSWORD_HASH holds `scrypt:N:r:p:<salt>:<hash>` (base64url), produced
// by `npm run hash-password` (scripts/hash-password.mjs mirrors this format).
// Colons rather than `$`, because .env loaders expand `$...` sequences.
// The password itself is never stored anywhere.
// ─────────────────────────────────────────────────────────────────────────────

function scryptAsync(password: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key)))
  );
}

export async function verifyPassword(password: string, stored: string | undefined): Promise<boolean> {
  if (!stored) return false;

  const parts = stored.trim().split(':');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64url');
  const N = Number(n);
  const R = Number(r);
  const P = Number(p);
  if (!expected.length || !N || !R || !P) return false;

  const actual = await scryptAsync(password, Buffer.from(saltB64, 'base64url'), expected.length, {
    N,
    r: R,
    p: P,
    maxmem: 256 * N * R, // scrypt needs ~128*N*r bytes; default cap is too tight for N=2^15
  });

  // Constant-time: no timing signal about how much of the password matched.
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
