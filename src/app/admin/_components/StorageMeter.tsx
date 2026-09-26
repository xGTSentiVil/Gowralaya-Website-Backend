import { LIMITS } from '@/lib/shared/media';
import { formatBytes } from './format';

/**
 * Photo/video storage used against the free Vercel Blob allowance. Going over
 * it locks storage for 30 days, so this is kept in view on the dashboard.
 */
export default function StorageMeter({ used }: { used: number }) {
  const ratio = used / LIMITS.storageBudgetBytes;
  const level = ratio >= LIMITS.storageBlockVideoRatio ? 'full' : ratio >= LIMITS.storageWarnRatio ? 'warn' : 'ok';

  return (
    <div className="meter">
      <div className="meter-head">
        <span>Photo &amp; video storage</span>
        <span className="muted">
          {formatBytes(used)} of {formatBytes(LIMITS.storageBudgetBytes)}
        </span>
      </div>
      <div
        className="meter-track"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(ratio * 100)}
        aria-label="Storage used"
      >
        <div className="meter-fill" data-level={level} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
      </div>
      {level === 'warn' && (
        <p className="muted" style={{ margin: '6px 0 0' }}>
          Storage is filling up. For videos, prefer YouTube links.
        </p>
      )}
      {level === 'full' && (
        <p className="muted" style={{ margin: '6px 0 0', color: 'var(--danger)' }}>
          Storage is nearly full — video uploads are paused. Use YouTube links, or delete old posts.
        </p>
      )}
    </div>
  );
}
