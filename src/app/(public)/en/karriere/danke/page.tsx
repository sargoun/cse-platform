import type { Metadata } from 'next';
import { dankeBlatt } from '../../../karriere/Seiten';
import { KARRIERE_TEXTE } from '../../../karriere/texte';

/** `/en/karriere/danke` — die Dankesseite englisch, mit derselben Frist (V-393). */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: KARRIERE_TEXTE.en.dankeMetaTitel };

export default function EnglishThankYou() {
  return dankeBlatt('en');
}
