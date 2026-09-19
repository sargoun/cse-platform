/**
 * Die drei geschuetzten Stammdatenfelder eines Menschen
 * (SEC-03, LEG-09, K-05, 01-KERN §6.13/§11).
 *
 * **Gelesen wird nur ueber `app.person_stammdaten_lesen`.** Geburtsdatum,
 * Geburtsort und Staatsangehoerigkeit sind `cse_app` als SELECT entzogen
 * (0190); ein `select geburtsdatum from person` scheitert mit „permission
 * denied for table person". Das ist keine Unbequemlichkeit, sondern die
 * Zusage: es gibt genau einen Lesepfad, er prueft
 * `personal.stammdaten_lesen`, und jeder Zugriff hinterlaesst eine
 * Auditzeile mit Rechtsgrundlage.
 *
 * **Geschrieben wird dagegen mit `personal.schreiben` — durch die Policy.**
 * `GRANT UPDATE` und `GRANT SELECT` sind getrennte Rechte; eine Spalte darf
 * schreibbar und unlesbar sein, und genau das braucht ein Personalformular,
 * das ein Geburtsdatum aufnimmt und es nicht zurueckliest (§11).
 *
 * **Warum es diese Felder ueberhaupt gibt.** § 16 BewachV verlangt fuer die
 * Meldung an das Bewacherregister Geburtsdatum, Geburtsort und
 * Staatsangehoerigkeit (SEC-03). Ohne sie ist eine Bewachermeldung nicht
 * vollstaendig — und mit ihnen in jeder Abfrage waere das Portal ein
 * Ausweisregister.
 */
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';

export interface Stammdaten {
  /** `JJJJ-MM-TT` — ein Kalendertag, kein Zeitpunkt (Invariante 2). */
  readonly geburtsdatum: string | null;
  readonly geburtsort: string | null;
  /** ISO 3166-1 alpha-2, gross geschrieben. */
  readonly staatsangehoerigkeit: string | null;
}

/**
 * Das Recht fehlt — und das ist etwas anderes als „nichts hinterlegt".
 *
 * Die Definer-Funktion wirft `42501`, statt leere Felder zu liefern, weil die
 * zwei Lagen zu zwei verschiedenen naechsten Schritten fuehren: „dann tragen
 * wir es ein" und „dann hole ich jemanden, der darf".
 */
export class KeinStammdatenRecht extends Error {
  readonly code = 'kein_recht';
  readonly status = 404;
  constructor() {
    super(
      'Kein Recht auf Stammdaten in dieser Gesellschaft '
      + '(`personal.stammdaten_lesen`, SEC-03/LEG-09).',
    );
    this.name = 'KeinStammdatenRecht';
  }
}

export class StammdatenEingabeFehler extends Error {
  readonly code = 'ungueltige_eingabe';
  readonly status = 400;
  constructor(nachricht: string) {
    super(nachricht);
    this.name = 'StammdatenEingabeFehler';
  }
}

export class PersonNichtGefunden extends Error {
  readonly code = 'nicht_gefunden';
  readonly status = 404;
  constructor(id: string) {
    super(`Diesen Menschen gibt es in dieser Gesellschaft nicht (${id}).`);
    this.name = 'PersonNichtGefunden';
  }
}

const DATUM = /^\d{4}-\d{2}-\d{2}$/u;
const ISO2 = /^[A-Za-z]{2}$/u;

/**
 * Liest die drei Felder — oder wirft, wenn das Recht fehlt.
 *
 * `null` als Ergebnis heisst: diesen Menschen fuehrt diese Gesellschaft nicht
 * (AUT-06 — nach aussen ununterscheidbar von „gibt es nicht").
 */
export async function leseStammdaten(
  kontext: LeseKontext, personId: string,
): Promise<Stammdaten | null> {
  try {
    const [z] = await kontext.abfrage<{
      geburtsdatum: string | null; geburtsort: string | null;
      staatsangehoerigkeit: string | null;
    }>(
      `select to_char(geburtsdatum, 'YYYY-MM-DD') as geburtsdatum,
              geburtsort, staatsangehoerigkeit
         from app.person_stammdaten_lesen($1::uuid)`,
      [personId],
    );
    if (z === undefined) return null;
    return {
      geburtsdatum: z.geburtsdatum,
      geburtsort: z.geburtsort,
      staatsangehoerigkeit: z.staatsangehoerigkeit === null
        ? null : z.staatsangehoerigkeit.trim(),
    };
  } catch (fehler) {
    if ((fehler as { code?: string }).code === '42501') throw new KeinStammdatenRecht();
    throw fehler;
  }
}

/**
 * **`undefined` heisst „nicht mitgeschickt", `null` heisst „leeren".**
 *
 * Der Unterschied ist der Befund, der diese Fassung gebaut hat: die erste
 * schrieb IMMER alle drei Spalten. Ein Aufruf, der nur den Geburtsort
 * nachtraegt, loeschte damit Geburtsdatum und Staatsangehoerigkeit — und weil
 * die drei Spalten dem Schreibenden nicht lesbar sind (K-05, §11), merkte es
 * niemand: das Formular zeigt danach, was es selbst geschrieben hat, und das
 * ist leer. Genau die drei Angaben, die § 16 BewachV fuer die Meldung an das
 * Bewacherregister verlangt, verschwanden lautlos.
 *
 * Das vollstaendige Formular schickt weiterhin alle drei Felder — ein leeres
 * Feld bleibt dort also ein ausdrueckliches „leeren", und das ist richtig.
 */
export interface StammdatenEingabe {
  readonly personId: string;
  /** `JJJJ-MM-TT`, `null` (leeren) oder `undefined` (nicht anfassen). */
  readonly geburtsdatum?: string | null;
  readonly geburtsort?: string | null;
  /** Zwei Buchstaben; wird gross geschrieben gespeichert. */
  readonly staatsangehoerigkeit?: string | null;
}

/**
 * Schreibt die drei Felder — ohne sie zurueckzulesen.
 *
 * **Kein `returning`.** Die Spalten sind dem Schreibenden nicht lesbar; ein
 * `update … returning geburtsdatum` scheitert mit 42501 an genau der
 * Spaltensperre, die hier gewollt ist. Wer das Ergebnis sehen will, liest es
 * ueber `leseStammdaten` — und hinterlaesst dabei seine Auditzeile.
 *
 * Die Policy `t_person_personalpflege` (0190) verlangt `personal.schreiben`
 * UND eine Beschaeftigung in der aktiven Gesellschaft. Null geaenderte Zeilen
 * heissen deshalb „nicht dieser Mensch, nicht diese Gesellschaft, oder kein
 * Schreibrecht" — und nicht „schon richtig".
 */
export async function schreibeStammdaten(
  kontext: SchreibKontext, eingabe: StammdatenEingabe,
): Promise<void> {
  const saetze: string[] = [];
  const werte: unknown[] = [eingabe.personId];
  const nimm = (spalte: string, wert: unknown, guss = ''): void => {
    werte.push(wert);
    saetze.push(`${spalte} = $${String(werte.length)}${guss}`);
  };

  if (eingabe.geburtsdatum !== undefined) {
    const geburtsdatum = eingabe.geburtsdatum?.trim() ?? '';
    if (geburtsdatum !== '' && !DATUM.test(geburtsdatum)) {
      throw new StammdatenEingabeFehler(
        'Das Geburtsdatum erwartet einen Kalendertag als JJJJ-MM-TT.');
    }
    nimm('geburtsdatum', geburtsdatum === '' ? null : geburtsdatum, '::date');
  }

  if (eingabe.geburtsort !== undefined) {
    const ort = eingabe.geburtsort?.trim() ?? '';
    nimm('geburtsort', ort === '' ? null : ort);
  }

  if (eingabe.staatsangehoerigkeit !== undefined) {
    const staat = eingabe.staatsangehoerigkeit?.trim() ?? '';
    if (staat !== '' && !ISO2.test(staat)) {
      throw new StammdatenEingabeFehler(
        'Die Staatsangehörigkeit erwartet den zweibuchstabigen Ländercode nach '
        + 'ISO 3166-1 alpha-2 — „DE", „TR", „SY". Das ist die Form, in der das '
        + 'Bewacherregister sie verlangt (SEC-03).');
    }
    nimm('staatsangehoerigkeit', staat === '' ? null : staat.toUpperCase());
  }

  /*
   * Kein Feld mitgebracht heisst: nichts zu tun. Ein `update` ohne SET waere
   * ein Syntaxfehler, und ein `update` allein auf `geaendert_am` schriebe eine
   * Aenderungsspur fuer eine Aenderung, die es nicht gab.
   */
  if (saetze.length === 0) return;

  werte.push(kontext.benutzerId);
  const zeilen = await kontext.schreibe<{ id: string }>(
    `update person
        set ${saetze.join(', ')},
            geaendert_am = now(), geaendert_von = $${String(werte.length)}::uuid
      where id = $1::uuid and geloescht_am is null
      returning id`,
    werte,
  );
  if (zeilen.length === 0) throw new PersonNichtGefunden(eingabe.personId);
}
