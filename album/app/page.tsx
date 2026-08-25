import { AlbumSheet } from '@/components/album/AlbumSheet';
import { COLLECTION_SLUG } from '@/lib/config';
import { firstView } from '@/lib/server/routes';

/**
 * La portada es el álbum. En un sitio estático no hay redirecciones de
 * servidor, así que en vez de rebotar a la primera hoja se sirve directamente.
 */
export default async function Home() {
  return <AlbumSheet collection={COLLECTION_SLUG} view={await firstView()} />;
}
