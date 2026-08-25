import type { Card, Series } from '../types';

export interface MissingGroup {
  series: Series;
  cards: Card[];
}

export interface SharePayload {
  /** Primera línea del texto. Por defecto, el resumen de faltas. */
  heading?: string;
  title: string;
  season: string;
  owned: number;
  total: number;
  groups: { series: string; requestable: boolean; numbers: string[] }[];
}

export function toPayload(
  collectionName: string,
  season: string,
  owned: number,
  total: number,
  groups: MissingGroup[],
): SharePayload {
  return {
    title: collectionName,
    season,
    owned,
    total,
    groups: groups
      .filter((g) => g.cards.length)
      .map((g) => ({
        series: g.series.name,
        requestable: g.series.requestable,
        numbers: g.cards.map((c) => c.number),
      })),
  };
}

/**
 * Texto plano listo para pegar en WhatsApp. Sin esto la app no entra en el flujo
 * real de intercambio, que ocurre entero en grupos de WhatsApp.
 */
/** El nombre de la colección ya suele llevar la temporada: no la repitas. */
export function collectionLabel(title: string, season: string): string {
  return title.includes(season) ? title : `${title} ${season}`;
}

export function buildShareText(payload: SharePayload): string {
  const missing = payload.total - payload.owned;
  const heading = payload.heading
    ?? `Me faltan ${missing} de ${payload.total} · ${collectionLabel(payload.title, payload.season)}`;
  const lines = [heading, ''];

  for (const group of payload.groups) {
    lines.push(`${group.series}${group.requestable ? '' : ' (no pedibles)'}: ${group.numbers.join(', ')}`);
  }

  return lines.join('\n');
}
