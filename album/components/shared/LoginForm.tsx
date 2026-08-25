'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { APP_NAME } from '@/lib/config';
import { isSupabaseConfigured, supabase } from '@/lib/db/supabase';
import { requestSync } from '@/lib/offline/sync';

/**
 * Magic link: sin contraseñas que recordar. La cuenta solo sirve para que tu
 * álbum te siga entre dispositivos; sin ella la app funciona igual en local.
 */
export function LoginForm() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [session, setSession] = useState<string | null>(null);

  useEffect(() => {
    const client = supabase();
    if (!client) return;
    client.auth.getUser().then(({ data }) => setSession(data.user?.email ?? null));
    const { data: sub } = client.auth.onAuthStateChange((_event, s) => {
      setSession(s?.user?.email ?? null);
      if (s) void requestSync();
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const client = supabase();
    if (!client) return;
    setState('sending');
    const { error } = await client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setState('error');
      setMessage(error.message);
      return;
    }
    setState('sent');
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-20">
      <h1 className="font-display text-3xl">{APP_NAME}</h1>
      <p className="mt-2 text-sm text-muted">
        Tu colección, como un álbum de verdad. Compatible con las colecciones de
        cromos y cartas de fútbol de la temporada.
      </p>

      {!isSupabaseConfigured ? (
        <div className="mt-6 rounded-xl border border-slot-edge bg-sheet p-4 text-sm">
          <p>Estás en <strong>modo local</strong>: todo se guarda en este dispositivo.</p>
          <p className="mt-2 text-muted">
            Configura Supabase (ver <code className="text-cream">.env.example</code>) para
            sincronizar entre móvil y ordenador.
          </p>
        </div>
      ) : session ? (
        <div className="mt-6 rounded-xl border border-slot-edge bg-sheet p-4 text-sm">
          <p>Sesión iniciada como <strong>{session}</strong>.</p>
          <button
            type="button"
            onClick={async () => { await supabase()?.auth.signOut(); }}
            className="mt-3 rounded-full border border-slot-edge px-3 py-1.5 text-sm"
          >
            Cerrar sesión
          </button>
        </div>
      ) : state === 'sent' ? (
        <div className="mt-6 rounded-xl border border-gold/40 bg-sheet p-4 text-sm">
          <p>Te hemos enviado un enlace a <strong>{email}</strong>.</p>
          <p className="mt-2 text-muted">Ábrelo en este mismo dispositivo.</p>
        </div>
      ) : (
        <form onSubmit={send} className="mt-6 space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs text-muted">Tu correo</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              className="w-full rounded-lg border border-slot-edge bg-sheet px-3 py-2.5 outline-none focus:border-gold"
            />
          </label>
          <button
            type="submit"
            disabled={state === 'sending'}
            className="w-full rounded-full bg-gold px-4 py-2.5 font-semibold text-ink disabled:opacity-60"
          >
            {state === 'sending' ? 'Enviando…' : 'Enviarme el enlace'}
          </button>
          {state === 'error' && <p className="text-sm text-red-300">{message}</p>}
        </form>
      )}

      <p className="mt-6 text-center text-sm">
        <Link href="/album" className="text-muted underline underline-offset-4">
          Entrar sin cuenta y empezar el álbum
        </Link>
      </p>
    </div>
  );
}
