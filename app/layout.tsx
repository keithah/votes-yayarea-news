import type { Metadata } from 'next';
import './styles.css';

export const metadata: Metadata = {
  title: 'votes.yayarea.news',
  description: 'Static Bay Area election guide scaffold.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
