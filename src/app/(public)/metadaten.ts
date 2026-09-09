import 'server-only';
import type { Metadata } from 'next';
import { basisAusAnfrage } from '@/server/inhalt/seiten-daten';
import { ladeSeite } from '@/server/services/inhalt/seite';
import { oeffentlichLesen } from '@/server/inhalt/lesen';

/**
 * Titel, Beschreibung und `canonical` — aus derselben `seite`-Zeile.
 *
 * Das `canonical` ist keine Formalie: dieselbe Seite unter zwei Hosts ist fuer
 * eine Suchmaschine zweimal derselbe Inhalt, und sie waehlt selbst, welcher
 * gewinnt. Solange O-08 offen ist, zeigt es auf den Host der Anfrage — richtig,
 * aber nicht stabil; `CSE_KANONISCHE_BASIS` macht es stabil.
 */
export async function metadatenFuer(pfad: string): Promise<Metadata> {
  const basis = await basisAusAnfrage();
  const seite = await oeffentlichLesen(async (kontext) =>
    ladeSeite({ unsafe: (s, w) => kontext.abfrage(s, w) }, pfad));
  if (seite === null) return { title: 'Nicht gefunden' };

  return {
    title: seite.titel,
    ...(seite.beschreibung === null ? {} : { description: seite.beschreibung }),
    alternates: { canonical: `${basis}${pfad}` },
    openGraph: {
      title: seite.titel,
      ...(seite.beschreibung === null ? {} : { description: seite.beschreibung }),
      url: `${basis}${pfad}`,
      locale: 'de_DE',
      type: 'website',
    },
  };
}
