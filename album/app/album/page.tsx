import { AlbumSheet } from '@/components/album/AlbumSheet';
import { COLLECTION_SLUG } from '@/lib/config';
import { firstView } from '@/lib/server/routes';

export default async function AlbumIndex() {
  return <AlbumSheet collection={COLLECTION_SLUG} view={await firstView()} />;
}
