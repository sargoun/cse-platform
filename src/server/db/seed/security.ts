/**
 * Demodaten fuer die Security — Posten, Plan und Einteilung (SEC-01, D-09).
 *
 * **Ohne diese Datei hat die Security keinen einzigen Dienst.** Das war nicht
 * bloss eine Luecke im Schaufenster: Fatima Yildiz ist der D-09-Fall — ein
 * Mensch, zwei Gesellschaften —, und ihr Mitarbeiterportal versprach beide
 * Schichtlisten, beide Stundenkonten, beide Monatsnachweise. Geliefert wurde
 * eine Gesellschaft. Kein Fehler, keine Meldung, nur die halbe Wahrheit auf
 * einem Bildschirm, der vollstaendig aussah.
 *
 * **Der Posten laeuft ueber den ECHTEN Generator**, wie die Reinigung ihre
 * Turnusse: `posten` → `planungsserie` → `app.planungsbedarf` →
 * `generiereEinsaetze`. Ein Seed, der `einsatz`-Zeilen direkt schreibt, prueft
 * nur, dass sich Zeilen schreiben lassen.
 *
 * **Die Lage des Dienstes ist ausgerechnet, nicht gewaehlt:** Dienstag und
 * Donnerstag 08:00–16:00. Der erste Versuch legte ihn auf 14:00–22:00 — und
 * der Besetzungsdienst wies ihn zurueck, zu Recht: die Reinigung beginnt
 * Mittwoch und Freitag um 06:00, und zwischen 22:00 und 06:00 liegen acht
 * Stunden, nicht die elf des § 5 ArbZG. Die Grenzen gelten dem MENSCHEN und
 * nicht dem Mandanten (D-09), also stolperte die zweite Gesellschaft ueber
 * die erste. Mit 16:00 Dienstschluss bleiben vierzehn Stunden bis zur
 * Fruehschicht.
 *
 * Das ist keine Anekdote, sondern der Grund, warum dieser Seed ueber
 * `besetzeEinsatz` laeuft und nicht ueber ein `insert`: ein direktes Einfuegen
 * haette die Zeilen geschrieben, der Bildschirm haette voll ausgesehen, und
 * die erste echte Doppelbeschaeftigung waere in einen Verstoss gelaufen, den
 * die Demo taeglich vorgefuehrt hat, ohne ihn zu zeigen.
 *
 * // TODO(client, O-342): Welche Qualifikation verlangt welcher Posten —
 * genuegt die Unterrichtung nach §34a Abs. 1a GewO, oder verlangt der
 * Objektschutz am Kurfürstendamm die Sachkundeprüfung? Bis zur Antwort traegt
 * der Demoposten KEINE `einsatzanforderung`; die Sperre ist gebaut und
 * geprueft (`app.einsatz_qualifikation_erfuellt`), aber welche Zeile sie
 * scharf stellt, entscheidet der Vertrag und nicht dieser Seed.
 *
 * **Idempotent durch LESEN ZUERST** — wie die uebrigen Seed-Dateien.
 */
import type postgres from 'postgres';
import {
  berlinHeute, generiereEinsaetze, type Abfrage,
} from '../../services/dienstplan/generator.js';
import { montag, tagePlus } from '@/lib/datum/kalendertag';
import { besetzeUndErfasse } from './zeit.js';

type Sql = postgres.Sql<Record<string, unknown>>;

export interface SecurityErgebnis {
  readonly posten: number;
  readonly einsaetze: number;
  readonly einteilungen: number;
  readonly zeiteintraege: number;
}

const POSTEN = {
  bezeichnung: 'Objektschutz Empfang — Tagdienst',
  kurzzeichen: 'OS-TD',
  rrule: 'FREQ=WEEKLY;BYDAY=TU,TH',
  beginnLokal: '08:00',
  dauerMinuten: 480,
  /**
   * EINER, nicht zwei.
   *
   * `min_besetzung` ist die Spalte, die es nur beim Posten gibt, und sie ist
   * teuer: faellt die Besetzung darunter, steht der Posten im
   * Dringlichkeitsblock und ist nicht veroeffentlichbar (SEC-01). Ein
   * Demoposten mit zwei Plaetzen und einer Belegschaft von zwei Menschen
   * stuende dauerhaft rot da — und der Dringlichkeitsblock, der eine echte
   * Unterbesetzung melden soll, waere Grundrauschen.
   */
  minBesetzung: 1,
  sollBesetzung: 1,
} as const;

export async function seedSecurity(
  sql: Sql, ids: ReadonlyMap<string, string>,
): Promise<SecurityErgebnis> {
  const leer: SecurityErgebnis = {
    posten: 0, einsaetze: 0, einteilungen: 0, zeiteintraege: 0,
  };
  const mandantId = ids.get('security');
  if (mandantId === undefined) throw new Error('Bereich security fehlt');

  const [objekt] = await sql<{ id: string }[]>`
    select id from objekt
     where mandant_id = ${mandantId} and archiviert_am is null and kunde_id is not null
     order by objektnummer limit 1`;
  if (objekt === undefined) return leer;

  const [planer] = await sql<{ id: string }[]>`
    select b.id from benutzer b
     join benutzer_mandant bm on bm.benutzer_id = b.id and bm.mandant_id = ${mandantId}
     join rolle r on r.id = bm.rolle_id
    where r.schluessel in ('admin', 'leitung', 'super_admin') and b.status = 'aktiv'
      and bm.entzogen_am is null
    order by r.schluessel limit 1`;
  if (planer === undefined) return leer;

  /**
   * Derselbe Anker wie beim Dienstplan der Reinigung: drei Wochen vor dem
   * Montag dieser Woche. Ohne Vergangenheit gibt es nichts zu erfassen, und
   * ohne erfasste Zeit bleibt das zweite Stundenkonto leer — also genau der
   * Bildschirm, den diese Datei fuellen soll.
   */
  const heute = await berlinHeute(sql as unknown as Abfrage);
  const anker = tagePlus(montag(heute), -21);

  let posten = 0;
  const [da] = await sql<{ id: string }[]>`
    select id from posten
     where mandant_id = ${mandantId} and objekt_id = ${objekt.id}
       and kurzzeichen = ${POSTEN.kurzzeichen} and archiviert_am is null limit 1`;
  const postenId = da?.id ?? (await sql<{ id: string }[]>`
    insert into posten (mandant_id, objekt_id, bezeichnung, kurzzeichen,
                        min_besetzung, soll_besetzung, abdeckung_rrule, dtstart_lokal,
                        zeitzone, dauer_minuten, gueltig_ab, erstellt_von_art)
    values (${mandantId}, ${objekt.id}, ${POSTEN.bezeichnung}, ${POSTEN.kurzzeichen},
            ${POSTEN.minBesetzung}, ${POSTEN.sollBesetzung}, ${POSTEN.rrule},
            ${`${anker} ${POSTEN.beginnLokal}`}::timestamp, 'Europe/Berlin',
            ${POSTEN.dauerMinuten}, ${anker}::date, 'system')
    returning id`)[0]!.id;
  if (da === undefined) posten += 1;

  const [serieDa] = await sql<{ id: string }[]>`
    select id from planungsserie
     where mandant_id = ${mandantId} and posten_id = ${postenId}
       and archiviert_am is null limit 1`;
  if (serieDa === undefined) {
    /**
     * `feiertage_ueberspringen = false` — und das ist die Aussage, nicht die
     * Vorgabe. 0028 §8.5 laesst fuer Posten bewusst keinen Vorgabewert zu:
     * ein stillschweigend uebersprungener Feiertag liesse die Weihnachtsnacht
     * UNBESETZT, und das faellt erst auf, wenn niemand da ist.
     */
    await sql`
      insert into planungsserie (mandant_id, posten_id, quelle, zeitzone,
                                 feiertage_ueberspringen, feiertag_bundesland,
                                 horizont_tage, erstellt_von_art)
      values (${mandantId}, ${postenId}, 'posten', 'Europe/Berlin',
              false, 'BE', 56, 'system')`;
  }

  const berichte = await generiereEinsaetze(sql as unknown as Abfrage, mandantId, {
    heute: anker, laufId: null,
  });
  const einsaetze = berichte.reduce((a, b) => a + b.erzeugt + b.aktualisiert, 0);

  const anstellungen = (await sql<{ id: string }[]>`
    select a.id from anstellung a
     where a.mandant_id = ${mandantId} and a.status = 'aktiv' and a.geloescht_am is null
     order by a.personalnummer`).map((a) => a.id);
  if (anstellungen.length === 0) return { ...leer, posten, einsaetze };

  const lauf = await besetzeUndErfasse(sql, mandantId, planer.id, anstellungen, heute);
  return {
    posten, einsaetze,
    einteilungen: lauf.einteilungen,
    zeiteintraege: lauf.erfasst,
  };
}
