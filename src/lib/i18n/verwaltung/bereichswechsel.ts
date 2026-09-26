/**
 * Der Bereichswechsel — Umschalter in der Kopfzeile und Bereichswahl, in
 * beiden Sprachen (TEN-06, TEN-10, DESIGN §6, V-165, D-659).
 *
 * **Die Gewerke heissen wie ihre Module.** „Reinigung", „Security", „Bau"
 * kommen aus `MODUL_NAMEN` — dieselben Wörter wie in der Modulzuweisung
 * (V-164). Ein Gewerk, das im Umschalter anders hiesse als auf dem
 * Benutzerblatt, wäre zwei Gewerke.
 *
 * **Zahlen deutsch, in beiden Sprachen.** Dieselbe Regel wie überall im
 * Verwaltungsportal; der Zähler ist eine Anzahl, nie Geld (0417).
 */
import type { InternSprache } from '../intern.js';
import { modulName } from './einstellungen/module-zuweisung.js';

/** Die Zähler, die `app.mandant_kennzahlen()` liefert (0417). */
export type ZaehlerSchluessel = 'auftraege_aktiv' | 'projekte_laufend';

export interface BereichswechselTexte {
  /** Kopf des Klappmenüs (DESIGN §6: „BEREICH WECHSELN"). */
  readonly kopf: string;
  readonly gruppenuebersicht: string;
  /** Der Auslöser, solange kein Bereich aktiv ist. */
  readonly bereichWaehlen: string;
  /** Vorgelesener Name des Auslösers — der sichtbare Text ist nur der Bereich. */
  readonly ausloeser: string;
  /* ── /auth/bereich ─────────────────────────────────────────────────── */
  readonly titel: string;
  readonly einleitung: string;
  readonly keinBereich: string;
  readonly aktuell: string;
  readonly hierhin: string;
  /** Die Zeile der Gruppenübersicht — mit der WIRKLICHEN Anzahl, nicht „vier". */
  readonly gruppeZeile: (anzahl: number) => string;
  readonly zurueckOhneWechsel: string;
  readonly website: string;
  readonly zurWebsite: string;
  readonly abmelden: string;
  readonly ausgang: string;
  readonly gruppe: string;
}

const ZAHL = new Intl.NumberFormat('de-DE');

export const BEREICHSWECHSEL_TEXTE: Readonly<Record<InternSprache, BereichswechselTexte>> = {
  de: {
    kopf: 'Bereich wechseln',
    gruppenuebersicht: 'Gruppenübersicht',
    bereichWaehlen: 'Bereich wählen',
    ausloeser: 'Bereich wechseln',
    titel: 'Bereich wählen',
    einleitung:
      'In welcher Gesellschaft arbeiten Sie jetzt? Nichts ist vorausgewählt — der '
      + 'Wechsel geschieht erst mit dem Klick und wird protokolliert.',
    keinBereich:
      'Diesem Konto ist kein Bereich zugewiesen. Das ist kein Fehler der Anmeldung: '
      + 'die Zuweisung erfolgt in der Benutzerverwaltung.',
    aktuell: 'Ihr aktueller Bereich',
    hierhin: 'Hierhin wechseln',
    gruppeZeile: (anzahl) => (anzahl === 1
      ? 'Eine Gesellschaft — nur lesen'
      : `${ZAHL.format(anzahl)} Gesellschaften zusammen — nur lesen`),
    zurueckOhneWechsel: 'Zurück ohne Wechsel',
    website: 'Website',
    zurWebsite: 'Zur Website',
    abmelden: 'Abmelden',
    ausgang: 'Ausgang',
    gruppe: 'CSE Gruppe',
  },
  en: {
    kopf: 'Switch area',
    gruppenuebersicht: 'Group overview',
    bereichWaehlen: 'Choose area',
    ausloeser: 'Switch area',
    titel: 'Choose area',
    einleitung:
      'Which Gesellschaft are you working in now? Nothing is preselected — the switch '
      + 'happens only with the click and is logged.',
    keinBereich:
      'No area is assigned to this account. This is not a login error: areas are '
      + 'assigned in user management.',
    aktuell: 'Your current area',
    hierhin: 'Switch here',
    gruppeZeile: (anzahl) => (anzahl === 1
      ? 'One Gesellschaft — read only'
      : `${ZAHL.format(anzahl)} Gesellschaften together — read only`),
    zurueckOhneWechsel: 'Back without switching',
    website: 'Website',
    zurWebsite: 'To the website',
    abmelden: 'Sign out',
    ausgang: 'Exit',
    gruppe: 'CSE Group',
  },
};

/**
 * „24 laufende Aufträge", „1 laufendes Projekt" — die Unterzeile eines
 * Bereichs. Einzahl und Mehrzahl, weil „1 laufende Aufträge" falsch ist.
 */
export function zaehlerText(
  schluessel: ZaehlerSchluessel, wert: number, sprache: InternSprache,
): string {
  const zahl = ZAHL.format(wert);
  const eins = wert === 1;
  if (sprache === 'en') {
    return schluessel === 'projekte_laufend'
      ? `${zahl} ${eins ? 'running project' : 'running projects'}`
      : `${zahl} ${eins ? 'active order' : 'active orders'}`;
  }
  return schluessel === 'projekte_laufend'
    ? `${zahl} ${eins ? 'laufendes Projekt' : 'laufende Projekte'}`
    : `${zahl} ${eins ? 'laufender Auftrag' : 'laufende Aufträge'}`;
}

/**
 * Die Gewerke eines Bereichs als Wort — „Reinigung", „Bau".
 *
 * `null` (die Buchung wurde nie gepflegt, O-355) und `[]` (kein Gewerk, CSE
 * Operations) ergeben beide KEINEN Text: unbekannt wird nicht erfunden, und
 * „kein Gewerk" ist keine Beschriftung.
 */
export function gewerkText(
  gewerke: readonly string[] | null, sprache: InternSprache,
): string | null {
  if (gewerke === null || gewerke.length === 0) return null;
  return gewerke.map((g) => modulName(g, sprache)).join(', ');
}

/**
 * Was der Auslöser des Umschalters zeigt: die Gruppenübersicht, den aktiven
 * Bereich — oder, ohne beides, die Aufforderung zu wählen.
 *
 * EINE Regel für zwei Stellen: den Auslöser selbst und den Rahmen, der
 * daneben nicht ein zweites Mal denselben Namen als Logo setzt (DESIGN §6
 * „Placement": der Umschalter ERSETZT das Logo).
 */
export function ausloeserName(
  bereiche: readonly { readonly id: string; readonly name: string }[],
  aktiv: string | null,
  gruppenansicht: boolean,
  texte: Pick<BereichswechselTexte, 'gruppenuebersicht' | 'bereichWaehlen'>,
): string {
  if (gruppenansicht) return texte.gruppenuebersicht;
  return bereiche.find((b) => b.id === aktiv)?.name ?? texte.bereichWaehlen;
}

/** Die Unterzeile: Gewerk und Zähler, getrennt durch einen Mittelpunkt (DESIGN §6). */
export function unterzeile(
  gewerke: readonly string[] | null,
  zaehler: { readonly schluessel: ZaehlerSchluessel; readonly wert: number } | null,
  sprache: InternSprache,
): string | null {
  const teile = [
    gewerkText(gewerke, sprache),
    zaehler === null ? null : zaehlerText(zaehler.schluessel, zaehler.wert, sprache),
  ].filter((t): t is string => t !== null);
  return teile.length === 0 ? null : teile.join(' · ');
}
