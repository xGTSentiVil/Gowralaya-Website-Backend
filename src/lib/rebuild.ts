import 'server-only';

// ─────────────────────────────────────────────────────────────────────────────
// Rebuild the website after a post changes.
//
// The live site already shows new posts within ~30 s (it fetches the feed in
// the browser). The rebuild bakes them into the prerendered HTML too, which is
// what Google and WhatsApp link previews read. It takes ~1-2 minutes.
//
// FRONTEND_DEPLOY_HOOK_URL comes from the *frontend* project in Vercel:
// Settings → Git → Deploy Hooks.
// ─────────────────────────────────────────────────────────────────────────────

export async function triggerSiteRebuild(reason: string): Promise<void> {
  const hook = process.env.FRONTEND_DEPLOY_HOOK_URL;
  if (!hook) {
    console.warn(`[rebuild] skipped (${reason}): FRONTEND_DEPLOY_HOOK_URL is not set`);
    return;
  }
  try {
    const res = await fetch(hook, { method: 'POST', signal: AbortSignal.timeout(10000) });
    if (!res.ok) console.error(`[rebuild] deploy hook answered HTTP ${res.status} (${reason})`);
    else console.log(`[rebuild] triggered (${reason})`);
  } catch (err) {
    // Never fail a save because the rebuild could not be requested; the post
    // is already live via the API and the next change will rebuild anyway.
    console.error(`[rebuild] could not reach the deploy hook (${reason})`, err);
  }
}
