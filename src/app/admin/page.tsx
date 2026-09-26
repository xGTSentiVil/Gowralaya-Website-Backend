import Link from 'next/link';
import { requireAdminPage } from '@/lib/dal';
import { listAll, storageBytes } from '@/lib/updates';
import { getSiteProjects, SITE_ORIGIN } from '@/lib/projects';
import { youtubeThumb, type MediaItem } from '@/lib/shared/media';
import { logout } from './actions';
import StorageMeter from './_components/StorageMeter';
import PostActions from './_components/PostActions';
import TidyButton from './_components/TidyButton';
import { formatDate } from './_components/format';

function previewOf(media: MediaItem[]): string | null {
  const first = media[0];
  if (!first) return null;
  if (first.kind === 'image') return first.thumb;
  if (first.kind === 'video') return first.poster;
  return youtubeThumb(first.id);
}

export default async function AdminHome({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  await requireAdminPage();

  const [{ saved }, posts, used, { list: projects }] = await Promise.all([
    searchParams,
    listAll(),
    storageBytes(),
    getSiteProjects(),
  ]);
  const projectName = new Map(projects.map((p) => [p.id, p.name]));

  return (
    <main className="admin-shell">
      <header className="admin-bar">
        <Link href="/admin" className="admin-brand">
          <strong>Sri Gowralaya</strong>
          <span>Site updates</span>
        </Link>
        <div className="admin-bar-actions">
          <a href={`${SITE_ORIGIN}/updates`} className="btn btn-sm btn-quiet" target="_blank" rel="noopener">
            View site
          </a>
          <form action={logout}>
            <button type="submit" className="btn btn-sm btn-quiet">
              Sign out
            </button>
          </form>
        </div>
      </header>

      {saved && (
        <p className="notice notice-ok" role="status">
          Saved. It shows on the website within about a minute.
        </p>
      )}

      <Link href="/admin/new" className="btn btn-gold btn-block" style={{ marginBottom: 18, minHeight: 52 }}>
        ＋ New update
      </Link>

      <StorageMeter used={used} />

      <div className="list-head">
        <h1>Updates</h1>
        <span className="muted">{posts.length} total</span>
      </div>

      {posts.length === 0 ? (
        <div className="card empty">
          <p style={{ margin: '0 0 6px', fontWeight: 600 }}>No updates yet</p>
          <p className="muted" style={{ margin: 0 }}>
            Post photos, a short clip or a YouTube link from site — it appears on the website’s Updates page and on the
            project’s page.
          </p>
        </div>
      ) : (
        <ul className="post-list">
          {posts.map((post) => {
            const thumb = previewOf(post.media);
            return (
              <li key={post.id} className="card post-row" data-hidden={!post.isPublished}>
                {thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element -- remote storage URLs; no optimisation wanted
                  <img src={thumb} alt="" className="post-thumb" loading="lazy" />
                ) : (
                  <div className="post-thumb">Text only</div>
                )}
                <div>
                  <div className="post-meta">
                    <span>{formatDate(post.takenOn)}</span>
                    <span className="post-project">
                      {post.projectId ? (projectName.get(post.projectId) ?? post.projectId) : 'General'}
                    </span>
                    {!post.isPublished && <span className="badge">Hidden</span>}
                    {post.media.length > 0 && (
                      <span>
                        {post.media.length} item{post.media.length === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>
                  {post.caption && <p className="post-caption">{post.caption}</p>}
                  <PostActions id={post.id} isPublished={post.isPublished} />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <TidyButton />
    </main>
  );
}
