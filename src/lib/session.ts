import 'server-only';
import { createHash } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

// ─────────────────────────────────────────────────────────────────────────────
// Admin session: a signed JWT in an HttpOnly cookie (the stateless approach
// from Next's authentication guide).
//
// The token carries a fingerprint of the current password hash, so changing
// ADMIN_PASSWORD_HASH in Vercel signs out every existing session — the way to
// revoke access if a phone is ever lost.
// ─────────────────────────────────────────────────────────────────────────────

export const SESSION_COOKIE = 'sg_admin';
const SESSION_DAYS = 30;

interface SessionPayload {
  role: 'admin';
  /** Fingerprint of ADMIN_PASSWORD_HASH at login. */
  pv: string;
}

function secretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET must be set to at least 32 random characters.');
  }
  return new TextEncoder().encode(secret);
}

function passwordVersion(): string {
  return createHash('sha256')
    .update(process.env.ADMIN_PASSWORD_HASH ?? '')
    .digest('base64url')
    .slice(0, 16);
}

export async function encryptSession(): Promise<string> {
  const payload: SessionPayload = { role: 'admin', pv: passwordVersion() };
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secretKey());
}

/** True only for a validly signed, unexpired admin token for the current password. */
export async function isValidSession(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ['HS256'] });
    return payload.role === 'admin' && payload.pv === passwordVersion();
  } catch {
    return false;
  }
}

export async function createSession(): Promise<void> {
  const token = await encryptSession();
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function deleteSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
