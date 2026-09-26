import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, isValidSession } from '@/lib/session';

// ─────────────────────────────────────────────────────────────────────────────
// Convenience only: sends a signed-out visitor from /admin/* to the login page
// before any page work happens. Real authorisation lives in lib/dal.ts and is
// checked inside every page, Server Action and route handler — Next's docs are
// explicit that proxy coverage can silently change, so nothing relies on it.
//
// /admin/login is excluded, otherwise its own sign-in action (which posts to
// that route) would be redirected away.
// ─────────────────────────────────────────────────────────────────────────────

export async function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (await isValidSession(token)) return NextResponse.next();
  return NextResponse.redirect(new URL('/admin/login', request.url));
}

export const config = {
  matcher: ['/admin', '/admin/((?!login).*)'],
};
