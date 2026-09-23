import type { Metadata } from 'next';
import { DankeSeiteFuer, dankMetadaten } from '../../../../datenschutz/anfrage/danke/Danke';

/**
 * `/en/datenschutz/anfrage/danke` — die Bestätigung mit der Monatsfrist,
 * englisch (LEG-09, D-82, V-156). Hierher leitet
 * `POST /api/datenschutz/anfrage` nach einer englischen Anfrage; bis V-156 war
 * das ein 404 — direkt nach einer Anfrage, die angekommen war.
 */
export const dynamic = 'force-dynamic';

export function generateMetadata(): Promise<Metadata> {
  return dankMetadaten('en');
}

export default function EnglishDataRequestThanks() {
  return DankeSeiteFuer('en');
}
