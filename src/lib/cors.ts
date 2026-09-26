import type { NextRequest } from 'next/server';

// ─────────────────────────────────────────────────────────────────────────────
// CORS for the public API, shared by every route the website calls.
//
// The live site is served from www (the apex domain 308-redirects there), so
// the www origin is the one that matters. It was missing from the old list, so
// the browser blocked the contact form on the live site.
//
// Unknown origins get no Access-Control-Allow-Origin header at all. The old
// code answered them with a *different* allowed origin, which blocks the call
// just the same but makes the failure much harder to diagnose.
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_ORIGINS = new Set([
  'https://www.srigowralayabuilders.in',
  'https://srigowralayabuilders.in',
  'https://srigowralayabuilders.vercel.app',
  'https://srigowralaya.vercel.app',
  // Local frontend (vite dev / vite preview) talking to the deployed backend.
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:4173',
]);

export function isAllowedOrigin(origin: string | null): origin is string {
  return !!origin && ALLOWED_ORIGINS.has(origin);
}

export function corsHeaders(request: NextRequest, methods: string): Record<string, string> {
  const origin = request.headers.get('origin');
  const headers: Record<string, string> = {
    // Responses differ per origin, so shared caches must key on it.
    Vary: 'Origin',
  };
  if (isAllowedOrigin(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = methods;
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
    headers['Access-Control-Max-Age'] = '86400';
  }
  return headers;
}
