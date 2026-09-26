import { requireAdminPage } from '@/lib/dal';
import { getSiteProjects } from '@/lib/projects';
import { storageMode } from '@/lib/storage';
import { storageBytes } from '@/lib/updates';
import Composer from '../_components/Composer';

/** Today in Chennai, so the default date matches the site even from a UTC server. */
const todayInIndia = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

export default async function NewUpdatePage() {
  await requireAdminPage();
  const [{ list, ok }, used] = await Promise.all([getSiteProjects(), storageBytes()]);

  return (
    <Composer
      postId={null}
      initial={{ projectId: null, caption: '', takenOn: todayInIndia(), isPublished: true, media: [] }}
      projects={list.map(({ id, name, location }) => ({ id, name, location }))}
      projectsOk={ok}
      storageMode={storageMode()}
      storageUsed={used}
    />
  );
}
