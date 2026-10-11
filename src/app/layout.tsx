import type { Metadata } from 'next';
import './globals.css';
import { DemoProfileProvider } from '@/components/demo-profile-provider.tsx';

export const metadata: Metadata = {
  title: 'Catalyst | Stock research desk',
  description: 'Evidence-first stock research for independent swing traders.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><DemoProfileProvider>{children}</DemoProfileProvider></body></html>;
}
