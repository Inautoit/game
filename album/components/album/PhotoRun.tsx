'use client';

import { useEffect, useRef, useState } from 'react';
import { useCollection } from '@/components/shared/CollectionProvider';
import { CARD_ASPECT } from '@/lib/config';
import { DEFAULT_CONDITION, updateUserCard } from '@/lib/offline/collection';
import { processPhoto, savePhoto } from '@/lib/photos';
import { isRare, type Card, type Series, type Team } from '@/lib/types';
import { EmptySlotArt } from './EmptySlotArt';
import { OwnedSlotArt } from './OwnedSlotArt';

interface Props {
  cards: Card[];
  series: Series;
  teamOf: (card: Card) => Team | undefined;
  onDone: (saved: number) => void;
}

/**
 * Fotografiar las cartas una a una, entrando y saliendo de la ficha, no lo hace
 * nadie con una colección de 500. Aquí se dispara, se guarda y salta sola a la
 * siguiente; desde el ordenador se pueden soltar varias imágenes de golpe y se
 * reparten en orden.
 */
export function PhotoRun({ cards, series, teamOf, onDone }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { owned } = useCollection();
  const [pos, setPos] = useState(0);
  const [saved, setSaved] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const node = dialog.current;
    if (node && !node.open) node.showModal();
  }, []);

  useEffect(() => {
    if (pos >= cards.length) onDone(saved);
  }, [pos, cards.length, saved, onDone]);

  const card = cards[pos];
  if (!card) return null;

  const team = teamOf(card);
  const mine = owned.get(card.id);

  async function onFiles(files: FileList) {
    setBusy(true);
    setError(null);
    let at = pos;
    let count = saved;

    for (const file of Array.from(files)) {
      const target = cards[at];
      if (!target) break;
      try {
        const blob = await processPhoto(file);
        const path = await savePhoto(target.id, DEFAULT_CONDITION, blob);
        const current = owned.get(target.id)?.quantity ?? 0;
        await updateUserCard(target.id, { photo_path: path, quantity: Math.max(1, current) });
        count += 1;
      } catch {
        setError('Esa imagen no se pudo leer. Prueba con otra.');
      }
      at += 1;
    }

    setSaved(count);
    setPos(at);
    setBusy(false);
  }

  return (
    <dialog
      ref={dialog}
      onClose={() => onDone(saved)}
      className="m-auto w-[min(28rem,100%)] rounded-2xl border border-slot-edge bg-leather p-5 text-cream backdrop:bg-black/70"
    >
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-display text-xl">Fotos seguidas</h2>
        <span className="text-sm text-muted tnum">{pos + 1} de {cards.length}</span>
      </div>

      <div className="mx-auto mt-3 w-40" style={{ aspectRatio: CARD_ASPECT }}>
        {mine?.photo_path || (mine?.quantity ?? 0) > 0 ? (
          <OwnedSlotArt
            number={card.number}
            playerName={card.player_name}
            teamName={team?.name}
            team={team}
            rare={isRare(series)}
          />
        ) : (
          <EmptySlotArt
            number={card.number}
            playerName={card.player_name}
            teamName={team?.name}
            position={card.position}
            team={team}
            rare={isRare(series)}
            printRun={card.print_run}
          />
        )}
      </div>

      <p className="mt-2 text-center text-sm text-muted">
        {card.number} · {card.player_name ?? team?.name ?? ''}
      </p>

      {error && <p className="mt-2 text-center text-sm text-red-300">{error}</p>}

      <div className="mt-4 flex justify-center gap-2">
        <label className="cursor-pointer rounded-full bg-gold px-4 py-2 text-sm font-semibold text-ink">
          {busy ? 'Guardando…' : 'Hacer foto'}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const files = e.target.files;
              if (files?.length) void onFiles(files);
              e.target.value = '';
            }}
          />
        </label>
        <button
          type="button"
          onClick={() => setPos(pos + 1)}
          className="rounded-full border border-slot-edge px-4 py-2 text-sm"
        >
          Saltar
        </button>
        <button
          type="button"
          onClick={() => dialog.current?.close()}
          className="rounded-full border border-slot-edge px-4 py-2 text-sm"
        >
          Salir
        </button>
      </div>

      <p className="mt-3 text-center text-xs text-muted">
        Al guardar salta sola a la siguiente y marca la carta como tuya.
      </p>
    </dialog>
  );
}
