'use client';

import type { Series, Team } from '@/lib/types';

export interface Filters {
  teamSlug: string;
  seriesCode: string;
  onlyRequestable: boolean;
}

interface Props {
  teams: Team[];
  series: Series[];
  value: Filters;
  onChange: (next: Filters) => void;
  showRequestable?: boolean;
}

export function ListFilters({ teams, series, value, onChange, showRequestable }: Props) {
  const select = 'rounded-full border border-slot-edge bg-sheet px-3 py-1.5 text-sm outline-none focus:border-gold';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Filtrar por serie"
        className={select}
        value={value.seriesCode}
        onChange={(e) => onChange({ ...value, seriesCode: e.target.value })}
      >
        <option value="">Todas las series</option>
        {series.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
      </select>

      <select
        aria-label="Filtrar por equipo"
        className={select}
        value={value.teamSlug}
        onChange={(e) => onChange({ ...value, teamSlug: e.target.value })}
      >
        <option value="">Todos los equipos</option>
        {teams.map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}
      </select>

      {showRequestable && (
        <label className="flex items-center gap-2 rounded-full border border-slot-edge bg-sheet px-3 py-1.5 text-sm">
          <input
            type="checkbox"
            checked={value.onlyRequestable}
            onChange={(e) => onChange({ ...value, onlyRequestable: e.target.checked })}
            className="accent-[var(--color-gold)]"
          />
          Solo pedibles
        </label>
      )}
    </div>
  );
}
