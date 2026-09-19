import type { Metadata } from 'next';
import { DankeSeiteFuer, dankMetadaten } from './Danke';

/** `/datenschutz/anfrage/danke` — deutsch (LEG-09). */
export const dynamic = 'force-dynamic';

export function generateMetadata(): Promise<Metadata> {
  return dankMetadaten();
}

export default function Seite() {
  return DankeSeiteFuer();
}
