'use client';

import { supabase } from './db/supabase';
import { db } from './offline/db';

const TARGET_W = 900;
const RATIO = 63 / 88;
const BUCKET = 'card-photos';

/**
 * Recorta a la proporción de la carta y comprime en el cliente antes de subir.
 * Subir 4 MB de foto de móvil para mostrarla a 200 px es tirar datos del usuario.
 */
export async function processPhoto(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const w = TARGET_W;
  const h = Math.round(TARGET_W / RATIO);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('El navegador no permite procesar la imagen');

  // Recorte "cover" centrado: la carta llena el hueco sin deformarse.
  const scale = Math.max(w / bitmap.width, h / bitmap.height);
  const dw = bitmap.width * scale;
  const dh = bitmap.height * scale;
  ctx.drawImage(bitmap, (w - dw) / 2, (h - dh) / 2, dw, dh);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/webp', 0.85));
  if (!blob) throw new Error('No se pudo comprimir la imagen');
  return blob;
}

/**
 * Guarda siempre en local (para verla al instante y sin conexión) y sube a Storage
 * si hay sesión. Devuelve la ruta que se persiste en user_cards.photo_path.
 */
export async function savePhoto(cardId: string, condition: string, blob: Blob): Promise<string> {
  const key = `${cardId}-${condition}.webp`;
  await db().photos.put({ key, blob });

  const client = supabase();
  if (client) {
    const { data } = await client.auth.getUser();
    const userId = data.user?.id;
    if (userId) {
      const path = `${userId}/${key}`;
      const { error } = await client.storage.from(BUCKET)
        .upload(path, blob, { upsert: true, contentType: 'image/webp' });
      if (!error) return path;
    }
  }
  return `local:${key}`;
}

/** Resuelve photo_path a una URL mostrable, venga de IndexedDB o de Storage. */
export async function resolvePhotoUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  if (path.startsWith('local:')) {
    const row = await db().photos.get(path.slice('local:'.length));
    return row ? URL.createObjectURL(row.blob) : null;
  }
  const local = await db().photos.get(path.split('/').pop() ?? '');
  if (local) return URL.createObjectURL(local.blob);

  const client = supabase();
  if (!client) return null;
  return client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
