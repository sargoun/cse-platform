import 'server-only';
import { cent, NULL_CENT, type Cent } from '../finanz/geld.js';
import {
  PIPELINE_LEER, pipelineZahlen, trefferquoteBp, type Abfrage, type PipelineZahlen,
} from './kennzahlen.js';
import type { Zeitraum } from './zeitraum.js';

/**
 * Dieselben sechs Berichte, aber je Gesellschaft (SPEC §6, TEN-05).
 *
 * **Warum eigene Abfragen und nicht sechsmal die Mandantenfassung.** Im
 * Gruppen-Scope gibt RLS die Zeilen ALLER sichtbaren Bereiche zurück; die
 * Mandantenfassung summierte sie zu einer Zahl, und genau diese Zahl
 * beantwortet die Frage der Gruppenansicht nicht. Wer dort hinsieht, will
 * wissen, welche Gesellschaft welchen Beitrag leistet — eine Summe ohne
 * Aufteilung ist die eine Zahl, die niemand handeln lässt.
 *
 * **Lesend, immer** (Invariante 10). Kein Schreibpfad, kein aktiver Mandant,
 * und `mandant_id` steht in `group by`, nicht in `where`: die sichtbare Menge
 * entscheidet die Policy und nicht diese Datei.
 */

export interface BereichsZeile {
  readonly mandantId: string;
  readonly slug: string;
  readonly name: string;
  /**
   * **Darf dieser Mensch die Zahlen DIESER Gesellschaft lesen?**
   *
   * Im Gruppen-Scope filtert die Policy je Zeile mit dem Recht des Bereichs.
   * Wer `gruppe.finanzen.lesen` in einer Gesellschaft nicht haelt, bekommt von
   * `sum(...)` dort NULL und von `count(*)` eine 0 -- und `coalesce(...,0)`
   * machte daraus eine Zeile, die aussieht wie „eine Gesellschaft ohne
   * Umsatz". Das ist die schlimmere Art von Fehler: sie sieht nicht aus wie
   * einer. Die Uebersicht (`gruppe/uebersicht.ts`) fragt das Recht deshalb VOR
   * der Zaehlung; die Berichte tun es jetzt auch, und die Seite zeigt einen
   * Strich statt einer Null.
   */
  readonly lesbar: boolean;
}

/**
 * Welche Bereiche welches Recht tragen — eine Abfrage fuer alle.
 *
 * Dieselbe Frage wie `rechteJeBereich` in `gruppe/uebersicht.ts`, hier aber
 * gegen ein blankes `Abfrage` statt gegen einen `LeseKontext`: die
 * Berichtsdienste bekommen absichtlich nur das Abfragen gereicht.
 */
async function bereicheMitRechten(
  db: Abfrage, rechte: readonly string[],
): Promise<ReadonlySet<string>> {
  const zeilen = await db.abfrage<{ mandant_id: string; alle: boolean }>(
    `select m.id as mandant_id,
            bool_and(app.hat_recht(r.recht, m.id)) as alle
       from mandant m cross join unnest($1::text[]) as r(recht)
      group by m.id`,
    [rechte],
  );
  return new Set(zeilen.filter((z) => z.alle).map((z) => z.mandant_id));
}

/**
 * Die Rechte, die jeder der sechs Gruppenberichte verlangt — genau die, mit
 * denen die Policies der gelesenen Tabellen filtern.
 *
 * **Wo ein Bericht aus zwei Tabellen liest, stehen beide da, und es gilt
 * UND.** Eine Umsatzzeile aus Erloesen, die dieser Mensch sehen darf, und
 * einem Aufwand, den er nicht sehen darf, waere ein Ergebnis, das zu hoch ist
 * — und nichts an der Zeile sagte das.
 *
 * `lead` filtert im Gruppen-Scope mit `crm.lesen` je Bereich (nicht mit einem
 * `gruppe.`-Recht): `t_lead_lesen` prueft `sichtbare_mandanten()` und dann das
 * Recht am Bereich der Zeile.
 */
export const GRUPPENBERICHT_RECHTE = {
  umsatz: ['gruppe.finanzen.lesen', 'gruppe.eingang.lesen'],
  auftraege: ['gruppe.auftrag.lesen', 'crm.lesen'],
  stunden: ['gruppe.zeit.lesen'],
  projekte: ['gruppe.kalkulation.lesen'],
  pipeline: ['gruppe.radar.lesen'],
  attribution: ['crm.lesen', 'gruppe.auftrag.lesen'],
} as const satisfies Record<string, readonly string[]>;

export interface UmsatzJeBereich extends BereichsZeile {
  readonly erloeseCent: Cent;
  readonly aufwandCent: Cent;
  readonly ergebnisCent: Cent;
  readonly rechnungen: number;
}

const geld = (roh: unknown): Cent =>
  (roh === null || roh === undefined ? NULL_CENT : cent(BigInt(String(roh))));

export async function umsatzJeBereich(
  db: Abfrage, z: Zeitraum,
): Promise<readonly UmsatzJeBereich[]> {
  const darf = await bereicheMitRechten(db, GRUPPENBERICHT_RECHTE.umsatz);
  const zeilen = await db.abfrage<{
    mandant_id: string; slug: string; name: string;
    erloese: string; rechnungen: string; aufwand: string;
  }>(
    `select m.id as mandant_id, m.slug, m.name,
            coalesce((select sum(r.brutto_cent) from rechnung r
                       where r.mandant_id = m.id and r.status = 'festgeschrieben'
                         and r.rechnungsdatum between $1::date and $2::date), 0)::text as erloese,
            coalesce((select count(*) from rechnung r
                       where r.mandant_id = m.id and r.status = 'festgeschrieben'
                         and r.rechnungsdatum between $1::date and $2::date), 0)::text as rechnungen,
            coalesce((select sum(e.brutto_cent) from eingangsrechnung e
                       where e.mandant_id = m.id and e.status in ('freigegeben','gebucht')
                         and e.rechnungsdatum between $1::date and $2::date), 0)::text as aufwand
       from mandant m
      order by m.sortierung, m.slug`,
    [z.von, z.bis],
  );
  return zeilen.map((r) => {
    const erloese = geld(r.erloese);
    const aufwand = geld(r.aufwand);
    return {
      mandantId: r.mandant_id, slug: r.slug, name: r.name,
      lesbar: darf.has(r.mandant_id),
      erloeseCent: erloese, aufwandCent: aufwand,
      ergebnisCent: cent(erloese - aufwand),
      rechnungen: Number(r.rechnungen),
    };
  });
}

export interface AuftraegeJeBereich extends BereichsZeile {
  readonly leads: number;
  readonly gewonnen: number;
  readonly auftraege: number;
  readonly auftragswertCent: Cent;
  readonly quoteBp: number;
}

export async function auftraegeJeBereich(
  db: Abfrage, z: Zeitraum,
): Promise<readonly AuftraegeJeBereich[]> {
  const darf = await bereicheMitRechten(db, GRUPPENBERICHT_RECHTE.auftraege);
  const zeilen = await db.abfrage<{
    mandant_id: string; slug: string; name: string;
    leads: string; gewonnen: string; auftraege: string; wert: string;
  }>(
    `select m.id as mandant_id, m.slug, m.name,
            coalesce((select count(*) from lead l
                       where l.mandant_id = m.id
                         and (l.erstellt_am at time zone 'Europe/Berlin')::date
                             between $1::date and $2::date), 0)::text as leads,
            coalesce((select count(*) from lead l
                       where l.mandant_id = m.id and l.status = 'gewonnen'
                         and (l.erstellt_am at time zone 'Europe/Berlin')::date
                             between $1::date and $2::date), 0)::text as gewonnen,
            coalesce((select count(*) from auftrag a
                       where a.mandant_id = m.id and a.status <> 'storniert'
                         and (a.erstellt_am at time zone 'Europe/Berlin')::date
                             between $1::date and $2::date), 0)::text as auftraege,
            coalesce((select sum(a.auftragswert_netto_cent) from auftrag a
                       where a.mandant_id = m.id and a.status <> 'storniert'
                         and (a.erstellt_am at time zone 'Europe/Berlin')::date
                             between $1::date and $2::date), 0)::text as wert
       from mandant m
      order by m.sortierung, m.slug`,
    [z.von, z.bis],
  );
  return zeilen.map((r) => {
    const leads = Number(r.leads);
    const gewonnen = Number(r.gewonnen);
    return {
      mandantId: r.mandant_id, slug: r.slug, name: r.name,
      lesbar: darf.has(r.mandant_id),
      leads, gewonnen,
      auftraege: Number(r.auftraege),
      auftragswertCent: geld(r.wert),
      quoteBp: leads === 0 ? 0 : Math.round((gewonnen * 10000) / leads),
    };
  });
}

export interface StundenJeBereich extends BereichsZeile {
  readonly personen: number;
  readonly istMinuten: number;
}

export async function stundenJeBereich(
  db: Abfrage, z: Zeitraum,
): Promise<readonly StundenJeBereich[]> {
  const darf = await bereicheMitRechten(db, GRUPPENBERICHT_RECHTE.stunden);
  const zeilen = await db.abfrage<{
    mandant_id: string; slug: string; name: string; personen: string; minuten: string;
  }>(
    `select m.id as mandant_id, m.slug, m.name,
            coalesce((select count(distinct t.person_id) from zeiteintrag t
                       where t.mandant_id = m.id and t.freigegeben_am is not null
                         and t.storniert_am is null and t.ersetzt_am is null
                         and (t.beginn_zeitpunkt at time zone 'Europe/Berlin')::date
                             between $1::date and $2::date), 0)::text as personen,
            coalesce((select sum(t.dauer_netto_minuten) from zeiteintrag t
                       where t.mandant_id = m.id and t.freigegeben_am is not null
                         and t.storniert_am is null and t.ersetzt_am is null
                         and (t.beginn_zeitpunkt at time zone 'Europe/Berlin')::date
                             between $1::date and $2::date), 0)::text as minuten
       from mandant m
      order by m.sortierung, m.slug`,
    [z.von, z.bis],
  );
  return zeilen.map((r) => ({
    mandantId: r.mandant_id, slug: r.slug, name: r.name,
    lesbar: darf.has(r.mandant_id),
    personen: Number(r.personen), istMinuten: Number(r.minuten),
  }));
}

export interface ProjekteJeBereich extends BereichsZeile {
  readonly laufend: number;
  readonly abgeschlossen: number;
  readonly verspaetet: number;
  readonly auftragssummeCent: Cent;
}

export async function projekteJeBereich(
  db: Abfrage, z: Zeitraum,
): Promise<readonly ProjekteJeBereich[]> {
  const darf = await bereicheMitRechten(db, GRUPPENBERICHT_RECHTE.projekte);
  const zeilen = await db.abfrage<{
    mandant_id: string; slug: string; name: string;
    laufend: string; abgeschlossen: string; verspaetet: string; summe: string;
  }>(
    /*
     * Die vier Zahlen kommen aus app.projekt_kennzahlen_gruppe (0158) und
     * nicht aus einem `sum(p.auftragssumme_netto_cent)`: cse_app hat auf
     * dieser Spalte KEIN select (K-05, D-92), und Postgres weist dann die
     * ganze Anweisung ab -- die Seite antwortete mit einem Serverfehler.
     * Der left join haelt jede Gesellschaft in der Liste, auch die ohne
     * Projekte und die, deren Kalkulation dieser Mensch nicht lesen darf.
     */
    `with kz as (select * from app.projekt_kennzahlen_gruppe($1::date, $2::date))
     select m.id as mandant_id, m.slug, m.name,
            coalesce(kz.laufend, 0)::text as laufend,
            coalesce(kz.abgeschlossen, 0)::text as abgeschlossen,
            coalesce(kz.verspaetet, 0)::text as verspaetet,
            coalesce(kz.auftragssumme_cent, 0)::text as summe
       from mandant m
       left join kz on kz.mandant_id = m.id
      order by m.sortierung, m.slug`,
    [z.von, z.bis],
  );
  return zeilen.map((r) => ({
    mandantId: r.mandant_id, slug: r.slug, name: r.name,
    lesbar: darf.has(r.mandant_id),
    laufend: Number(r.laufend),
    abgeschlossen: Number(r.abgeschlossen),
    verspaetet: Number(r.verspaetet),
    auftragssummeCent: geld(r.summe),
  }));
}

export interface PipelineJeBereich extends BereichsZeile, PipelineZahlen {
  /** Gewonnen je geboten, in Basispunkten; `null` ohne ein einziges Angebot. */
  readonly trefferquoteBp: number | null;
}

/**
 * REP-06 je Gesellschaft — mit DERSELBEN Zählung wie die Bereichsseite
 * (`pipelineZahlen` in `kennzahlen.ts`, V-226, D-720).
 *
 * Hier stand eine eigene Abfrage, und sie zählte anders: „gefunden" war jeder
 * Vorgang, „eingereicht" liess `verfahren_aufgehoben` aus, und die
 * Bereichsseite zählte nach dem heutigen Stand. Für dieselben Zeilen standen
 * auf beiden Seiten verschiedene Zahlen. Jetzt fragt diese Funktion nur noch
 * die Liste der Gesellschaften und hängt die gemeinsame Zählung an; wo sie
 * für einen Bereich nichts liefert, steht die leere Zählung da.
 */
export async function pipelineJeBereich(
  db: Abfrage, z: Zeitraum,
): Promise<readonly PipelineJeBereich[]> {
  const darf = await bereicheMitRechten(db, GRUPPENBERICHT_RECHTE.pipeline);
  const bereiche = await db.abfrage<{ mandant_id: string; slug: string; name: string }>(
    `select m.id as mandant_id, m.slug, m.name
       from mandant m
      order by m.sortierung, m.slug`,
  );
  const zahlen = await pipelineZahlen(db, z);
  return bereiche.map((r) => {
    const je = zahlen.get(r.mandant_id) ?? PIPELINE_LEER;
    return {
      mandantId: r.mandant_id, slug: r.slug, name: r.name,
      lesbar: darf.has(r.mandant_id),
      ...je,
      trefferquoteBp: trefferquoteBp(je),
    };
  });
}

export interface AttributionJeBereich extends BereichsZeile {
  readonly kanal: string;
  readonly leads: number;
  readonly auftraege: number;
}

/**
 * Herkunft über alle Bereiche — je Gesellschaft UND Kanal.
 *
 * Eine Zeile je (Bereich, Kanal): ein Kanal, der in einer Gesellschaft
 * funktioniert und in einer anderen nicht, ist genau der Befund, wegen dessen
 * diese Seite in der Gruppenansicht steht.
 */
export async function attributionJeBereich(
  db: Abfrage, z: Zeitraum,
): Promise<readonly AttributionJeBereich[]> {
  const darf = await bereicheMitRechten(db, GRUPPENBERICHT_RECHTE.attribution);
  const zeilen = await db.abfrage<{
    mandant_id: string; slug: string; name: string;
    kanal: string; leads: string; auftraege: string;
  }>(
    `with eingang as (
       select l.id as lead_id, l.mandant_id,
              coalesce(nullif(fe.utm_quelle, ''),
                       case l.quelle
                         when 'webformular' then 'Website (ohne UTM)'
                         when 'vergabe_radar' then 'Vergaberadar'
                         when 'empfehlung' then 'Empfehlung'
                         when 'akquise' then 'Akquise'
                         else 'Manuell erfasst'
                       end) as kanal
         from lead l
         left join formular_eingang fe on fe.lead_id = l.id
        where (l.erstellt_am at time zone 'Europe/Berlin')::date between $1::date and $2::date
     )
     select m.id as mandant_id, m.slug, m.name, e.kanal,
            count(*)::text as leads,
            count(a.id)::text as auftraege
       from eingang e
       join mandant m on m.id = e.mandant_id
       left join auftrag a on a.lead_id = e.lead_id and a.status <> 'storniert'
      group by m.id, m.slug, m.name, m.sortierung, e.kanal
      order by m.sortierung, m.slug, count(a.id) desc, e.kanal`,
    [z.von, z.bis],
  );
  return zeilen.map((r) => ({
    mandantId: r.mandant_id, slug: r.slug, name: r.name,
    lesbar: darf.has(r.mandant_id),
    kanal: r.kanal, leads: Number(r.leads), auftraege: Number(r.auftraege),
  }));
}
