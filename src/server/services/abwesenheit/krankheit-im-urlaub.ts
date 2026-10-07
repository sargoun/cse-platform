/**
 * Krankheit im Urlaub — die Tage einer nachgewiesenen Arbeitsunfähigkeit im
 * genehmigten Urlaub kommen auf das Urlaubskonto zurück
 * (V-319, O-138, D-788, D-853, § 9 BUrlG, EMP-05, EMP-10).
 *
 * **Warum es den Weg braucht.** Eine Krankmeldung über einem genehmigten
 * Urlaub ließ sich erfassen — `ab_keine_dublette` (0073) sperrt nur dieselbe
 * Art —, aber das Urlaubskonto behielt die vollen Urlaubstage abgezogen:
 * `kern.abwesenheit_urlaubskonto` bucht nur Genehmigung und Stornierung. Der
 * einzige Weg war, den ganzen Urlaub zu stornieren und neu zu beantragen.
 *
 * // TODO(client, O-138): Voreinstellung — mit AU-Bescheinigung werden die Arbeitstage des genehmigten Urlaubs, an denen die Arbeitnehmerin krank war, dem Urlaubskonto des Urlaubsjahres gutgeschrieben (§ 9 BUrlG); ohne Bescheinigung nicht. Der Urlaub verlängert sich dadurch nicht, er bleibt, wie er genehmigt wurde. Welche Art den Urlaub unterbricht, steht im Katalog (Voreinstellung: nur „Krankheit"). D-788, D-853.
 *
 * **Die Zahl rechnet diese Datei** (Invariante 6): was der Urlaub nach
 * derselben Regel kostete, die ihn beim Genehmigen berechnet hat
 * (`rechneTage`), weniger das, was seine Teile vor und nach der Krankheit
 * kosten. So zählen die halben Tage am Rand des Urlaubs genau so, wie sie
 * abgezogen wurden. Die Datenbank prüft nur die Decken: nie mehr als
 * Kalendertage im Urlaub krank, nie mehr, als der Urlaub noch kostet.
 *
 * **Eine Transaktion.** `app.krankheit_im_urlaub_erfassen` (0537) sperrt den
 * Urlaub, legt die Krankheit mit Verweis und gutgeschriebenen Tagen an, und
 * der Auslöser bucht das Urlaubskonto. Storniert jemand die Krankheit, bucht
 * derselbe Auslöser zurück; storniert jemand den Urlaub, gibt er nur zurück,
 * was der Urlaub noch kostet.
 */
import type { SchreibKontext } from '../../kontext/index.js';
import { mengeNachPostgres, milliMenge, type MilliMenge } from '../finanz/menge.js';
import { tagePlus } from '@/lib/datum/kalendertag';
import { rechneTage, ZeitraumFehler, type Wochentag } from './tage.js';
import { findeAbwesenheit } from './index.js';

export interface Urlaubszeitraum {
  /** `JJJJ-MM-TT`, einschließlich. */
  readonly von: string;
  readonly bis: string;
  readonly vonHalbtags: boolean;
  readonly bisHalbtags: boolean;
}

/**
 * Rein: wie viele Urlaubstage die Krankheit zurückgibt.
 *
 * Der Urlaub kostet `rechneTage(Urlaub)`. Ohne die kranken Tage kosteten nur
 * seine Teile davor und danach — mit den halben Tagen, die der Urlaub an
 * seinen Rändern trägt. Die Differenz ist die Gutschrift. Ein Feiertag oder
 * Wochenende in der Krankheit gibt nichts zurück: er hat nichts gekostet.
 */
export function gutschriftTage(
  urlaub: Urlaubszeitraum, krank: { readonly von: string; readonly bis: string },
  arbeitstage?: readonly Wochentag[],
): MilliMenge {
  const von = krank.von > urlaub.von ? krank.von : urlaub.von;
  const bis = krank.bis < urlaub.bis ? krank.bis : urlaub.bis;
  if (von > bis) return milliMenge(0n);
  const regel = arbeitstage === undefined ? {} : { arbeitstage };

  const ganz = rechneTage({
    von: urlaub.von, bis: urlaub.bis,
    vonHalbtags: urlaub.vonHalbtags, bisHalbtags: urlaub.bisHalbtags, ...regel,
  });
  const davor = von > urlaub.von
    ? rechneTage({ von: urlaub.von, bis: tagePlus(von, -1), vonHalbtags: urlaub.vonHalbtags, ...regel })
    : 0n;
  const danach = bis < urlaub.bis
    ? rechneTage({ von: tagePlus(bis, 1), bis: urlaub.bis, bisHalbtags: urlaub.bisHalbtags, ...regel })
    : 0n;
  const rest = ganz - davor - danach;
  return milliMenge(rest > 0n ? rest : 0n);
}

/** Warum der Weg nicht gegangen wird — als Schlüssel für `?fehler=` (D-753). */
export type KrankheitImUrlaubGrund =
  | 'nicht_gefunden' | 'kein_urlaub' | 'nicht_genehmigt' | 'au_fehlt' | 'ausserhalb'
  | 'keine_arbeitstage' | 'keine_art' | 'art_ungeklaert' | 'schon_erfasst'
  | 'konto_fehlt' | 'zu_viel' | 'au_bis_vor_von' | 'kein_datum' | 'kein_recht';

const SAETZE: Readonly<Record<KrankheitImUrlaubGrund, string>> = {
  nicht_gefunden: 'Diesen Antrag oder seinen Urlaub gibt es in dieser Gesellschaft nicht.',
  kein_urlaub: 'Dieser Antrag ist kein Urlaubsantrag — nur ein Urlaub, der auf das Urlaubskonto zählt, wird unterbrochen.',
  nicht_genehmigt: 'Der Urlaub ist nicht (mehr) genehmigt; eine Krankheit davor oder danach wird als Krankmeldung erfasst.',
  au_fehlt: 'Ohne AU-Bescheinigung werden keine Urlaubstage gutgeschrieben (§ 9 BUrlG: „durch ärztliches Zeugnis nachgewiesen"). Die Krankheit wird dann als gewöhnliche Krankmeldung erfasst.',
  ausserhalb: 'Die Krankheit liegt nicht im Urlaub.',
  keine_arbeitstage: 'Die kranken Tage im Urlaub sind Wochenenden oder Feiertage — sie haben keinen Urlaubstag gekostet, es gibt nichts gutzuschreiben.',
  keine_art: 'Im Katalog unterbricht keine Abwesenheitsart den Urlaub (Stammdaten › Abwesenheitsarten, O-138).',
  art_ungeklaert: 'Für diese Abwesenheitsart ist nicht hinterlegt, ob sie bezahlt ist (O-139).',
  schon_erfasst: 'In diesem Zeitraum ist schon eine Krankheit erfasst. Ist sie ohne Gutschrift erfasst, wird sie mit dem Grund „wird als Krankheit im Urlaub erfasst" storniert und hier neu erfasst.',
  konto_fehlt: 'Für das Urlaubsjahr gibt es kein offenes Urlaubskonto; ein abgeschlossenes Jahr wird nicht rückwirkend geändert (O-18).',
  zu_viel: 'Es würden mehr Tage gutgeschrieben, als der Urlaub noch kostet — er wurde mit einer anderen Arbeitswoche genehmigt, oder es ist schon gutgeschrieben.',
  au_bis_vor_von: '„Bescheinigung gültig bis" liegt vor dem ersten Krankheitstag.',
  kein_datum: 'Der Krankheitszeitraum braucht zwei Kalendertage als JJJJ-MM-TT, das Ende nicht vor dem Anfang.',
  kein_recht: 'Die Krankheit im Urlaub erfasst, wer zeit.abwesenheit_melden und zeit.abwesenheit_genehmigen hält.',
};

export class KrankheitImUrlaubFehler extends Error {
  readonly code: string;
  readonly status: number;
  constructor(readonly grund: KrankheitImUrlaubGrund) {
    super(SAETZE[grund]);
    this.name = 'KrankheitImUrlaubFehler';
    this.status = grund === 'nicht_gefunden' ? 404 : grund === 'kein_recht' ? 403
      : grund === 'schon_erfasst' || grund === 'konto_fehlt' || grund === 'zu_viel'
        || grund === 'nicht_genehmigt' || grund === 'art_ungeklaert' || grund === 'keine_art'
        ? 409 : 400;
    this.code = this.status === 404 ? 'nicht_gefunden' : this.status === 403
      ? 'verboten' : this.status === 409 ? 'ungueltiger_zustand' : 'ungueltige_eingabe';
  }
}

export interface KrankheitImUrlaubEingabe {
  readonly antragId: string;
  readonly von: string;
  readonly bis: string;
  /** § 9 BUrlG: ohne Bescheinigung keine Gutschrift — der Weg verlangt sie. */
  readonly auVorliegt: boolean;
  readonly auBis?: string | null;
  readonly bemerkung?: string | null;
  /** Leer: die eine Art des Katalogs, die den Urlaub unterbricht. */
  readonly abwesenheitsartId?: string | null;
  readonly arbeitstage?: readonly Wochentag[];
}

export interface KrankheitImUrlaubErgebnis {
  readonly krankheitId: string;
  readonly urlaubId: string;
  /** `numeric(12,3)` als Text. */
  readonly gutgeschrieben: string;
  readonly jahr: number;
}

/** Die Arten des Katalogs, die einen Urlaub unterbrechen — für die Auswahl. */
export async function urlaubUnterbrechendeArten(
  kontext: Pick<SchreibKontext, 'abfrage'>,
): Promise<readonly { id: string; bezeichnung: string; bezahlt: boolean | null }[]> {
  return kontext.abfrage<{ id: string; bezeichnung: string; bezahlt: boolean | null }>(
    `select id, bezeichnung, bezahlt from abwesenheitsart
      where unterbricht_urlaub and archiviert_am is null
      order by (mandant_id is null) desc, bezeichnung, id`);
}

function ausDatenbank(fehler: unknown): KrankheitImUrlaubFehler | null {
  const f = fehler as { code?: unknown; message?: unknown };
  const text = typeof f.message === 'string' ? f.message : '';
  if (f.code === '42501') return new KrankheitImUrlaubFehler('kein_recht');
  if (f.code === '23P01') return new KrankheitImUrlaubFehler('schon_erfasst');
  if (f.code === 'P0002' && text.startsWith('Kein offenes Urlaubskonto')) {
    return new KrankheitImUrlaubFehler('konto_fehlt');
  }
  if (f.code === 'P0002') return new KrankheitImUrlaubFehler('nicht_genehmigt');
  if (f.code === '23514' && text.includes('ist nicht genehmigt')) {
    return new KrankheitImUrlaubFehler('nicht_genehmigt');
  }
  if (f.code === '23514' && text.includes('gutgeschrieben')) {
    return new KrankheitImUrlaubFehler('zu_viel');
  }
  return null;
}

/**
 * Erfasst die Krankheit im genehmigten Urlaub eines Antrags und schreibt die
 * Urlaubstage gut — in der Transaktion des Aufrufers.
 */
export async function erfasseKrankheitImUrlaub(
  kontext: SchreibKontext, eingabe: KrankheitImUrlaubEingabe,
): Promise<KrankheitImUrlaubErgebnis> {
  const [antrag] = await kontext.abfrage<{
    abwesenheit_id: string | null; zaehlt_auf_urlaubskonto: boolean | null;
  }>(
    `select (select ab.id from abwesenheit ab where ab.antrag_id = a.id limit 1) as abwesenheit_id,
            aa.zaehlt_auf_urlaubskonto
       from antrag a
       left join abwesenheitsart aa on aa.id = a.abwesenheitsart_id
      where a.id = $1::uuid`,
    [eingabe.antragId]);
  if (antrag === undefined || antrag.abwesenheit_id === null) {
    throw new KrankheitImUrlaubFehler('nicht_gefunden');
  }
  if (antrag.zaehlt_auf_urlaubskonto !== true) throw new KrankheitImUrlaubFehler('kein_urlaub');

  const urlaub = await findeAbwesenheit(kontext, antrag.abwesenheit_id);
  if (urlaub === null) throw new KrankheitImUrlaubFehler('nicht_gefunden');
  if (urlaub.status !== 'genehmigt') throw new KrankheitImUrlaubFehler('nicht_genehmigt');
  if (!eingabe.auVorliegt) throw new KrankheitImUrlaubFehler('au_fehlt');

  let tage: MilliMenge;
  try {
    tage = rechneTage({
      von: eingabe.von, bis: eingabe.bis,
      ...(eingabe.arbeitstage === undefined ? {} : { arbeitstage: eingabe.arbeitstage }),
    });
  } catch (fehler) {
    if (fehler instanceof ZeitraumFehler) throw new KrankheitImUrlaubFehler('kein_datum');
    throw fehler;
  }
  const auBis = eingabe.auBis === undefined || eingabe.auBis === null || eingabe.auBis.trim() === ''
    ? null : eingabe.auBis.trim();
  if (auBis !== null && auBis < eingabe.von) throw new KrankheitImUrlaubFehler('au_bis_vor_von');
  if (eingabe.von > urlaub.bis || eingabe.bis < urlaub.von) {
    throw new KrankheitImUrlaubFehler('ausserhalb');
  }

  const gutschrift = gutschriftTage(urlaub, eingabe, eingabe.arbeitstage);
  if (gutschrift === 0n) throw new KrankheitImUrlaubFehler('keine_arbeitstage');

  const arten = await urlaubUnterbrechendeArten(kontext);
  const art = eingabe.abwesenheitsartId === undefined || eingabe.abwesenheitsartId === null
    || eingabe.abwesenheitsartId === ''
    ? (arten.length === 1 ? arten[0] : undefined)
    : arten.find((a) => a.id === eingabe.abwesenheitsartId);
  if (art === undefined) throw new KrankheitImUrlaubFehler('keine_art');
  if (art.bezahlt === null) throw new KrankheitImUrlaubFehler('art_ungeklaert');

  let krankheitId: string;
  try {
    const [neu] = await kontext.schreibe<{ id: string }>(
      `select app.krankheit_im_urlaub_erfassen(
                $1::uuid, $2::uuid, $3::date, $4::date, $5::date, $6, $7::numeric, $8::numeric) as id`,
      [urlaub.id, art.id, eingabe.von, eingabe.bis, auBis,
        (eingabe.bemerkung ?? '').trim() === '' ? null : (eingabe.bemerkung ?? '').trim(),
        mengeNachPostgres(tage), mengeNachPostgres(gutschrift)]);
    krankheitId = neu!.id;
  } catch (fehler) {
    throw ausDatenbank(fehler) ?? fehler;
  }
  return {
    krankheitId, urlaubId: urlaub.id, gutgeschrieben: mengeNachPostgres(gutschrift),
    jahr: Number(urlaub.von.slice(0, 4)),
  };
}
