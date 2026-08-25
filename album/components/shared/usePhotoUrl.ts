'use client';

import { useEffect, useState } from 'react';
import { resolvePhotoUrl } from '@/lib/photos';

/** Devuelve la URL de la foto y libera el object URL al desmontar. */
export function usePhotoUrl(path: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let revoke: string | null = null;
    let alive = true;
    resolvePhotoUrl(path ?? null).then((next) => {
      if (!alive) {
        if (next?.startsWith('blob:')) URL.revokeObjectURL(next);
        return;
      }
      if (next?.startsWith('blob:')) revoke = next;
      setUrl(next);
    });
    return () => {
      alive = false;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [path]);

  return url;
}
