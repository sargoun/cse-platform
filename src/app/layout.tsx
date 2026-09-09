import type { ReactNode } from 'react';
import '../styles/globals.css';

export const metadata = { title: 'CSE Platform' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
