import { redirect } from 'next/navigation';
import { isAdmin } from '@/lib/dal';
import LoginForm from './LoginForm';

export default async function LoginPage() {
  if (await isAdmin()) redirect('/admin');

  return (
    <main className="login-wrap">
      <div className="card login-card">
        <h1>Site updates</h1>
        <p className="muted">Sri Gowralaya Builders · post photos and videos from site</p>
        <LoginForm />
      </div>
    </main>
  );
}
