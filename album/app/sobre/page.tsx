import type { Metadata } from 'next';
import { QuickAdd } from '@/components/album/QuickAdd';

export const metadata: Metadata = { title: 'Abrir sobre' };

export default function SobrePage() {
  return <QuickAdd />;
}
