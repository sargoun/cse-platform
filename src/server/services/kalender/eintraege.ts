import 'server-only';

/**
 * Der zentrale Kalender (CAL-01, CAL-02) — er SAMMELT, er kopiert nicht.
 *
 * **Die Entscheidung, die alles andere trägt.** Eine Schicht steht in
 * `einsatz`, ein Projekttermin in `projekt`, eine Vergabefrist in
 * `ausschreibung`. Der Kalender liest sie dort und reicht sie durch; er legt
 * keine zweite Zeile dafür an. Der Preis ist diese Datei — sechs Abfragen
 * statt einer. Der Gegenwert ist, dass eine im Dienstplan verschobene Schicht
 * im Kalender sofort verschoben ist, weil es DIESELBE Zeile ist.
 *
 * Die Alternative wäre eine Kalendertabelle, in die alles hineinkopiert wird.
 * Sie liest sich schöner und ist genau einmal richtig: bis zur ersten
 * Änderung, die nur eine der beiden Seiten erreicht. Danach hat die Frage
 * „wann arbeitet Fatima" zwei Antworten.
 *
 * **RLS entscheidet, was sichtbar ist — nicht diese Datei** (Invariante 3).
 * Jede Abfrage liest ihre Tabelle ohne `where mandant_id`, und die Policy
 * antwortet. Wer `zeit.lesen` nicht hält, sieht keine Schichten; wer
 * `vergabe.lesen` nicht hält, keine Fristen. Der Kalender ist damit je Mensch
 * verschieden, und zwar ohne eine einzige Rechtefrage in diesem Code.
 */

import type { Abfrage } from '../bericht/kennzahlen.js';
import type { Zeitraum } from '../bericht/zeitraum.js';

/**
 * Woher ein Eintrag stammt. Sie steht in jeder Zeile, weil ein Kalender ohne
 * Herkunft eine Liste von Balken ist: „warum steht das da" ist die erste
 * Frage, die jemand stellt.
 */
export type Quelle =
  | 'termin'      // kalender_eintrag — was der Kalender selbst besitzt
  | 'einsatz'     // Dienstplan
  | 'projekt'     // Soll- und Ist-Ende
  | 'vergabe'     // Angebotsfrist einer Ausschreibung
  | 'freigabe'    // Frist im Freigabe-Posteingang
  | 'lead';       // SLA-Frist einer Anfrage

export interface KalenderZeile {
  readonly id: string;
  readonly quelle: Quelle;
  readonly titel: string;
  readonly beginn: string;
  readonly ende: string;
  readonly ganztaegig: boolean;
  readonly ort: string | null;
  readonly beschreibung: string | null;
  readonly abgesagt: boolean;
  readonly geaendert: string | null;
  /** Wohin der Eintrag führt — ein Kalender ohne Weg zum Vorgang ist ein Bild. */
  readonly weg: string | null;
}

export interface Lage {
  readonly zeitraum: Zeitraum;
  /** Nur Einträge dieses Menschen (CAL-02, und der iCal-Feed). */
  readonly nurBenutzerId?: string | null;
  /** Nur diese Herkünfte — die Filterleiste der Seite. */
  readonly nurQuellen?: readonly Quelle[] | null;
}

const zeigt = (lage: Lage, q: Quelle): boolean =>
  lage.nurQuellen === undefined || lage.nurQuellen === null || lage.nurQuellen.includes(q);

/**
 * **Die Zeitgrenzen als `timestamptz`, aus dem BERLINER Tag gerechnet.**
 *
 * `von` ist der Beginn des Berliner Tages, `bis` das Ende des Berliner
 * Tages — beides als Instant. Wer stattdessen `beginn::date between …`
 * filterte, verglich ein UTC-Datum mit einem Berliner und verlöre jede Nacht
 * zwischen Mitternacht und zwei Uhr (Invariante 2).
 */
const FENSTER = `
  ($1 || ' 00:00')::timestamp at time zone 'Europe/Berlin'`;
const FENSTER_ENDE = `
  (($2 || ' 00:00')::timestamp + interval '1 day') at time zone 'Europe/Berlin'`;

export async function kalenderZeilen(
  db: Abfrage, lage: Lage, mandantSlug: string,
): Promise<readonly KalenderZeile[]> {
  const w = [lage.zeitraum.von, lage.zeitraum.bis, lage.nurBenutzerId ?? null];
  const alle: KalenderZeile[] = [];

  if (zeigt(lage, 'termin')) {
    const zeilen = await db.abfrage<KalenderZeile>(
      `select k.id::text as id, 'termin'::text as quelle, k.titel,
              k.beginn::text as beginn, k.ende::text as ende,
              k.ganztaegig, k.ort, k.beschreibung,
              (k.abgesagt_am is not null) as abgesagt,
              coalesce(k.geaendert_am, k.erstellt_am)::text as geaendert,
              '/portal/${mandantSlug}/kalender/' || k.id::text as weg
         from kalender_eintrag k
        where k.beginn < ${FENSTER_ENDE} and k.ende >= ${FENSTER}
          and ($3::uuid is null
               or k.besitzer_benutzer_id = $3::uuid
               or $3::uuid = any (k.teilnehmer))`, w);
    alle.push(...zeilen);
  }

  if (zeigt(lage, 'einsatz')) {
    /*
     * **Die Schicht kommt aus dem Dienstplan, nicht aus einer Kopie.**
     * `einsatz_zuordnung` sagt, WER sie hat -- ohne sie zeigte der
     * persoenliche Kalender fremde Schichten, und mit `distinct` zeigt er
     * eine Schicht mit drei Menschen einmal und nicht dreimal.
     */
    const zeilen = await db.abfrage<KalenderZeile>(
      `select distinct on (e.id)
              e.id::text as id, 'einsatz'::text as quelle,
              coalesce(o.bezeichnung, 'Einsatz') as titel,
              e.beginn_zeitpunkt::text as beginn, e.ende_zeitpunkt::text as ende,
              false as ganztaegig,
              nullif(concat_ws(', ', o.strasse, o.ort), '') as ort,
              case when e.status = 'storniert' then 'Abgesagt' else null end as beschreibung,
              (e.status = 'storniert') as abgesagt,
              e.erstellt_am::text as geaendert,
              '/portal/${mandantSlug}/dienstplan' as weg
         from einsatz e
         left join objekt o on o.id = e.objekt_id
         left join einsatz_zuordnung z
                on z.einsatz_id = e.id and z.status in ('geplant', 'zugesagt')
         left join anstellung a on a.id = z.anstellung_id
         left join benutzer b on b.person_id = a.person_id
        where e.beginn_zeitpunkt < ${FENSTER_ENDE} and e.ende_zeitpunkt >= ${FENSTER}
          and ($3::uuid is null or b.id = $3::uuid)
        order by e.id, e.beginn_zeitpunkt`, w);
    alle.push(...zeilen);
  }

  /*
   * **Fristen sind GANZTAEGIG.** Eine Angebotsfrist "am 30. September" ist
   * kein Termin um 00:00; als Zeitpunkt gezeigt stuende sie ganz oben im Tag
   * und saehe aus wie der erste Termin des Morgens. Ganztaegig ist sie das,
   * was sie ist: eine Eigenschaft des Tages.
   */
  const fristen: readonly { quelle: Quelle; sql: string }[] = [
    {
      quelle: 'projekt',
      sql: `select p.id::text as id, 'projekt'::text as quelle,
                   'Projektende: ' || p.bezeichnung as titel,
                   coalesce(p.ist_ende, p.soll_ende)::text as beginn,
                   coalesce(p.ist_ende, p.soll_ende)::text as ende,
                   true as ganztaegig, null::text as ort,
                   case when p.ist_ende is not null then 'Abgeschlossen'
                        else 'Geplantes Ende' end as beschreibung,
                   false as abgesagt, p.erstellt_am::text as geaendert,
                   '/portal/${mandantSlug}/bau/projekte/' || p.id::text as weg
              from projekt p
             where p.archiviert_am is null
               and coalesce(p.ist_ende, p.soll_ende) between $1::date and $2::date
               and $3::uuid is null`,
    },
    {
      quelle: 'vergabe',
      sql: `select v.id::text as id, 'vergabe'::text as quelle,
                   'Angebotsfrist: ' || a.titel as titel,
                   a.frist_angebot::text as beginn, a.frist_angebot::text as ende,
                   true as ganztaegig, null::text as ort,
                   'Vergabeverfahren' as beschreibung, false as abgesagt,
                   v.erstellt_am::text as geaendert,
                   '/portal/${mandantSlug}/radar/vorgaenge/' || v.id::text as weg
              from ausschreibung_vorgang v
              join ausschreibung a on a.id = v.ausschreibung_id
             where v.geloescht_am is null
               and a.frist_angebot is not null
               and a.frist_angebot::date between $1::date and $2::date
               and $3::uuid is null`,
    },
    {
      quelle: 'freigabe',
      sql: `select f.id::text as id, 'freigabe'::text as quelle,
                   'Freigabe fällig: ' || coalesce(f.titel, f.aktion) as titel,
                   f.frist::text as beginn, f.frist::text as ende,
                   true as ganztaegig, null::text as ort,
                   'Wartet auf eine Entscheidung' as beschreibung, false as abgesagt,
                   f.erstellt_am::text as geaendert,
                   '/portal/${mandantSlug}/freigaben/' || f.id::text as weg
              from freigabe f
             where f.status = 'offen' and f.frist is not null
               and f.frist::date between $1::date and $2::date
               and ($3::uuid is null or f.zugewiesen_an = $3::uuid)`,
    },
    {
      quelle: 'lead',
      sql: `select l.id::text as id, 'lead'::text as quelle,
                   'Anfrage beantworten: ' || l.firma_name as titel,
                   l.sla_frist_am::text as beginn, l.sla_frist_am::text as ende,
                   true as ganztaegig, null::text as ort,
                   l.betreff as beschreibung, false as abgesagt,
                   l.erstellt_am::text as geaendert,
                   '/portal/${mandantSlug}/crm/leads/' || l.id::text as weg
              from lead l
             where l.status in ('neu', 'in_bearbeitung', 'angebot')
               and l.sla_frist_am is not null
               and l.sla_frist_am::date between $1::date and $2::date
               and ($3::uuid is null or l.besitzer_benutzer_id = $3::uuid)`,
    },
  ];

  for (const f of fristen) {
    if (!zeigt(lage, f.quelle)) continue;
    alle.push(...await db.abfrage<KalenderZeile>(f.sql, w));
  }

  /*
   * Sortiert wird HIER und nicht je Abfrage: sechs sortierte Listen
   * hintereinander sind keine sortierte Liste. Ganztaegiges zuerst innerhalb
   * eines Tages -- so liest man einen Kalender.
   */
  return [...alle].sort((a, b) => {
    if (a.beginn !== b.beginn) return a.beginn < b.beginn ? -1 : 1;
    if (a.ganztaegig !== b.ganztaegig) return a.ganztaegig ? -1 : 1;
    return a.titel.localeCompare(b.titel, 'de');
  });
}
