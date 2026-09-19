import 'server-only';
import type { LeseKontext } from '../../kontext/index.js';
import { ladePosteingang, type PosteingangEintrag } from './laden.js';
import { stapelGrund } from './posteingang.js';

/**
 * Die Stapelmappe — **jeder Fall einzeln zu sehen, bevor fünfzig auf einmal
 * genehmigt werden** (APR-02, APR-03, APR-04, Invariante 7).
 *
 * **Warum es diesen Bildschirm gibt, obwohl die Häkchenspalte im Posteingang
 * steht.** Der Posteingang zeigt je Zeile, was APR-02 an Kopfdaten verlangt:
 * Titel, Art, Risiko, Betrag, Frist. Das genügt zum Sortieren. Es genügt
 * NICHT, um fünfzig Vorgänge zu verantworten — und Invariante 7 sagt nicht
 * „ein Mensch hat geklickt", sie sagt „nichts verlässt das System ohne
 * menschliche Freigabe". Eine Stapelfreigabe, die die Fälle nicht zeigt, ist
 * ein Häkchen bei „alle" mit zusätzlichen Schritten.
 *
 * Diese Mappe legt deshalb je Fall die GEÄNDERTEN FELDER daneben — mit ihrem
 * Wert vorher, ihrem Wert nachher und ihrer Konfidenz. Wer danach genehmigt,
 * hat gesehen, was er genehmigt.
 *
 * **Sie weicht die Ausnahmen nicht auf, sie zeigt sie.** Ein markierter
 * Vorgang (`stapel_faehig = false`) und einer mit unsicherem Feld stehen in
 * derselben Mappe, aber ohne Häkchen und mit ihrem Grund — mit dem Weg zur
 * Einzelprüfung daneben. Die Regel dafür steht in `posteingang.ts` und gilt
 * für Bildschirm und Dienst gleichermassen; der Server bewertet sie beim
 * Entscheiden ein zweites Mal (`entscheideStapel`), was immer der Browser
 * geschickt hat.
 *
 * **Diese Mappe schreibt keine Ansichtszeile.** Die Prüfansicht
 * (`/freigaben/[id]`) vermerkt das Öffnen, weil die Prüfdauer daran hängt
 * (APR-08, K-13); eine Liste ist keine Prüfung je Vorgang. Den Vermerk
 * schreibt `entscheideStapel` je entschiedener Zeile mit dem Kanal `stapel` —
 * dort, wo die Entscheidung fällt, und mit dem Namen, der stimmt.
 */

export interface StapelFeld {
  readonly id: string;
  readonly bezeichnung: string;
  readonly wertVorher: string | null;
  readonly wertNachher: string | null;
  /** Die Zeichenkette der Datenbank (`numeric(4,3)`), nie eine Gleitkommazahl. */
  readonly konfidenz: string | null;
  readonly unsicher: boolean;
  readonly grund: string | null;
}

export interface StapelFall {
  readonly eintrag: PosteingangEintrag;
  readonly felder: readonly StapelFeld[];
  /** `null` heisst: darf in den Stapel. Sonst steht hier, warum nicht. */
  readonly grund: string | null;
}

export interface StapelMappe {
  readonly faelle: readonly StapelFall[];
  /** Hält diese Sitzung `freigabe.stapel_entscheiden` (O-367)? */
  readonly darfStapel: boolean;
}

/**
 * Teilt die Mappe in das, was angekreuzt werden darf, und das, was nicht.
 *
 * Rein — `tests/kern/freigabe-stapelmappe.test.ts` hält daran den Fall fest,
 * der APR-03 aushebelt: stapelfähig UND mit unsicherem Feld.
 */
export function teileStapel(faelle: readonly StapelFall[]): {
  readonly stapelbar: readonly StapelFall[];
  readonly ausgenommen: readonly StapelFall[];
} {
  return {
    stapelbar: faelle.filter((f) => f.grund === null),
    ausgenommen: faelle.filter((f) => f.grund !== null),
  };
}

interface FeldRoh {
  readonly id: string;
  readonly freigabe_id: string;
  readonly bezeichnung: string;
  readonly wert_vorher: string | null;
  readonly wert_nachher: string | null;
  readonly konfidenz: string | null;
  readonly unsicher: boolean;
  readonly grund: string | null;
}

export async function ladeStapelMappe(
  kontext: LeseKontext, jetzt: Date,
): Promise<StapelMappe> {
  const [recht] = await kontext.abfrage<{ hat: boolean }>(
    `select app.hat_recht('freigabe.stapel_entscheiden', app.aktiver_mandant()) as hat`);

  const eintraege = await ladePosteingang(kontext, jetzt);
  if (eintraege.length === 0) {
    return { faelle: [], darfStapel: recht?.hat === true };
  }

  /*
   * EINE Abfrage für alle Felder statt einer je Fall: fünfzig Vorgänge wären
   * sonst einundfünfzig Rundreisen, und die Mappe wäre der langsamste
   * Bildschirm des Portals — also der, den niemand öffnet.
   */
  const felder = await kontext.abfrage<FeldRoh>(
    `select ff.id, ff.freigabe_id, ff.bezeichnung, ff.wert_vorher, ff.wert_nachher,
            ff.konfidenz::text as konfidenz, ff.unsicher, ff.grund
       from freigabe_feld ff
      where ff.freigabe_id = any ($1::uuid[])
      order by ff.unsicher desc, ff.feld_pfad`,
    [eintraege.map((e) => e.id)]);

  const jeFreigabe = new Map<string, StapelFeld[]>();
  for (const f of felder) {
    const liste = jeFreigabe.get(f.freigabe_id) ?? [];
    liste.push({
      id: f.id,
      bezeichnung: f.bezeichnung,
      wertVorher: f.wert_vorher,
      wertNachher: f.wert_nachher,
      konfidenz: f.konfidenz,
      unsicher: f.unsicher,
      grund: f.grund,
    });
    jeFreigabe.set(f.freigabe_id, liste);
  }

  return {
    faelle: eintraege.map((eintrag) => ({
      eintrag,
      felder: jeFreigabe.get(eintrag.id) ?? [],
      grund: stapelGrund(eintrag),
    })),
    darfStapel: recht?.hat === true,
  };
}
