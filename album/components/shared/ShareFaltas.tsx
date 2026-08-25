'use client';

import { useState } from 'react';
import { buildShareText, type SharePayload } from '@/lib/share/faltas';

type State = 'idle' | 'working' | 'copied' | 'error';

/** Copiar el texto y compartir la imagen: los dos caminos por los que se intercambia. */
export function ShareFaltas({ payload }: { payload: SharePayload }) {
  const [state, setState] = useState<State>('idle');

  async function copyText() {
    try {
      await navigator.clipboard.writeText(buildShareText(payload));
      setState('copied');
      setTimeout(() => setState('idle'), 1800);
    } catch {
      setState('error');
    }
  }

  async function shareImage() {
    setState('working');
    try {
      const res = await fetch('/api/share/faltas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const file = new File([blob], 'mis-faltas.png', { type: 'image/png' });

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text: buildShareText(payload) });
      } else {
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
      }
      setState('idle');
    } catch {
      setState('error');
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => void copyText()}
        className="rounded-full border border-slot-edge px-3 py-1.5 text-sm hover:border-cream/40"
      >
        {state === 'copied' ? 'Copiado ✓' : 'Copiar lista'}
      </button>
      <button
        type="button"
        onClick={() => void shareImage()}
        disabled={state === 'working'}
        className="rounded-full bg-gold px-3 py-1.5 text-sm font-semibold text-ink disabled:opacity-60"
      >
        {state === 'working' ? 'Generando…' : 'Compartir imagen'}
      </button>
      {state === 'error' && (
        <span className="text-xs text-red-300">No se pudo compartir. Copia la lista.</span>
      )}
    </div>
  );
}
