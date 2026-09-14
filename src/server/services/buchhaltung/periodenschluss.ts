import 'server-only';
import type { SchreibKontext } from '../../kontext/index.js';
import { monatsgrenzen } from '../../../lib/datum/kalendertag.js';
import { PeriodeUnklarFehler, sicherePeriode, type Periode } from './periode.js';
import { monatszahlen } from './monatszahlen.js';
import { KALENDERJAHR } from './wirtschaftsjahr.js';

/**
 * Das Periodenschloss von Hand — vorlaeufig schliessen, schliessen, wieder
 * oeffnen (ACC-01, ACC-08, LEG-01, PR 65, D-484).
 *
 * **Drei Zustaende, eine Richtung mit Ausnahme.** `offen` →
 * `vorlaeufig_geschlossen` → `geschlossen`. Vorlaeufig ist die Arbeitsphase
 * der Buchhaltung: wer `buchhaltung.festschreiben` haelt, bucht noch hinein
 * (`fin.periode_gesperrt`), alle anderen nicht; vorlaeufig laesst sich
 * wieder oeffnen. Geschlossen ist endgueltig: der Monat nimmt keine Buchung
 * mehr auf, und er oeffnet nicht wieder — korrigiert wird im offenen Monat
 * durch Gegenbuchung (GoBD, Festschreibung). Das Schliessen selbst weist die
 * Datenbank ab, solange eine Zeile ohne Konto oder eine Buchung ohne
 * Ausgleich im Monat steht (`fin.periode_schliessen_pruefen`).
 *
 * **Ein laufender Monat wird nicht endgueltig geschlossen.** Sein letzter
 * Tag muss vor dem Berliner Heute liegen — sonst schriebe man Zahlen fest,
 * zu denen noch Belege kommen. Vorlaeufig geht jederzeit.
 *
 * **Beim endgueltigen Schliessen werden die Monatszahlen eingefroren**
 * (`umsatz_erloes_cent`, `aufwand_cent`, `ergebnis_cent`, ACC-08) — mit
 * derselben Rechnung wie `monatszahlen.ts`, damit die Seite spaeter sagen
 * kann, ob nachtraeglich ein Beleg mit altem Datum dazukam.
 *
 * Jede Handlung steht im Protokoll: Monat, Zustand vorher und nachher.
 */
export type SchlussArt = 'vorlaeufig' | 'endgueltig' | 'oeffnen';

export class PeriodenschlussFehler extends Error {
  constructor(nachricht: string, readonly grund: 'laufend' | 'endgueltig' | 'zustand' | 'recht' | 'unklar' | 'monat') {
    super(nachricht);
    this.name = 'PeriodenschlussFehler';
  }
}

export interface PeriodenSchluss {
  readonly jahr: number;
  readonly monat: number;
  readonly art: SchlussArt;
}

export interface Geschlossen {
  readonly periode: Periode;
  readonly vorher: Periode['status'];
}

const MM = (n: number): string => String(n).padStart(2, '0');

export async function schliessePeriode(kontext: SchreibKontext, e: PeriodenSchluss): Promise<Geschlossen> {
  if (!Number.isInteger(e.jahr) || e.jahr < 2000 || e.jahr > 2100
      || !Number.isInteger(e.monat) || e.monat < 1 || e.monat > 12) {
    throw new PeriodenschlussFehler('Kein Buchungsmonat.', 'monat');
  }
  const [recht] = await kontext.abfrage<{ hat: boolean }>(
    `select app.hat_recht('buchhaltung.festschreiben', app.aktiver_mandant()) as hat`);
  if (recht?.hat !== true) {
    throw new PeriodenschlussFehler('Das Periodenschloss verlangt buchhaltung.festschreiben.', 'recht');
  }

  const tag = `${String(e.jahr)}-${MM(e.monat)}-01`;
  let periode: Periode;
  try {
    periode = await sicherePeriode(kontext, kontext.aktiverMandantId, tag);
  } catch (fehler: unknown) {
    if (fehler instanceof PeriodeUnklarFehler) throw new PeriodenschlussFehler(fehler.message, 'unklar');
    throw fehler;
  }
  const vorher = periode.status;

  if (vorher === 'geschlossen') {
    throw new PeriodenschlussFehler(
      `Der Monat ${MM(e.monat)}/${String(e.jahr)} ist geschlossen und öffnet nicht wieder — `
      + 'korrigiert wird im offenen Monat durch Gegenbuchung (GoBD).', 'endgueltig');
  }

  if (e.art === 'oeffnen') {
    if (vorher !== 'vorlaeufig_geschlossen') {
      throw new PeriodenschlussFehler('Nur ein vorläufig geschlossener Monat lässt sich wieder öffnen.', 'zustand');
    }
    await kontext.schreibe(
      `update periode set status = 'offen', vorlaeufig_geschlossen_am = null,
              geaendert_am = now(), geaendert_von_art = 'mensch', geaendert_von = app.aktueller_benutzer()
        where id = $1::uuid`, [periode.id]);
  } else if (e.art === 'vorlaeufig') {
    if (vorher !== 'offen') {
      throw new PeriodenschlussFehler('Der Monat ist schon vorläufig geschlossen.', 'zustand');
    }
    await kontext.schreibe(
      `update periode set status = 'vorlaeufig_geschlossen', vorlaeufig_geschlossen_am = now(),
              geaendert_am = now(), geaendert_von_art = 'mensch', geaendert_von = app.aktueller_benutzer()
        where id = $1::uuid`, [periode.id]);
  } else {
    const [heute] = await kontext.abfrage<{ tag: string }>(`select app.berlin_heute()::text as tag`);
    if (heute !== undefined && periode.endeAm >= heute.tag) {
      throw new PeriodenschlussFehler(
        `Der Monat ${MM(e.monat)}/${String(e.jahr)} läuft noch (bis ${periode.endeAm}) — endgültig `
        + 'geschlossen wird ein Monat erst, wenn er vorbei ist.', 'laufend');
    }
    /* Die Zahlen des Monats, wie `monatszahlen.ts` sie rechnet — eingefroren. */
    const grenzen = monatsgrenzen(tag);
    const zahlen = await monatszahlen(kontext, e.jahr, KALENDERJAHR);
    const zeile = zahlen.monate.find((m) => m.von === grenzen.von);
    const erloese = zeile?.erloeseCent ?? 0n;
    const aufwand = zeile?.aufwandCent ?? 0n;
    await kontext.schreibe(
      `update periode
          set status = 'geschlossen', geschlossen_am = now(), geschlossen_von = app.aktueller_benutzer(),
              vorlaeufig_geschlossen_am = coalesce(vorlaeufig_geschlossen_am, now()),
              umsatz_erloes_cent = $2::bigint, aufwand_cent = $3::bigint, ergebnis_cent = $4::bigint,
              geaendert_am = now(), geaendert_von_art = 'mensch', geaendert_von = app.aktueller_benutzer()
        where id = $1::uuid`,
      [periode.id, erloese.toString(), aufwand.toString(), (erloese - aufwand).toString()]);
  }

  const [nachher] = await kontext.abfrage<{ status: Periode['status'] }>(
    `select status::text as status from periode where id = $1::uuid`, [periode.id]);
  await kontext.schreibe(
    `select app.protokolliere('periode.zustand', 'periode', $1, $2::jsonb, $3::jsonb, app.aktiver_mandant())`,
    /* Objekte, keine JSON-Texte: der Treiber kodiert einen Text ein zweites Mal (D-467). */
    [periode.id, { status: vorher },
      { status: nachher?.status ?? null, art: e.art, jahr: e.jahr, monat: e.monat }]);
  return { periode: { ...periode, status: nachher?.status ?? periode.status }, vorher };
}
