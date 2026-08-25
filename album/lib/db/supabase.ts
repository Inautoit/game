'use client';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Sin credenciales la app arranca igual en "modo local": todo vive en IndexedDB.
 * Es el modo con el que se desarrolla y el que hace que funcione sin cobertura.
 */
export const isSupabaseConfigured = Boolean(url && anonKey);

let client: SupabaseClient | null = null;

/**
 * El sitio es estático: no hay servidor que refresque cookies de sesión, así que
 * la sesión vive en el navegador y el enlace mágico se cierra en el cliente.
 */
export function supabase(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  if (!client) {
    client = createClient(url!, anonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
        storageKey: 'album-auth',
      },
    });
  }
  return client;
}
