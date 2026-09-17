import { notFound } from 'next/navigation';
import { Abschnitte } from '@/components/oeffentlich/Abschnitte';
import { JsonLd } from '@/components/oeffentlich/JsonLd';
import { Gesellschaften } from '@/components/oeffentlich/Gesellschaften';
import { Kontaktwege } from '@/components/oeffentlich/Kontaktwege';
import { Beitraege } from '@/components/oeffentlich/Beitraege';
import { ProfilTabs } from '@/components/oeffentlich/ProfilTabs';
import { ansprueche, seitenDaten } from '@/server/inhalt/seiten-daten';
import { oeffentlichLesen } from '@/server/inhalt/lesen';
import { oeffentlicheBeitraege } from '@/server/services/social/dienst';
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

  /*
   * Ist das die Profilseite EINER Gesellschaft? Der Ausdruck stand bisher
   * inline im JSX und wurde dort einmal gebraucht; jetzt braucht ihn auch
   * der Beitragsabschnitt, und zweimal dieselbe Regel liefe irgendwann
   * auseinander.
   */
  const slug = /^\/(?:en\/)?unternehmen\/([a-z-]+)$/u.exec(pfad)?.[1];
  const treffer = slug === undefined
    ? [] : daten.bereiche.filter((b) => b.slug === slug);
  const bereich = treffer.length === 1 ? treffer[0]! : null;

  const beitraege = bereich === null
    ? []
    : await oeffentlichLesen((kontext) => oeffentlicheBeitraege(kontext, bereich.id));

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
        * **Die Reiterleiste des Profils, auf der Wurzel wie auf jeder
        * Unterseite** (SEITENKARTE §2.2, DESIGN §4).
        *
        * Sie steht hier und nicht in `ProfilRahmen`, weil die Wurzel NICHT
        * durch jenen Rahmen geht: sie ist eine redaktionelle Seite aus
        * `seite`/`abschnitt`, die Unterseiten sind Listen aus Fachtabellen.
        * Stünde die Leiste nur dort, wäre die Profilseite die einzige, von der
        * aus man ihre sieben Unterseiten nicht erreicht — also genau die
        * Seite, auf der jeder anfängt.
        */}
      {bereich !== null && (
        <div className="mx-auto w-full max-w-content px-s4">
          <ProfilTabs
            bereich={bereich.slug}
            aktiv=""
            sprache={sprache}
            label={sprache === 'en' ? 'Profile sections' : 'Bereiche des Profils'}
          />
        </div>
      )}
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
      {bereich === null ? null : <Kontaktwege bereiche={[bereich]} sprache={sprache} />}

      {/*
        * **Die veroeffentlichten Beitraege dieser Gesellschaft** (SOC-05).
        *
        * Sie stehen NACH den Kontaktwegen: wer auf einer Profilseite liest,
        * sucht zuerst, was die Gesellschaft tut und wie man sie erreicht --
        * das Aktuelle ist der Grund wiederzukommen, nicht der Grund zu
        * bleiben.
        *
        * Gelesen wird im OEFFENTLICHEN Kontext, ohne Sitzung: die Policy
        * `t_beitrag_oeffentlich` laesst genau die veroeffentlichten und nicht
        * zurueckgezogenen durch. Der Dienst filtert dieselbe Bedingung noch
        * einmal -- nicht aus Misstrauen gegen die Policy, sondern damit der
        * Aufrufer sie beim Lesen sieht.
        */}
      {bereich === null ? null : <Beitraege beitraege={beitraege} sprache={sprache} />}
    </>
  );
}
