'use client';

interface Props {
  owned: number;
  total: number;
  label?: string;
  compact?: boolean;
}

/** El contador del álbum: 340 / 514. Avanza cuando marcas una carta nueva. */
export function ProgressBar({ owned, total, label, compact }: Props) {
  const percent = total ? Math.round((owned / total) * 100) : 0;
  const complete = total > 0 && owned === total;

  return (
    <div className={compact ? '' : 'px-4 pb-2 pt-3'}>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="truncate text-sm text-muted">{label}</span>
        <span className="shrink-0 text-sm tnum">
          <strong className={`font-display text-base ${complete ? 'text-gold' : 'text-cream'}`}>
            {owned}
          </strong>
          <span className="text-muted"> / {total}</span>
          <span className={`ml-2 ${complete ? 'text-gold' : 'text-muted'}`}>{percent}%</span>
        </span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-slot"
        role="progressbar"
        aria-valuenow={owned}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={label ? `Progreso de ${label}` : 'Progreso'}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-500 ease-out ${
            complete ? 'bg-gold' : 'bg-cream/70'
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
