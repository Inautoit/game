import { CARD_ASPECT } from '@/lib/config';
import { teamKit } from '@/lib/kit';
import type { Team } from '@/lib/types';

interface Props {
  number: string;
  playerName?: string | null;
  teamName?: string | null;
  position?: string | null;
  team?: Pick<Team, 'pattern' | 'primary_color' | 'secondary_color'> | null;
  rare?: boolean;
  /** Tirada limitada: se enseña en la ficha, no en el álbum. */
  printRun?: number | null;
}

/**
 * El hueco vacío. No es una imagen: es diseño propio generado con los datos de la
 * carta (número, jugador, equipo) sobre el patrón de la camiseta del club.
 * Es el elemento firma del producto y la razón de que un álbum medio vacío dé
 * ganas de llenarlo en vez de dar pena.
 */
export function EmptySlotArt({
  number, playerName, teamName, position, team, rare, printRun,
}: Props) {
  return (
    <div
      className="relative h-full w-full overflow-hidden rounded-slot bg-slot"
      style={{ containerType: 'inline-size', aspectRatio: CARD_ASPECT }}
    >
      {/* La camiseta del club, muy contenida: informa de un vistazo, no grita. */}
      <div className="absolute inset-0 opacity-[0.22]" style={{ background: teamKit(team) }} />
      <div
        className="absolute inset-0"
        style={{ background: 'linear-gradient(180deg, rgba(7,18,14,0.55) 0%, rgba(7,18,14,0.82) 100%)' }}
      />
      <div
        className={`absolute inset-0 rounded-slot ring-1 ring-inset ${
          rare ? 'ring-gold-dim/70' : 'ring-slot-edge'
        }`}
      />
      <div className="absolute inset-[6cqw] rounded-[3cqw] border border-dashed border-white/10" />

      <div className="relative flex h-full flex-col justify-between p-[7cqw]">
        <span
          className="font-display leading-none text-white/25 tnum"
          style={{ fontSize: '40cqw' }}
        >
          {number}
        </span>

        <div className="min-w-0">
          {playerName ? (
            <p className="truncate font-display uppercase text-white/60" style={{ fontSize: '10cqw' }}>
              {playerName}
            </p>
          ) : (
            <p className="truncate text-white/35" style={{ fontSize: '8.5cqw' }}>
              {position || 'Sin nombre'}
            </p>
          )}
          <p className="truncate text-muted/80" style={{ fontSize: '8cqw' }}>
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
