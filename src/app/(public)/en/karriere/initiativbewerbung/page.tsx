import type { Metadata } from 'next';
import { bewerbungsMeldung } from '../../../karriere/meldung';
import { initiativBlatt } from '../../../karriere/Seiten';
import { KARRIERE_TEXTE } from '../../../karriere/texte';

/** `/en/karriere/initiativbewerbung` — die Initiativbewerbung englisch (V-393). */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: KARRIERE_TEXTE.en.initiativMetaTitel };

export default async function EnglishUnsolicitedApplication(
  { searchParams }: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const meldung = bewerbungsMeldung((await searchParams)['fehler'], 'en');
  return initiativBlatt('en', meldung);
}
