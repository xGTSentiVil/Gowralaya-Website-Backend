import { redirect } from 'next/navigation';
import { SITE_ORIGIN } from '@/lib/projects';

// This app only serves the API and the /admin portal. Anyone landing on its
// root is sent to the real website.
export default function Home() {
  redirect(SITE_ORIGIN);
}
