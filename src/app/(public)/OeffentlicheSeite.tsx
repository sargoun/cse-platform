import { notFound } from 'next/navigation';
import { Abschnitte } from '@/components/oeffentlich/Abschnitte';
import { JsonLd } from '@/components/oeffentlich/JsonLd';
import { Gesellschaften } from '@/components/oeffentlich/Gesellschaften';
import { Kontaktwege } from '@/components/oeffentlich/Kontaktwege';
import { ansprueche, seitenDaten } from '@/server/inhalt/seiten-daten';
import { VORGABE_SPRACHE, type Sprache } from '@/lib/sprache';
import { shellBereiche } from './lade-shell';

/**
 * Eine oeffentliche Seite, so wie sie in der Datenbank steht.
 *
 * Es gibt sie **einmal** — Startseite, Bereichsseite und jede Rechtsseite
 * gehen hier durch. Waere sie je Route kopiert, muesste jede Kopie an die
 * JSON-LD-Bloecke und an `pruefeSeite()` denken, und die vierte tut es nicht.
 */
export async function OeffentlicheSeite(
  { pfad, sprache = VORGABE_SPRACHE }:
  { readonly pfad: string; readonly sprache?: Sprache },
) {
  const daten = await seitenDaten(pfad, sprache);
  // Eine Seite im Entwurf ist fuer den Besucher nicht vorhanden — nicht leer.
  if (daten === null) notFound();

  return (
    <>
      <JsonLd blocks={daten.jsonLd} />
      <Abschnitte
        seite={daten.seite}
        bereiche={shellBereiche(daten.bereiche)}
        ansprueche={ansprueche(daten.bereiche)}
        sprache={sprache}
        gruppeName={daten.gruppeName}
      />
      {/*
        * Das Impressum bekommt die Pflichtangaben aus `mandant` angehaengt.
        *
        * Vorher stand dort ein Satz, der auf den Fussbereich verwies und
        * Handelsregister, Umsatzsteuer-Identifikationsnummer und
        * Geschaeftsfuehrung „sobald bestaetigt" versprach — also ein
        * Impressum ohne die Angaben, die § 5 TMG verlangt. Der Fussbereich
        * traegt Anschrift und Telefon, mehr nicht.
        *
        * Die Sonderbehandlung steht hier und nicht als Abschnittsart im
        * Redaktionssystem: die Angaben stehen schon in `mandant`, wo auch die
        * Rechnung sie hernimmt. Ein zweites Mal als Fliesstext gepflegt,
        * liefen sie auseinander — und das Impressum waere die Fassung, die
        * niemand nachzieht.
        */}
      {pfad === '/impressum' && (
        <Gesellschaften bereiche={daten.bereiche} sprache={sprache} />
      )}
      {/*
        * Dieselbe Begruendung, andere Seite: `/kontakt` verwies auf das
        * Impressum und auf die Angebotsformulare, statt die Wege zu zeigen,
        * die es nennt. Wer Kontakt sucht, soll ihn hier finden.
        */}
      {pfad === '/kontakt' && (
        <Kontaktwege bereiche={daten.bereiche} sprache={sprache} />
      )}
      {/*
        * **Die Profilseite einer Gesellschaft endete nach den Leistungen.**
        *
        * `/unternehmen/<slug>` traegt genau zwei Abschnitte: `hero` und
        * `leistungen`. Wer dort gelesen hat, was die Gesellschaft tut, fand
        * keinen Weg, sie zu erreichen — kein Telefon, keine Adresse, keine
        * Angebotsanfrage. Die Auftragsbeschreibung nennt beides ausdruecklich
        * (§3, „Contact" und „Request an offer"), und es ist die Stelle, an der
        * ein Besucher am ehesten bereit ist.
        *
        * Gezeigt wird GENAU DIESE Gesellschaft, nicht alle vier: wer auf der
        * Seite von SSE Security steht, will SSE Security anrufen.
        */}
      {(() => {
        const slug = /^\/(?:en\/)?unternehmen\/([a-z-]+)$/u.exec(pfad)?.[1];
        const eine = slug === undefined
          ? [] : daten.bereiche.filter((b) => b.slug === slug);
        return eine.length === 1
          ? <Kontaktwege bereiche={eine} sprache={sprache} />
          : null;
      })()}
    </>
  );
}
