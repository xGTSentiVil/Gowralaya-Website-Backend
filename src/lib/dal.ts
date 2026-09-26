import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, isValidSession } from './session';

// ─────────────────────────────────────────────────────────────────────────────
// The authorisation gate. Every admin page, Server Action and route handler
// calls one of these — proxy.ts only does a convenience redirect and is never
// relied on for security (Server Actions don't even pass through it reliably).
// ─────────────────────────────────────────────────────────────────────────────

export const isAdmin = cache(async (): Promise<boolean> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return isValidSession(token);
});

/** For pages: sends a signed-out visitor to the login screen. */
export async function requireAdminPage(): Promise<void> {
  if (!(await isAdmin())) redirect('/admin/login');
}

export class UnauthorizedError extends Error {
  constructor() {
    super('Not signed in');
  }
}

/** For Server Actions and route handlers: throws instead of redirecting. */
export async function requireAdmin(): Promise<void> {
  if (!(await isAdmin())) throw new UnauthorizedError();
}
