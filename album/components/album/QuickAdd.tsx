'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useCollection } from '@/components/shared/CollectionProvider';
import { addCopy, removeCopy } from '@/lib/offline/collection';
import type { Card } from '@/lib/types';

interface Entry {
  card: Card;
  quantity: number;
  isNew: boolean;
}

/**
 * Modo sobre: acabas de abrir uno y quieres meter ocho cartas seguidas.
 * Todo el diseño va a que el foco no se pierda nunca y a confirmar en voz alta
 * qué carta has metido, porque el número solo no basta para saber si te has
 * equivocado.
 */
export function QuickAdd() {
  const { index } = useCollection();
  const [value, setValue] = useState('');
  const [seriesCode, setSeriesCode] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (index && !seriesCode) {
      setSeriesCode(index.baseSeries?.code ?? index.catalog.series[0]?.code ?? null);
    }
  }, [index, seriesCode]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const byNumber = useMemo(() => {
    const map = new Map<string, Card[]>();
    if (!index) return map;
    for (const card of index.catalog.cards) {
      const key = card.number.toLowerCase();
      map.set(key, [...(map.get(key) ?? []), card]);
    }
    return map;
  }, [index]);

  const activeSeries = index?.catalog.series.find((s) => s.code === seriesCode);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const raw = value.trim().toLowerCase();
    if (!raw || !index) return;

    const matches = byNumber.get(raw) ?? [];
    const card = matches.find((c) => c.series_id === activeSeries?.id) ?? matches[0];

    if (!card) {
      setError(`No existe la carta ${value.trim()} en esta colección`);
      setValue('');
      if (navigator.vibrate) navigator.vibrate([12, 40, 12]);
      return;
    }

    setError(null);
    const result = await addCopy(card.id);
    setEntries((prev) => [{ card, quantity: result.quantity, isNew: result.isNew }, ...prev]);
    setValue('');
    if (navigator.vibrate) navigator.vibrate(result.isNew ? 18 : 8);
    inputRef.current?.focus();
  }

  async function undo() {
    const [last, ...rest] = entries;
    if (!last) return;
    await removeCopy(last.card.id);
    setEntries(rest);
    inputRef.current?.focus();
  }

  if (!index) {
    return <p className="px-4 py-16 text-center text-muted">Cargando catálogo…</p>;
  }

  const last = entries[0];
  const newCount = entries.filter((e) => e.isNew).length;
  const teamName = (card: Card) =>
    (card.team_id ? index.teamById.get(card.team_id)?.name : undefined) ?? '';

  return (
    <div className="mx-auto max-w-md px-4 pb-12 pt-[calc(1rem+env(safe-area-inset-top))]">
      <h1 className="font-display text-2xl">Abrir sobre</h1>
      <p className="mt-1 text-sm text-muted">
        Escribe el número y pulsa intro. Una detrás de otra.
      </p>

      <div className="no-scrollbar mt-4 flex gap-2 overflow-x-auto">
        {index.catalog.series.map((s) => (
          <button
            key={s.code}
            type="button"
            onClick={() => { setSeriesCode(s.code); inputRef.current?.focus(); }}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-sm ${
              s.code === seriesCode
                ? 'border-cream/70 bg-cream text-ink'
                : 'border-slot-edge bg-sheet text-cream/80'
            }`}
          >
            {s.name}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="mt-4">
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          enterKeyHint="done"
          placeholder={activeSeries?.kind === 'base' ? '128' : 'MVP7'}
          aria-label="Número de carta"
          className="w-full rounded-2xl border border-slot-edge bg-sheet px-4 py-6 text-center font-display text-5xl tnum
            outline-none focus:border-gold"
        />
      </form>

      {error && <p className="mt-3 text-center text-sm text-red-300">{error}</p>}

      {last && (
        <div
          key={`${last.card.id}-${entries.length}`}
          className={`animate-pop mt-4 rounded-xl border p-4 text-center ${
            last.isNew ? 'border-gold bg-gold text-ink' : 'border-slot-edge bg-sheet'
          }`}
        >
          <p className="font-display text-xl">{last.isNew ? 'Nueva' : `Repe ×${last.quantity}`}</p>
          <p className="text-sm">
            {last.card.number} · {last.card.player_name ?? teamName(last.card)}
          </p>
          <p className={`text-xs ${last.isNew ? 'text-ink/70' : 'text-muted'}`}>
            {teamName(last.card)}
          </p>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between">
        <p className="text-sm text-muted tnum">
          {entries.length} en esta sesión · {newCount} {newCount === 1 ? 'nueva' : 'nuevas'}
        </p>
        <button
          type="button"
          onClick={() => void undo()}
          disabled={!entries.length}
          className="rounded-full border border-slot-edge px-3 py-1.5 text-sm disabled:opacity-40"
        >
          Deshacer
        </button>
      </div>

      {entries.length > 1 && (
        <ul className="mt-4 divide-y divide-slot-edge/60 overflow-hidden rounded-xl border border-slot-edge">
          {entries.slice(1, 12).map((entry, i) => (
            <li key={`${entry.card.id}-${i}`} className="flex items-center justify-between bg-sheet px-3 py-2 text-sm">
              <span className="tnum text-muted">{entry.card.number}</span>
              <span className="min-w-0 flex-1 truncate px-3">
                {entry.card.player_name ?? teamName(entry.card)}
              </span>
              <span className={entry.isNew ? 'text-gold' : 'text-muted'}>
                {entry.isNew ? 'nueva' : `×${entry.quantity}`}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-6 text-center text-xs text-muted">
        Próximamente: leer el número con la cámara.{' '}
        <Link href="/faltas" className="underline underline-offset-4">Ver faltas</Link>
      </p>
    </div>
  );
}
