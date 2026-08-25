import { CARD_ASPECT } from '@/lib/config';
import { teamKit } from '@/lib/kit';
import type { Team } from '@/lib/types';

interface Props {
  number: string;
  playerName?: string | null;
  teamName?: string | null;
  team?: Pick<Team, 'pattern' | 'primary_color' | 'secondary_color'> | null;
  rare?: boolean;
}

/**
 * Tienes la carta pero aún no le has hecho foto. Misma camiseta que el hueco
 * vacío, pero encendida: el hueco está ocupado y se ve desde el otro lado de
 * la mesa.
 */
export function OwnedSlotArt({ number, playerName, teamName, team, rare }: Props) {
  return (
    <div
      className="relative h-full w-full overflow-hidden rounded-slot"
      style={{ containerType: 'inline-size', aspectRatio: CARD_ASPECT }}
    >
      <div className="absolute inset-0" style={{ background: teamKit(team) }} />
      <div
        className="absolute inset-0"
        style={{ background: 'linear-gradient(180deg, rgba(7,18,14,0.12) 0%, rgba(7,18,14,0.88) 78%)' }}
      />

      <div className="relative flex h-full flex-col justify-between p-[7cqw]">
        <span
          className="font-display leading-none text-white tnum"
          style={{ fontSize: '30cqw', textShadow: '0 1px 6px rgba(7,18,14,0.6)' }}
        >
          {number}
        </span>
        <div className="min-w-0">
          <p className="truncate font-display uppercase text-white" style={{ fontSize: '10cqw' }}>
            {playerName ?? teamName ?? ''}
          </p>
          {playerName && teamName && (
            <p className="truncate text-white/70" style={{ fontSize: '8cqw' }}>{teamName}</p>
          )}
        </div>
      </div>

      <div
        className={`absolute inset-0 rounded-slot ring-1 ring-inset ${
          rare ? 'ring-gold/60' : 'ring-white/12'
        }`}
      />
    </div>
  );
}
