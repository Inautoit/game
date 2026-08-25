import type { Card } from '../types';

/**
 * Wallapop y similares no tienen API pública y el scraping va contra sus
 * condiciones y se rompe cada dos semanas. En vez de raspar, se abre la búsqueda
 * ya rellenada: el usuario ve el precio real y nosotros no tocamos nada suyo.
 */
export function marketSearchLinks(card: Card, collectionName: string, teamName?: string) {
  const q = [collectionName, card.player_name ?? teamName, card.number].filter(Boolean).join(' ');
  const e = encodeURIComponent(q);
  return [
    { label: 'Buscar en Wallapop', href: `https://es.wallapop.com/app/search?keywords=${e}` },
    { label: 'Buscar en eBay', href: `https://www.ebay.es/sch/i.html?_nkw=${e}` },
    { label: 'Buscar en Cardmarket', href: `https://www.cardmarket.com/es/Football/Products/Search?searchString=${e}` },
  ];
}
