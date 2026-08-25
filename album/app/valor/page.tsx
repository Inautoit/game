import type { Metadata } from 'next';
import { ValueScreen } from '@/components/valor/ValueScreen';

export const metadata: Metadata = { title: 'Valor de tu colección' };

export default function ValorPage() {
  return <ValueScreen />;
}
