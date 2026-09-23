import type { LeseKontext } from '../../kontext/index.js';
import { cent, type Cent } from '../finanz/geld.js';
import { ANGEBOT_OFFEN, AUFTRAG_AKTIV, PROJEKT_IN_ARBEIT } from '../bericht/mengen.js';
import { OFFENE_ZUSTAENDE } from '../kern/aufgabe.js';

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
  /*
   * V-150 (DSH-01): aktive Projekte, „aktuell im Einsatz" und anstehende
   * Aufgaben fehlten. „Letzte Aktivität" fehlt weiter: `lead_aktivitaet`
   * kennt keinen Gruppenleseweg (0017), und ihn zu öffnen hiesse,
   * Gesprächsnotizen aller Gesellschaften in der Gruppe lesbar zu machen.
   */
  // TODO(client, O-910): Darf die Gruppenansicht CRM-Aktivitäten (Notizen,
  // Anrufe, Termine mit Inhalt) aller Gesellschaften lesen — mit welchem Recht?
  projekte: 'gruppe.bau.lesen',
  einsatz: 'gruppe.zeit.lesen',
  aufgaben: 'gruppe.aufgabe.lesen',
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
  /** Bauprojekte im Stand `in_arbeit` (`mengen.ts`). */
  readonly projekteInArbeit: number | null;
  /** Offene Zeiteinträge — wer gerade eingestempelt ist (DSH-05, `zeiteintrag_offen`). */
  readonly imEinsatz: number | null;
  /** Aufgaben in einem Stand aus `OFFENE_ZUSTAENDE` (`kern/aufgabe.ts`), nicht gelöscht. */
  readonly aufgabenOffen: number | null;
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
  readonly projekte_in_arbeit: number;
  readonly im_einsatz: number;
  readonly aufgaben_offen: number;
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
              where a.mandant_id = m.id and a.status::text = $3 and a.archiviert_am is null)::int
              as auftraege_aktiv,
            (select count(*) from angebot g
              where g.mandant_id = m.id and g.archiviert_am is null
                and g.status::text = any($1::text[]))::int as angebote_offen,
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
              as freigaben_offen,
            (select count(*) from projekt p
              where p.mandant_id = m.id and p.archiviert_am is null
                and p.status::text = $2)::int as projekte_in_arbeit,
            (select count(*) from zeiteintrag_offen z where z.mandant_id = m.id)::int
              as im_einsatz,
            (select count(*) from aufgabe t
              where t.mandant_id = m.id and t.geloescht_am is null
                and t.status::text = any($4::text[]))::int as aufgaben_offen
       from mandant m
      order by m.sortierung, m.slug`,
    /*
     * Die Mengen aus `mengen.ts` als PARAMETER — dieselben Werte, mit denen
     * die Listen dahinter filtern (`/gruppe/angebote?status=offen`,
     * `/gruppe/projekte?status=in_arbeit`, `/gruppe/aufgaben`). Zwei
     * Schreibweisen derselben Menge wären zwei Zahlen (DSH-04).
     */
    [ANGEBOT_OFFEN, PROJEKT_IN_ARBEIT, AUFTRAG_AKTIV, OFFENE_ZUSTAENDE],
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
      projekteInArbeit: darf(UEBERSICHT_RECHTE.projekte) ? z.projekte_in_arbeit : null,
      imEinsatz: darf(UEBERSICHT_RECHTE.einsatz) ? z.im_einsatz : null,
      aufgabenOffen: darf(UEBERSICHT_RECHTE.aufgaben) ? z.aufgaben_offen : null,
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
