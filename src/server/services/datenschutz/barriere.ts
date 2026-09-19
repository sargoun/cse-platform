/**
 * Der Meldeweg für Barrieren (LEG-07, BFSG).
 *
 * **Er fragt fast nichts.** Pflicht ist die Beschreibung, sonst nichts — nicht
 * einmal eine E-Mail-Adresse. Wer eine Antwort möchte, hinterlässt eine; wer
 * nur sagen will „diese Tabelle ist mit dem Screenreader nicht lesbar", soll
 * das können, ohne sich zu erkennen zu geben. Ein Pflichtfeld hier wäre eine
 * Hürde vor dem Weg, der Hürden melden soll.
 *
 * **Und er landet bei der Website-Pflege, nicht beim Datenschutz.** Eine
 * Barriere behebt, wer die Seite baut. Die Meldung in denselben Posteingang zu
 * legen wie ein Auskunftsersuchen hiesse, sie dort liegen zu lassen, wo sie
 * niemand beheben kann.
 */
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';

export type BerichtStatus = 'neu' | 'in_bearbeitung' | 'behoben' | 'kein_mangel';

export class BarriereFehler extends Error {
  constructor(nachricht: string, readonly grund: string, readonly status = 400) {
    super(nachricht);
    this.name = 'BarriereFehler';
  }
}

export interface NeuerBericht {
  readonly beschreibung: string;
  readonly seite?: string | undefined;
  readonly hilfsmittel?: string | undefined;
  readonly email?: string | undefined;
}

export async function melde(
  kontext: SchreibKontext, eingabe: NeuerBericht,
): Promise<string> {
  const beschreibung = eingabe.beschreibung.trim();
  if (beschreibung === '') {
    throw new BarriereFehler(
      'Bitte beschreiben Sie kurz, was nicht funktioniert hat.', 'ohne_beschreibung');
  }
  const email = eingabe.email?.trim() ?? '';
  if (email !== '' && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/iu.test(email)) {
    throw new BarriereFehler(
      'Bitte prüfen Sie die E-Mail-Adresse — oder lassen Sie das Feld leer.',
      'email_ungueltig');
  }

  const leer = (wert: string | undefined): string | null => {
    const t = wert?.trim() ?? '';
    return t === '' ? null : t;
  };

  const zeilen = await kontext.schreibe<{ id: string }>(
    `insert into barrierebericht (mandant_id, seite, beschreibung, hilfsmittel, email)
     values (app.aktiver_mandant(), $1, $2, $3, $4)
     returning id`,
    [leer(eingabe.seite), beschreibung, leer(eingabe.hilfsmittel), leer(email)]);

  const z = zeilen[0];
  if (z === undefined) {
    throw new BarriereFehler(
      'Die Meldung konnte nicht gespeichert werden.', 'nicht_gespeichert', 500);
  }
  return z.id;
}

export interface BerichtZeile {
  readonly id: string;
  readonly seite: string | null;
  readonly beschreibung: string;
  readonly hilfsmittel: string | null;
  readonly email: string | null;
  readonly status: BerichtStatus;
  readonly eingegangenAm: Date;
  readonly antwort: string | null;
}

const FELDER = `id, seite, beschreibung, hilfsmittel, email, status::text as status,
                eingegangen_am as "eingegangenAm", antwort`;

export async function liste(kontext: LeseKontext): Promise<readonly BerichtZeile[]> {
  return kontext.abfrage<BerichtZeile>(
    `select ${FELDER}
       from barrierebericht
      where mandant_id = app.aktiver_mandant()
      order by (status in ('behoben', 'kein_mangel')), eingegangen_am desc`);
}

/**
 * Erledigen — mit dem, was getan wurde.
 *
 * Der Text ist nicht nur für den Melder: die Barrierefreiheitserklärung muss
 * den STAND nennen, und der Stand ist die Summe dieser Sätze. Ein „behoben"
 * ohne Beschreibung ist im nächsten Audit nichts wert.
 */
export async function erledige(
  kontext: SchreibKontext, id: string,
  ergebnis: 'behoben' | 'kein_mangel', antwort: string,
): Promise<void> {
  if (antwort.trim() === '') {
    throw new BarriereFehler(
      'Bitte halten Sie fest, was getan wurde — die Barrierefreiheitserklärung '
      + 'muss den Stand nennen können.', 'ohne_antwort');
  }
  const zeilen = await kontext.schreibe<{ id: string }>(
    `update barrierebericht
        set status = $2::barrierebericht_status, antwort = $3,
            bearbeitet_am = now(), bearbeitet_von = app.aktueller_benutzer()
      where mandant_id = app.aktiver_mandant() and id = $1::uuid
        and status not in ('behoben', 'kein_mangel')
      returning id`,
    [id, ergebnis, antwort.trim()]);
  if (zeilen[0] === undefined) {
    throw new BarriereFehler(
      'Diese Meldung gibt es nicht — oder sie ist bereits erledigt.',
      'nicht_gefunden', 404);
  }
}
