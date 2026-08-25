'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';

export interface TabItem {
  key: string;
  label: string;
  href: string;
  owned: number;
  total: number;
  color?: string | null;
  rare?: boolean;
}

interface Props {
  items: TabItem[];
  active: string;
  title?: string;
}

/** Pestañas siempre visibles: equipos en la serie base, series en el resto. */
export function ViewTabs({ items, active, title }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('[data-active="true"]');
    el?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [active]);

  return (
    <div>
      {title && <p className="px-4 pb-0.5 text-[0.65rem] uppercase tracking-wider text-muted/80">{title}</p>}
      <div ref={ref} className="no-scrollbar flex gap-2 overflow-x-auto px-4 pb-1.5">
        {items.map((item) => {
          const isActive = item.key === active;
          const done = item.total > 0 && item.owned === item.total;
          return (
            <Link
              key={item.key}
              href={item.href}
              data-active={isActive}
              scroll={false}
              className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors
                ${isActive
                  ? 'border-cream/70 bg-cream text-ink'
                  : 'border-slot-edge bg-sheet text-cream/80 hover:border-cream/40'}`}
            >
              {item.color && (
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: item.color }}
                  aria-hidden
                />
              )}
              <span className="whitespace-nowrap">{item.label}</span>
              <span
                className={`tnum text-xs ${
                  isActive ? 'text-ink/60' : done ? 'text-gold' : 'text-muted'
                }`}
              >
                {item.owned}/{item.total}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
