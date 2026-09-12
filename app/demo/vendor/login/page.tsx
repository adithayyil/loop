import { redirect } from 'next/navigation';
import { isLoggedIn } from '@/lib/demo-data';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (await isLoggedIn()) redirect('/demo/vendor');
  const sp = await searchParams;
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 360, margin: '80px auto' }}>
      <h1 style={{ fontSize: 22 }}>Vendor Portal</h1>
      <p style={{ color: '#666' }}>Sign in to view invoices.</p>
      {sp.error ? <p style={{ color: 'crimson' }}>Invalid credentials.</p> : null}
      <form method="POST" action="/demo/vendor/api/login">
        <p>
          <input
            id="username"
            name="username"
            placeholder="Username"
            data-testid="username"
            autoComplete="username"
            style={{ width: '100%', padding: 8 }}
          />
        </p>
        <p>
          <input
            id="password"
            name="password"
            type="password"
            placeholder="Password"
            data-testid="password"
            autoComplete="current-password"
            style={{ width: '100%', padding: 8 }}
          />
        </p>
        <button type="submit" data-testid="login-button" style={{ padding: '8px 16px' }}>
          Sign in
        </button>
      </form>
      <p style={{ color: '#999', fontSize: 13 }}>demo credentials: vendor / hunter2</p>
    </main>
  );
}
