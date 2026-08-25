'use client';

import { useEffect, useState } from 'react';
import { useCollection } from './CollectionProvider';
import { isSupabaseConfigured } from '@/lib/db/supabase';

/** Estado honesto de los datos: qué queda por subir y si estás sin conexión. */
export function SyncBadge() {
  const { pending } = useCollection();
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  if (!isSupabaseConfigured) {
    return (
      <span className="rounded-full border border-slot-edge px-2.5 py-1 text-[0.7rem] text-muted">
        solo en este dispositivo
      </span>
    );
  }
  if (!online) {
    return (
      <span className="rounded-full border border-slot-edge px-2.5 py-1 text-[0.7rem] text-muted">
        sin conexión
      </span>
    );
  }
  if (pending > 0) {
    return (
      <span className="rounded-full border border-gold/40 px-2.5 py-1 text-[0.7rem] text-gold tnum">
        {pending} por guardar
      </span>
    );
  }
  return (
    <span className="rounded-full border border-slot-edge px-2.5 py-1 text-[0.7rem] text-muted">
      guardado
    </span>
  );
}
