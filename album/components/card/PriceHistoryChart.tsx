'use client';

import { formatPrice } from '@/lib/prices/aggregate';
import { formatDate } from '@/lib/format';
import type { PriceSnapshot } from '@/lib/types';

/** Evolución del precio. Solo se dibuja si hay suficientes puntos para significar algo. */
export function PriceHistoryChart({ snapshots }: { snapshots: PriceSnapshot[] }) {
  const points = snapshots
    .filter((s) => s.price_median != null)
    .map((s) => ({ t: new Date(s.captured_at).getTime(), v: Number(s.price_median), currency: s.currency }))
    .sort((a, b) => a.t - b.t);

  if (points.length <= 3) return null;

  const w = 320;
  const h = 90;
  const pad = 6;
  const times = points.map((p) => p.t);
  const values = points.map((p) => p.v);
  const [t0, t1] = [Math.min(...times), Math.max(...times)];
  const [v0, v1] = [Math.min(...values), Math.max(...values)];
  const spanT = t1 - t0 || 1;
  const spanV = v1 - v0 || 1;

  const xy = points.map((p) => [
    pad + ((p.t - t0) / spanT) * (w - pad * 2),
    h - pad - ((p.v - v0) / spanV) * (h - pad * 2),
  ] as const);

  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${xy[xy.length - 1][0].toFixed(1)},${h} L${xy[0][0].toFixed(1)},${h} Z`;

  return (
    <figure className="rounded-xl border border-slot-edge bg-sheet p-3">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="h-[90px] w-full"
        role="img"
        aria-label={`Evolución del precio entre ${formatDate(new Date(t0).toISOString())} y ${formatDate(new Date(t1).toISOString())}`}
      >
        <path d={area} fill="rgba(201,162,39,0.12)" />
        <path d={line} fill="none" stroke="var(--color-gold)" strokeWidth="1.75"
          strokeLinecap="round" strokeLinejoin="round" />
        {xy.slice(-1).map(([x, y]) => (
          <circle key="last" cx={x} cy={y} r="3" fill="var(--color-gold)" />
        ))}
      </svg>
      <figcaption className="mt-1 flex justify-between text-xs text-muted tnum">
        <span>{formatDate(new Date(t0).toISOString())}</span>
        <span>
          {formatPrice(values[0], points[0].currency)} → {formatPrice(values[values.length - 1], points[0].currency)}
        </span>
        <span>{formatDate(new Date(t1).toISOString())}</span>
      </figcaption>
    </figure>
  );
}
