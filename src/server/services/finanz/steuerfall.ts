import 'server-only';
import { cent } from './geld.js';
import {
  reverseChargeLage, type Bauleistungsart, type ReverseChargeLage, type StatusZeile,
} from './steuer/nachweis.js';
import {
  abzugLage, type AbzugLage, type Bescheinigung,
} from './estg48/abzug.js';
import { STICHTAG_QUELLE } from './estg48/grenzen.platzhalter.js';

/**
 * Der Steuerfall einer Rechnung: §13b UStG und §48 EStG, aus den Belegen
 * (FIN-09, FIN-10, PR 51).
 *
 * **Was hier NICHT passiert: raten.** Ob eine Leistung eine Bauleistung im
 * Sinne des §13b ist, steht nicht im Gewerk der Gesellschaft. Die REALTIME
 * Service GmbH baut auch um, ohne dass jede Position eine Bauleistung nach
 * §13b Abs. 2 Nr. 4 wäre, und die CSE Dienstleistungen reinigt für Kunden, die
 * selbst reinigen, und für solche, die es nicht tun. Ein aus dem Mandanten
 * abgeleiteter Reverse Charge wäre genau der Fehler, den
 * `01-ORDNERSTRUKTUR.md` §8.6 beim Namen nennt.
 *
 * Die Art der Leistung steht deshalb auf dem BELEG
 * (`rechnung.reverse_charge_grundlage`), gesetzt von einem Menschen. Dieser
 * Dienst beantwortet nur, was daraus folgt.
 */

export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export class SteuerfallFehler extends Error {
  constructor(nachricht: string, readonly grund: 'nicht_gefunden' | 'kein_entwurf') {
    super(nachricht);
    this.name = 'SteuerfallFehler';
  }
}

export interface Steuerfall {
  readonly stichtag: string;
  readonly reverseCharge: ReverseChargeLage;
  readonly bauabzug: AbzugLage;
  /**
   * Ob die POSITIONEN die Verlagerung tragen — also auf einer Steuergruppe
   * der Kategorie `AE` stehen.
   *
   * **Warum das eine eigene Frage ist.** Die Datenbank verlangt (§4.9,
   * `fin.rechnung_summen_stimmig`), dass jede Steuerzeile durch ihre
   * Positionen gedeckt ist. Eine Kopfzeile „Steuerschuldnerschaft des
   * Leistungsempfängers" über Positionen, die 19 % tragen, ist deshalb nicht
   * bloss unschön, sondern nicht speicherbar — und das ist richtig so: sie
   * wäre ein Beleg mit einem Hinweis und einer Umsatzsteuer, die einander
   * widersprechen.
   */
  readonly positionenPassen: boolean;
  /** Was zu tun ist, wenn sie es nicht tun. `null`, wenn alles stimmt. */
  readonly positionenHinweis: string | null;
}

interface KopfZeile {
  status: string;
  kunde_id: string;
  auftrag_id: string | null;
  leistung_von: string | null;
  leistung_bis: string | null;
  rechnungsdatum: string | null;
  grundlage: string | null;
  brutto_cent: string;
}

/**
 * Der Stichtag, an dem beide Regeln bewertet werden.
 *
 * **Eine Zeile, ein Parameter — und die offene Frage steht daneben.**
 * `STICHTAG_QUELLE` ist bis zur Antwort auf O-21 `leistung_bis`; die Antwort
 * ist ein Wert dort plus ein Test, kein Umbau. Fehlt `leistung_bis` (bei einer
 * Abschlagsrechnung ist das der Normalfall), fällt er auf das Rechnungsdatum
 * zurück — und das steht im Rückgabewert, damit niemand raten muss, wonach
 * entschieden wurde.
 */
function stichtagVon(k: KopfZeile, heute: string): string {
  if (STICHTAG_QUELLE === 'leistung_bis' && k.leistung_bis !== null) return k.leistung_bis;
  return k.rechnungsdatum ?? heute;
}

/** Liest den Steuerfall, ohne etwas zu schreiben. */
export async function ermittleSteuerfall(
  db: Abfrage, rechnungId: string,
): Promise<Steuerfall> {
  const [kopf] = await db.abfrage<KopfZeile>(
    `select r.status::text as status, r.kunde_id, r.auftrag_id,
            to_char(r.leistung_von, 'YYYY-MM-DD') as leistung_von,
            to_char(r.leistung_bis, 'YYYY-MM-DD') as leistung_bis,
            to_char(coalesce(r.rechnungsdatum, app.berlin_heute()), 'YYYY-MM-DD')
              as rechnungsdatum,
            r.reverse_charge_grundlage::text as grundlage,
            r.brutto_cent::text as brutto_cent
       from rechnung r where r.id = $1`,
    [rechnungId],
  );
  if (kopf === undefined) {
    throw new SteuerfallFehler(`Rechnung ${rechnungId} gibt es nicht.`, 'nicht_gefunden');
  }

  const [heuteZeile] = await db.abfrage<{ heute: string }>(
    `select to_char(app.berlin_heute(), 'YYYY-MM-DD') as heute`);
  const stichtag = stichtagVon(kopf, heuteZeile?.heute ?? '1970-01-01');
  const art = (kopf.grundlage ?? null) as Bauleistungsart | null;

  const status = await db.abfrage<StatusZeile>(
    `select leistungsart::text as "leistungsart", ist_bauleistender as "istBauleistender",
            to_char(gilt_ab, 'YYYY-MM-DD') as "giltAb",
            to_char(gilt_bis, 'YYYY-MM-DD') as "giltBis",
            grundlage
       from kunde_bauleistender_status
      where kunde_id = $1
      order by gilt_ab`,
    [kopf.kunde_id],
  );

  const bescheinigungen = await db.abfrage<Bescheinigung>(
    `select id::text as id, bescheinigung_nummer as "nummer",
            to_char(gueltig_von, 'YYYY-MM-DD') as "gueltigVon",
            to_char(gueltig_bis, 'YYYY-MM-DD') as "gueltigBis",
            to_char(widerrufen_am, 'YYYY-MM-DD') as "widerrufenAm",
            umfang::text as umfang, auftrag_id::text as "auftragId"
       from freistellungsbescheinigung
      where kunde_id = $1
      order by gueltig_von`,
    [kopf.kunde_id],
  );

  const [satz] = await db.abfrage<{ bp: number | null }>(
    `select (app.plattform_einstellung('finanzen.bauabzugsteuer_satz_bp') #>> '{}')::int as bp`);

  const reverseCharge = reverseChargeLage(status, stichtag, art);

  /**
   * Die Kategorien der Leistungspositionen. `AE` ist die EN-16931-Kategorie
   * für „VAT Reverse Charge"; sie hängt an der Steuergruppe, die ein Mensch
   * an der Position gewählt hat — nicht an einem Kopfschalter.
   */
  const kategorien = await db.abfrage<{ kategorie: string; n: string }>(
    `select p.kategorie::text as kategorie, count(*)::text as n
       from rechnungsposition p
      where p.rechnung_id = $1 and p.positionsart = 'leistung'
      group by p.kategorie`,
    [rechnungId],
  );
  const alleAe = kategorien.length > 0 && kategorien.every((k) => k.kategorie === 'AE');
  const keineAe = kategorien.every((k) => k.kategorie !== 'AE');

  const positionenPassen = reverseCharge.greift ? alleAe : keineAe;
  const positionenHinweis = positionenPassen ? null
    : reverseCharge.greift
      ? 'Die Steuerschuld geht nach §13b UStG über, aber die Positionen tragen '
        + `noch einen Steuersatz. Stellen Sie sie auf „${
          art === 'bau' ? 'ust_0_13b_bau' : 'ust_0_13b_reinigung'
        }" um — der Beleg weist dann 0,00 € Umsatzsteuer aus und nennt den Grund. `
        + 'Die Plattform schreibt das nicht selbst um: eine Position ist die '
        + 'Angabe eines Menschen, und ihr Steuersatz ist eine davon.'
      : 'Die Positionen tragen eine Steuergruppe mit Steuerschuldnerschaft des '
        + 'Leistungsempfängers, für diesen Kunden ist am Stichtag aber kein '
        + '§13b-Status hinterlegt. So weist der Beleg 0,00 € Umsatzsteuer aus, '
        + 'ohne dass die Verlagerung belegt wäre.';

  /**
   * **Die Grundlage der Bauabzugsteuer ist der BRUTTObetrag** — die
   * Gegenleistung im Sinne des §48 Abs. 1 EStG. Bei §13b ist das derselbe
   * Betrag wie netto, weil keine Umsatzsteuer ausgewiesen wird; das ist kein
   * Sonderfall, sondern dieselbe Regel auf eine Rechnung ohne Steuerausweis.
   */
  const bauabzug = abzugLage({
    gegenleistungCent: cent(BigInt(kopf.brutto_cent)),
    // §48 EStG knüpft an BAU an, nicht an Gebäudereinigung: Nr. 8 des §13b hat
    // in §48 keine Entsprechung.
    istBauleistung: art === 'bau',
    satzBp: satz?.bp ?? 1500,
    stichtag,
    leistungVon: kopf.leistung_von,
    leistungBis: kopf.leistung_bis,
    auftragId: kopf.auftrag_id,
    bescheinigungen,
  });

  return { stichtag, reverseCharge, bauabzug, positionenPassen, positionenHinweis };
}

/**
 * Schreibt den Steuerfall an den ENTWURF.
 *
 * Nach dem Festschreiben ist der Beleg unveränderlich (Invariante 4); ein
 * Steuerfall, der sich danach noch änderte, wäre eine stille Änderung an einer
 * Rechnung, die der Kunde schon hat — und zwar an der Stelle, an der Geld
 * hängt.
 */
export async function schreibeSteuerfall(
  db: Abfrage, rechnungId: string,
): Promise<Steuerfall> {
  const [kopf] = await db.abfrage<{ status: string }>(
    `select status::text as status from rechnung where id = $1`, [rechnungId]);
  if (kopf?.status !== 'entwurf') {
    throw new SteuerfallFehler(
      `Der Steuerfall wird an einem Entwurf geschrieben. Diese Rechnung ist `
      + `„${kopf?.status ?? 'unbekannt'}".`,
      'kein_entwurf',
    );
  }

  const fall = await ermittleSteuerfall(db, rechnungId);

  /**
   * **`reverse_charge` wird nur gesetzt, wenn die Positionen es tragen.**
   *
   * Der erste Entwurf setzte den Kopfschalter und liess die Steuersummen
   * stehen: der Beleg sagte „Steuerschuldnerschaft des Leistungsempfängers"
   * UND wies 19 % aus. Der zweite hängte die Summen in der Auswertung um und
   * prallte an `fin.rechnung_summen_stimmig` ab (§4.9) — zu Recht: eine
   * Steuerzeile, die keine Position deckt, ist eine Zahl, die sich aus dem
   * Beleg nicht nachrechnen lässt.
   *
   * Der Steuersatz einer Position ist die Angabe eines Menschen. Die Plattform
   * sagt, was folgt, und nennt den nächsten Schritt — sie schreibt ihn nicht
   * selbst um.
   */
  const greift = fall.reverseCharge.greift && fall.positionenPassen;

  await db.abfrage(
    `update rechnung
        set reverse_charge = $2,
            steuerhinweis = $3,
            bauabzugsteuer_pflichtig = $4,
            bauabzugsteuer_satz_bp = $5,
            bauabzugsteuer_grundlage_cent = $6::bigint,
            einbehalt_bauabzugsteuer_cent = $7::bigint,
            freistellungsbescheinigung_id = $8::uuid
      where id = $1`,
    [rechnungId,
     greift,
     greift ? fall.reverseCharge.hinweis : null,
     fall.bauabzug.einbehalten,
     fall.bauabzug.einbehalten ? fall.bauabzug.satzBp : null,
     fall.bauabzug.einbehalten ? fall.bauabzug.grundlageCent.toString() : null,
     fall.bauabzug.einbehaltCent.toString(),
     fall.bauabzug.bescheinigungId],
  );

  return fall;
}
