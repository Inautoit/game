'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { COLLECTION_SLUG } from '@/lib/config';
import { useCollection } from './CollectionProvider';

const ITEMS = [
  { href: '/album', label: 'Álbum', icon: '▦' },
  { href: '/faltas', label: 'Faltas', icon: '◇' },
  { href: '/repes', label: 'Repes', icon: '❐' },
  { href: '/valor', label: 'Valor', icon: '€' },
  { href: '/sobre', label: 'Sobre', icon: '＋' },
] as const;

export function TabBar() {
  const pathname = usePathname();
  const { index } = useCollection();
  if (pathname?.startsWith('/login')) return null;

  const firstTeam = index?.catalog.teams[0]?.slug;
  const albumHref = firstTeam ? `/album/${COLLECTION_SLUG}/${firstTeam}` : '/album';

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slot-edge/70 bg-leather/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <ul className="mx-auto flex max-w-5xl">
        {ITEMS.map((item) => {
          const active = item.href === '/album'
            ? pathname?.startsWith('/album') || pathname?.startsWith('/card')
            : pathname?.startsWith(item.href);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href === '/album' ? albumHref : item.href}
                className={`flex flex-col items-center gap-0.5 py-2.5 text-[0.7rem] ${
                  active ? 'text-gold' : 'text-muted'
                }`}
              >
                <span aria-hidden className="text-base leading-none">{item.icon}</span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
