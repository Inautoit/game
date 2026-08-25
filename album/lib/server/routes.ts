import { COLLECTION_SLUG } from '../config';
import { getCatalog } from './catalog';

/** La portada del álbum es la primera hoja de la serie base. */
export async function firstAlbumHref(slug = COLLECTION_SLUG): Promise<string> {
  const catalog = await getCatalog(slug);
  const team = catalog?.teams[0]?.slug;
  if (team) return `/album/${slug}/${team}`;
  const series = catalog?.series[0]?.code.toLowerCase();
  return series ? `/album/${slug}/${series}` : '/sobre';
}
