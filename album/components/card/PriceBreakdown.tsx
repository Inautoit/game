'use client';

import { formatPrice } from '@/lib/prices/aggregate';
import { SOURCE_LABEL } from '@/lib/prices/types';
import { formatDate, relativeDate } from '@/lib/format';
import type { PriceSnapshot } from '@/lib/types';

/**
 * Nunca un precio sin decir de dónde sale, de cuándo es y sobre cuántos datos.
 * Es lo que separa una estimación útil de un número inventado.
 */
export function PriceBreakdown({ snapshots }: { snapshots: PriceSnapshot[] }) {
  if (!snapshots.length) {
    return (
      <p className="text-sm text-muted">
        Todavía no hay datos de precio para esta carta. Si la compras o la vendes,
        repórtalo: es lo que hace que el precio de la comunidad sea real.
      </p>
    );
  }

  const latest = new Map<string, PriceSnapshot>();
  for (const s of snapshots) {
    const prev = latest.get(s.source);
    if (!prev || prev.captured_at < s.captured_at) latest.set(s.source, s);
  }

  return (
    <ul className="divide-y divide-slot-edge/60 overflow-hidden rounded-xl border border-slot-edge">
      {[...latest.values()].map((s) => (
        <li key={s.id} className="flex items-start justify-between gap-3 bg-sheet px-3 py-2.5">
          <div className="min-w-0">
            <p className="text-sm">
              {SOURCE_LABEL[s.source] ?? s.source}
              <span className="ml-2 text-xs text-muted">
                {s.listing_type === 'sold' ? 'ventas cerradas' : 'anuncios activos'}
              </span>
            </p>
            <p className="text-xs text-muted tnum">
              {s.sample_size ?? 0} {s.sample_size === 1 ? 'dato' : 'datos'} ·{' '}
              <time dateTime={s.captured_at} title={formatDate(s.captured_at)}>
                {relativeDate(s.captured_at)}
              </time>
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="font-display text-base tnum">
              {formatPrice(s.price_median != null ? Number(s.price_median) : null, s.currency)}
            </p>
            {s.price_min != null && s.price_max != null && (
              <p className="text-xs text-muted tnum">
                {formatPrice(Number(s.price_min), s.currency)} – {formatPrice(Number(s.price_max), s.currency)}
              </p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
