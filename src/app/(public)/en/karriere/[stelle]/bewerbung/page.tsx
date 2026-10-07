import type { Metadata } from 'next';
import { bewerbungsMeldung } from '../../../../karriere/meldung';
import { bewerbungsBlatt } from '../../../../karriere/Seiten';
import { KARRIERE_TEXTE } from '../../../../karriere/texte';

/** `/en/karriere/[stelle]/bewerbung` — dasselbe Formular englisch (V-393, D-83). */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: KARRIERE_TEXTE.en.bewerbungMetaTitel };

export default async function EnglishApplication(
  { params, searchParams }: {
    params: Promise<{ stelle: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const meldung = bewerbungsMeldung((await searchParams)['fehler'], 'en');
  return bewerbungsBlatt('en', (await params).stelle, meldung);
}
