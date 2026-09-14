import type { LeseKontext } from '../../kontext/index.js';
import { cent, type Cent } from '../finanz/geld.js';
import { rechteJeBereich } from './uebersicht.js';

/**
 * Offene Posten ueber die Gruppe (ACC-07): Debitoren und Kreditoren je
 * Gesellschaft, und die Posten selbst — lesend.
 *
 * `offener_posten` steht in der Gruppenansicht unter `gruppe.zahlung.lesen`
 * (Policy `t_gruppe`); die Seite selbst verlangt `gruppe.buchhaltung.lesen`
 * (SEITENKARTE §6). Beides ist noetig, und beides wird getrennt gefragt: die
 * Seite oeffnet das Tor, das Recht je Bereich entscheidet, ob eine Zelle eine
 * Zahl oder ein Strich ist.
 *
 * Die Gegenpartei kommt aus `kunde` bzw. `lieferant`, und DEREN Policies
 * verlangen `gruppe.crm.lesen` bzw. `gruppe.eingang.lesen`. Wer den Posten
 * sehen darf, den Namen aber nicht, sieht den Posten mit einem Strich — die
 * Policy der anderen Tabelle wird nicht umgangen, sie wird sichtbar.
 */
export const POSTEN_RECHT = 'gruppe.zahlung.lesen';

export interface BereichPosten {
  readonly mandantId: string;
  readonly slug: string;
  readonly name: string;
  readonly debitorenOffenCent: Cent | null;
  readonly debitorenUeberfaelligCent: Cent | null;
  readonly kreditorenOffenCent: Cent | null;
  readonly kreditorenUeberfaelligCent: Cent | null;
  readonly anzahl: number | null;
}

export interface OffenerPosten {
  readonly id: string;
  readonly mandantId: string;
  readonly slug: string;
  readonly art: string;
  readonly gegenpartei: string | null;
  readonly beleg: string | null;
  readonly betragCent: Cent;
  readonly offenCent: Cent;
  /** `DD.MM.YYYY` oder `null`. */
  readonly faelligAm: string | null;
  /** Tage seit Faelligkeit — 0, wenn nicht faellig oder nicht ueberfaellig. */
  readonly ueberfaelligTage: number;
  readonly mahnstufe: number | null;
  /** Der Beleg im Bereich — Rechnung oder Eingangsrechnung. */
  readonly zielPfad: string | null;
}

export interface GruppenOffenePosten {
  readonly bereiche: readonly BereichPosten[];
  readonly posten: readonly OffenerPosten[];
}

interface BereichRoh {
  readonly mandant_id: string;
  readonly slug: string;
  readonly name: string;
  readonly deb_offen: string;
  readonly deb_ueberfaellig: string;
  readonly kred_offen: string;
  readonly kred_ueberfaellig: string;
  readonly anzahl: number;
}

interface PostenRoh {
  readonly id: string;
  readonly mandant_id: string;
  readonly slug: string;
  readonly art: string;
  readonly gegenpartei: string | null;
  readonly beleg: string | null;
  readonly betrag_cent: string;
  readonly offen_cent: string;
  readonly faellig_am: string | null;
  readonly ueberfaellig_tage: number;
  readonly mahnstufe: number | null;
  readonly rechnung_id: string | null;
  readonly eingangsrechnung_id: string | null;
}

export async function gruppenOffenePosten(
  kontext: LeseKontext, mandantIds: readonly string[],
): Promise<GruppenOffenePosten> {
  const rechte = await rechteJeBereich(kontext, [POSTEN_RECHT]);
  const darf = (id: string): boolean => rechte.get(id)?.has(POSTEN_RECHT) === true;

  const bereicheRoh = await kontext.abfrage<BereichRoh>(
    `select m.id as mandant_id, m.slug, m.name,
            coalesce(sum(op.offen_cent) filter (where op.art = 'debitor'), 0)::text as deb_offen,
            coalesce(sum(op.offen_cent) filter (where op.art = 'debitor'
                     and op.faellig_am < current_date), 0)::text as deb_ueberfaellig,
            coalesce(sum(op.offen_cent) filter (where op.art = 'kreditor'), 0)::text as kred_offen,
            coalesce(sum(op.offen_cent) filter (where op.art = 'kreditor'
                     and op.faellig_am < current_date), 0)::text as kred_ueberfaellig,
            count(op.id)::int as anzahl
       from mandant m
       left join offener_posten op on op.mandant_id = m.id and op.ausgeglichen_am is null
      where m.id = any($1::uuid[])
      group by m.id, m.slug, m.name, m.sortierung
      order by m.sortierung, m.slug`,
    [mandantIds],
  );

  const postenRoh = await kontext.abfrage<PostenRoh>(
    `select op.id, op.mandant_id, m.slug, op.art::text as art,
            coalesce(k.name, l.name) as gegenpartei,
            coalesce(r.nummer, e.interne_belegnummer) as beleg,
            op.betrag_cent::text, op.offen_cent::text,
            to_char(op.faellig_am, 'DD.MM.YYYY') as faellig_am,
            greatest(0, (current_date - op.faellig_am))::int as ueberfaellig_tage,
            op.letzte_mahnstufe as mahnstufe,
            op.rechnung_id, op.eingangsrechnung_id
       from offener_posten op
       join mandant m on m.id = op.mandant_id
       left join kunde k on k.id = op.kunde_id
       left join lieferant l on l.id = op.lieferant_id
       left join rechnung r on r.id = op.rechnung_id
       left join eingangsrechnung e on e.id = op.eingangsrechnung_id
      where op.ausgeglichen_am is null and op.mandant_id = any($1::uuid[])
      order by op.faellig_am nulls last, op.offen_cent desc
      limit 300`,
    [mandantIds],
  );

  return {
    bereiche: bereicheRoh.map((z) => ({
      mandantId: z.mandant_id,
      slug: z.slug,
      name: z.name,
      debitorenOffenCent: darf(z.mandant_id) ? cent(BigInt(z.deb_offen)) : null,
      debitorenUeberfaelligCent: darf(z.mandant_id) ? cent(BigInt(z.deb_ueberfaellig)) : null,
      kreditorenOffenCent: darf(z.mandant_id) ? cent(BigInt(z.kred_offen)) : null,
      kreditorenUeberfaelligCent: darf(z.mandant_id) ? cent(BigInt(z.kred_ueberfaellig)) : null,
      anzahl: darf(z.mandant_id) ? z.anzahl : null,
    })),
    posten: postenRoh.map((z) => ({
      id: z.id,
      mandantId: z.mandant_id,
      slug: z.slug,
      art: z.art,
      gegenpartei: z.gegenpartei,
      beleg: z.beleg,
      betragCent: cent(BigInt(z.betrag_cent)),
      offenCent: cent(BigInt(z.offen_cent)),
      faelligAm: z.faellig_am,
      ueberfaelligTage: z.ueberfaellig_tage,
      mahnstufe: z.mahnstufe,
      zielPfad: z.rechnung_id !== null
        ? `/portal/${z.slug}/finanzen/rechnungen/${z.rechnung_id}`
        : z.eingangsrechnung_id !== null
          ? `/portal/${z.slug}/finanzen/eingangsrechnungen/${z.eingangsrechnung_id}`
          : null,
    })),
  };
}
