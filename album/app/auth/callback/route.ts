import { NextResponse } from 'next/server';
import { serverClient } from '@/lib/db/supabase-server';

/** Cierre del magic link: cambia el código por la sesión y vuelve al álbum. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') ?? '/album';

  if (code) {
    const client = await serverClient();
    if (client) {
      const { error } = await client.auth.exchangeCodeForSession(code);
      if (!error) return NextResponse.redirect(new URL(next, url.origin));
    }
  }

  return NextResponse.redirect(new URL('/login?error=enlace', url.origin));
}
