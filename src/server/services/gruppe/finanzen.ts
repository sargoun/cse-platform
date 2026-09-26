import type { LeseKontext } from '../../kontext/index.js';
import { cent, type Cent } from '../finanz/geld.js';
import { MONATSNAMEN } from '../../../lib/datum/kalendertag.js';
import { rechteJeBereich } from './uebersicht.js';
import { ausgabenAufwand, jeGesellschaft } from '../buchhaltung/aufwand.js';

/**
 * Finanzen ueber die Gruppe (FIN-17, REP-01): je Gesellschaft und je Monat,
 * was fakturiert und was eingegangen ist — netto, in Cent, aus der Datenbank.
 *
 * **Das ist keine Gewinn-und-Verlust-Rechnung, und die Seite sagt das.**
 * „Saldo" ist die Differenz aus festgeschriebenen Ausgangsrechnungen und dem
 * Aufwand: freigegebene oder gebuchte Eingangsrechnungen UND Betriebsausgaben
 * (V-215, D-706 — vorher fehlten die Ausgaben, und der Saldo war um jede
 * gebuchte Tankquittung zu hoch). Personal, Abschreibung,
 * Steuern, Abgrenzung fehlen — den Jahresabschluss macht der Steuerberater
 * (CLAUDE.md, „Out of scope"). Eine Zahl, die „Gewinn" hiesse, waere hier eine
 * erfundene Geschaeftsregel.
 *
 * **Drei Rechte, drei Spalten.** `rechnung` steht unter `gruppe.finanzen.lesen`,
 * `eingangsrechnung` und `ausgabe` unter `gruppe.eingang.lesen` (die Ausgaben
 * über `app.ausgaben_aufwand`, 0446, damit die Erstattungen mitzählen, die die
 * Gruppendecke als Zeilen ausblendet), `offener_posten` unter
 * `gruppe.zahlung.lesen` (Policies `t_gruppe`). Fehlt eines davon in einem
 * Bereich, bleibt die Spalte dort `null` — der Saldo auch, denn eine Differenz
 * aus einer Zahl und einem Strich ist keine Zahl.
 */
export const FINANZEN_RECHTE = {
  rechnungen: 'gruppe.finanzen.lesen',
  eingang: 'gruppe.eingang.lesen',
  posten: 'gruppe.zahlung.lesen',
} as const;

export interface BereichFinanzen {
  readonly mandantId: string;
  readonly slug: string;
  readonly name: string;
  readonly fakturiertCent: Cent | null;
  readonly rechnungen: number | null;
  readonly eingangCent: Cent | null;
  readonly eingangsrechnungen: number | null;
  /** Betriebsausgaben netto (V-215) — unter demselben Recht wie der Eingang. */
  readonly ausgabenCent: Cent | null;
  readonly ausgaben: number | null;
  /** Eingangsrechnungen + Betriebsausgaben. */
  readonly aufwandCent: Cent | null;
  readonly saldoCent: Cent | null;
  readonly forderungenOffenCent: Cent | null;
  readonly verbindlichkeitenOffenCent: Cent | null;
}

export interface MonatsZeile {
  readonly monat: number;
  readonly label: string;
  /** Je Bereich in der Reihenfolge von `bereiche`; `null` wo das Recht fehlt. */
  readonly werte: readonly (Cent | null)[];
  readonly summe: Cent;
}

export interface GruppenFinanzen {
  readonly jahr: number;
  readonly bereiche: readonly BereichFinanzen[];
  readonly fakturiertJeMonat: readonly MonatsZeile[];
  readonly eingangJeMonat: readonly MonatsZeile[];
  readonly ausgabenJeMonat: readonly MonatsZeile[];
  /** Eingangsrechnungen + Betriebsausgaben je Monat — die Grundlage des Ergebnisses. */
  readonly aufwandJeMonat: readonly MonatsZeile[];
  readonly summe: {
    readonly fakturiertCent: Cent;
    readonly eingangCent: Cent;
    readonly ausgabenCent: Cent;
    readonly aufwandCent: Cent;
    readonly saldoCent: Cent | null;
    readonly forderungenOffenCent: Cent;
    readonly verbindlichkeitenOffenCent: Cent;
  };
}

interface Roh {
  readonly mandant_id: string;
  readonly slug: string;
  readonly name: string;
  readonly fakturiert_cent: string;
  readonly rechnungen: number;
  readonly eingang_cent: string;
  readonly eingangsrechnungen: number;
  readonly forderungen_cent: string;
  readonly verbindlichkeiten_cent: string;
}

interface MonatRoh {
  readonly mandant_id: string;
  readonly monat: number;
  readonly summe_cent: string;
}

function summeCent(werte: readonly (Cent | null)[]): Cent {
  let s = 0n;
  for (const w of werte) if (w !== null) s += w;
  return cent(s);
}

function monatsMatrix(
  zeilen: readonly MonatRoh[], bereiche: readonly BereichFinanzen[], darf: (mandantId: string) => boolean,
): readonly MonatsZeile[] {
  const karte = new Map<string, bigint>();
  for (const z of zeilen) karte.set(`${z.mandant_id}:${String(z.monat)}`, BigInt(z.summe_cent));
  const monate: MonatsZeile[] = [];
  for (let m = 1; m <= 12; m += 1) {
    const werte = bereiche.map((b) =>
      (darf(b.mandantId) ? cent(karte.get(`${b.mandantId}:${String(m)}`) ?? 0n) : null));
    monate.push({ monat: m, label: MONATSNAMEN[m - 1] ?? String(m), werte, summe: summeCent(werte) });
  }
  return monate;
}

/**
 * Zwei Monatsmatrizen derselben Form Zelle für Zelle addiert — `null` bleibt
 * `null`, wenn eine der beiden Zellen `null` ist (das Recht fehlt).
 */
export function summiereMatrizen(
  a: readonly MonatsZeile[], b: readonly MonatsZeile[],
): readonly MonatsZeile[] {
  return a.map((zeile, i) => {
    const andere = b[i];
    const werte = zeile.werte.map((w, j) => {
      const v = andere?.werte[j] ?? null;
      return w === null || v === null ? null : cent(w + v);
    });
    return { monat: zeile.monat, label: zeile.label, werte, summe: summeCent(werte) };
  });
}

export async function gruppenFinanzen(kontext: LeseKontext, jahr: number): Promise<GruppenFinanzen> {
  if (!Number.isInteger(jahr) || jahr < 2000 || jahr > 2100) {
    throw new RangeError(`Kein Geschaeftsjahr: ${String(jahr)}`);
  }
  const rechte = await rechteJeBereich(kontext, Object.values(FINANZEN_RECHTE));
  const darf = (mandantId: string, recht: string): boolean => rechte.get(mandantId)?.has(recht) === true;

  const roh = await kontext.abfrage<Roh>(
    `select m.id as mandant_id, m.slug, m.name,
            (select coalesce(sum(r.netto_gesamt_cent), 0) from rechnung r
              where r.mandant_id = m.id and r.status = 'festgeschrieben'
                and extract(year from r.rechnungsdatum) = $1)::text as fakturiert_cent,
            (select count(*) from rechnung r
              where r.mandant_id = m.id and r.status = 'festgeschrieben'
                and extract(year from r.rechnungsdatum) = $1)::int as rechnungen,
            (select coalesce(sum(e.netto_cent), 0) from eingangsrechnung e
              where e.mandant_id = m.id and e.status in ('freigegeben', 'gebucht')
                and extract(year from e.rechnungsdatum) = $1)::text as eingang_cent,
            (select count(*) from eingangsrechnung e
              where e.mandant_id = m.id and e.status in ('freigegeben', 'gebucht')
                and extract(year from e.rechnungsdatum) = $1)::int as eingangsrechnungen,
            (select coalesce(sum(op.offen_cent), 0) from offener_posten op
              where op.mandant_id = m.id and op.art = 'debitor' and op.ausgeglichen_am is null)::text
              as forderungen_cent,
            (select coalesce(sum(op.offen_cent), 0) from offener_posten op
              where op.mandant_id = m.id and op.art = 'kreditor' and op.ausgeglichen_am is null)::text
              as verbindlichkeiten_cent
       from mandant m
      order by m.sortierung, m.slug`,
    [jahr],
  );

  /*
   * Die Betriebsausgaben des Kalenderjahrs, je Gesellschaft und Monat —
   * dieselbe Quelle wie die Monatszahlen im Bereich (V-215).
   */
  const ausgabenZeilen = await ausgabenAufwand(kontext, `${String(jahr)}-01-01`, `${String(jahr)}-12-31`);
  const ausgabenJe = jeGesellschaft(ausgabenZeilen);

  const bereiche: BereichFinanzen[] = roh.map((z) => {
    const fakturiert = darf(z.mandant_id, FINANZEN_RECHTE.rechnungen) ? cent(BigInt(z.fakturiert_cent)) : null;
    const eingangsrecht = darf(z.mandant_id, FINANZEN_RECHTE.eingang);
    const eingang = eingangsrecht ? cent(BigInt(z.eingang_cent)) : null;
    const ausgaben = eingangsrecht ? ausgabenJe.get(z.mandant_id) ?? { nettoCent: cent(0n), anzahl: 0 } : null;
    const aufwand = eingang === null || ausgaben === null ? null : cent(eingang + ausgaben.nettoCent);
    const posten = darf(z.mandant_id, FINANZEN_RECHTE.posten);
    return {
      mandantId: z.mandant_id,
      slug: z.slug,
      name: z.name,
      fakturiertCent: fakturiert,
      rechnungen: fakturiert === null ? null : z.rechnungen,
      eingangCent: eingang,
      eingangsrechnungen: eingang === null ? null : z.eingangsrechnungen,
      ausgabenCent: ausgaben?.nettoCent ?? null,
      ausgaben: ausgaben?.anzahl ?? null,
      aufwandCent: aufwand,
      saldoCent: fakturiert === null || aufwand === null ? null : cent(fakturiert - aufwand),
      forderungenOffenCent: posten ? cent(BigInt(z.forderungen_cent)) : null,
      verbindlichkeitenOffenCent: posten ? cent(BigInt(z.verbindlichkeiten_cent)) : null,
    };
  });

  const [fakturiertMonate, eingangMonate] = await Promise.all([
    kontext.abfrage<MonatRoh>(
      `select r.mandant_id, extract(month from r.rechnungsdatum)::int as monat,
              sum(r.netto_gesamt_cent)::text as summe_cent
         from rechnung r
        where r.status = 'festgeschrieben' and extract(year from r.rechnungsdatum) = $1
        group by r.mandant_id, 2`,
      [jahr],
    ),
    kontext.abfrage<MonatRoh>(
      `select e.mandant_id, extract(month from e.rechnungsdatum)::int as monat,
              sum(e.netto_cent)::text as summe_cent
         from eingangsrechnung e
        where e.status in ('freigegeben', 'gebucht') and extract(year from e.rechnungsdatum) = $1
        group by e.mandant_id, 2`,
      [jahr],
    ),
  ]);

  const fakturiertCent = summeCent(bereiche.map((b) => b.fakturiertCent));
  const eingangCent = summeCent(bereiche.map((b) => b.eingangCent));
  const ausgabenCent = summeCent(bereiche.map((b) => b.ausgabenCent));
  const aufwandCent = summeCent(bereiche.map((b) => b.aufwandCent));
  const alleSaldi = bereiche.every((b) => b.saldoCent !== null);
  const ausgabenMonate: MonatRoh[] = ausgabenZeilen.map((a) => ({
    mandant_id: a.mandantId, monat: Number(a.monat.slice(5, 7)), summe_cent: a.nettoCent.toString(),
  }));
  const eingangJeMonat = monatsMatrix(eingangMonate, bereiche,
    (id) => darf(id, FINANZEN_RECHTE.eingang));
  const ausgabenJeMonat = monatsMatrix(ausgabenMonate, bereiche,
    (id) => darf(id, FINANZEN_RECHTE.eingang));
  return {
    jahr,
    bereiche,
    fakturiertJeMonat: monatsMatrix(fakturiertMonate, bereiche,
      (id) => darf(id, FINANZEN_RECHTE.rechnungen)),
    eingangJeMonat,
    ausgabenJeMonat,
    aufwandJeMonat: summiereMatrizen(eingangJeMonat, ausgabenJeMonat),
    summe: {
      fakturiertCent,
      eingangCent,
      ausgabenCent,
      aufwandCent,
      // Ein Gruppensaldo aus unvollstaendigen Spalten waere eine falsche Zahl.
      saldoCent: alleSaldi && bereiche.length > 0 ? cent(fakturiertCent - aufwandCent) : null,
      forderungenOffenCent: summeCent(bereiche.map((b) => b.forderungenOffenCent)),
      verbindlichkeitenOffenCent: summeCent(bereiche.map((b) => b.verbindlichkeitenOffenCent)),
    },
  };
}
