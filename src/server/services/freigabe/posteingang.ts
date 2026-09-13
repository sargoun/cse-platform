/**
 * Ein Posteingang, sortiert nach Frist und Risiko (APR-01, §14.4).
 *
 * **Warum EIN Posteingang.** Vier Agenten mit je einer eigenen Warteschlange
 * heisst: vier Listen, von denen drei niemand oeffnet. Was ueberfaellig ist,
 * steht oben — unabhaengig davon, wer es vorgeschlagen hat.
 *
 * **Der Sortierschluessel ist deterministisch und wird ANGEZEIGT.** Eine
 * Reihenfolge, die niemand erklaeren kann, ist eine, der niemand traut; und
 * wem die Reihenfolge raetselhaft ist, der arbeitet die Liste von oben ab,
 * ohne zu wissen, was er dabei hinten liegen laesst.
 *
 * **Die Risikoeinstufung ist CODE, nie ein Modell** (§14.4). Ein Modell, das
 * sein eigenes Ergebnis als „niedriges Risiko" einstuft, hebt das Tor auf,
 * das es passieren soll.
 */
import type { Cent } from '../finanz/geld.js';

export type Risiko = 'niedrig' | 'mittel' | 'hoch';

/** Die Vorgangsarten aus `agent_vorgang_typ` (0128). */
export type VorgangTyp =
  | 'ausschreibung_bewerten' | 'dokument_abrufen' | 'vergabeunterlage_lesen'
  | 'interner_hinweis' | 'termin_bestaetigen' | 'anfrage_antwort_entwurf'
  | 'ersatz_vorschlagen' | 'monatsrechnung_entwurf' | 'angebot_erstellen'
  | 'nachlass_gewaehren' | 'externer_versand' | 'buchung_uebernehmen'
  | 'beitrag_veroeffentlichen' | 'mahnung_vorschlagen' | 'stellenanzeige_entwurf'
  | 'bewerbung_auswerten' | 'kandidat_ranking';

export const VORGANG_TYPEN: readonly VorgangTyp[] = [
  'ausschreibung_bewerten', 'dokument_abrufen', 'vergabeunterlage_lesen',
  'interner_hinweis', 'termin_bestaetigen', 'anfrage_antwort_entwurf',
  'ersatz_vorschlagen', 'monatsrechnung_entwurf', 'angebot_erstellen',
  'nachlass_gewaehren', 'externer_versand', 'buchung_uebernehmen',
  'beitrag_veroeffentlichen', 'mahnung_vorschlagen', 'stellenanzeige_entwurf',
  'bewerbung_auswerten', 'kandidat_ranking',
];

/**
 * Rein interne Vorgaenge — nichts verlaesst das Haus, nichts wird gebucht.
 * Genau diese sind nach §14.4 `niedrig`, und nur diese.
 */
const INTERN: ReadonlySet<VorgangTyp> = new Set<VorgangTyp>([
  'interner_hinweis', 'termin_bestaetigen', 'dokument_abrufen',
  'vergabeunterlage_lesen', 'ausschreibung_bewerten',
]);

/**
 * Aussendung, Buchung, Veroeffentlichung — nach §14.4 mindestens `mittel`.
 * Ein Entwurf ist noch keine Handlung (§4.4), aber sein Vorschlag geht auf
 * eine Handlung zu, und der Posteingang sortiert Absichten, nicht Zustaende.
 */
const AUSSEN: ReadonlySet<VorgangTyp> = new Set<VorgangTyp>([
  'externer_versand', 'angebot_erstellen', 'nachlass_gewaehren',
  'buchung_uebernehmen', 'beitrag_veroeffentlichen', 'mahnung_vorschlagen',
  'stellenanzeige_entwurf', 'anfrage_antwort_entwurf', 'ersatz_vorschlagen',
  'monatsrechnung_entwurf', 'bewerbung_auswerten', 'kandidat_ranking',
]);

/**
 * Die Tatsachen, aus denen sich das Risiko ergibt. Jede ist eine Aussage
 * ueber die Daten, keine Einschaetzung.
 */
export interface RisikoLage {
  readonly vorgangTyp: VorgangTyp;
  readonly betragCent: Cent | null;
  /** `agent_richtlinie.max_betrag_cent` bzw. der Code-Boden (§4.5). */
  readonly wirksameGrenzeCent: Cent | null;
  readonly oeffentlicherAuftraggeber: boolean;
  readonly neueGegenpartei: boolean;
  readonly unsichereFelder: number;
  readonly injektionsverdacht: boolean;
  readonly personenbezogeneEntscheidung: boolean;
  /** `'keine'`, wenn die ArbZG-Pruefung nichts fand (§13). */
  readonly arbzgVerdikt: string;
  /** Ohne Vergleichbares: erstmalig, und damit immer volle Pruefung (§14.5). */
  readonly hatVergleich: boolean;
  /** Ein leerer oder toleranzgrosser Diff bei einer Routinerechnung. */
  readonly diffLeer: boolean;
}

export interface RisikoUrteil {
  readonly risiko: Risiko;
  /** Warum — jede zutreffende Bedingung, in fester Reihenfolge. */
  readonly gruende: readonly string[];
}

/**
 * Die Einstufung.
 *
 * Die `hoch`-Bedingungen werden ALLE gesammelt und nicht bei der ersten
 * abgebrochen: die Oberflaeche zeigt sie an, und „auch noch" ist eine andere
 * Information als „deshalb".
 */
export function stufeRisikoEin(lage: RisikoLage): RisikoUrteil {
  const gruende: string[] = [];

  if (lage.betragCent !== null && lage.wirksameGrenzeCent !== null
      && lage.betragCent > lage.wirksameGrenzeCent) {
    gruende.push('Betrag ueber der wirksamen Grenze');
  }
  if (lage.oeffentlicherAuftraggeber) gruende.push('Oeffentlicher Auftraggeber als Empfaenger');
  if (lage.neueGegenpartei) gruende.push('Neue Gegenpartei');
  if (lage.unsichereFelder > 0) {
    gruende.push(`${String(lage.unsichereFelder)} unsichere Felder`);
  }
  if (lage.injektionsverdacht) gruende.push('Verdacht auf Prompt-Injektion');
  if (lage.personenbezogeneEntscheidung) {
    gruende.push('Personenbezogene Entscheidung (Art. 22 DSGVO)');
  }
  if (lage.arbzgVerdikt !== 'keine') gruende.push(`ArbZG-Verdikt: ${lage.arbzgVerdikt}`);
  if (!lage.hatVergleich) gruende.push('Erstmalig — kein Vergleich vorhanden');

  if (gruende.length > 0) return { risiko: 'hoch', gruende };

  if (INTERN.has(lage.vorgangTyp)) {
    return { risiko: 'niedrig', gruende: ['Rein interner Vorgang'] };
  }
  /*
   * Der eine Weg von `mittel` nach `niedrig`: eine Routinerechnung, deren
   * Diff leer ist. Er verlangt einen Vergleich — ohne ihn hat die Bedingung
   * oben bereits auf `hoch` gesetzt, und ein leerer Diff ohne Vergleich waere
   * nicht „unveraendert", sondern „nie verglichen".
   */
  if (lage.diffLeer && lage.hatVergleich
      && (lage.vorgangTyp === 'monatsrechnung_entwurf'
          || lage.vorgangTyp === 'anfrage_antwort_entwurf')) {
    return { risiko: 'niedrig', gruende: ['Unveraendert gegenueber der Vorperiode'] };
  }
  if (AUSSEN.has(lage.vorgangTyp)) {
    return { risiko: 'mittel', gruende: ['Aussendung, Buchung oder Veroeffentlichung'] };
  }
  return { risiko: 'mittel', gruende: ['Keine Einstufung als intern'] };
}

/** 5 = ueberfaellig … 0 = ohne Frist (§14.4). */
export type Dringlichkeit = 0 | 1 | 2 | 3 | 4 | 5;

const STUNDE = 3_600_000;

/**
 * Die Dringlichkeit aus der Frist.
 *
 * `jetzt` wird uebergeben und nicht gelesen: die Funktion ist rein, und der
 * Server ist die Uhr (Invariante 5). Ein `Date.now()` hier hiesse, dass ein
 * Test die Grenzen nicht pruefen kann, ohne zu warten.
 */
export function dringlichkeit(frist: Date | null, jetzt: Date): Dringlichkeit {
  if (frist === null) return 0;
  const restMs = frist.getTime() - jetzt.getTime();
  if (restMs <= 0) return 5;
  if (restMs < 4 * STUNDE) return 4;
  if (restMs < 24 * STUNDE) return 3;
  if (restMs < 3 * 24 * STUNDE) return 2;
  return 1;
}

const RISIKO_PUNKTE: Readonly<Record<Risiko, 1 | 2 | 3>> = {
  niedrig: 1, mittel: 2, hoch: 3,
};

export function risikoPunkte(risiko: Risiko): number {
  return RISIKO_PUNKTE[risiko];
}

export interface PosteingangZeile {
  readonly id: string;
  readonly frist: Date | null;
  readonly risiko: Risiko;
  readonly betragCent: Cent | null;
  readonly erstelltAm: Date;
}

/**
 * Die Ordnung: Dringlichkeit, Risiko, Betrag, Alter — jeweils absteigend.
 *
 * **Die Kennung entscheidet den Gleichstand.** Ohne sie waere die Reihenfolge
 * zweier in derselben Millisekunde angelegter Vorgaenge von der Sortierung
 * der Datenbank abhaengig — und eine Liste, die sich beim Neuladen umsortiert,
 * laesst einen Menschen zweimal denselben Vorgang oeffnen und einen anderen
 * nie.
 */
export function vergleichePosteingang(
  a: PosteingangZeile, b: PosteingangZeile, jetzt: Date,
): number {
  const d = dringlichkeit(b.frist, jetzt) - dringlichkeit(a.frist, jetzt);
  if (d !== 0) return d;

  const r = risikoPunkte(b.risiko) - risikoPunkte(a.risiko);
  if (r !== 0) return r;

  const ab = a.betragCent ?? 0n;
  const bb = b.betragCent ?? 0n;
  if (ab !== bb) return bb > ab ? 1 : -1;

  // Aelter zuerst: „Alter absteigend" heisst frueher erstellt weiter oben.
  const alter = a.erstelltAm.getTime() - b.erstelltAm.getTime();
  if (alter !== 0) return alter;

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function sortierePosteingang<T extends PosteingangZeile>(
  zeilen: readonly T[], jetzt: Date,
): readonly T[] {
  return [...zeilen].sort((a, b) => vergleichePosteingang(a, b, jetzt));
}

/**
 * Der Sortierschluessel als Text — die Spalte, die §14.4 verlangt, damit die
 * Reihenfolge nie raetselhaft ist.
 */
export function sortSchluessel(zeile: PosteingangZeile, jetzt: Date): string {
  return `${String(dringlichkeit(zeile.frist, jetzt))}·${String(risikoPunkte(zeile.risiko))}`;
}

/** Die Beschriftung der Dringlichkeit (DESIGN §5, deutsche Portaltexte). */
export function dringlichkeitText(stufe: Dringlichkeit): string {
  switch (stufe) {
    case 5: return 'Ueberfaellig';
    case 4: return 'Unter 4 Stunden';
    case 3: return 'Heute';
    case 2: return 'Diese Woche';
    case 1: return 'Spaeter';
    default: return 'Ohne Frist';
  }
}
