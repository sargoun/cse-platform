import type { LeseKontext } from '../../kontext/index.js';
import type { KalenderZeile } from '../kalender/eintraege.js';
import { rechteJeBereich } from './uebersicht.js';

/**
 * Der zusammengeführte Kalender über alle Gesellschaften (CAL-01, CAL-02,
 * TEN-05) — **lesend** (Invariante 10).
 *
 * **Er SAMMELT, er kopiert nicht** — dieselbe Entscheidung wie im Bereich
 * (`kalender/eintraege.ts`): eine Schicht steht in `einsatz`, ein
 * Projekttermin in `projekt`, eine Vergabefrist in `ausschreibung`. Eine im
 * Dienstplan verschobene Schicht ist deshalb hier verschoben, ohne dass
 * jemand diesen Kalender angefasst hätte.
 *
 * **Und er zeigt KEINEN Personenbezug.** Das ist der Unterschied zur
 * Gesellschaftssicht, und er ist der Grund, warum diese Datei überhaupt
 * existiert statt `kalenderZeilen` mit einem Mandantenfeld:
 *
 *   1. **`gespraech` fehlt.** Die siebte Quelle des Bereichskalenders ist das
 *      Bewerbungsgespräch, und ihr Titel ist `'Gespräch: ' || bewerbung.name`.
 *      Ein gemeinsamer Kalender über drei Gesellschaften ist genau die Stelle,
 *      an der jemand versehentlich liest, wer sich wo beworben hat. Die
 *      Bewerbertische tragen deshalb keine Gruppenpolicy und seit 0370 die
 *      restriktive Decke `p_gruppe_kein_personenbezug`; diese Datei fragt sie
 *      gar nicht erst.
 *   2. **Eine Schicht steht ohne Namen da.** `einsatz` liefert Objekt und
 *      Zeit; WER eingeteilt ist, steht in `einsatz_zuordnung` und erscheint
 *      auf keiner Zeile — genauso wie auf `/portal/gruppe/dienstplan`, das
 *      Soll und Besetzung zeigt und keine Namen.
 *   3. **Der Personenfilter ist ein SUCHWEG, keine Spalte.** Wer eine
 *      bestimmte Person wählt, sieht deren Schichten über die Gesellschaften
 *      hinweg — die Frage, die das Arbeitszeitgesetz stellt (D-09) und die
 *      `/portal/gruppe/auslastung` bereits beantwortet. Er verlangt
 *      `gruppe.personal.lesen` zusätzlich zum Quellenrecht (O-872).
 *
 * **RLS entscheidet, was sichtbar ist** (Invariante 3). Jede Abfrage liest
 * ihre Tabelle ohne Rechteprüfung im Code, und die Policy antwortet je
 * Gesellschaft. Die Seite fragt die Rechte trotzdem — aber nur, um den
 * Unterschied zwischen „nichts geplant" und „darf ich nicht sehen" anzeigen
 * zu können (`quellenRechte`).
 */

/** Die sechs Quellen des Gruppenkalenders — `gespraech` ist mit Absicht keine. */
export type GruppenQuelle = 'termin' | 'einsatz' | 'projekt' | 'vergabe' | 'freigabe' | 'lead';

export const GRUPPEN_QUELLEN: readonly GruppenQuelle[] = [
  'termin', 'einsatz', 'projekt', 'vergabe', 'freigabe', 'lead',
];

/**
 * Das Recht, an dem die Quelle in der Gruppenansicht hängt — so, wie die
 * POLICY es nennt, nicht so, wie es heissen sollte.
 *
 * `lead` fällt aus der Reihe: `t_lead_lesen` (0017) prüft den MANDANTEN-
 * Schlüssel `crm.lesen` über `app.sichtbare_mandanten()`, nicht
 * `gruppe.crm.lesen`. Hier den schöneren Schlüssel zu nennen hiesse, eine
 * Legende zu schreiben, die nicht stimmt: die Zeile erschiene als „kein
 * Recht", obwohl sie sichtbar ist, oder umgekehrt. Der Unterschied ist
 * gemeldet und gehört zu 0017, nicht hierher.
 */
export const QUELLEN_RECHT: Readonly<Record<GruppenQuelle, string>> = {
  termin: 'gruppe.kalender.lesen',
  einsatz: 'gruppe.dienstplan.lesen',
  projekt: 'gruppe.bau.lesen',
  vergabe: 'gruppe.radar.lesen',
  freigabe: 'gruppe.freigabe.lesen',
  lead: 'crm.lesen',
};

/** Das Recht, das den Personenfilter freischaltet — siehe O-872. */
export const PERSONENFILTER_RECHT = 'gruppe.personal.lesen';

/** Die Quellen, die überhaupt einen Personen- oder Teambezug tragen. */
export const QUELLEN_MIT_PERSONENBEZUG: readonly GruppenQuelle[] = ['einsatz'];

export interface GruppenKalenderZeile extends KalenderZeile {
  readonly quelle: GruppenQuelle;
  readonly mandantId: string;
  readonly bereichSlug: string;
  readonly bereichName: string;
}

export interface GruppenLage {
  /** Berliner Kalendertage, `YYYY-MM-DD`, beide einschliesslich. */
  readonly von: string;
  readonly bis: string;
  readonly mandantIds: readonly string[];
  readonly nurQuellen?: readonly GruppenQuelle[] | null;
  /** Nur Schichten dieses Teams (CAL-02). */
  readonly nurTeamId?: string | null;
  /** Nur Schichten dieses Menschen (CAL-02, D-09) — siehe O-872. */
  readonly nurPersonId?: string | null;
  readonly grenze?: number;
}

export interface TeamWahl {
  readonly id: string;
  readonly name: string;
  readonly bereichSlug: string;
  readonly bereichName: string;
}

export interface PersonWahl {
  readonly id: string;
  readonly name: string;
  /** In welchen Gesellschaften beschäftigt — Slugs, sortiert. */
  readonly bereiche: readonly string[];
}

/**
 * **Die Zeitgrenzen als `timestamptz`, aus dem BERLINER Tag gerechnet**
 * (Invariante 2) — wortgleich zu `kalender/eintraege.ts`, und aus demselben
 * Grund: `beginn::date between …` verglich ein UTC-Datum mit einem Berliner
 * und verlöre jede Nacht zwischen Mitternacht und zwei Uhr.
 */
const FENSTER = `($1 || ' 00:00')::timestamp at time zone 'Europe/Berlin'`;
const FENSTER_ENDE =
  `(($2 || ' 00:00')::timestamp + interval '1 day') at time zone 'Europe/Berlin'`;

/** Der Berliner Kalendertag eines `timestamptz` — nie `::date` allein. */
const BERLINER_TAG = (spalte: string): string =>
  `(${spalte} at time zone 'Europe/Berlin')::date`;

/*
 * **Der Weg zum Vorgang baut den Slug aus der ZEILE** (`m.slug`), nie aus
 * einer Zeichenkette im Code. In der Gruppenansicht ist das keine Feinheit,
 * sondern die ganze Sache: die Zeilen stammen aus vier Gesellschaften, und
 * ein fest verdrahteter Slug schickte drei Viertel der Verweise in die
 * falsche. Deshalb steht in jeder Abfrage unten `join mandant m`.
 */

interface Abfrageteil {
  readonly quelle: GruppenQuelle;
  readonly sql: string;
  /** Trägt diese Quelle einen Team- oder Personenbezug? Sonst entfällt sie beim Filtern. */
  readonly mitPersonenbezug: boolean;
}

/**
 * Die sechs Abfragen.
 *
 * Parameter, in jeder gleich: `$1` von, `$2` bis, `$3` Mandanten,
 * `$4` Team (oder NULL), `$5` Person (oder NULL), `$6` Grenze. Gleich, damit
 * der Aufrufer eine Werteliste baut und nicht sechs — eine Abfrage mit
 * verschobenen Platzhaltern ist der Fehler, den man erst im Betrieb sieht.
 *
 * **Deshalb steht `and $4::uuid is null and $5::uuid is null` auch in den
 * fünf Abfragen ohne Personenbezug.** Zwei Gründe, und der zweite ist der
 * wichtigere:
 *
 *   1. Postgres muss JEDEN Platzhalter einer Anweisung typisieren können. Ein
 *      `$4`, das in der Abfrage nicht vorkommt, endet in „could not determine
 *      data type of parameter $4" — eine uniforme Werteliste braucht eine
 *      uniforme Verwendung.
 *   2. Die Regel steht damit in der ABFRAGE und nicht nur im Ablauf darüber:
 *      ist ein Team oder eine Person gewählt, liefert eine Quelle ohne
 *      Personenbezug nichts. `gruppenKalenderZeilen` überspringt sie
 *      ohnehin — aber wer die Abfrage einzeln laufen lässt, bekommt dieselbe
 *      Antwort und nicht eine Liste, die einer Person Projektenden zuschreibt.
 */
function teile(): readonly Abfrageteil[] {
  return [
    {
      quelle: 'termin',
      mitPersonenbezug: false,
      sql: `select k.id::text as id, 'termin'::text as quelle, k.titel,
                   k.beginn::text as beginn, k.ende::text as ende,
                   k.ganztaegig, k.ort, k.beschreibung,
                   (k.abgesagt_am is not null) as abgesagt,
                   coalesce(k.geaendert_am, k.erstellt_am)::text as geaendert,
                   '/portal/' || m.slug || '/kalender/' || k.id::text as weg,
                   m.id::text as "mandantId", m.slug as "bereichSlug", m.name as "bereichName"
              from kalender_eintrag k
              join mandant m on m.id = k.mandant_id
             where k.beginn < ${FENSTER_ENDE} and k.ende > ${FENSTER}
               and k.mandant_id = any ($3::uuid[])
               and $4::uuid is null and $5::uuid is null`,
    },
    {
      /*
       * **Die Schicht OHNE Namen.** `einsatz_zuordnung` wird nur im `exists`
       * der Filter benutzt und nie ausgegeben: der Titel ist das Objekt, der
       * Untertitel die Zeit. Wer eingeteilt ist, steht im Dienstplan der
       * Gesellschaft — dort, wo jemand die Einteilung auch ändern kann.
       *
       * **`exists` statt `join`, und das ist der Grund:** eine Schicht mit
       * drei eingeteilten Menschen ist EINE Schicht. Ein Verbund auf
       * `einsatz_zuordnung` haette sie dreimal geliefert, und im Kalender
       * stuenden drei Balken uebereinander, die dasselbe meinen.
       */
      quelle: 'einsatz',
      mitPersonenbezug: true,
      sql: `select e.id::text as id, 'einsatz'::text as quelle,
                   coalesce(o.bezeichnung, 'Einsatz') as titel,
                   e.beginn_zeitpunkt::text as beginn, e.ende_zeitpunkt::text as ende,
                   false as ganztaegig,
                   nullif(concat_ws(', ', o.strasse, o.ort), '') as ort,
                   case when e.status = 'storniert' then 'Abgesagt' else null end as beschreibung,
                   (e.status = 'storniert') as abgesagt,
                   coalesce(e.geaendert_am, e.erstellt_am)::text as geaendert,
                   '/portal/' || m.slug || '/dienstplan/einsatz/' || e.id::text as weg,
                   m.id::text as "mandantId", m.slug as "bereichSlug", m.name as "bereichName"
              from einsatz e
              join mandant m on m.id = e.mandant_id
              left join objekt o on o.id = e.objekt_id
             where e.beginn_zeitpunkt < ${FENSTER_ENDE} and e.ende_zeitpunkt > ${FENSTER}
               and e.mandant_id = any ($3::uuid[])
               and ($4::uuid is null or exists (
                     select 1 from einsatz_zuordnung z
                       join team_mitglied tm
                         on tm.mandant_id = z.mandant_id and tm.anstellung_id = z.anstellung_id
                      where z.einsatz_id = e.id and z.mandant_id = e.mandant_id
                        and z.status in ('geplant', 'zugesagt')
                        and tm.team_id = $4::uuid))
               and ($5::uuid is null or exists (
                     select 1 from einsatz_zuordnung z
                      where z.einsatz_id = e.id and z.mandant_id = e.mandant_id
                        and z.status in ('geplant', 'zugesagt')
                        and z.person_id = $5::uuid))`,
    },
    {
      quelle: 'projekt',
      mitPersonenbezug: false,
      sql: `select p.id::text as id, 'projekt'::text as quelle,
                   'Projektende: ' || p.bezeichnung as titel,
                   coalesce(p.ist_ende, p.soll_ende)::text as beginn,
                   coalesce(p.ist_ende, p.soll_ende)::text as ende,
                   true as ganztaegig, null::text as ort,
                   case when p.ist_ende is not null then 'Abgeschlossen'
                        else 'Geplantes Ende' end as beschreibung,
                   false as abgesagt,
                   coalesce(p.geaendert_am, p.erstellt_am)::text as geaendert,
                   '/portal/' || m.slug || '/bau/projekte/' || p.id::text as weg,
                   m.id::text as "mandantId", m.slug as "bereichSlug", m.name as "bereichName"
              from projekt p
              join mandant m on m.id = p.mandant_id
             where p.archiviert_am is null
               and coalesce(p.ist_ende, p.soll_ende) between $1::date and $2::date
               and p.mandant_id = any ($3::uuid[])
               and $4::uuid is null and $5::uuid is null`,
    },
    {
      quelle: 'vergabe',
      mitPersonenbezug: false,
      sql: `select v.id::text as id, 'vergabe'::text as quelle,
                   'Angebotsfrist: ' || a.titel as titel,
                   a.frist_angebot::text as beginn, a.frist_angebot::text as ende,
                   true as ganztaegig, null::text as ort,
                   'Vergabeverfahren' as beschreibung, false as abgesagt,
                   coalesce(v.geaendert_am, v.erstellt_am)::text as geaendert,
                   '/portal/' || m.slug || '/radar/' || a.id::text as weg,
                   m.id::text as "mandantId", m.slug as "bereichSlug", m.name as "bereichName"
              from ausschreibung_vorgang v
              join ausschreibung a on a.id = v.ausschreibung_id
              join mandant m on m.id = v.mandant_id
             where v.geloescht_am is null
               and a.frist_angebot is not null
               and ${BERLINER_TAG('a.frist_angebot')} between $1::date and $2::date
               and v.mandant_id = any ($3::uuid[])
               and $4::uuid is null and $5::uuid is null`,
    },
    {
      quelle: 'freigabe',
      mitPersonenbezug: false,
      sql: `select f.id::text as id, 'freigabe'::text as quelle,
                   'Freigabe fällig: ' || coalesce(f.titel, f.aktion) as titel,
                   f.frist::text as beginn, f.frist::text as ende,
                   true as ganztaegig, null::text as ort,
                   'Wartet auf eine Entscheidung' as beschreibung, false as abgesagt,
                   coalesce(f.geaendert_am, f.erstellt_am)::text as geaendert,
                   '/portal/' || m.slug || '/freigaben/' || f.id::text as weg,
                   m.id::text as "mandantId", m.slug as "bereichSlug", m.name as "bereichName"
              from freigabe f
              join mandant m on m.id = f.mandant_id
             where f.status = 'offen' and f.frist is not null
               and ${BERLINER_TAG('f.frist')} between $1::date and $2::date
               and f.mandant_id = any ($3::uuid[])
               and $4::uuid is null and $5::uuid is null`,
    },
    {
      quelle: 'lead',
      mitPersonenbezug: false,
      sql: `select l.id::text as id, 'lead'::text as quelle,
                   'Anfrage beantworten: ' || coalesce(
                     l.firma_name,
                     (select k.name from kunde k where k.id = l.kunde_id),
                     'ohne Namen') as titel,
                   l.sla_frist_am::text as beginn, l.sla_frist_am::text as ende,
                   true as ganztaegig, null::text as ort,
                   l.betreff as beschreibung, false as abgesagt,
                   coalesce(l.geaendert_am, l.erstellt_am)::text as geaendert,
                   '/portal/' || m.slug || '/crm/leads/' || l.id::text as weg,
                   m.id::text as "mandantId", m.slug as "bereichSlug", m.name as "bereichName"
              from lead l
              join mandant m on m.id = l.mandant_id
             where l.status in ('neu', 'in_bearbeitung', 'angebot')
               and l.sla_frist_am is not null
               and ${BERLINER_TAG('l.sla_frist_am')} between $1::date and $2::date
               and l.mandant_id = any ($3::uuid[])
               and $4::uuid is null and $5::uuid is null`,
    },
  ];
}

const zeigt = (lage: GruppenLage, q: GruppenQuelle): boolean =>
  lage.nurQuellen === undefined || lage.nurQuellen === null || lage.nurQuellen.includes(q);

export async function gruppenKalenderZeilen(
  kontext: LeseKontext, lage: GruppenLage,
): Promise<readonly GruppenKalenderZeile[]> {
  const team = lage.nurTeamId ?? null;
  const person = lage.nurPersonId ?? null;
  const werte = [
    lage.von, lage.bis, [...lage.mandantIds], team, person,
    Math.trunc(lage.grenze ?? 1500),
  ];
  const alle: GruppenKalenderZeile[] = [];

  for (const t of teile()) {
    if (!zeigt(lage, t.quelle)) continue;
    /*
     * **Ein Filter, der eine Quelle nicht betrifft, entfernt sie — er
     * schweigt nicht darueber.** Eine Vergabefrist gehoert der Gesellschaft
     * und keinem Menschen; sie bei gesetztem Personenfilter mitzuzeigen
     * hiesse, sie diesem Menschen zuzuschreiben. Sie stillschweigend
     * stehenzulassen waere die andere Haelfte desselben Fehlers. Die Seite
     * sagt deshalb daneben, welche Quellen der Filter ausblendet.
     */
    if ((team !== null || person !== null) && !t.mitPersonenbezug) continue;
    const zeilen = await kontext.abfrage<GruppenKalenderZeile>(
      `${t.sql} limit $6::integer`, werte);
    alle.push(...zeilen.map((z) => ({ ...z, quelle: t.quelle })));
  }

  /*
   * Sortiert wird HIER und nicht je Abfrage: sechs sortierte Listen
   * hintereinander sind keine sortierte Liste. Ganztaegiges zuerst innerhalb
   * eines Tages — so liest man einen Kalender.
   */
  return [...alle].sort((a, b) => {
    if (a.beginn !== b.beginn) return a.beginn < b.beginn ? -1 : 1;
    if (a.ganztaegig !== b.ganztaegig) return a.ganztaegig ? -1 : 1;
    return a.titel.localeCompare(b.titel, 'de');
  });
}

/**
 * Welche Quelle in welcher Gesellschaft lesbar ist.
 *
 * Nur für die Legende: eine leere Woche in der Security kann „nichts
 * geplant" heissen oder „kein Dienstplanrecht", und die beiden sehen im
 * Kalender gleich aus. Gefiltert wird trotzdem von RLS — diese Karte
 * entscheidet nichts, sie erklärt.
 */
export async function quellenRechte(
  kontext: LeseKontext,
): Promise<ReadonlyMap<string, ReadonlySet<string>>> {
  return rechteJeBereich(kontext, [
    ...new Set(Object.values(QUELLEN_RECHT)), PERSONENFILTER_RECHT,
  ]);
}

/** Die Teams, nach denen gefiltert werden kann — je Gesellschaft (CAL-02, §7.5). */
export async function gruppenTeams(
  kontext: LeseKontext, mandantIds: readonly string[],
): Promise<readonly TeamWahl[]> {
  return kontext.abfrage<TeamWahl>(
    `select t.id, t.name, m.slug as "bereichSlug", m.name as "bereichName"
       from team t
       join mandant m on m.id = t.mandant_id
      where t.geloescht_am is null and t.mandant_id = any ($1::uuid[])
      order by m.sortierung, m.slug, t.name
      limit 200`,
    [[...mandantIds]],
  );
}

/**
 * Die Menschen, nach denen gefiltert werden kann.
 *
 * **Eingeschränkt auf die Gesellschaften mit `gruppe.personal.lesen`** —
 * nicht auf alle sichtbaren. `t_person_lesen` (0004) und
 * `t_anstellung_lesen` prüfen dieses Recht NICHT: sie geben jede Person jeder
 * sichtbaren Gesellschaft heraus. Die Einschränkung steht deshalb hier, in
 * der Abfrage, und dieselbe Liste ist die Grundlage von
 * `/portal/gruppe/personen`.
 */
export async function gruppenPersonen(
  kontext: LeseKontext, mandantIds: readonly string[],
): Promise<readonly PersonWahl[]> {
  const zeilen = await kontext.abfrage<{
    id: string; vorname: string; nachname: string; bereiche: readonly string[];
  }>(
    `select p.id, p.vorname, p.nachname, array_agg(distinct m.slug) as bereiche
       from person p
       join anstellung a on a.person_id = p.id and a.geloescht_am is null
                        and (a.austritt is null or a.austritt >= current_date)
       join mandant m on m.id = a.mandant_id
      where p.geloescht_am is null
        and a.mandant_id = any ($1::uuid[])
        and a.mandant_id = any (app.rechte_mandanten($2))
      group by p.id, p.vorname, p.nachname
      order by p.nachname, p.vorname
      limit 500`,
    [[...mandantIds], PERSONENFILTER_RECHT],
  );
  return zeilen.map((z) => ({
    id: z.id,
    name: `${z.vorname} ${z.nachname}`.trim(),
    bereiche: [...z.bereiche].sort(),
  }));
}
