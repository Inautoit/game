'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useCollection } from '@/components/shared/CollectionProvider';
import { setQuantity, updateUserCard } from '@/lib/offline/collection';
import { formatPrice } from '@/lib/prices/aggregate';
import { usePrices } from '@/lib/prices/client';
import { buildShareText } from '@/lib/share/faltas';
import { ListFilters, type Filters } from './ListFilters';

/** Tus repes: cuántas tienes, cuánto valen y cuáles das a cambio. */
export function DupesList() {
  const { index, owned, loading } = useCollection();
  const { priceFor } = usePrices();
  const [filters, setFilters] = useState<Filters>({
    teamSlug: '', seriesCode: '', onlyRequestable: false,
  });
  const [copied, setCopied] = useState(false);

  const rows = useMemo(() => {
    if (!index) return [];
    const team = filters.teamSlug ? index.teamBySlug.get(filters.teamSlug) : undefined;

    return index.catalog.cards
      .map((card) => ({ card, mine: owned.get(card.id) }))
      .filter((r) => (r.mine?.quantity ?? 0) > 1)
      .filter((r) => {
        const series = index.seriesById.get(r.card.series_id);
        if (filters.seriesCode && series?.code !== filters.seriesCode) return false;
        if (team && r.card.team_id !== team.id) return false;
        return true;
      })
      .map((r) => {
        const extras = (r.mine!.quantity ?? 1) - 1;
        const price = priceFor(r.card.id);
        return { ...r, extras, price, value: price ? price.value * extras : null };
      });
  }, [index, owned, filters, priceFor]);

  if (loading || !index) {
    return <p className="px-4 py-16 text-center text-muted">Cargando…</p>;
  }

  const totalExtras = rows.reduce((n, r) => n + r.extras, 0);
  const priced = rows.filter((r) => r.value != null);
  const totalValue = priced.reduce((n, r) => n + (r.value ?? 0), 0);

  async function copyList() {
    const text = buildShareText({
      heading: `Doy a cambio ${totalExtras} cartas · ${index!.catalog.collection.name} ` +
        `${index!.catalog.collection.season}`,
      title: index!.catalog.collection.name,
      season: index!.catalog.collection.season,
      owned: 0,
      total: totalExtras,
      groups: index!.catalog.series
        .map((s) => ({
          series: s.name,
          requestable: s.requestable,
          numbers: rows
            .filter((r) => r.card.series_id === s.id)
            .flatMap((r) => Array.from({ length: r.extras }, () => r.card.number)),
        }))
        .filter((g) => g.numbers.length),
    });

    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="mx-auto max-w-2xl px-4 pb-32 pt-[calc(1rem+env(safe-area-inset-top))]">
      <div className="flex items-baseline justify-between">
        <h1 className="font-display text-2xl">Repes</h1>
        <span className="text-sm text-muted tnum">{totalExtras} para cambiar</span>
      </div>

      <div className="mt-3">
        <ListFilters
          teams={index.catalog.teams}
          series={index.catalog.series}
          value={filters}
          onChange={setFilters}
        />
      </div>

      {rows.length > 0 && (
        <button
          type="button"
          onClick={() => void copyList()}
          className="mt-3 rounded-full border border-slot-edge px-3 py-1.5 text-sm hover:border-cream/40"
        >
          {copied ? 'Copiado ✓' : 'Copiar lista de repes'}
        </button>
      )}

      {rows.length === 0 ? (
        <p className="mt-10 text-center text-muted">
          Todavía no tienes repes. Llegarán solas.
        </p>
      ) : (
        <ul className="mt-5 divide-y divide-slot-edge/60 overflow-hidden rounded-xl border border-slot-edge">
          {rows.map(({ card, mine, extras, price, value }) => {
            const team = card.team_id ? index.teamById.get(card.team_id) : undefined;
            return (
              <li key={card.id} className="flex items-center gap-3 bg-sheet px-3 py-2.5">
                <span
                  className="h-7 w-1 shrink-0 rounded-full"
                  style={{ background: team?.primary_color ?? '#7c8291' }}
                  aria-hidden
                />
                <Link href={`/card/${card.id}`} className="min-w-0 flex-1">
                  <p className="truncate text-sm">
                    <span className="font-display text-base tnum">{card.number}</span>
                    <span className="ml-2">{card.player_name ?? team?.name ?? ''}</span>
                  </p>
                  <p className="text-xs text-muted tnum">
                    tienes {mine!.quantity} · sobran {extras}
                    {price ? ` · ${formatPrice(price.value, price.currency)} cada una` : ' · sin precio'}
                  </p>
                </Link>

                <div className="flex shrink-0 items-center gap-2">
                  <span className="w-14 text-right text-sm tnum">
                    {value != null ? formatPrice(value) : '—'}
                  </span>
                  <button
                    type="button"
                    aria-label={mine!.for_trade ? 'Quitar de cambios' : 'Marcar para cambio'}
                    onClick={() => void updateUserCard(card.id, { for_trade: !mine!.for_trade })}
                    className={`rounded-full border px-2 py-1 text-xs ${
                      mine!.for_trade ? 'border-gold bg-gold text-ink' : 'border-slot-edge text-muted'
                    }`}
                  >
                    cambio
                  </button>
                  <button
                    type="button"
                    aria-label="Quitar una copia"
                    onClick={() => void setQuantity(card.id, mine!.quantity - 1)}
                    className="h-7 w-7 rounded-full border border-slot-edge text-sm leading-none"
                  >
                    −
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {rows.length > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(3.9rem+env(safe-area-inset-bottom))] z-30 border-t border-slot-edge/70 bg-leather/95 backdrop-blur">
          <div className="mx-auto flex max-w-2xl items-baseline justify-between px-4 py-3">
            <span className="text-sm text-muted">Tus repes valen aproximadamente</span>
            <span className="font-display text-xl tnum">{formatPrice(totalValue)}</span>
          </div>
          <p className="mx-auto max-w-2xl px-4 pb-2 text-[0.7rem] text-muted">
            Solo cuentan las {priced.length} de {rows.length} con datos de precio. Es una
            estimación, no una tasación.
          </p>
        </div>
      )}
    </div>
  );
}
