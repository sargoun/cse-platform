import type { ReactNode } from 'react';

export const metadata = { title: 'CSE Platform' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
