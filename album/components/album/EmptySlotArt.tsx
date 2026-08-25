import { CARD_ASPECT } from '@/lib/config';

interface Props {
  number: string;
  playerName?: string | null;
  teamName?: string | null;
  position?: string | null;
  color?: string | null;
  rare?: boolean;
  /** Tirada limitada: se enseña en la ficha, no en el álbum. */
  printRun?: number | null;
}

/**
 * El hueco vacío. No es una imagen: es diseño propio generado con los datos de la
 * carta (número, jugador, equipo y color del club). Es el elemento firma del
 * producto y la razón de que un álbum medio vacío dé ganas de llenarlo.
 */
export function EmptySlotArt({
  number, playerName, teamName, position, color, rare, printRun,
}: Props) {
  const accent = color || '#7c8291';
  return (
    <div
      className="sleeve relative h-full w-full overflow-hidden rounded-slot bg-slot"
      style={{ containerType: 'inline-size', aspectRatio: CARD_ASPECT }}
    >
      {/* Tinte del club, muy contenido: informa, no decora. */}
      <div
        className="absolute inset-0 opacity-[0.18]"
        style={{ background: `linear-gradient(160deg, ${accent} 0%, transparent 62%)` }}
      />
      <div
        className={`absolute inset-0 rounded-slot ring-1 ring-inset ${
          rare ? 'ring-gold-dim/70' : 'ring-slot-edge'
        }`}
      />
      <div className="absolute inset-[6cqw] rounded-[3cqw] border border-dashed border-white/8" />

      {/* Banda del equipo */}
      <div className="absolute left-0 top-0 h-full w-[3.5cqw]" style={{ background: accent }} />

      <div className="relative flex h-full flex-col justify-between p-[7cqw] pl-[10cqw]">
        <span
          className="font-display leading-none text-white/22 tnum"
          style={{ fontSize: '40cqw' }}
        >
          {number}
        </span>

        <div className="min-w-0">
          {playerName ? (
            <p className="truncate font-display uppercase text-white/55" style={{ fontSize: '10cqw' }}>
              {playerName}
            </p>
          ) : (
            <p className="truncate text-white/30" style={{ fontSize: '8.5cqw' }}>
              {position || 'Sin nombre'}
            </p>
          )}
          <p className="truncate text-muted/70" style={{ fontSize: '8cqw' }}>
            {teamName ?? ''}
          </p>
          {printRun ? (
            <p className="tnum text-gold/70" style={{ fontSize: '7.5cqw' }}>/{printRun}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
