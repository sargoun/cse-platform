import 'server-only';
import { cent, type Cent } from '../finanz/geld.js';
import { MONATSNAMEN, monatsgrenzen, monatVerschieben } from '../../../lib/datum/kalendertag.js';
import { wirtschaftsjahrZeitraum, type Wirtschaftsjahr } from './wirtschaftsjahr.js';

/**
 * Monatszahlen einer Gesellschaft — BWA-artig, je Wirtschaftsjahr (ACC-08,
 * REP-01, PR 65, D-484).
 *
 * **BWA-artig, keine Betriebswirtschaftliche Auswertung.** Diese rechnet
 * aus gebuchten Konten mit Abgrenzung, Personal, Abschreibung. Was hier
 * steht, kommt aus den BELEGEN: Erloese sind die festgeschriebenen
 * Ausgangsrechnungen nach Rechnungsdatum (netto, Stornos mit ihrem
 * Vorzeichen), Aufwand sind die freigegebenen und gebuchten
 * Eingangsrechnungen nach Rechnungsdatum (netto), Ergebnis ist die
 * Differenz. Das ist dieselbe Lesart wie die Gruppensicht (D-475) — die
 * Gruppensumme ist damit die Summe der Gesellschaften, nichts anderes —
 * und sie sagt, was ihr fehlt, statt es zu schaetzen.
 *
 * **Je Wirtschaftsjahr, nicht je Januar.** Die Monate laufen ab dem
 * Beginn aus `datev_konfiguration` (O-05, Platzhalter markiert); ein
 * abweichendes Wirtschaftsjahr zeigt Juli bis Juni.
 *
 * Fuer einen geschlossenen Monat stehen daneben die EINGEFRORENEN Zahlen
 * aus `periode` (geschrieben beim Schliessen, `periodenschluss.ts`). Weichen
 * sie von der lebenden Rechnung ab, sagt die Zeile es — das ist der Fall
 * „nach dem Schliessen kam noch ein Beleg mit altem Datum", und der gehoert
 * gesehen, nicht geglaettet.
 */
export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export interface MonatsZahl {
  /** `YYYY-MM` */
  readonly monat: string;
  readonly label: string;
  readonly von: string;
  readonly bis: string;
  readonly erloeseCent: Cent;
  readonly rechnungen: number;
  readonly aufwandCent: Cent;
  readonly eingangsrechnungen: number;
  readonly ergebnisCent: Cent;
  readonly periode: {
    readonly id: string;
    readonly status: 'offen' | 'vorlaeufig_geschlossen' | 'geschlossen';
    readonly geschlossenAm: string | null;
    readonly eingefroren: { readonly erloeseCent: Cent; readonly aufwandCent: Cent; readonly ergebnisCent: Cent } | null;
    readonly abweichung: boolean;
  } | null;
}

export interface Monatszahlen {
  readonly jahr: number;
  readonly von: string;
  readonly bis: string;
  readonly bezeichnung: string;
  readonly wirtschaftsjahr: Wirtschaftsjahr;
  readonly monate: readonly MonatsZahl[];
  readonly summe: { readonly erloeseCent: Cent; readonly aufwandCent: Cent; readonly ergebnisCent: Cent };
}

/** Die zwoelf Monate eines Wirtschaftsjahrs — reine Kalenderarithmetik. */
export function monateDesWirtschaftsjahrs(
  jahr: number, wj: Wirtschaftsjahr,
): readonly { monat: string; label: string; von: string; bis: string }[] {
  const { von } = wirtschaftsjahrZeitraum(jahr, wj);
  const erster = `${von.slice(0, 7)}-01`;
  const aus = [];
  for (let i = 0; i < 12; i += 1) {
    const tag = monatVerschieben(erster, i);
    const grenzen = monatsgrenzen(tag);
    const m = Number(tag.slice(5, 7));
    aus.push({ monat: tag.slice(0, 7), label: `${MONATSNAMEN[m - 1] ?? tag.slice(5, 7)} ${tag.slice(0, 4)}`,
      von: grenzen.von, bis: grenzen.bis });
  }
  return aus;
}

interface SummeRoh {
  readonly monat: string;
  readonly erloese: string;
  readonly rechnungen: number;
  readonly aufwand: string;
  readonly eingangsrechnungen: number;
}

interface PeriodeRoh {
  readonly id: string;
  readonly monat: string;
  readonly status: 'offen' | 'vorlaeufig_geschlossen' | 'geschlossen';
  readonly geschlossen_am: string | null;
  readonly umsatz_erloes_cent: string | null;
  readonly aufwand_cent: string | null;
  readonly ergebnis_cent: string | null;
}

export async function monatszahlen(db: Abfrage, jahr: number, wj: Wirtschaftsjahr): Promise<Monatszahlen> {
  const { von, bis, bezeichnung } = wirtschaftsjahrZeitraum(jahr, wj);
  const monate = monateDesWirtschaftsjahrs(jahr, wj);
  const summen = await db.abfrage<SummeRoh>(
    `with r as (
       select to_char(rechnungsdatum, 'YYYY-MM') as monat,
              sum(netto_gesamt_cent) as erloese, count(*) as rechnungen
         from rechnung
        where status = 'festgeschrieben' and rechnungsdatum between $1::date and $2::date
        group by 1),
     e as (
       select to_char(rechnungsdatum, 'YYYY-MM') as monat,
              sum(netto_cent) as aufwand, count(*) as eingangsrechnungen
         from eingangsrechnung
        where status in ('freigegeben', 'gebucht') and rechnungsdatum between $1::date and $2::date
        group by 1)
     select coalesce(r.monat, e.monat) as monat,
            coalesce(r.erloese, 0)::text as erloese, coalesce(r.rechnungen, 0)::int as rechnungen,
            coalesce(e.aufwand, 0)::text as aufwand, coalesce(e.eingangsrechnungen, 0)::int as eingangsrechnungen
       from r full outer join e on e.monat = r.monat`,
    [von, bis]);
  const perioden = await db.abfrage<PeriodeRoh>(
    `select id, to_char(beginn_am, 'YYYY-MM') as monat, status::text as status,
            to_char(geschlossen_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI') as geschlossen_am,
            umsatz_erloes_cent::text, aufwand_cent::text, ergebnis_cent::text
       from periode
      where beginn_am between $1::date and $2::date`,
    [von, bis]);
  const summeKarte = new Map(summen.map((s) => [s.monat, s]));
  const periodeKarte = new Map(perioden.map((p) => [p.monat, p]));

  let erloeseGesamt = 0n; let aufwandGesamt = 0n;
  const zeilen: MonatsZahl[] = monate.map((m) => {
    const s = summeKarte.get(m.monat);
    const erloese = BigInt(s?.erloese ?? '0');
    const aufwand = BigInt(s?.aufwand ?? '0');
    erloeseGesamt += erloese; aufwandGesamt += aufwand;
    const p = periodeKarte.get(m.monat);
    const eingefroren = p !== undefined && p.umsatz_erloes_cent !== null && p.aufwand_cent !== null && p.ergebnis_cent !== null
      ? { erloeseCent: cent(BigInt(p.umsatz_erloes_cent)), aufwandCent: cent(BigInt(p.aufwand_cent)),
          ergebnisCent: cent(BigInt(p.ergebnis_cent)) }
      : null;
    return {
      monat: m.monat, label: m.label, von: m.von, bis: m.bis,
      erloeseCent: cent(erloese), rechnungen: s?.rechnungen ?? 0,
      aufwandCent: cent(aufwand), eingangsrechnungen: s?.eingangsrechnungen ?? 0,
      ergebnisCent: cent(erloese - aufwand),
      periode: p === undefined ? null : {
        id: p.id, status: p.status, geschlossenAm: p.geschlossen_am, eingefroren,
        abweichung: eingefroren !== null
          && (eingefroren.erloeseCent !== erloese || eingefroren.aufwandCent !== aufwand),
      },
    };
  });
  return {
    jahr, von, bis, bezeichnung, wirtschaftsjahr: wj, monate: zeilen,
    summe: { erloeseCent: cent(erloeseGesamt), aufwandCent: cent(aufwandGesamt), ergebnisCent: cent(erloeseGesamt - aufwandGesamt) },
  };
}
