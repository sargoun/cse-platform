import 'server-only';

/**
 * Die beiden Dienstplanwachen aus SPEC §14 (TIM-05, PLN-06, NOT-01).
 *
 *   | Schicht beendet, kein `zeiteintrag` | stündlich | Planer benachrichtigen |
 *   | Morgen unbesetzt                    | täglich 18:00 | dringend melden   |
 *
 * **Warum sie zusammen in einer Datei stehen.** Sie beantworten dieselbe
 * Frage aus zwei Richtungen: stimmt der Plan noch mit der Wirklichkeit
 * überein? Die eine sieht zurück (geplant, aber nicht gearbeitet — oder
 * gearbeitet und nicht erfasst), die andere nach vorn (morgen fehlt jemand).
 * Beide melden an DIESELBEN Menschen, und beide teilen sich das Gedächtnis
 * in `waechter_meldung`.
 *
 * **Kein Sprachmodell, nirgends.** SPEC §14 sagt es ausdrücklich: „Plain
 * scheduled jobs, no LLM." Das hier sind zwei Abfragen und ein Vergleich.
 */

export interface Abfrage {
  unsafe(sql: string, werte?: readonly unknown[]): Promise<readonly unknown[]>;
}

export interface OffeneSchicht {
  readonly mandantId: string;
  readonly mandantSlug: string;
  readonly zuordnungId: string;
  readonly einsatzId: string;
  readonly personName: string;
  readonly objektName: string | null;
  readonly endeLokal: string;
  readonly stundenHer: number;
}

export interface UnbesetzteSchicht {
  readonly mandantId: string;
  readonly mandantSlug: string;
  readonly einsatzId: string;
  readonly objektName: string | null;
  readonly beginnLokal: string;
  readonly soll: number;
  readonly besetzt: number;
  readonly tag: string;
}

/**
 * **Schicht beendet, kein Zeiteintrag.**
 *
 * `zugesagt` und nicht `geplant`: wer nur eingeteilt, aber nicht zugesagt
 * war, hat nicht versprochen zu kommen — das ist eine Besetzungslücke und
 * gehört in die andere Wache, nicht in diese.
 *
 * **Zwei Stunden Nachlauf, nicht null.** Ein Mitarbeiter, dessen Schicht um
 * 22:00 endet, hat um 22:01 noch nicht ausgestempelt; eine stündliche Wache
 * ohne Nachlauf meldete jede Schicht in der Minute ihres Endes und würde
 * damit zur Uhr, nicht zur Warnung. Zwei Stunden sind der Abstand, nach dem
 * ein fehlender Eintrag keine Verzögerung mehr ist, sondern ein Versäumnis —
 * und die Nacherfassung (TIM-07) ist genau der Weg, ihn dann noch zu setzen.
 *
 * **Ein stornierter Einsatz zählt nicht**, und eine `abgesagte` oder
 * `ersetzte` Zuordnung auch nicht: dort war am Ende niemand eingeteilt.
 */
export const NACHLAUF_STUNDEN = 2;

const OFFENE_SCHICHTEN_SQL = `
  select ez.mandant_id, m.slug as mandant_slug, ez.id as zuordnung_id, e.id as einsatz_id,
         coalesce(p.vorname || ' ' || p.nachname, 'unbekannt') as person_name,
         o.bezeichnung as objekt_name,
         to_char(e.ende_zeitpunkt at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI') as ende_lokal,
         floor(extract(epoch from (now() - e.ende_zeitpunkt)) / 3600)::int as stunden_her
    from einsatz_zuordnung ez
    join einsatz e on e.id = ez.einsatz_id and e.mandant_id = ez.mandant_id
    join mandant m on m.id = ez.mandant_id
    left join person p on p.id = ez.person_id
    left join objekt o on o.id = e.objekt_id
   where ez.status = 'zugesagt'
     and ez.entfernt_am is null
     and e.status <> 'storniert'
     and e.storniert_am is null
     and e.ende_zeitpunkt < now() - ($1 || ' hours')::interval
     /* Nicht die halbe Vergangenheit aufrollen: der Lauf ist stuendlich. */
     and e.ende_zeitpunkt > now() - interval '7 days'
     and not exists (
       select 1 from zeiteintrag z
        where z.einsatz_zuordnung_id = ez.id
          and z.status <> 'storniert'
          and z.storniert_am is null)
   order by e.ende_zeitpunkt`;

export async function findeOffeneSchichten(
  db: Abfrage, nachlaufStunden: number = NACHLAUF_STUNDEN,
): Promise<readonly OffeneSchicht[]> {
  const zeilen = (await db.unsafe(
    OFFENE_SCHICHTEN_SQL, [String(nachlaufStunden)])) as readonly Record<string, unknown>[];
  return zeilen.map((z) => ({
    mandantId: String(z['mandant_id']),
    mandantSlug: String(z['mandant_slug']),
    zuordnungId: String(z['zuordnung_id']),
    einsatzId: String(z['einsatz_id']),
    personName: String(z['person_name']),
    objektName: (z['objekt_name'] as string | null) ?? null,
    endeLokal: String(z['ende_lokal']),
    stundenHer: Number(z['stunden_her']),
  }));
}

/**
 * **Morgen unbesetzt.**
 *
 * Gezählt werden die ZUSAGEN, nicht die Einteilungen: eine Schicht, für die
 * drei Leute eingeteilt sind und niemand zugesagt hat, ist morgen leer. Der
 * gespeicherte Zähler `einsatz.besetzt_anzahl` wird bewusst nicht benutzt —
 * er ist ein abgeleiteter Wert, und eine Wache, die einen abgeleiteten Wert
 * gegen die Wirklichkeit prüfen soll, darf nicht denselben Wert lesen.
 *
 * **Die Untergrenze ist `min_besetzung`.** Eine Schicht mit Soll 3 und
 * Minimum 2 ist mit zwei Leuten knapp, aber machbar; sie als „unbesetzt" zu
 * melden, hiesse jeden Abend dieselbe Meldung zu schicken, bis niemand mehr
 * hinsieht. Ein `coalesce` auf das Soll braucht es nicht: `min_besetzung >= 1
 * and <= soll_besetzung` steht als CHECK in 0028 — die Spalte ist nie leer
 * und nie null, und eine Abfrage, die sich dagegen absichert, behauptet einen
 * Zustand, den die Datenbank nicht zulässt.
 *
 * **„Morgen" ist ein Berliner Kalendertag** (Invariante 2, K-11): der Lauf um
 * 18:00 Ortszeit meint den Tag, der um Mitternacht in Berlin beginnt, nicht
 * die nächsten 24 Stunden.
 */
const UNBESETZT_SQL = `
  with morgen as (select (app.berlin_heute() + 1) as tag)
  select e.mandant_id, m.slug as mandant_slug, e.id as einsatz_id,
         o.bezeichnung as objekt_name,
         to_char(e.beginn_zeitpunkt at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
           as beginn_lokal,
         e.min_besetzung as soll,
         (select count(*) from einsatz_zuordnung z
           where z.einsatz_id = e.id and z.status = 'zugesagt' and z.entfernt_am is null)::int
           as besetzt,
         (select tag from morgen)::text as tag
    from einsatz e
    join mandant m on m.id = e.mandant_id
    left join objekt o on o.id = e.objekt_id
   where e.status <> 'storniert'
     and e.storniert_am is null
     and (e.beginn_zeitpunkt at time zone 'Europe/Berlin')::date = (select tag from morgen)
     and (select count(*) from einsatz_zuordnung z
           where z.einsatz_id = e.id and z.status = 'zugesagt' and z.entfernt_am is null)
         < e.min_besetzung
   order by e.beginn_zeitpunkt`;

export async function findeUnbesetzteSchichten(
  db: Abfrage,
): Promise<readonly UnbesetzteSchicht[]> {
  const zeilen = (await db.unsafe(UNBESETZT_SQL)) as readonly Record<string, unknown>[];
  return zeilen.map((z) => ({
    mandantId: String(z['mandant_id']),
    mandantSlug: String(z['mandant_slug']),
    einsatzId: String(z['einsatz_id']),
    objektName: (z['objekt_name'] as string | null) ?? null,
    beginnLokal: String(z['beginn_lokal']),
    soll: Number(z['soll']),
    besetzt: Number(z['besetzt']),
    tag: String(z['tag']),
  }));
}

/**
 * Die Empfänger einer Dienstplanmeldung: wer den Dienstplan schreibt.
 *
 * SPEC §14 sagt „notify planner" und nennt kein Feld — es gibt auch keines.
 * `kern.traeger_des_rechts` beantwortet die Frage aus derselben Auflösung,
 * mit der die Seite später entscheidet, ob jemand sie überhaupt öffnen darf
 * (D-494). Eine Meldung an jemanden, der die Zielseite nicht sehen kann,
 * wäre NOT-03 ins Gesicht geschlagen.
 */
export async function planer(db: Abfrage, mandantId: string): Promise<readonly string[]> {
  const [z] = (await db.unsafe(
    `select kern.traeger_des_rechts($1::uuid, 'dienstplan.schreiben') as ids`,
    [mandantId])) as readonly { ids: string[] | null }[];
  return z?.ids ?? [];
}

/**
 * Hat diese Wache diesen Menschen zu dieser Lage schon benachrichtigt?
 *
 * Geschrieben wird VOR der Zustellung, und der Eindeutigkeitsschlüssel
 * entscheidet — dieselbe Reihenfolge wie beim Radar (0148): andersherum
 * stünde die Meldung nach einem Abbruch zweimal im Posteingang.
 */
export async function quittiere(
  db: Abfrage,
  m: {
    readonly mandantId: string; readonly waechter: string; readonly objektTyp: string;
    readonly objektId: string; readonly empfaengerId: string; readonly kennung: string;
  },
): Promise<string | null> {
  const zeilen = (await db.unsafe(
    `insert into waechter_meldung
       (mandant_id, waechter, objekt_typ, objekt_id, empfaenger_id, kennung)
     values ($1::uuid, $2, $3, $4::uuid, $5::uuid, $6)
     on conflict do nothing
     returning id`,
    [m.mandantId, m.waechter, m.objektTyp, m.objektId, m.empfaengerId, m.kennung],
  )) as readonly { id: string }[];
  return zeilen.length === 1 ? (zeilen[0] as { id: string }).id : null;
}

/**
 * **Die Quittung wieder zurücknehmen, wenn nichts zugestellt wurde.**
 *
 * Der Anspruch (`quittiere`) muss VOR der Zustellung stehen, sonst melden zwei
 * gleichzeitige Läufe dieselbe Lage zweimal. Bleibt die Zustellung dann aber
 * bei null — ein stillgelegtes Konto, ein fehlendes Ziel —, wäre die Quittung
 * ein Gedächtnis an etwas, das nie geschah: der nächste Lauf fände sie vor und
 * schwiege für immer. Also: Anspruch nehmen, zustellen, und bei null den
 * Anspruch zurückgeben.
 */
export async function gibQuittungZurueck(db: Abfrage, id: string): Promise<void> {
  await db.unsafe(`delete from waechter_meldung where id = $1::uuid`, [id]);
}
