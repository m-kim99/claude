import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Chat',
  description: 'claude-sonnet-4-5-20250929',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
