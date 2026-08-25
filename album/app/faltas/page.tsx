import type { Metadata } from 'next';
import { MissingList } from '@/components/lists/MissingList';

export const metadata: Metadata = { title: 'Faltas' };

export default function FaltasPage() {
  return <MissingList />;
}
