'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useCollection } from '@/components/shared/CollectionProvider';
import { formatPrice } from '@/lib/prices/aggregate';
import { usePrices } from '@/lib/prices/client';
import { relativeDate } from '@/lib/format';
import { SERIES_KIND_LABEL, type SeriesKind } from '@/lib/types';

/**
 * Lo que vale tu colección. El número grande siempre va acompañado de cuántas
 * cartas tienen datos detrás: sin eso es un número bonito y falso.
 */
export function ValueScreen() {
  const { index, owned, loading } = useCollection();
  const { priceFor } = usePrices();

  const data = useMemo(() => {
    if (!index) return null;

    const rows = [...owned.entries()].flatMap(([cardId, mine]) => {
      const card = index.cardById.get(cardId);
      if (!card) return [];
      const series = index.seriesById.get(card.series_id);
      const price = priceFor(cardId);
      return [{
        card,
        series,
        quantity: mine.quantity,
        price,
        value: price ? price.value * mine.quantity : null,
      }];
    });

    const byKind = new Map<SeriesKind, { value: number; cards: number }>();
    for (const row of rows) {
      const kind = row.series?.kind ?? 'base';
      const acc = byKind.get(kind) ?? { value: 0, cards: 0 };
      acc.value += row.value ?? 0;
      acc.cards += row.quantity;
      byKind.set(kind, acc);
    }

    const priced = rows.filter((r) => r.value != null);
    return {
      rows,
      priced,
      total: priced.reduce((n, r) => n + (r.value ?? 0), 0),
      byKind: [...byKind.entries()].sort((a, b) => b[1].value - a[1].value),
      top: [...priced].sort((a, b) => (b.price!.value) - (a.price!.value)).slice(0, 10),
      lastUpdate: priced
        .map((r) => r.price!.updatedAt)
        .sort()
        .reverse()[0],
    };
  }, [index, owned, priceFor]);

  if (loading || !index || !data) {
    return <p className="px-4 py-16 text-center text-muted">Cargando…</p>;
  }

  if (!data.rows.length) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center">
        <p className="font-display text-xl">Aún no tienes ninguna carta.</p>
        <Link
          href="/sobre"
          className="mt-4 inline-block rounded-full bg-gold px-4 py-2 text-sm font-semibold text-ink"
        >
          Abre tu primer sobre
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 pb-12 pt-[calc(1rem+env(safe-area-inset-top))]">
      <h1 className="font-display text-2xl">Valor</h1>

      <div className="mt-3 rounded-xl border border-slot-edge bg-sheet p-5">
        <p className="font-display text-5xl tnum">{formatPrice(data.total)}</p>
        <p className="mt-2 text-sm text-muted tnum">
          {data.priced.length} de {data.rows.length} cartas con datos de precio
          {data.lastUpdate ? ` · actualizado ${relativeDate(data.lastUpdate)}` : ''}
        </p>
      </div>

      <p className="mt-3 rounded-lg border border-gold/30 bg-gold/5 px-3 py-2 text-xs text-cream/80">
        Es una <strong>estimación</strong> a partir de anuncios y ventas reportadas por la
        comunidad. No es una tasación y no sirve como garantía de venta.
      </p>

      <section className="mt-7">
        <h2 className="mb-2 font-display text-lg">Por tipo de carta</h2>
        <ul className="divide-y divide-slot-edge/60 overflow-hidden rounded-xl border border-slot-edge">
          {data.byKind.map(([kind, acc]) => (
            <li key={kind} className="flex items-center justify-between bg-sheet px-3 py-2.5">
              <span className="text-sm">{SERIES_KIND_LABEL[kind]}</span>
              <span className="text-right">
                <span className="font-display text-base tnum">{formatPrice(acc.value)}</span>
                <span className="ml-2 text-xs text-muted tnum">{acc.cards} ejemplares</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-7">
        <h2 className="mb-2 font-display text-lg">Tus 10 más valiosas</h2>
        {data.top.length === 0 ? (
          <p className="text-sm text-muted">
            Ninguna de tus cartas tiene precio todavía. Reporta una venta y empieza a
            construir el precio de la comunidad.
          </p>
        ) : (
          <ol className="divide-y divide-slot-edge/60 overflow-hidden rounded-xl border border-slot-edge">
            {data.top.map((row, i) => {
              const team = row.card.team_id ? index.teamById.get(row.card.team_id) : undefined;
              return (
                <li key={row.card.id}>
                  <Link
                    href={`/card/${row.card.id}`}
                    className="flex items-center gap-3 bg-sheet px-3 py-2.5"
                  >
                    <span className="w-5 text-center text-sm text-muted tnum">{i + 1}</span>
                    <span
                      className="h-7 w-1 shrink-0 rounded-full"
                      style={{ background: team?.primary_color ?? '#7c8291' }}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">
                        <span className="font-display tnum">{row.card.number}</span>
                        <span className="ml-2">{row.card.player_name ?? team?.name ?? ''}</span>
                      </span>
                      <span className="block text-xs text-muted">
                        {row.series?.name}
                        {row.quantity > 1 ? ` · tienes ${row.quantity}` : ''}
                      </span>
                    </span>
                    <span className="shrink-0 font-display text-base tnum">
                      {formatPrice(row.price!.value, row.price!.currency)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
