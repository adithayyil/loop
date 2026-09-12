import { NextResponse } from 'next/server';
import { SESSION_COOKIE, VENDOR_PASS, VENDOR_USER } from '@/lib/demo-data';

export const dynamic = 'force-dynamic';

/** Behind a tunnel, `request.url` reflects the internal host; trust forwarded headers. */
function origin(request: Request): string {
  const proto = request.headers.get('x-forwarded-proto') ?? 'http';
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? 'localhost:3000';
  return `${proto}://${host}`;
}

export async function POST(req: Request) {
  const form = await req.formData();
  const user = String(form.get('username') ?? '');
  const pass = String(form.get('password') ?? '');

  if (user === VENDOR_USER && pass === VENDOR_PASS) {
    const res = NextResponse.redirect(new URL('/demo/vendor', origin(req)), 303);
    res.cookies.set(SESSION_COOKIE, 'ok', {
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30,
    });
    return res;
  }
  return NextResponse.redirect(new URL('/demo/vendor/login?error=1', origin(req)), 303);
}
