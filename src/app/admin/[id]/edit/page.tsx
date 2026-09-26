import { notFound } from 'next/navigation';
import { requireAdminPage } from '@/lib/dal';
import { getSiteProjects } from '@/lib/projects';
import { storageMode } from '@/lib/storage';
import { getUpdate, storageBytes } from '@/lib/updates';
import Composer from '../../_components/Composer';

export default async function EditUpdatePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const { id } = await params;

  const [post, { list, ok }, used] = await Promise.all([getUpdate(id), getSiteProjects(), storageBytes()]);
  if (!post) notFound();

  return (
    <Composer
      postId={post.id}
      initial={{
        projectId: post.projectId,
        caption: post.caption,
        takenOn: post.takenOn,
        isPublished: post.isPublished,
        media: post.media,
      }}
      projects={list.map(({ id, name, location }) => ({ id, name, location }))}
      projectsOk={ok}
      storageMode={storageMode()}
      storageUsed={used}
    />
  );
}
