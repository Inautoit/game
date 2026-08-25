import type { Metadata } from 'next';
import { AlbumSheet } from '@/components/album/AlbumSheet';
import { COLLECTION_SLUG } from '@/lib/config';
import { getCatalog } from '@/lib/server/catalog';

interface Props {
  params: Promise<{ collection: string; view: string }>;
}

/** Una hoja por equipo y por serie, generadas en el build. */
export async function generateStaticParams() {
  const catalog = await getCatalog(COLLECTION_SLUG);
  if (!catalog) return [];
  return [
    ...catalog.teams.map((t) => ({ collection: COLLECTION_SLUG, view: t.slug })),
    ...catalog.series.map((s) => ({ collection: COLLECTION_SLUG, view: s.code.toLowerCase() })),
  ];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { collection, view } = await params;
  const catalog = await getCatalog(collection);
  const team = catalog?.teams.find((t) => t.slug === view);
  const series = catalog?.series.find((s) => s.code.toLowerCase() === view.toLowerCase());
  const name = team?.name ?? series?.name;
  return { title: name ? `${name} · ${catalog?.collection.name}` : 'Álbum' };
}

export default async function AlbumPage({ params }: Props) {
  const { collection, view } = await params;
  return <AlbumSheet collection={collection} view={view} />;
}
