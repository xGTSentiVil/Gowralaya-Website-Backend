'use client';

import { useState, useTransition } from 'react';
import { tidyStorage } from '../actions';
import { formatBytes } from './format';

/** Clears files left behind by abandoned uploads (closed tab, dropped signal). */
export default function TidyButton() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div style={{ marginTop: 28 }}>
      <button
        type="button"
        className="btn btn-sm btn-quiet"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const r = await tidyStorage();
            setMessage(
              !r.ok
                ? (r.error ?? 'Couldn’t tidy storage.')
                : r.removed
                  ? `Removed ${r.removed} unused file${r.removed === 1 ? '' : 's'} (${formatBytes(r.freedBytes)}).`
                  : 'Nothing to tidy — no unused files.'
            );
          })
        }
      >
        {pending ? 'Checking storage…' : 'Tidy up unused files'}
      </button>
      {message && <p className="muted" style={{ margin: '4px 0 0' }}>{message}</p>}
    </div>
  );
}
