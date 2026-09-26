'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { deletePost, setPostPublished } from '../actions';

export default function PostActions({ id, isPublished }: { id: string; isPublished: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      setError(null);
      const result = await fn();
      if (!result.ok) setError(result.error ?? 'Something went wrong.');
    });

  return (
    <>
      <div className="post-actions">
        <Link href={`/admin/${id}/edit`} className="btn btn-sm">
          Edit
        </Link>
        <button
          type="button"
          className="btn btn-sm"
          disabled={pending}
          onClick={() => run(() => setPostPublished(id, !isPublished))}
        >
          {isPublished ? 'Hide' : 'Show'}
        </button>
        <button
          type="button"
          className="btn btn-sm btn-danger"
          disabled={pending}
          onClick={() => {
            if (window.confirm('Delete this update and its photos and videos? This can’t be undone.')) {
              run(() => deletePost(id));
            }
          }}
        >
          Delete
        </button>
      </div>
      {error && (
        <p className="muted" style={{ color: 'var(--danger)', margin: '6px 0 0' }} role="alert">
          {error}
        </p>
      )}
    </>
  );
}
