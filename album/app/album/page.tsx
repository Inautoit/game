import { redirect } from 'next/navigation';
import { firstAlbumHref } from '@/lib/server/routes';

export default async function AlbumIndex() {
  redirect(await firstAlbumHref());
}
