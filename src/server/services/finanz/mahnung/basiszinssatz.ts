import 'server-only';
import type { LeseKontext, SchreibKontext } from '../../../kontext/index.js';

/**
 * **Den Basiszinssatz nach § 247 BGB eintragen** (V-299, O-358, FIN-15,
 * D-809).
 *
 * `basiszinssatz` (0125) lasen der Mahnlauf und der Waechter
 * `basiszinssatz_pruefen`; geschrieben hat ihn niemand — weder Formular noch
 * Dienst. Die Tabelle gehoert keiner Gesellschaft: der Satz gilt fuer die
 * Bundesrepublik. Ihre Policies lassen nur eine Super-Administration mit
 * `system.referenzdaten_verwalten` schreiben (0125).
 *
 * TODO(client, O-358): Voreinstellung — zentral fuer die Gruppe, je
 * Kalenderhalbjahr (1. Januar, 1. Juli) nach der Bekanntmachung der Deutschen
 * Bundesbank, eingetragen von der Super-Administration unter Einstellungen ›
 * Mahnwesen; der Waechter laesst am 15. Juni und 15. Dezember den Lauf
 * scheitern, wenn die kommende Haelfte fehlt. Gebaut mit V-299. D-784, D-809.
 *
 * **Je Halbjahr eine Zeile, mit Ende.** Der Satz kann sich zu jedem 1. Januar
 * und 1. Juli aendern; eine offene Zeile gaelte still weiter, und der
 * Waechter faende nie eine Luecke. Eine noch offene Zeile davor wird zum Tag
 * vor dem neuen Halbjahr geschlossen.
 *
 * **Eingabe in Prozent, gespeichert in Basispunkten.** Die Bundesbank gibt
 * den Satz mit zwei Nachkommastellen bekannt („1,27 %"); die Umrechnung
 * geschieht an der Zeichenkette, nie ueber eine Gleitkommazahl
 * (Invariante 1). Negative Saetze gab es (−0,88 % von 2016 bis 2022) — die
 * Tabelle hat mit Absicht keine Untergrenze (0125).
 *
 * **Protokolliert.** Ein falscher Satz erzeugt falsche Zinsforderungen an
 * echte Kunden; die Auditzeile nennt alten und neuen Wert.
 */

/** § 247 BGB in dieser Fassung gilt seit dem 1. Januar 2002. */
export const BASISZINS_AB_JAHR = 2002;
/**
 * Pruefgrenze der Eingabe, keine Rechtsregel: −10 % bis +20 %. Sie faengt
 * eine vertauschte Einheit („127" statt „1,27") ab, bevor ein Kunde sie
 * bezahlt.
 */
export const BASISZINS_PRUEFGRENZE_BP = { min: -1000, max: 2000 } as const;
export const QUELLE_VOREINSTELLUNG = 'Deutsche Bundesbank';
const QUELLE_HOECHSTENS = 200;

export type BasiszinsGrund =
  | 'halbjahr_ungueltig' | 'satz_ungueltig' | 'satz_unplausibel' | 'quelle_fehlt'
  | 'nur_super_admin' | 'ueberlappt';

export class BasiszinsFehler extends Error {
  readonly status: number;
  constructor(readonly grund: BasiszinsGrund, nachricht: string) {
    super(nachricht);
    this.name = 'BasiszinsFehler';
    this.status = grund === 'nur_super_admin' ? 403 : grund === 'ueberlappt' ? 409 : 422;
  }
}

export interface Halbjahr {
  readonly jahr: number;
  readonly haelfte: 1 | 2;
  /** Erster Tag (ISO). */
  readonly von: string;
  /** Letzter Tag (ISO). */
  readonly bis: string;
}

/** `jahr` und `haelfte` aus dem Formular — ein Kalenderhalbjahr ab 2002. */
export function pruefeHalbjahr(jahrRoh: string, haelfteRoh: string, bisJahr: number): Halbjahr {
  const jahrText = jahrRoh.trim();
  const haelfteText = haelfteRoh.trim();
  if (!/^\d{4}$/u.test(jahrText) || (haelfteText !== '1' && haelfteText !== '2')) {
    throw new BasiszinsFehler('halbjahr_ungueltig', 'Das Halbjahr ist kein Kalenderhalbjahr.');
  }
  const jahr = Number(jahrText);
  if (jahr < BASISZINS_AB_JAHR || jahr > bisJahr) {
    throw new BasiszinsFehler('halbjahr_ungueltig',
      `Eingetragen werden Halbjahre von ${String(BASISZINS_AB_JAHR)} bis ${String(bisJahr)}.`);
  }
  const haelfte = haelfteText === '1' ? 1 : 2;
  return haelfte === 1
    ? { jahr, haelfte, von: `${jahrText}-01-01`, bis: `${jahrText}-06-30` }
    : { jahr, haelfte, von: `${jahrText}-07-01`, bis: `${jahrText}-12-31` };
}

/**
 * „1,27", „-0,88", „−0.5", „3" → Basispunkte als ganze Zahl.
 *
 * Hoechstens zwei Nachkommastellen, wie die Bekanntmachung. Gerechnet wird an
 * den Ziffern: 1,27 sind 1 × 100 + 27 Basispunkte.
 */
export function prozentInBasispunkte(roh: string): number {
  const text = roh.trim().replace(/\s*%$/u, '').replace('−', '-');
  const t = /^([+-]?)(\d{1,2})(?:[,.](\d{1,2}))?$/u.exec(text);
  if (t === null) {
    throw new BasiszinsFehler('satz_ungueltig',
      'Der Satz ist eine Prozentzahl mit höchstens zwei Nachkommastellen, etwa 1,27.');
  }
  const ganz = Number(t[2]);
  const bruch = Number((t[3] ?? '0').padEnd(2, '0'));
  const bp = ganz * 100 + bruch;
  const ergebnis = t[1] === '-' ? -bp : bp;
  if (ergebnis < BASISZINS_PRUEFGRENZE_BP.min || ergebnis > BASISZINS_PRUEFGRENZE_BP.max) {
    throw new BasiszinsFehler('satz_unplausibel',
      'Der Satz liegt außerhalb von −10 % bis +20 % — bitte die Einheit prüfen.');
  }
  return Object.is(ergebnis, -0) ? 0 : ergebnis;
}

/** Basispunkte als deutsche Prozentangabe: −88 → „−0,88 %". */
export function basispunkteAlsProzent(bp: number): string {
  const betrag = Math.abs(bp);
  const text = `${String(Math.trunc(betrag / 100))},${String(betrag % 100).padStart(2, '0')} %`;
  return bp < 0 ? `−${text}` : text;
}

export function pruefeQuelle(roh: string): string {
  const text = roh.trim();
  if (text === '') {
    throw new BasiszinsFehler('quelle_fehlt', 'Die Quelle fehlt — etwa die Bekanntmachung der Bundesbank.');
  }
  return text.slice(0, QUELLE_HOECHSTENS);
}

export interface BasiszinsEingabe {
  readonly halbjahr: Halbjahr;
  readonly satzBp: number;
  readonly quelle: string;
}

export interface BasiszinsZeile {
  readonly id: string;
  readonly von: string;
  readonly bis: string | null;
  readonly satzBp: number;
  readonly quelle: string;
}

/** Alle eingetragenen Saetze, der neueste zuerst. */
export async function leseBasiszinssaetze(kontext: LeseKontext): Promise<readonly BasiszinsZeile[]> {
  const zeilen = await kontext.abfrage<{
    id: string; von: string; bis: string | null; satz_bp: number; quelle: string;
  }>(
    `select id, gueltig_von::text as von, gueltig_bis::text as bis, satz_bp, quelle
       from basiszinssatz order by gueltig_von desc`);
  return zeilen.map((z) => ({
    id: z.id, von: z.von, bis: z.bis, satzBp: Number(z.satz_bp), quelle: z.quelle,
  }));
}

export interface Deckung {
  /** Gilt fuer heute ein Satz? */
  readonly heute: number | null;
  /** Der erste Tag der kommenden Haelfte — und ob ein Satz ihn deckt. */
  readonly naechsteAb: string;
  readonly naechste: number | null;
}

/** Deckt ein Satz heute und die kommende Haelfte? Heute aus der Datenbank (K-11). */
export async function leseDeckung(kontext: LeseKontext): Promise<Deckung> {
  const [z] = await kontext.abfrage<{
    heute: number | null; naechste_ab: string; naechste: number | null;
  }>(
    `with t as (select app.berlin_heute() as heute),
          n as (select case when extract(month from t.heute) <= 6
                            then make_date(extract(year from t.heute)::int, 7, 1)
                            else make_date(extract(year from t.heute)::int + 1, 1, 1) end as ab
                  from t)
     select (select b.satz_bp from basiszinssatz b, t
              where b.gueltig_von <= t.heute
                and (b.gueltig_bis is null or b.gueltig_bis >= t.heute)) as heute,
            n.ab::text as naechste_ab,
            (select b.satz_bp from basiszinssatz b
              where b.gueltig_von <= n.ab
                and (b.gueltig_bis is null or b.gueltig_bis >= n.ab)) as naechste
       from n`);
  return {
    heute: z?.heute === null || z?.heute === undefined ? null : Number(z.heute),
    naechsteAb: z?.naechste_ab ?? '',
    naechste: z?.naechste === null || z?.naechste === undefined ? null : Number(z.naechste),
  };
}

export type BasiszinsErgebnis = 'eingetragen' | 'korrigiert' | 'unveraendert';

/**
 * Traegt den Satz eines Halbjahres ein — oder korrigiert ihn.
 *
 * Die Super-Administration fragt der Dienst selbst, bevor die Policy es tut:
 * die Policy antwortete mit einer Ausnahme ohne Grund (0125).
 */
export async function setzeBasiszinssatz(
  kontext: SchreibKontext, e: BasiszinsEingabe,
): Promise<BasiszinsErgebnis> {
  const [chef] = await kontext.abfrage<{ ja: boolean }>(`select app.ist_super_admin() as ja`);
  if (chef?.ja !== true) {
    throw new BasiszinsFehler('nur_super_admin',
      'Den Basiszinssatz trägt die Super-Administration ein — er gehört keiner Gesellschaft.');
  }

  /*
   * Erst sperren, dann den alten Stand lesen — für die ganze Tabelle, weil
   * ein Eintrag auch die offene Zeile davor schliesst. Zwei gleichzeitige
   * Speichervorgänge läsen sonst denselben Stand: der zweite überschriebe den
   * ersten mit einem veralteten Vorwert im Protokoll, und beim ersten Eintrag
   * meldeten beide „eingetragen". Eine Zeilensperre trüge den ersten Eintrag
   * nicht — dann gibt es noch keine Zeile.
   */
  await kontext.schreibe(`select pg_advisory_xact_lock(hashtext('basiszinssatz'))`);

  const [alt] = await kontext.abfrage<{
    id: string; satz_bp: number; quelle: string; bis: string | null;
  }>(
    `select id, satz_bp, quelle, gueltig_bis::text as bis
       from basiszinssatz where gueltig_von = $1::date`,
    [e.halbjahr.von]);
  /*
   * Unverändert nur, wenn auch das ENDE stimmt: eine offene Zeile mit
   * demselben Beginn, Satz und derselben Quelle (0125 lässt sie zu) deckte
   * sonst weiter die folgenden Halbjahre, und der Wächter hielte einen
   * fehlenden Satz für vorhanden.
   */
  if (alt !== undefined && Number(alt.satz_bp) === e.satzBp && alt.quelle === e.quelle
      && alt.bis === e.halbjahr.bis) {
    return 'unveraendert';
  }

  /* Eine offene Zeile davor endet am Tag vor dem neuen Halbjahr. */
  await kontext.schreibe(
    `update basiszinssatz set gueltig_bis = $1::date - 1
      where gueltig_bis is null and gueltig_von < $1::date`, [e.halbjahr.von]);

  let id: string;
  try {
    const [z] = await kontext.schreibe<{ id: string }>(
      `insert into basiszinssatz (gueltig_von, gueltig_bis, satz_bp, quelle)
       values ($1::date, $2::date, $3::integer, $4)
       on conflict (gueltig_von) do update
         set gueltig_bis = excluded.gueltig_bis, satz_bp = excluded.satz_bp,
             quelle = excluded.quelle
       returning id`,
      [e.halbjahr.von, e.halbjahr.bis, e.satzBp, e.quelle]);
    id = z!.id;
  } catch (fehler) {
    if ((fehler as { code?: string }).code === '23P01') {
      throw new BasiszinsFehler('ueberlappt',
        'Für einen Tag dieses Halbjahres gilt schon ein anderer Satz.');
    }
    throw fehler;
  }

  await kontext.schreibe(
    `select app.protokolliere('basiszinssatz.gesetzt', 'basiszinssatz', $1, $2::jsonb,
                              $3::jsonb, app.aktiver_mandant())`,
    [id,
      alt === undefined ? null
        : { gueltig_bis: alt.bis, satz_bp: Number(alt.satz_bp), quelle: alt.quelle },
      { gueltig_von: e.halbjahr.von, gueltig_bis: e.halbjahr.bis, satz_bp: e.satzBp,
        quelle: e.quelle }]);
  return alt === undefined ? 'eingetragen' : 'korrigiert';
}
