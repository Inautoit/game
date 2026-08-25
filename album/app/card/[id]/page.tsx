import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CardDetail } from '@/components/card/CardDetail';
import { COLLECTION_SLUG } from '@/lib/config';
import { findCard, getCatalog } from '@/lib/server/catalog';

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const found = await findCard(COLLECTION_SLUG, id);
  if (!found) return { title: 'Carta no encontrada' };
  const { card, series, team, catalog } = found;
  const name = card.player_name ?? team?.name ?? `Carta ${card.number}`;
  return {
    title: `${card.number} · ${name} — ${catalog.collection.name}`,
    description: `${name}${team ? ` (${team.name})` : ''}. Serie ${series.name}, ` +
      `número ${card.number}. Compatible con la colección ${catalog.collection.name}.`,
  };
}

/** Se renderiza en el servidor para que compartir el enlace de una carta funcione. */
export default async function CardPage({ params }: Props) {
  const { id } = await params;
  const found = await findCard(COLLECTION_SLUG, id);
  if (!found) notFound();
  const catalog = await getCatalog(COLLECTION_SLUG);
  return (
    <CardDetail
      card={found.card}
      series={found.series}
      team={found.team}
      collection={catalog!.collection}
    />
  );
}
