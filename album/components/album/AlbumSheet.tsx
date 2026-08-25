'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useCollection } from '@/components/shared/CollectionProvider';
import { Flash, nextFlashId, type FlashMessage } from '@/components/shared/Flash';
import { SyncBadge } from '@/components/shared/SyncBadge';
import type { Card } from '@/lib/types';
import { CardSlot } from './CardSlot';
import { PhotoRun } from './PhotoRun';
import { ProgressBar } from './ProgressBar';
import { ViewTabs, type TabItem } from './ViewTabs';

interface Props {
  collection: string;
  view: string;
}

/** La hoja del archivador: pestañas, barra de progreso y la rejilla de huecos. */
export function AlbumSheet({ collection, view }: Props) {
  const { index, loading, error, owned, progress } = useCollection();
  const router = useRouter();
  const [flash, setFlash] = useState<FlashMessage | null>(null);
  /* La lista se congela al empezar: si se recalculara en vivo, cada foto sacaría
     su carta de la lista y el índice saltaría a la siguiente, dejándose una sin
     fotografiar en cada paso. */
  const [photoRun, setPhotoRun] = useState<Card[] | null>(null);

  const resolved = useMemo(() => {
    if (!index) return null;
    const team = index.teamBySlug.get(view);
    if (team && index.baseSeries) {
      return {
        kind: 'team' as const,
        key: team.slug,
        title: team.name,
        series: index.baseSeries,
        cards: index.cardsByTeam.get(team.id) ?? [],
      };
    }
    const series = index.seriesByCode.get(view.toUpperCase());
    if (series) {
      return {
        kind: 'series' as const,
        key: series.code,
        title: series.name,
        series,
        cards: index.cardsBySeries.get(series.id) ?? [],
      };
    }
    return null;
  }, [index, view]);

  const count = (cards: Card[]) => cards.reduce((n, c) => n + (owned.has(c.id) ? 1 : 0), 0);

  const seriesTabs: TabItem[] = useMemo(() => {
    if (!index) return [];
    return index.catalog.series.map((s) => {
      const cards = index.cardsBySeries.get(s.id) ?? [];
      const firstTeam = index.baseSeries?.id === s.id
        ? index.catalog.teams[0]?.slug
        : undefined;
      return {
        key: s.code,
        label: s.name,
        href: `/album/${collection}/${firstTeam ?? s.code.toLowerCase()}`,
        owned: count(cards),
        total: cards.length,
        rare: s.scarcity >= 3,
      };
    });
  }, [index, owned, collection]);

  const teamTabs: TabItem[] = useMemo(() => {
    if (!index) return [];
    return index.catalog.teams.map((t) => {
      const cards = index.cardsByTeam.get(t.id) ?? [];
      return {
        key: t.slug,
        label: t.name,
        href: `/album/${collection}/${t.slug}`,
        owned: count(cards),
        total: cards.length,
        color: t.primary_color,
      };
    });
  }, [index, owned, collection]);

  if (loading) return <SheetSkeleton />;
  if (error) {
    return (
      <p className="px-4 py-16 text-center text-muted">
        No se pudo cargar el catálogo: {error}
      </p>
    );
  }
  if (!index || !resolved) {
    return (
      <div className="px-4 py-16 text-center">
        <p className="text-muted">Esa hoja no existe en esta colección.</p>
        <Link
          href={`/album/${collection}/${index?.catalog.teams[0]?.slug ?? ''}`}
          className="mt-3 inline-block rounded-full border border-slot-edge px-4 py-2 text-sm"
        >
          Volver al álbum
        </Link>
      </div>
    );
  }

  const activeSeries = resolved.series;
  const isBase = index.baseSeries?.id === activeSeries.id;
  const withoutPhoto = resolved.cards.filter((c) => !owned.get(c.id)?.photo_path);

  const onMarked = (card: Card, quantity: number, isNew: boolean) => {
    const who = card.player_name ?? card.number;
    setFlash({
      id: nextFlashId(),
      text: isNew ? `Nueva · ${who}` : `Repe ×${quantity} · ${who}`,
      tone: isNew ? 'new' : 'dupe',
    });
  };

  return (
    <div>
      <header className="sticky top-0 z-30 border-b border-slot-edge/60 bg-leather/95 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto max-w-5xl">
          <div className="flex items-center justify-between px-4 pt-3">
            <h1 className="truncate font-display text-base leading-tight">
              {index.catalog.collection.name}
            </h1>
            <SyncBadge />
          </div>
          <ProgressBar owned={progress.owned} total={progress.total} label="Colección completa" />
          <ViewTabs items={seriesTabs} active={activeSeries.code} title="Series" />
          {isBase && <ViewTabs items={teamTabs} active={resolved.key} title="Equipos" />}
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-10 pt-4">
        {progress.owned === 0 && <FirstOpen />}

        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="font-display text-xl">{resolved.title}</h2>
          <span className="text-sm text-muted tnum">
            {count(resolved.cards)} / {resolved.cards.length}
          </span>
        </div>

        <div className="mb-3">
          {withoutPhoto.length > 0 ? (
            <button
              type="button"
              onClick={() => setPhotoRun(withoutPhoto)}
              className="rounded-full border border-slot-edge px-3 py-1.5 text-sm hover:border-cream/40"
            >
              Fotos seguidas · {withoutPhoto.length} sin foto
            </button>
          ) : (
            <p className="text-sm text-muted">Todas las cartas de esta hoja tienen foto.</p>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 sm:gap-3 lg:grid-cols-6">
          {resolved.cards.map((card) => (
            <CardSlot
              key={card.id}
              card={card}
              team={card.team_id ? index.teamById.get(card.team_id) : undefined}
              series={activeSeries}
              owned={owned.get(card.id)}
              onOpen={(c) => router.push(`/card/${c.id}`)}
              onMarked={onMarked}
            />
          ))}
        </div>

        <p className="mt-6 text-center text-xs text-muted">
          Toque corto para marcar · toque largo para abrir la ficha
        </p>
      </main>

      {photoRun && (
        <PhotoRun
          cards={photoRun}
          series={activeSeries}
          teamOf={(c) => (c.team_id ? index.teamById.get(c.team_id) : undefined)}
          onDone={(savedCount) => {
            setPhotoRun(null);
            if (savedCount) {
              setFlash({
                id: nextFlashId(),
                text: savedCount === 1 ? '1 foto guardada' : `${savedCount} fotos guardadas`,
                tone: 'info',
              });
            }
          }}
        />
      )}

      <Flash message={flash} />
    </div>
  );
}

function FirstOpen() {
  return (
    <div className="mb-5 rounded-xl border border-gold/40 bg-sheet p-4">
      <p className="font-display text-lg">Tu álbum está entero por llenar.</p>
      <p className="mt-1 text-sm text-muted">
        Marca cartas tocando los huecos, o mete un sobre entero de una vez.
      </p>
      <Link
        href="/sobre"
        className="mt-3 inline-block rounded-full bg-gold px-4 py-2 text-sm font-semibold text-ink"
      >
        Abre tu primer sobre
      </Link>
    </div>
  );
}

function SheetSkeleton() {
  return (
    <div className="mx-auto max-w-5xl px-4 pt-8">
      <div className="h-4 w-40 animate-pulse rounded bg-slot" />
      <div className="mt-6 grid grid-cols-3 gap-2.5 sm:grid-cols-4 lg:grid-cols-6">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="animate-pulse rounded-slot bg-slot" style={{ aspectRatio: '63 / 88' }} />
        ))}
      </div>
    </div>
  );
}
