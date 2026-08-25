import type { Metadata } from 'next';
import { DupesList } from '@/components/lists/DupesList';

export const metadata: Metadata = { title: 'Repes' };

export default function RepesPage() {
  return <DupesList />;
}
