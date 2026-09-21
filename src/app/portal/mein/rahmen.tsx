import type { ReactNode } from 'react';
import type postgres from 'postgres';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withPersonScope, type LeseKontext } from '@/server/kontext/index';
import type { Route } from 'next';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import {
  meinBeschriftungen, meinTexte, PORTAL_BCP47, PORTAL_RICHTUNG,
  type MeinTexte, type PortalSprache,
} from '@/lib/i18n/texte';
import {
  leseEigeneAnstellungen, leseEigenePerson,
  type EigeneAnstellung, type EigenePerson,
} from '@/server/services/mitarbeiter/person';
import { portalZugang, type PortalZugang } from '../zugang';

/**
 * Der gemeinsame Einstieg jeder Seite unter `/portal/mein` (EMP-12, EMP-14,
 * K-18).
 *
 * **Eine Transaktion, eine Bindung, alle Daten.** Der Personen-Scope wird
 * EINMAL betreten; darin werden der Mensch, seine Beschaeftigungen und die
 * Daten der Seite gelesen. Drei Seiten, die sich ihren Scope je selbst
 * aufmachen, sind drei Stellen, an denen jemand `withGroupScope` schreibt —
 * und dann steht die Seite leer da, ohne Fehler und ohne Meldung (K-18).
 *
 * **Die Sprache kommt aus `person.sprache`** und nicht aus dem Pfad: das
 * Mitarbeiterportal hat kein Sprachsegment (SEITENKARTE §12). Geaendert wird
 * sie an genau einer Stelle, `/portal/konto/profil` — deshalb gibt es hier
 * bewusst KEINE zweite Sprachwahl.
 *
 * **Ein Konto ohne Person hat hier nichts zu suchen.** `withPersonScope` wirft
 * dann `KeinePersonFehler`; diese Datei faengt den Fall vorher ab und
 * antwortet 404 — dieselbe Antwort wie fuer alles andere, was es fuer diese
 * Anmeldung nicht gibt (AUT-06).
 */

export interface MeinBasis {
  readonly zugang: PortalZugang;
  readonly person: EigenePerson;
  readonly anstellungen: readonly EigeneAnstellung[];
  readonly sprache: PortalSprache;
  readonly texte: MeinTexte;
}

export type MeinErgebnis<T> =
  | { readonly art: 'anmeldung' }
  | { readonly art: 'ok'; readonly basis: MeinBasis; readonly daten: T };

/**
 * Tor, Personen-Scope und Daten — in dieser Reihenfolge und in einer
 * Transaktion.
 *
 * `laden` bekommt den Lesekontext der Person. Er hat kein `schreibe`: das ist
 * kein Versehen, sondern der Typ, den `withPersonScope` zurueckgibt. Ein
 * Schreibversuch aus einer Portalseite ist damit ein Compilerfehler und keine
 * Laufzeitentscheidung.
 */
export async function meinPortal<T>(
  pfad: string,
  laden: (kontext: LeseKontext, basis: Omit<MeinBasis, 'zugang'>) => Promise<T>,
): Promise<MeinErgebnis<T>> {
  const zugang = await portalZugang(pfad);
  if (zugang === null) return { art: 'anmeldung' };
  if (zugang.sitzung.personId === null || zugang.sitzung.personId === '') notFound();

  const ergebnis = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withPersonScope(tx, zugang.sitzung, async (kontext) => {
      const person = await leseEigenePerson(kontext);
      if (person === null) return null;
      const anstellungen = await leseEigeneAnstellungen(kontext);
      const teil = { person, anstellungen, sprache: person.sprache,
        texte: meinTexte(person.sprache) };
      return { teil, daten: await laden(kontext, teil) };
    })) as Promise<{ teil: Omit<MeinBasis, 'zugang'>; daten: T } | null>);

  if (ergebnis === null) notFound();
  return { art: 'ok', basis: { zugang, ...ergebnis.teil }, daten: ergebnis.daten };
}

/**
 * Die Huelle einer Arbeiterseite.
 *
 * **`dir` und `lang` sitzen auf einem Element um die Seite herum**, nicht auf
 * `<html>`. Das Wurzel-Layout kennt nur die zwei Sprachen der oeffentlichen
 * Website (`src/lib/sprache.ts`) und bekommt sie aus einem Kopf, den die
 * Middleware setzt; beide Dateien gehoeren nicht zu diesem Modul. `dir` ist
 * ein globales HTML-Attribut und wirkt auf jedem Element — die Spiegelung der
 * Oberflaeche, die Laufrichtung der Tab-Leiste und die Ausrichtung jedes
 * Textes darin folgen ihm. Was die Wurzel dazu noch beitragen muesste, ist
 * `dir` auf `<html>` selbst, damit auch die Bildlaufleiste und das Feld
 * ausserhalb dieser Huelle spiegeln; das ist im Abschlussbericht als offener
 * Punkt vermerkt und kein Sonderweg dieser Datei.
 *
 * Der Identitaetsstreifen und der 3px-Aktivbalken spiegeln ausdruecklich NICHT
 * (SEITENKARTE §12) — sie sind Identitaet, keine Leserichtung. Sie kommen aus
 * `PortalRahmen` und bleiben unveraendert.
 */
export function MeinRahmen({
  basis, titel, aktiverTab, zurueck, children,
}: {
  readonly basis: MeinBasis;
  readonly titel: string;
  readonly aktiverTab: string;
  /**
   * Der Weg eine Ebene hinauf — durchgereicht an `PortalRahmen`
   * (DESIGN §5 „The way back", D-613).
   *
   * **Dreizehn Unterseiten dieses Portals haben ihn schon** — als
   * handgebauten `← {t.zeiten}` im Seitenrumpf, mit eigenen Klassen. Diese
   * Durchreiche ist die Stelle, an der sie zusammenlaufen: derselbe Pfeil,
   * dieselbe Stelle, ein `aria-label` in allen vier Sprachen. Wer sie
   * uebergibt, setzt keinen zweiten daneben.
   */
  readonly zurueck?: { readonly ziel: Route; readonly text: string };
  readonly children: ReactNode;
}) {
  return (
    <div
      lang={PORTAL_BCP47[basis.sprache]}
      dir={PORTAL_RICHTUNG[basis.sprache]}
      data-cse="mein-portal"
      data-sprache={basis.sprache}
    >
      <PortalRahmen
        titel={titel}
        {...(zurueck === undefined ? {} : { zurueck })}
        /*
         * `Heute` ist die Wurzel dieses Portals, und `titel` ist der Name der
         * Seite, auf der man steht. Auf `/portal/mein/schichten` stand in der
         * Kopfzeile nur „Schichten" — ein Verweis auf `/portal/mein`, der wie
         * eine Ueberschrift aussah. Mit beidem liest sich die Zeile als Weg:
         * `‹ Heute › Schichten`.
         */
        wurzelTitel={basis.texte.heute}
        /**
         * Kein Bereich: eine Anmeldung, mehrere Gesellschaften. Der Streifen
         * oben ist neutral, und die Zugehoerigkeit steht an jeder ZEILE —
         * eine Kopfzeile, die sich fuer eine der beiden GmbHs entscheidet,
         * waere fuer die andere Haelfte des Tages falsch (EMP-14, D-09).
         */
        bereich={null}
        nurLesen={false}
        leiste={basis.zugang.leiste}
        wurzel="/portal/mein"
        aktiverTab={aktiverTab}
        sichtbareTabs={basis.zugang.sichtbareTabs}
        navigationsRechte={basis.zugang.navigationsRechte}
        /* Die Leiste und die Kopfzeile in der Sprache der Person (D-419). */
        beschriftungen={meinBeschriftungen(basis.texte)}
      >
        {children}
      </PortalRahmen>
    </div>
  );
}
