/**
 * Der Bewerbungseingang über ein Postfach (REC-03, V-224, D-718).
 *
 * **Der Befund.** REC-03 verlangt Bewerbungen über das Karriereformular UND
 * über ein überwachtes Postfach. Gebaut war nur das Formular: kein Anschluss,
 * keine Zeile „nicht verbunden" unter den Integrationen und keine Erfassung
 * von Hand. Eine per E-Mail eingegangene Bewerbung konnte weder ankommen
 * noch angelegt werden — und bekam damit auch keine Löschfrist (REC-07).
 *
 * **Zwei Hälften.**
 *
 *  1. **Der Anschluss als Vertrag, nicht als Zusage** (CLAUDE.md, „No fake
 *     integrations"): `BewerbungsPostfach` mit genau einem Adapter heute —
 *     `NichtVerbundenesPostfach` (`integrationen/bewerbungspostfach.ts`). Welches Postfach, welcher Anbieter, in
 *     welcher Region und unter welchem Vertrag, ist nicht entschieden
 *     (O-938); wer triagiert und ob die Plattform nach der Übernahme im
 *     Postfach löschen darf, ist O-117. Der Adapter liefert keine Nachricht
 *     und behauptet keine.
 *  2. **Die Erfassung von Hand** (`erfasseBewerbungAusPostfach`): ein Mensch
 *     überträgt eine Bewerbung, die im Postfach liegt — mit Quelle `mail`,
 *     Rechtsgrundlage und Aufbewahrungsfrist GENAU wie beim Formular
 *     (`nimmBewerbungAn`), sonst griffe REC-07 für diese Bewerbungen nicht.
 *
 * **Keine Kaltakquise, kein Scraping** (CLAUDE.md): der Eingang nimmt an, was
 * jemand von sich aus geschickt hat. Es gibt keinen Weg, der ein Postfach
 * oder eine Börse nach Menschen durchsucht.
 */
import { randomUUID } from 'node:crypto';
import type { SchreibKontext } from '../../kontext/index.js';
import { BEWERBUNG_EMAIL, RecruitingFehler, aufbewahrungTage } from './dienst.js';

export interface PostfachBewerbung {
  readonly stelleId: string | null;
  readonly name: string;
  readonly email: string;
  readonly telefon: string | null;
  readonly nachricht: string | null;
}

/**
 * Eine Bewerbung aus dem Postfach von Hand erfassen (REC-03, REC-07).
 *
 * **Die Frist wird HIER gesetzt**, aus derselben Einstellung und nach
 * derselben Uhr wie beim Formular (`app.berlin_heute()`,
 * `recruiting.aufbewahrung_tage`): ohne sie bliebe die Bewerbung für immer
 * liegen. Ob die Frist mit dem Eingang im Postfach oder mit der Erfassung
 * beginnen soll, ist O-938 — gesetzt wird die Erfassung, also dieselbe Regel
 * wie beim Formular, wo beides zusammenfällt.
 *
 * **Die Stelle wird geprüft** — sie muss in dieser Gesellschaft stehen und
 * darf nicht geschlossen sein; ohne Stelle ist es eine Initiativbewerbung,
 * die per E-Mail kam (0472 lässt `mail` mit und ohne Stelle zu).
 */
export async function erfasseBewerbungAusPostfach(
  kontext: SchreibKontext, neu: PostfachBewerbung,
): Promise<string> {
  const name = neu.name.trim();
  const email = neu.email.trim().toLowerCase();
  if (name === '' || !BEWERBUNG_EMAIL.test(email)) {
    throw new RecruitingFehler(
      'Name und eine lesbare E-Mail-Adresse sind Pflicht.', 'unvollstaendig', 400);
  }
  if (name.length > 200 || (neu.nachricht ?? '').length > 20_000
      || (neu.telefon ?? '').length > 60) {
    throw new RecruitingFehler('Eine Angabe ist zu lang.', 'zu_lang', 400);
  }
  if (neu.stelleId !== null) {
    const [s] = await kontext.abfrage<{ id: string }>(
      `select id from stelle
        where id = $1::uuid and mandant_id = app.aktiver_mandant()
          and geschlossen_am is null`, [neu.stelleId]);
    if (s === undefined) {
      throw new RecruitingFehler(
        'Diese Stelle gibt es hier nicht — oder sie ist geschlossen.', 'stelle_unbekannt', 400);
    }
  }
  // TODO(client, O-938): Beginnt die Löschfrist einer Bewerbung aus dem Postfach mit dem
  // Eingang im Postfach oder mit der Übernahme in die Plattform? Gesetzt ist die Übernahme.
  const tage = await aufbewahrungTage(kontext);
  const telefon = (neu.telefon ?? '').trim();
  const nachricht = (neu.nachricht ?? '').trim();
  const id = randomUUID();
  await kontext.schreibe(
    `insert into bewerbung
       (id, mandant_id, stelle_id, quelle, name, email, telefon, nachricht,
        aufbewahrung_bis)
     values ($1::uuid, app.aktiver_mandant(), $2::uuid, 'mail'::bewerbung_quelle,
             $3, $4, $5, $6,
             (app.berlin_heute() + ($7::int || ' days')::interval)::date)`,
    [id, neu.stelleId, name, email, telefon === '' ? null : telefon,
      nachricht === '' ? null : nachricht, tage]);
  await kontext.schreibe(
    `select app.protokolliere('recruiting.bewerbung_aus_postfach', 'bewerbung', $1, null,
                              $2::jsonb, app.aktiver_mandant())`,
    [id, { quelle: 'mail', stelle_id: neu.stelleId }]);
  return id;
}
