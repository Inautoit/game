'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useCollection } from '@/components/shared/CollectionProvider';
import { ShareFaltas } from '@/components/shared/ShareFaltas';
import { addCopy } from '@/lib/offline/collection';
import { toPayload, type MissingGroup } from '@/lib/share/faltas';
import { ListFilters, type Filters } from './ListFilters';

/**
 * Lo que te falta, agrupado por serie. El indicador de "pedible" ahorra dinero
 * real: pedir al servicio de últimas cartas algo que no se puede pedir es tirar
 * el sello.
 */
export function MissingList() {
  const { index, owned, progress, loading } = useCollection();
  const [filters, setFilters] = useState<Filters>({
    teamSlug: '', seriesCode: '', onlyRequestable: false,
  });

  const groups: MissingGroup[] = useMemo(() => {
    if (!index) return [];
    const team = filters.teamSlug ? index.teamBySlug.get(filters.teamSlug) : undefined;

    return index.catalog.series
      .filter((s) => !filters.seriesCode || s.code === filters.seriesCode)
      .filter((s) => !filters.onlyRequestable || s.requestable)
      .map((series) => ({
        series,
        cards: (index.cardsBySeries.get(series.id) ?? [])
          .filter((c) => !owned.has(c.id))
          .filter((c) => !team || c.team_id === team.id),
      }))
      .filter((g) => g.cards.length > 0);
  }, [index, owned, filters]);

  if (loading || !index) {
    return <p className="px-4 py-16 text-center text-muted">Cargando…</p>;
  }

  const missingShown = groups.reduce((n, g) => n + g.cards.length, 0);
  const payload = toPayload(
    index.catalog.collection.name,
    index.catalog.collection.season,
    progress.owned,
    progress.total,
    groups,
  );

  return (
    <div className="mx-auto max-w-2xl px-4 pb-12 pt-[calc(1rem+env(safe-area-inset-top))]">
      <div className="flex items-baseline justify-between">
        <h1 className="font-display text-2xl">Faltas</h1>
        <span className="text-sm text-muted tnum">
          {progress.total - progress.owned} en total
        </span>
      </div>

      <div className="mt-3">
        <ListFilters
          teams={index.catalog.teams}
          series={index.catalog.series}
          value={filters}
          onChange={setFilters}
          showRequestable
        />
      </div>

      <div className="mt-3">
        <ShareFaltas payload={payload} />
      </div>

      {missingShown === 0 ? (
        <p className="mt-10 text-center text-muted">
          Nada que pedir con este filtro. Buena señal.
        </p>
      ) : (
        <div className="mt-5 space-y-5">
          {groups.map((group) => (
            <section key={group.series.id}>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="font-display text-lg">{group.series.name}</h2>
                <span className="flex items-center gap-2 text-xs">
                  <span
                    className={`rounded-full border px-2 py-0.5 ${
                      group.series.requestable
                        ? 'border-gold/50 text-gold'
                        : 'border-slot-edge text-muted'
                    }`}
                  >
                    {group.series.requestable ? 'pedible' : 'no pedible'}
                  </span>
                  <span className="text-muted tnum">{group.cards.length}</span>
                </span>
              </div>

              <ul className="divide-y divide-slot-edge/60 overflow-hidden rounded-xl border border-slot-edge">
                {group.cards.map((card) => {
                  const team = card.team_id ? index.teamById.get(card.team_id) : undefined;
                  return (
                    <li key={card.id} className="flex items-center gap-3 bg-sheet px-3 py-2">
                      <span
                        className="h-6 w-1 shrink-0 rounded-full"
                        style={{ background: team?.primary_color ?? '#7c8291' }}
                        aria-hidden
                      />
                      <Link href={`/card/${card.id}`} className="min-w-0 flex-1">
                        <span className="font-display text-base tnum">{card.number}</span>
                        <span className="ml-2 truncate text-sm">
                          {card.player_name ?? team?.name ?? ''}
                        </span>
                        {card.player_name && team && (
                          <span className="ml-2 text-xs text-muted">{team.name}</span>
                        )}
                      </Link>
                      <button
                        type="button"
                        onClick={() => void addCopy(card.id)}
                        className="shrink-0 rounded-full border border-slot-edge px-2.5 py-1 text-xs hover:border-gold"
                      >
                        La tengo
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
