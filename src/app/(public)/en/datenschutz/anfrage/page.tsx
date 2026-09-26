import type { Metadata } from 'next';
import { AnfrageSeiteFuer, anfrageMetadaten } from '../../../datenschutz/anfrage/Anfrage';

/**
 * `/en/datenschutz/anfrage` — dieselbe Betroffenenanfrage, englisch
 * (LEG-09, D-82, V-156).
 *
 * **Der Befund.** `Anfrage.tsx` trug vollständige englische Texte, und
 * `POST /api/datenschutz/anfrage` leitete mit `sprache=en` hierher um — aber
 * die Route gab es nicht. Die Sprachwahl auf `/datenschutz/anfrage` bot
 * `/en/…` an (der Pfad stand nicht in `NUR_DEUTSCH`), und die englische
 * Widerspruchsseite verwies fest hierher: zweimal ein 404, auf einem Weg, den
 * Art. 12 Abs. 2 DSGVO „erleichtert" sehen will.
 *
 * **Derselbe Schreibweg, dieselben Felder** (D-83): das Formular schickt
 * `sprache=en` mit, und nur die Anzeige ist übersetzt.
 */
export const dynamic = 'force-dynamic';

export function generateMetadata(): Promise<Metadata> {
  return anfrageMetadaten('en');
}

export default async function EnglishDataRequest(
  { searchParams }: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const suche = await searchParams;
  const meldung = typeof suche['meldung'] === 'string' ? suche['meldung'] : undefined;
  return AnfrageSeiteFuer('en', meldung);
}
