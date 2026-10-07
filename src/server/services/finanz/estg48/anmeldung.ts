import type { LeseKontext } from '../../../kontext/index.js';
import { istWerktag } from '../../../../lib/datum/werktage.js';
import { tagePlus } from '../../../../lib/datum/kalendertag.js';

/**
 * Die Anmeldung der Bauabzugsteuer nach § 48a EStG — was die Plattform
 * VORBEREITET (FIN-10, LEG-06, V-315, O-187, D-787, D-847).
 *
 * **Wer meldet an.** Behält die Gesellschaft bei der Zahlung an einen
 * Bauleistenden 15 % ein (keine gültige Freistellungsbescheinigung, § 48
 * EStG), muss sie den Betrag bis zum 10. Tag nach Ablauf des Monats, in dem
 * die Gegenleistung erbracht wurde, anmelden und abführen — je Leistendem,
 * bei dessen Finanzamt (§ 48a Abs. 1 EStG).
 *
 * // TODO(client, O-187): Voreinstellung — der Steuerberater gibt die Anmeldung ab (ELSTER ist nicht verbunden); die Plattform bereitet vor: den Einbehalt je Lieferant und Zahlungsmonat, anteilig nach den Zahlungen, und die Frist am 10. des Folgemonats (nach § 108 Abs. 3 AO auf den nächsten Werktag verschoben). D-787, D-847.
 *
 * **Der Monat ist der der ZAHLUNG, nicht der Rechnung.** Die Gegenleistung
 * ist erbracht, wenn gezahlt wird. Eine Eingangsrechnung, die in zwei Raten
 * bezahlt wird, gehört mit zwei Anteilen in zwei Monate: der Einbehalt wird
 * im Verhältnis der Zahlungen zum offenen Posten verteilt
 * (`einbehaltJeZahlung`). Was keiner Zahlung zugeordnet ist — die Rechnung ist
 * noch offen, oder ein Rest wurde ohne Geld ausgeglichen (Skonto, Differenz)
 * —, steht ausdrücklich als „noch keinem Monat zugeordnet" da und wird nicht
 * geraten.
 *
 * **Nichts verlässt die Plattform** (Invariante 7): sie rechnet und zeigt,
 * die Anmeldung geht über den Steuerberater.
 */

/** Die Frist der Anmeldung für einen Monat `JJJJ-MM` — Berliner Kalendertag. */
export function anmeldungsFrist(monat: string): string {
  const treffer = /^(\d{4})-(\d{2})$/u.exec(monat);
  if (treffer === null || Number(treffer[2]) < 1 || Number(treffer[2]) > 12) {
    throw new RangeError(`Kein Monat JJJJ-MM: ${monat}`);
  }
  const jahr = Number(treffer[1]);
  const m = Number(treffer[2]);
  const folge = m === 12 ? `${String(jahr + 1)}-01` : `${String(jahr)}-${String(m + 1).padStart(2, '0')}`;
  /*
   * § 108 Abs. 3 AO: fällt das Ende einer Frist auf einen Sonnabend, Sonntag
   * oder gesetzlichen Feiertag, endet sie am nächsten Werktag. Feiertage:
   * Berlin, wie überall in der Plattform (O-167).
   */
  let tag = `${folge}-10`;
  while (!istWerktag(tag)) tag = tagePlus(tag, 1);
  return tag;
}

/** Eine Zahlung an den Lieferanten auf den Posten der Rechnung. */
export interface Zahlungsanteil {
  /** Berliner Kalendertag der Zahlung `JJJJ-MM-TT`. */
  readonly tag: string;
  readonly betragCent: bigint;
}

/**
 * Wie viel des Einbehalts auf welche Zahlung entfällt — in Cent, ohne
 * Rundungsdrift.
 *
 * `postenCent` ist, was die Gesellschaft dem Lieferanten schuldet (brutto
 * minus Einbehalt). Gerechnet wird KUMULIERT: nach jeder Zahlung ist der
 * bis dahin erbrachte Einbehalt `einbehalt × gezahlt / posten`, kaufmännisch
 * auf den Cent gerundet; der Anteil einer Zahlung ist die Differenz zum
 * Stand davor. So ergeben die Anteile zusammen genau den Einbehalt, sobald
 * der Posten bezahlt ist — keine Zahlung trägt einen Rest, den eine andere
 * schon hatte. Was über den Posten hinaus gezahlt wird, trägt nichts.
 */
export function einbehaltJeZahlung(
  einbehaltCent: bigint, postenCent: bigint, zahlungen: readonly Zahlungsanteil[],
): readonly { readonly tag: string; readonly anteilCent: bigint }[] {
  if (einbehaltCent <= 0n || postenCent <= 0n) return zahlungen.map((z) => ({ tag: z.tag, anteilCent: 0n }));
  const sortiert = [...zahlungen].sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  let gezahlt = 0n;
  let bisher = 0n;
  return sortiert.map((z) => {
    gezahlt += z.betragCent > 0n ? z.betragCent : 0n;
    const gedeckt = gezahlt >= postenCent ? postenCent : gezahlt;
    // Kaufmännisch gerundet: (2·a·b + c) / (2·c), alles ganzzahlig (Invariante 1).
    const stand = (2n * einbehaltCent * gedeckt + postenCent) / (2n * postenCent);
    const anteil = stand - bisher;
    bisher = stand;
    return { tag: z.tag, anteilCent: anteil };
  });
}

/** Eine Eingangsrechnung mit Einbehalt und ihren Zahlungen. */
export interface EinbehaltBeleg {
  readonly rechnungId: string;
  readonly beleg: string;
  readonly lieferantId: string;
  readonly lieferant: string;
  readonly steuernummer: string | null;
  readonly einbehaltCent: bigint;
  /** `null`: der Posten ist (noch) nicht eröffnet oder nicht sichtbar. */
  readonly postenCent: bigint | null;
  readonly zahlungen: readonly Zahlungsanteil[];
}

export interface MonatsZeile {
  /** `JJJJ-MM` — der Monat der Zahlungen. */
  readonly monat: string;
  readonly lieferantId: string;
  readonly lieferant: string;
  readonly steuernummer: string | null;
  readonly einbehaltCent: bigint;
  /** Wie viele Rechnungen zu dieser Summe beitragen. */
  readonly rechnungen: number;
  readonly frist: string;
}

export interface OffenerEinbehalt {
  readonly rechnungId: string;
  readonly beleg: string;
  readonly lieferant: string;
  /** Der Teil des Einbehalts, der noch keinem Zahlungsmonat zugeordnet ist. */
  readonly offenCent: bigint;
}

/**
 * Die Monatssummen je Lieferant — und was noch keinem Monat zugeordnet ist.
 * Rein: die Eingabe sind die Belege mit ihren Zahlungen.
 */
export function monatsEinbehalte(belege: readonly EinbehaltBeleg[]): {
  readonly zeilen: readonly MonatsZeile[];
  readonly offen: readonly OffenerEinbehalt[];
} {
  const summen = new Map<string, { zeile: Omit<MonatsZeile, 'einbehaltCent' | 'rechnungen'>;
    einbehalt: bigint; rechnungen: Set<string> }>();
  const offen: OffenerEinbehalt[] = [];
  for (const b of belege) {
    const anteile = b.postenCent === null ? [] : einbehaltJeZahlung(b.einbehaltCent, b.postenCent, b.zahlungen);
    let zugeordnet = 0n;
    for (const a of anteile) {
      if (a.anteilCent === 0n) continue;
      zugeordnet += a.anteilCent;
      const monat = a.tag.slice(0, 7);
      const schluessel = `${monat}|${b.lieferantId}`;
      const da = summen.get(schluessel) ?? {
        zeile: { monat, lieferantId: b.lieferantId, lieferant: b.lieferant,
          steuernummer: b.steuernummer, frist: anmeldungsFrist(monat) },
        einbehalt: 0n, rechnungen: new Set<string>(),
      };
      da.einbehalt += a.anteilCent;
      da.rechnungen.add(b.rechnungId);
      summen.set(schluessel, da);
    }
    if (zugeordnet < b.einbehaltCent) {
      offen.push({ rechnungId: b.rechnungId, beleg: b.beleg, lieferant: b.lieferant,
        offenCent: b.einbehaltCent - zugeordnet });
    }
  }
  const zeilen = [...summen.values()].map((s) => ({
    ...s.zeile, einbehaltCent: s.einbehalt, rechnungen: s.rechnungen.size,
  })).sort((a, b) => (a.monat !== b.monat ? (a.monat < b.monat ? 1 : -1)
    : a.lieferant.localeCompare(b.lieferant, 'de')));
  return { zeilen, offen };
}

export interface BauabzugUebersicht {
  readonly heute: string;
  readonly zeilen: readonly MonatsZeile[];
  readonly offen: readonly OffenerEinbehalt[];
}

interface BelegRoh {
  rechnungId: string;
  beleg: string;
  lieferantId: string;
  lieferant: string;
  steuernummer: string | null;
  einbehalt: string;
  posten: string | null;
  zahlungen: readonly { tag: string; betrag: string }[] | null;
}

/**
 * Die Eingangsrechnungen mit Einbehalt und ihre Zahlungen — unter der RLS der
 * Sitzung. Ohne `zahlung.lesen` bleiben Posten und Zahlungen unsichtbar; die
 * Seite sagt das, statt „nichts einbehalten" zu behaupten.
 */
export async function ladeBauabzugUebersicht(kontext: LeseKontext): Promise<BauabzugUebersicht> {
  const [tag] = await kontext.abfrage<{ heute: string }>(
    `select to_char(app.berlin_heute(), 'YYYY-MM-DD') as heute`);
  const roh = await kontext.abfrage<BelegRoh>(
    `select er.id::text as "rechnungId",
            coalesce(er.interne_belegnummer, er.rechnungsnummer_lieferant, '—') as beleg,
            er.lieferant_id::text as "lieferantId", l.name as lieferant, l.steuernummer,
            er.bauabzugsteuer_cent::text as einbehalt,
            op.betrag_cent::text as posten,
            (select json_agg(json_build_object(
                      'tag', to_char(z.zahlungsdatum, 'YYYY-MM-DD'),
                      'betrag', zz.betrag_cent::text) order by z.zahlungsdatum, zz.erstellt_am)
               from zahlung_zuordnung zz
               join zahlung z on z.mandant_id = zz.mandant_id and z.id = zz.zahlung_id
              where zz.mandant_id = op.mandant_id and zz.offener_posten_id = op.id
                and zz.art = 'zahlung' and z.richtung = 'ausgang'
                and z.storniert_am is null) as zahlungen
       from eingangsrechnung er
       join lieferant l on l.mandant_id = er.mandant_id and l.id = er.lieferant_id
       left join offener_posten op
         on op.mandant_id = er.mandant_id and op.eingangsrechnung_id = er.id
        and op.art = 'kreditor'
      where er.mandant_id = app.aktiver_mandant()
        and er.bauabzugsteuer_pflichtig and er.bauabzugsteuer_cent > 0
        and er.status in ('freigegeben', 'gebucht')
      order by er.lieferant_id, er.id`);
  const belege: EinbehaltBeleg[] = roh.map((r) => ({
    rechnungId: r.rechnungId, beleg: r.beleg, lieferantId: r.lieferantId,
    lieferant: r.lieferant, steuernummer: r.steuernummer,
    einbehaltCent: BigInt(r.einbehalt),
    postenCent: r.posten === null ? null : BigInt(r.posten),
    zahlungen: (r.zahlungen ?? []).map((z) => ({ tag: z.tag, betragCent: BigInt(z.betrag) })),
  }));
  return { heute: tag?.heute ?? '', ...monatsEinbehalte(belege) };
}
