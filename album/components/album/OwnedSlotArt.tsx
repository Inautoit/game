import { CARD_ASPECT } from '@/lib/config';

interface Props {
  number: string;
  playerName?: string | null;
  teamName?: string | null;
  color?: string | null;
  rare?: boolean;
}

/**
 * Tienes la carta pero aún no le has hecho foto. Se ve llena y con el color del
 * club: el hueco está ocupado, que es la información que importa de un vistazo.
 */
export function OwnedSlotArt({ number, playerName, teamName, color, rare }: Props) {
  const accent = color || '#7c8291';
  return (
    <div
      className="relative h-full w-full overflow-hidden rounded-slot"
      style={{
        containerType: 'inline-size',
        aspectRatio: CARD_ASPECT,
        background: `linear-gradient(155deg, ${accent} 0%, #0f231d 78%)`,
      }}
    >
      <div className="absolute inset-0 bg-black/25" />
      <div className="relative flex h-full flex-col justify-between p-[7cqw]">
        <span className="font-display leading-none text-white/85 tnum" style={{ fontSize: '30cqw' }}>
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
      {rare && <div className="absolute inset-0 rounded-slot ring-1 ring-inset ring-gold/60" />}
    </div>
  );
}
