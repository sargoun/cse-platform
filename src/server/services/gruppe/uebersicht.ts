import type { LeseKontext } from '../../kontext/index.js';
import { cent, type Cent } from '../finanz/geld.js';

/**
 * Die Gruppenuebersicht: eine Kennzahlenzeile je Gesellschaft (TEN-05, DSH-01).
 *
 * **Eine Zelle ist eine Zahl oder `null` — nie eine Null, die „kein Recht"
 * heisst.** Im Gruppen-Scope filtert die Policy je Zeile mit dem Recht des
 * Bereichs (`app.rechte_mandanten('gruppe.auftrag.lesen')`, 0004 ff.). Wer
 * das Recht in einer Gesellschaft nicht haelt, bekommt von der Zaehlung dort
 * eine 0 zurueck — und die saehe aus wie „keine Auftraege". Deshalb wird das
 * Recht VOR der Zaehlung je Bereich gefragt, und die Zelle bleibt `null`, wo
 * es fehlt. Die Seite zeigt dafuer einen Strich, nicht eine Zahl.
 *
 * **Geld als Summe in der Datenbank, in Cent, als Text uebertragen.** Ein
 * `bigint`-Summenwert verlaesst postgres.js als `string`; `Number` verloere ab
 * 2^53 Cent still Stellen (Invariante 1).
 */
export const UEBERSICHT_RECHTE = {
  auftraege: 'gruppe.auftrag.lesen',
  angebote: 'gruppe.angebot.lesen',
  leads: 'gruppe.crm.lesen',
  objekte: 'gruppe.objekt.lesen',
  beschaeftigte: 'gruppe.personal.lesen',
  fakturiert: 'gruppe.finanzen.lesen',
  forderungen: 'gruppe.zahlung.lesen',
  freigaben: 'gruppe.freigabe.lesen',
} as const;

export interface BereichKennzahlen {
  readonly mandantId: string;
  readonly slug: string;
  readonly name: string;
  readonly auftraegeAktiv: number | null;
  readonly angeboteOffen: number | null;
  readonly leadsNeu: number | null;
  readonly objekte: number | null;
  readonly beschaeftigte: number | null;
  /** Netto, festgeschriebene Rechnungen mit Rechnungsdatum im laufenden Jahr. */
  readonly fakturiertJahrCent: Cent | null;
  /** Offene Debitorenposten — was Kunden schulden. */
  readonly forderungenOffenCent: Cent | null;
  readonly freigabenOffen: number | null;
}

export interface GruppenSumme {
  readonly auftraegeAktiv: number;
  readonly fakturiertJahrCent: Cent;
  readonly forderungenOffenCent: Cent;
  readonly freigabenOffen: number;
  /** Ueber wie viele der Bereiche die Summe geht — je Kennzahl. */
  readonly bereiche: Readonly<Record<'auftraege' | 'fakturiert' | 'forderungen' | 'freigaben', number>>;
}

export interface GruppenUebersicht {
  readonly jahr: number;
  readonly bereiche: readonly BereichKennzahlen[];
  readonly summe: GruppenSumme;
}

interface RechtZeile { readonly mandant_id: string; readonly recht: string; readonly ok: boolean }

/**
 * Welche Rechte diese Sitzung in welchem Bereich haelt — in EINER Abfrage.
 * `app.hat_recht` mit dem Mandanten der Zeile (K-03), nie global.
 */
export async function rechteJeBereich(
  kontext: LeseKontext, rechte: readonly string[],
): Promise<ReadonlyMap<string, ReadonlySet<string>>> {
  const zeilen = await kontext.abfrage<RechtZeile>(
    `select m.id as mandant_id, r.recht, app.hat_recht(r.recht, m.id) as ok
       from mandant m cross join unnest($1::text[]) as r(recht)`,
    [rechte],
  );
  const karte = new Map<string, Set<string>>();
  for (const z of zeilen) {
    const menge = karte.get(z.mandant_id) ?? new Set<string>();
    if (z.ok) menge.add(z.recht);
    karte.set(z.mandant_id, menge);
  }
  return karte;
}

interface Roh {
  readonly mandant_id: string;
  readonly slug: string;
  readonly name: string;
  readonly auftraege_aktiv: number;
  readonly angebote_offen: number;
  readonly leads_neu: number;
  readonly objekte: number;
  readonly beschaeftigte: number;
  readonly fakturiert_jahr_cent: string;
  readonly forderungen_offen_cent: string;
  readonly freigaben_offen: number;
}

export async function gruppenUebersicht(kontext: LeseKontext): Promise<GruppenUebersicht> {
  const rechte = await rechteJeBereich(kontext, Object.values(UEBERSICHT_RECHTE));
  // Das Jahr aus der Datenbankuhr, nicht aus `new Date()`: Uhr ist der Server
  // (Invariante 5), und ein Test kann sie stellen.
  const [uhr] = await kontext.abfrage<{ jahr: number }>(
    `select extract(year from (now() at time zone 'Europe/Berlin'))::int as jahr`);
  if (uhr === undefined) throw new Error('Die Datenbank hat kein Jahr geliefert.');
  const roh = await kontext.abfrage<Roh>(
    `select m.id as mandant_id, m.slug, m.name,
            (select count(*) from auftrag a
              where a.mandant_id = m.id and a.status = 'aktiv' and a.archiviert_am is null)::int
              as auftraege_aktiv,
            (select count(*) from angebot g
              where g.mandant_id = m.id and g.archiviert_am is null
                and g.status in ('entwurf', 'in_pruefung', 'versendet'))::int as angebote_offen,
            (select count(*) from lead l
              where l.mandant_id = m.id and l.status = 'neu' and l.archiviert_am is null)::int
              as leads_neu,
            (select count(*) from objekt o
              where o.mandant_id = m.id and o.archiviert_am is null)::int as objekte,
            (select count(*) from anstellung an
              where an.mandant_id = m.id and an.geloescht_am is null
                and (an.austritt is null or an.austritt >= current_date))::int as beschaeftigte,
            (select coalesce(sum(r.netto_gesamt_cent), 0) from rechnung r
              where r.mandant_id = m.id and r.status = 'festgeschrieben'
                and extract(year from r.rechnungsdatum)
                    = extract(year from (now() at time zone 'Europe/Berlin')))::text
              as fakturiert_jahr_cent,
            (select coalesce(sum(op.offen_cent), 0) from offener_posten op
              where op.mandant_id = m.id and op.art = 'debitor' and op.ausgeglichen_am is null)::text
              as forderungen_offen_cent,
            (select count(*) from freigabe f
              where f.mandant_id = m.id and f.status = 'offen' and f.vorgang_typ is not null)::int
              as freigaben_offen
       from mandant m
      order by m.sortierung, m.slug`,
  );

  const bereiche: BereichKennzahlen[] = roh.map((z) => {
    const darf = (recht: string): boolean => rechte.get(z.mandant_id)?.has(recht) === true;
    return {
      mandantId: z.mandant_id,
      slug: z.slug,
      name: z.name,
      auftraegeAktiv: darf(UEBERSICHT_RECHTE.auftraege) ? z.auftraege_aktiv : null,
      angeboteOffen: darf(UEBERSICHT_RECHTE.angebote) ? z.angebote_offen : null,
      leadsNeu: darf(UEBERSICHT_RECHTE.leads) ? z.leads_neu : null,
      objekte: darf(UEBERSICHT_RECHTE.objekte) ? z.objekte : null,
      beschaeftigte: darf(UEBERSICHT_RECHTE.beschaeftigte) ? z.beschaeftigte : null,
      fakturiertJahrCent: darf(UEBERSICHT_RECHTE.fakturiert)
        ? cent(BigInt(z.fakturiert_jahr_cent)) : null,
      forderungenOffenCent: darf(UEBERSICHT_RECHTE.forderungen)
        ? cent(BigInt(z.forderungen_offen_cent)) : null,
      freigabenOffen: darf(UEBERSICHT_RECHTE.freigaben) ? z.freigaben_offen : null,
    };
  });

  const zaehle = (werte: readonly (number | null)[]): [number, number] => {
    let anzahl = 0; let n = 0;
    for (const w of werte) if (w !== null) { anzahl += w; n += 1; }
    return [anzahl, n];
  };
  const summiere = (werte: readonly (Cent | null)[]): [Cent, number] => {
    let summe = 0n; let n = 0;
    for (const w of werte) if (w !== null) { summe += w; n += 1; }
    return [cent(summe), n];
  };
  const [auftraege, nAuftraege] = zaehle(bereiche.map((b) => b.auftraegeAktiv));
  const [fakturiert, nFakturiert] = summiere(bereiche.map((b) => b.fakturiertJahrCent));
  const [forderungen, nForderungen] = summiere(bereiche.map((b) => b.forderungenOffenCent));
  const [freigaben, nFreigaben] = zaehle(bereiche.map((b) => b.freigabenOffen));

  return {
    jahr: uhr.jahr,
    bereiche,
    summe: {
      auftraegeAktiv: auftraege,
      fakturiertJahrCent: fakturiert,
      forderungenOffenCent: forderungen,
      freigabenOffen: freigaben,
      bereiche: {
        auftraege: nAuftraege, fakturiert: nFakturiert,
        forderungen: nForderungen, freigaben: nFreigaben,
      },
    },
  };
}
