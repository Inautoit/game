import { redirect } from 'next/navigation';
import { firstAlbumHref } from '@/lib/server/routes';

export default async function CollectionIndex({
  params,
}: { params: Promise<{ collection: string }> }) {
  const { collection } = await params;
  redirect(await firstAlbumHref(collection));
}
