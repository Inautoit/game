import { COLLECTION_SLUG } from '../config';
import { getCatalog } from './catalog';

/** La portada del álbum es la primera hoja de la serie base. */
export async function firstView(slug = COLLECTION_SLUG): Promise<string> {
  const catalog = await getCatalog(slug);
  return catalog?.teams[0]?.slug ?? catalog?.series[0]?.code.toLowerCase() ?? '';
}

export async function firstAlbumHref(slug = COLLECTION_SLUG): Promise<string> {
  const view = await firstView(slug);
  return view ? `/album/${slug}/${view}/` : '/sobre/';
}
