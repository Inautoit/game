'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CARD_ASPECT } from '@/lib/config';
import { addCopy } from '@/lib/offline/collection';
import { isRare, type Card, type Series, type Team } from '@/lib/types';
import { usePhotoUrl } from '@/components/shared/usePhotoUrl';
import type { Owned } from '@/components/shared/CollectionProvider';
import { EmptySlotArt } from './EmptySlotArt';
import { OwnedSlotArt } from './OwnedSlotArt';

const LONG_PRESS_MS = 420;

interface Props {
  card: Card;
  team?: Team;
  series: Series;
  owned?: Owned;
  onOpen: (card: Card) => void;
  onMarked?: (card: Card, quantity: number, isNew: boolean) => void;
}

/**
 * Los tres estados del álbum: vacío, tenida y repe.
 * Toque corto marca, toque largo abre la ficha. Ese atajo es lo que hace la app
 * usable de verdad: se marcan cartas de pie, con una mano y sin mirar mucho.
 */
export function CardSlot({ card, team, series, owned, onOpen, onMarked }: Props) {
  const photo = usePhotoUrl(owned?.photo_path);
  const [justFilled, setJustFilled] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const quantity = owned?.quantity ?? 0;
  const rare = isRare(series);
  const dupes = quantity > 1;

  const mark = useCallback(async () => {
    const before = quantity;
    const result = await addCopy(card.id);
    if (before === 0) {
      setJustFilled(true);
      setTimeout(() => setJustFilled(false), 420);
    }
    if (navigator.vibrate) navigator.vibrate(result.isNew ? 18 : 8);
    onMarked?.(card, result.quantity, result.isNew);
  }, [card, quantity, onMarked]);

  const onPointerDown = () => {
    longPressed.current = false;
    timer.current = setTimeout(() => {
      longPressed.current = true;
      if (navigator.vibrate) navigator.vibrate(12);
      onOpen(card);
    }, LONG_PRESS_MS);
  };

  const cancel = () => { if (timer.current) clearTimeout(timer.current); };

  const onPointerUp = () => {
    cancel();
    if (!longPressed.current) void mark();
  };

  const label = [
    `Carta ${card.number}`,
    card.player_name ?? team?.name ?? '',
    quantity === 0 ? 'te falta' : dupes ? `tienes ${quantity}` : 'la tienes',
  ].filter(Boolean).join(', ');

  return (
    <div className="relative">
      {/* Cartas apiladas detrás: se ve que hay repes sin leer el contador. */}
      {dupes && (
        <>
          <div className="absolute inset-0 translate-x-[3px] translate-y-[3px] rounded-slot bg-black/45" />
          <div className="absolute inset-0 translate-x-[1.5px] translate-y-[1.5px] rounded-slot bg-slot-edge/70" />
        </>
      )}

      <button
        type="button"
        aria-label={label}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerLeave={cancel}
        onPointerCancel={cancel}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void mark(); }
          if (e.key === 'i' || e.key === 'I') { e.preventDefault(); onOpen(card); }
        }}
        className={`group relative block w-full select-none overflow-hidden rounded-slot
          transition-transform duration-150 active:scale-[0.97]
          focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold
          ${rare ? 'shadow-[0_0_0_1px_rgba(201,162,39,0.45)]' : ''}`}
        style={{ aspectRatio: CARD_ASPECT, touchAction: 'manipulation' }}
      >
        {quantity === 0 ? (
          <EmptySlotArt
            number={card.number}
            playerName={card.player_name}
            teamName={team?.name}
            position={card.position}
            team={team}
            rare={rare}
            printRun={card.print_run}
          />
        ) : (
          <div className={`relative h-full w-full ${justFilled ? 'animate-slot-fill' : ''}`}>
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photo}
                alt={card.player_name ?? `Carta ${card.number}`}
                className="h-full w-full object-cover"
              />
            ) : (
              <OwnedSlotArt
                number={card.number}
                playerName={card.player_name}
                teamName={team?.name}
                team={team}
                rare={rare}
              />
            )}
            <div className="sleeve pointer-events-none absolute inset-0 rounded-slot ring-1 ring-inset ring-white/10" />
            {dupes && (
              <span className="absolute right-1 top-1 rounded-full bg-black/70 px-1.5 py-0.5 text-[0.65rem] font-medium text-cream tnum">
                ×{quantity}
              </span>
            )}
            {owned?.for_trade && (
              <span className="absolute left-1 top-1 rounded-full bg-gold/90 px-1.5 py-0.5 text-[0.6rem] font-semibold text-ink">
                cambio
              </span>
            )}
          </div>
        )}
      </button>

      <button
        type="button"
        onClick={() => onOpen(card)}
        aria-label={`Ver ficha de la carta ${card.number}`}
        className="absolute bottom-1 right-1 hidden rounded-full bg-black/65 px-2 py-1 text-[0.65rem] text-cream/80
          hover:bg-black/85 sm:group-hover:block sm:focus-visible:block"
      >
        ficha
      </button>
    </div>
  );
}
