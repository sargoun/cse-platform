import 'server-only';
import type { Metadata } from 'next';
import { basisAusAnfrage } from '@/server/inhalt/seiten-daten';
import { ladeSeite } from '@/server/services/inhalt/seite';
import { oeffentlichLesen } from '@/server/inhalt/lesen';
import {
  alternativen, mitSprache, OG_LOCALE, VORGABE_SPRACHE, type Sprache,
} from '@/lib/sprache';

/**
 * Titel, Beschreibung, `canonical` und `hreflang` — aus derselben `seite`-Zeile.
 *
 * Das `canonical` ist keine Formalie: dieselbe Seite unter zwei Hosts ist fuer
 * eine Suchmaschine zweimal derselbe Inhalt, und sie waehlt selbst, welcher
 * gewinnt. Solange O-08 offen ist, zeigt es auf den Host der Anfrage — richtig,
 * aber nicht stabil; `CSE_KANONISCHE_BASIS` macht es stabil.
 *
 * **`hreflang` steht auf JEDER Seite, auch auf der deutschen.** Google wertet
 * die Verweise nur aus, wenn sie gegenseitig sind: eine englische Seite, die
 * auf ihre deutsche Fassung zeigt, ohne dass die zurueckzeigt, wird ignoriert
 * — und dann konkurrieren beide Fassungen um dieselbe Suchanfrage, statt sich
 * zu ergaenzen. Deshalb kommen die Alternativen aus `alternativen()` und
 * nicht aus zwei getrennt gepflegten Listen.
 */
export async function metadatenFuer(
  pfad: string, sprache: Sprache = VORGABE_SPRACHE,
): Promise<Metadata> {
  const basis = await basisAusAnfrage();
  const seite = await oeffentlichLesen(async (kontext) =>
    ladeSeite({ unsafe: (s, w) => kontext.abfrage(s, w) }, pfad, sprache));
  if (seite === null) return { title: sprache === 'en' ? 'Not found' : 'Nicht gefunden' };

  const url = `${basis}${mitSprache(pfad, sprache)}`;
  return {
    title: seite.titel,
    ...(seite.beschreibung === null ? {} : { description: seite.beschreibung }),
    alternates: { canonical: url, languages: alternativen(pfad, basis) },
    openGraph: {
      title: seite.titel,
      ...(seite.beschreibung === null ? {} : { description: seite.beschreibung }),
      url,
      locale: OG_LOCALE[sprache],
      type: 'website',
    },
  };
}
