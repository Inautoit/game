'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EmptySlotArt } from '@/components/album/EmptySlotArt';
import { OwnedSlotArt } from '@/components/album/OwnedSlotArt';
import { useCollection } from '@/components/shared/CollectionProvider';
import { usePhotoUrl } from '@/components/shared/usePhotoUrl';
import { CARD_ASPECT } from '@/lib/config';
import { DEFAULT_CONDITION, setQuantity, updateUserCard } from '@/lib/offline/collection';
import { processPhoto, savePhoto } from '@/lib/photos';
import { formatPrice } from '@/lib/prices/aggregate';
import { usePrices } from '@/lib/prices/client';
import { marketSearchLinks } from '@/lib/prices/links';
import { isRare, SERIES_KIND_LABEL, type Card, type Collection, type Series, type Team } from '@/lib/types';
import { PriceBreakdown } from './PriceBreakdown';
import { PriceHistoryChart } from './PriceHistoryChart';
import { ReportSaleForm } from './ReportSaleForm';

interface Props {
  card: Card;
  series: Series;
  team: Team | null;
  collection: Collection;
}

export function CardDetail({ card, series, team, collection }: Props) {
  const router = useRouter();
  const { owned } = useCollection();
  const { priceFor, snapshotsFor } = usePrices();
  const [uploading, setUploading] = useState(false);
  const [reporting, setReporting] = useState(false);

  const mine = owned.get(card.id);
  const quantity = mine?.quantity ?? 0;
  const photo = usePhotoUrl(mine?.photo_path);
  const price = priceFor(card.id);
  const snapshots = snapshotsFor(card.id);
  const rare = isRare(series);

  async function onPhoto(file: File) {
    setUploading(true);
    try {
      const blob = await processPhoto(file);
      const path = await savePhoto(card.id, DEFAULT_CONDITION, blob);
      await updateUserCard(card.id, { photo_path: path, quantity: Math.max(1, quantity) });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 pb-12 pt-[calc(0.75rem+env(safe-area-inset-top))]">
      <button
        type="button"
        onClick={() => router.back()}
        className="mb-4 text-sm text-muted hover:text-cream"
      >
        ← Volver al álbum
      </button>

      <div className="flex flex-col gap-5 sm:flex-row">
        <div className="mx-auto w-48 shrink-0 sm:mx-0 sm:w-56">
          <div className={`overflow-hidden rounded-slot ${rare ? 'ring-1 ring-gold/60' : ''}`}
            style={{ aspectRatio: CARD_ASPECT }}>
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photo} alt={card.player_name ?? `Carta ${card.number}`}
                className="h-full w-full object-cover" />
            ) : quantity > 0 ? (
              <OwnedSlotArt
                number={card.number}
                playerName={card.player_name}
                teamName={team?.name}
                team={team}
                rare={rare}
              />
            ) : (
              <EmptySlotArt
                number={card.number}
                playerName={card.player_name}
                teamName={team?.name}
                position={card.position}
                team={team}
                rare={rare}
                printRun={card.print_run}
              />
            )}
          </div>

          <label className="mt-2 block cursor-pointer rounded-full border border-slot-edge px-3 py-2 text-center text-sm hover:border-cream/40">
            {uploading ? 'Procesando…' : photo ? 'Cambiar foto' : 'Subir foto de tu carta'}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onPhoto(file);
                e.target.value = '';
              }}
            />
          </label>
          <p className="mt-1 text-center text-[0.7rem] text-muted">
            Tu foto, tu cuenta. Se recorta a 63×88 y se comprime antes de subirla.
          </p>
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-wider text-muted">
            {series.name === SERIES_KIND_LABEL[series.kind]
              ? series.name
              : `${series.name} · ${SERIES_KIND_LABEL[series.kind]}`}
          </p>
          <h1 className="font-display text-3xl leading-tight">
            <span className="tnum text-muted">{card.number}</span>{' '}
            {card.player_name ?? team?.name ?? 'Sin nombre'}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {[card.player_name ? team?.name : null, card.position, collection.season]
              .filter(Boolean).join(' · ')}
          </p>
          {card.print_run ? (
            <p className="mt-1 text-sm text-gold tnum">Tirada limitada /{card.print_run}</p>
          ) : null}

          <div className="mt-4 flex items-center gap-3">
            <QuantityStepper
              quantity={quantity}
              onChange={(q) => void setQuantity(card.id, q)}
            />
            <button
              type="button"
              onClick={() => void updateUserCard(card.id, { for_trade: !mine?.for_trade })}
              disabled={quantity === 0}
              className={`rounded-full border px-3 py-2 text-sm disabled:opacity-40 ${
                mine?.for_trade ? 'border-gold bg-gold text-ink' : 'border-slot-edge'
              }`}
            >
              {mine?.for_trade ? 'Disponible para cambio' : 'Marcar para cambio'}
            </button>
          </div>
          {quantity > 1 && (
            <p className="mt-2 text-sm text-muted tnum">
              Tienes {quantity}: {quantity - 1} {quantity - 1 === 1 ? 'repe' : 'repes'}.
            </p>
          )}
        </div>
      </div>

      <section className="mt-8">
        <h2 className="mb-2 font-display text-lg">Valor de mercado</h2>
        <div className="rounded-xl border border-slot-edge bg-sheet p-4">
          <p className="font-display text-4xl tnum">
            {price ? formatPrice(price.value, price.currency) : '—'}
          </p>
          <p className="mt-1 text-sm text-muted">
            {price
              ? `Mediana ponderada sobre ${price.sampleSize} ${price.sampleSize === 1 ? 'dato' : 'datos'}`
              : 'Sin datos suficientes todavía'}
          </p>
        </div>

        <div className="mt-3 space-y-3">
          <PriceBreakdown snapshots={snapshots} />
          <PriceHistoryChart snapshots={snapshots} />
        </div>

        <p className="mt-3 text-xs text-muted">
          Es una estimación a partir de anuncios y ventas reportadas, no una tasación.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          {marketSearchLinks(card, collection.name, team?.name).map((link) => (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-slot-edge px-3 py-1.5 text-sm hover:border-cream/40"
            >
              {link.label} ↗
            </a>
          ))}
        </div>

        <div className="mt-4">
          {reporting ? (
            <ReportSaleForm cardId={card.id} onDone={() => setReporting(false)} />
          ) : (
            <button
              type="button"
              onClick={() => setReporting(true)}
              className="text-sm text-gold underline underline-offset-4"
            >
              Reportar una venta de esta carta
            </button>
          )}
        </div>
      </section>

      <p className="mt-8 text-xs text-muted">
        <Link href="/faltas" className="underline underline-offset-4">Ver todo lo que te falta</Link>
      </p>
    </div>
  );
}

function QuantityStepper({ quantity, onChange }: { quantity: number; onChange: (q: number) => void }) {
  return (
    <div className="flex items-center gap-2 rounded-full border border-slot-edge px-1.5 py-1">
      <button
        type="button"
        aria-label="Quitar una"
        onClick={() => onChange(Math.max(0, quantity - 1))}
        className="h-8 w-8 rounded-full text-lg leading-none hover:bg-slot"
      >
        −
      </button>
      <span className="min-w-8 text-center font-display text-lg tnum">{quantity}</span>
      <button
        type="button"
        aria-label="Añadir una"
        onClick={() => onChange(quantity + 1)}
        className="h-8 w-8 rounded-full text-lg leading-none hover:bg-slot"
      >
        +
      </button>
    </div>
  );
}
