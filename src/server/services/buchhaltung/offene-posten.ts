import 'server-only';
import { cent, type Cent } from '../finanz/geld.js';

/**
 * Offene Posten — Debitoren und Kreditoren einer Gesellschaft, mit
 * Altersstruktur und Abstimmung (ACC-07, FIN-15, PR 65, D-484).
 *
 * **Das Alter eines Postens ist eine Differenz von Kalendertagen.**
 * `stichtag - faellig_am` in Postgres, beides `date`, beides der Berliner
 * Kalender (K-11): kein Zeitpunkt, keine Zone, keine Stunde, die an einem
 * Umstellungswochenende fehlt oder doppelt ist. Ein Posten, der am 28. Maerz
 * faellig war, ist am 27. April 30 Tage alt — ob die Uhr dazwischen
 * umgestellt wurde oder nicht (der Test haelt genau das fest).
 *
 * Die fuenf Klassen sind die ueblichen der Debitorenbuchhaltung und die
 * des PR-Plans: nicht faellig, 0–30, 31–60, 61–90, ueber 90 Tage. Ihre
 * Summe IST der offene Betrag — kein Posten faellt zwischen zwei Klassen.
 *
 * **Die Abstimmung ist ein zweiter Weg, kein Echo.** `offen_cent` ist eine
 * erzeugte Spalte (`betrag - bezahlt`), und `bezahlt_cent` schreiben die
 * Ausloeser aus den Zuordnungen. Abgestimmt wird deshalb gegen die QUELLEN:
 * die festgeschriebenen Rechnungen (`zahlbetrag_cent`) minus die nicht
 * stornierten Zuordnungen. Weichen die beiden Wege ab, steht die Zahl auf
 * dem Bildschirm mit der Abweichung — nicht ein gruenes Haekchen, das nichts
 * geprueft hat.
 */
export const KLASSEN = ['nicht_faellig', 'bis30', 'bis60', 'bis90', 'ueber90'] as const;
export type Klasse = (typeof KLASSEN)[number];

export const KLASSE_LABEL: Readonly<Record<Klasse, string>> = {
  nicht_faellig: 'nicht fällig', bis30: '0–30 Tage', bis60: '31–60 Tage',
  bis90: '61–90 Tage', ueber90: 'über 90 Tage',
};

/** Reine Funktion — dieselbe Einteilung wie im SQL, fuer Tests und Anzeige. */
export function klasseFuer(tage: number): Klasse {
  if (tage < 0) return 'nicht_faellig';
  if (tage <= 30) return 'bis30';
  if (tage <= 60) return 'bis60';
  if (tage <= 90) return 'bis90';
  return 'ueber90';
}

export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export type PostenArt = 'debitor' | 'kreditor';

export interface Klassenwerte {
  readonly nicht_faellig: Cent;
  readonly bis30: Cent;
  readonly bis60: Cent;
  readonly bis90: Cent;
  readonly ueber90: Cent;
  readonly gesamt: Cent;
  readonly ueberfaellig: Cent;
  readonly anzahl: number;
}

export interface Altersstruktur {
  readonly stichtag: string;
  readonly debitor: Klassenwerte;
  readonly kreditor: Klassenwerte;
  /** Guthaben stehen daneben, nicht dazwischen: sie sind keine Forderung. */
  readonly guthaben: { readonly debitorCent: Cent; readonly kreditorCent: Cent };
}

const LEER: Klassenwerte = {
  nicht_faellig: cent(0n), bis30: cent(0n), bis60: cent(0n), bis90: cent(0n), ueber90: cent(0n),
  gesamt: cent(0n), ueberfaellig: cent(0n), anzahl: 0,
};

interface KlasseRoh {
  readonly art: string;
  readonly klasse: Klasse;
  readonly summe: string;
  readonly anzahl: number;
}

/** Die Klasse als SQL — dieselben Grenzen wie `klasseFuer`. */
const KLASSE_SQL = `case
  when ($1::date - op.faellig_am) < 0 then 'nicht_faellig'
  when ($1::date - op.faellig_am) <= 30 then 'bis30'
  when ($1::date - op.faellig_am) <= 60 then 'bis60'
  when ($1::date - op.faellig_am) <= 90 then 'bis90'
  else 'ueber90' end`;

export async function altersstruktur(db: Abfrage, stichtag: string): Promise<Altersstruktur> {
  const roh = await db.abfrage<KlasseRoh>(
    `select op.art::text as art, ${KLASSE_SQL} as klasse,
            sum(op.offen_cent)::text as summe, count(*)::int as anzahl
       from offener_posten op
      where op.ausgeglichen_am is null and op.offen_cent > 0
        and op.art in ('debitor', 'kreditor')
      group by op.art, 2`,
    [stichtag]);
  const [guthaben] = await db.abfrage<{ debitor: string; kreditor: string }>(
    `select coalesce(sum(op.offen_cent) filter (where op.art = 'debitor_guthaben'), 0)::text as debitor,
            coalesce(sum(op.offen_cent) filter (where op.art = 'kreditor_guthaben'), 0)::text as kreditor
       from offener_posten op where op.ausgeglichen_am is null`);

  const baue = (art: PostenArt): Klassenwerte => {
    const werte: Record<Klasse, bigint> = { nicht_faellig: 0n, bis30: 0n, bis60: 0n, bis90: 0n, ueber90: 0n };
    let anzahl = 0;
    for (const z of roh) {
      if (z.art !== art) continue;
      werte[z.klasse] += BigInt(z.summe);
      anzahl += z.anzahl;
    }
    const gesamt = KLASSEN.reduce((s, k) => s + werte[k], 0n);
    return {
      nicht_faellig: cent(werte.nicht_faellig), bis30: cent(werte.bis30), bis60: cent(werte.bis60),
      bis90: cent(werte.bis90), ueber90: cent(werte.ueber90),
      gesamt: cent(gesamt), ueberfaellig: cent(gesamt - werte.nicht_faellig), anzahl,
    };
  };
  return {
    stichtag,
    debitor: roh.some((z) => z.art === 'debitor') ? baue('debitor') : LEER,
    kreditor: roh.some((z) => z.art === 'kreditor') ? baue('kreditor') : LEER,
    guthaben: {
      debitorCent: cent(BigInt(guthaben?.debitor ?? '0')),
      kreditorCent: cent(BigInt(guthaben?.kreditor ?? '0')),
    },
  };
}

export interface PostenZeile {
  readonly id: string;
  readonly art: PostenArt;
  readonly gegenpartei: string | null;
  readonly belegnummer: string | null;
  readonly faelligAm: string;
  readonly tage: number;
  readonly klasse: Klasse;
  readonly betragCent: Cent;
  readonly bezahltCent: Cent;
  readonly offenCent: Cent;
  readonly mahnstufe: number;
  /** Relativ zur Bereichswurzel: der Beleg, aus dem die Zahl kommt (DSH-04). */
  readonly zielPfad: string | null;
}

interface PostenRoh {
  readonly id: string;
  readonly art: string;
  readonly gegenpartei: string | null;
  readonly belegnummer: string | null;
  readonly faellig_am: string;
  readonly tage: number;
  readonly betrag_cent: string;
  readonly bezahlt_cent: string;
  readonly offen_cent: string;
  readonly mahnstufe: number;
  readonly rechnung_id: string | null;
  readonly eingangsrechnung_id: string | null;
}

export async function postenListe(
  db: Abfrage, art: PostenArt, stichtag: string, grenze = 500,
): Promise<readonly PostenZeile[]> {
  const roh = await db.abfrage<PostenRoh>(
    `select op.id, op.art::text as art,
            coalesce(k.name, l.name) as gegenpartei,
            coalesce(r.nummer, er.interne_belegnummer, er.rechnungsnummer_lieferant) as belegnummer,
            op.faellig_am::text as faellig_am, ($1::date - op.faellig_am)::int as tage,
            op.betrag_cent::text as betrag_cent, op.bezahlt_cent::text as bezahlt_cent,
            op.offen_cent::text as offen_cent, op.letzte_mahnstufe as mahnstufe,
            op.rechnung_id, op.eingangsrechnung_id
       from offener_posten op
       left join kunde k on k.id = op.kunde_id and k.mandant_id = op.mandant_id
       left join lieferant l on l.id = op.lieferant_id and l.mandant_id = op.mandant_id
       left join rechnung r on r.id = op.rechnung_id and r.mandant_id = op.mandant_id
       left join eingangsrechnung er on er.id = op.eingangsrechnung_id and er.mandant_id = op.mandant_id
      where op.ausgeglichen_am is null and op.offen_cent > 0 and op.art = $2::offener_posten_art
      order by op.faellig_am, op.id
      limit $3`,
    [stichtag, art, grenze]);
  return roh.map((z) => ({
    id: z.id, art: z.art as PostenArt, gegenpartei: z.gegenpartei, belegnummer: z.belegnummer,
    faelligAm: z.faellig_am, tage: z.tage, klasse: klasseFuer(z.tage),
    betragCent: cent(BigInt(z.betrag_cent)), bezahltCent: cent(BigInt(z.bezahlt_cent)),
    offenCent: cent(BigInt(z.offen_cent)), mahnstufe: z.mahnstufe,
    zielPfad: z.rechnung_id !== null ? `finanzen/rechnungen/${z.rechnung_id}`
      : z.eingangsrechnung_id !== null ? `finanzen/eingangsrechnungen/${z.eingangsrechnung_id}` : null,
  }));
}

export interface Abstimmung {
  readonly art: PostenArt;
  /** Aus der Postentabelle: Summe der offenen Betraege. */
  readonly ausPostenCent: Cent;
  /** Der zweite Weg: Forderungen aus den Belegen minus nicht stornierte Zuordnungen. */
  readonly ausBelegenCent: Cent;
  readonly stimmt: boolean;
  readonly quelle: string;
}

/**
 * Debitoren: `rechnung.zahlbetrag_cent` jeder festgeschriebenen Rechnung mit
 * Forderung (der Ausloeser `fin.op_eroeffnen` eroeffnet genau daraus den
 * Posten) minus die Zuordnungen, die tilgen (alles ausser `ueberzahlung`,
 * ohne stornierte Zahlungen). Kreditoren: der eroeffnete Betrag des Postens
 * minus dieselben Zuordnungen — die Eingangsrechnung fuehrt Einbehalte
 * (Bauabzugsteuer), die im Posten schon verrechnet sind.
 */
export async function abstimmungOffenePosten(db: Abfrage): Promise<readonly Abstimmung[]> {
  const [z] = await db.abfrage<{
    deb_posten: string; deb_belege: string; deb_zuordnungen: string;
    kred_posten: string; kred_betrag: string; kred_zuordnungen: string;
  }>(
    `select
       (select coalesce(sum(op.offen_cent), 0) from offener_posten op where op.art = 'debitor')::text as deb_posten,
       (select coalesce(sum(r.zahlbetrag_cent), 0) from rechnung r
         where r.status = 'festgeschrieben' and r.zahlbetrag_cent > 0)::text as deb_belege,
       (select coalesce(sum(zz.betrag_cent), 0) from zahlung_zuordnung zz
          join offener_posten op on op.id = zz.offener_posten_id and op.mandant_id = zz.mandant_id
          left join zahlung z on z.id = zz.zahlung_id and z.mandant_id = zz.mandant_id
         where op.art = 'debitor' and zz.art <> 'ueberzahlung'
           and (z.id is null or z.storniert_am is null))::text as deb_zuordnungen,
       (select coalesce(sum(op.offen_cent), 0) from offener_posten op where op.art = 'kreditor')::text as kred_posten,
       (select coalesce(sum(op.betrag_cent), 0) from offener_posten op where op.art = 'kreditor')::text as kred_betrag,
       (select coalesce(sum(zz.betrag_cent), 0) from zahlung_zuordnung zz
          join offener_posten op on op.id = zz.offener_posten_id and op.mandant_id = zz.mandant_id
          left join zahlung z on z.id = zz.zahlung_id and z.mandant_id = zz.mandant_id
         where op.art = 'kreditor' and zz.art <> 'ueberzahlung'
           and (z.id is null or z.storniert_am is null))::text as kred_zuordnungen`);
  if (z === undefined) return [];
  const deb = BigInt(z.deb_belege) - BigInt(z.deb_zuordnungen);
  const kred = BigInt(z.kred_betrag) - BigInt(z.kred_zuordnungen);
  return [
    { art: 'debitor', ausPostenCent: cent(BigInt(z.deb_posten)), ausBelegenCent: cent(deb),
      stimmt: BigInt(z.deb_posten) === deb,
      quelle: 'festgeschriebene Rechnungen (Zahlbetrag) − nicht stornierte Zuordnungen' },
    { art: 'kreditor', ausPostenCent: cent(BigInt(z.kred_posten)), ausBelegenCent: cent(kred),
      stimmt: BigInt(z.kred_posten) === kred,
      quelle: 'eröffnete Verbindlichkeiten − nicht stornierte Zuordnungen' },
  ];
}
