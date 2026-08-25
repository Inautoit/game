import type { Metadata } from 'next';
import { LoginForm } from '@/components/shared/LoginForm';

export const metadata: Metadata = { title: 'Entrar' };

export default function LoginPage() {
  return <LoginForm />;
}
