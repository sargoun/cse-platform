/**
 * Demodaten fuer Phase 5 — Dienstplan (TIM-02, TIM-03, CLN-02, CLN-03).
 *
 * Ohne diese Datei zeigt der Dienstplan eine leere Woche, und zwar auf jedem
 * Bildschirm gleich ueberzeugend: keine Fehlermeldung, keine Luecke, nur
 * nichts. Genau das ist die Sorte Zustand, in der ein Fehler im Generator
 * monatelang niemandem auffaellt.
 *
 * Angelegt wird die Kette, auf der die Abnahme steht:
 * Objekt → Revier → Turnus (mit RRULE) → Planungsserie — und dann laeuft der
 * **echte** Generator darueber. Nicht eine Handvoll `einsatz`-Zeilen per
 * INSERT: die pruefen nur, dass sich Zeilen schreiben lassen. Der Lauf prueft
 * den Weg, den auch die Nacht nimmt.
 *
 * Eine der Serien ist mit Absicht eine **Nachtschicht 22:00–06:00**. Sie ist
 * der Fall, an dem sich die Zeitrechnung entscheidet (K-11), und sie gehoert
 * in die Demodaten, damit jemand sie ansieht, bevor eine Zeitumstellung sie
 * ansieht.
 *
 * **Idempotent durch LESEN ZUERST** — wie `operations.ts` und aus demselben
 * Grund: die natuerlichen Schluessel liegen auf teilweisen Indizes.
 */
import type postgres from 'postgres';
import {
  berlinHeute, generiereEinsaetze, type Abfrage,
} from '../../services/dienstplan/generator.js';
import {
  pflegeFeiertage, pflegeJahre, type FeiertagPflegeBericht,
} from '../../services/dienstplan/feiertage.js';
import { montag, tagePlus } from '@/lib/datum/kalendertag';

type Sql = postgres.Sql<Record<string, unknown>>;

interface TurnusVorgabe {
  readonly revier: string;
  readonly kurzzeichen: string;
  readonly sollzeit: number;
  readonly bezeichnung: string;
  readonly rrule: string;
  /** Wanduhr, ohne Zone — `03-GEWERKE.md` §10.1. */
  readonly beginnLokal: string;
  readonly dauerMinuten: number;
  readonly feiertagsregel: 'ausfall' | 'unveraendert';
}

/**
 * Drei Turnusse je Objekt — und der dritte ist der interessante.
 *
 * Unterhaltsreinigung morgens ist der Regelfall. Die Glasreinigung im
 * Monatsrhythmus prueft `FREQ=MONTHLY`. Die Nachtschicht prueft die
 * Zeitumstellung und den Uebertrag ueber Mitternacht.
 */
const TURNUSSE: readonly TurnusVorgabe[] = [
  {
    revier: 'Bürogeschosse', kurzzeichen: 'BG', sollzeit: 210,
    bezeichnung: 'Unterhaltsreinigung Büro',
    rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR', beginnLokal: '06:00',
    dauerMinuten: 210, feiertagsregel: 'ausfall',
  },
  {
    revier: 'Glasflächen', kurzzeichen: 'GL', sollzeit: 180,
    bezeichnung: 'Glasreinigung monatlich',
    rrule: 'FREQ=MONTHLY;BYMONTHDAY=15', beginnLokal: '08:00',
    dauerMinuten: 180, feiertagsregel: 'ausfall',
  },
  {
    revier: 'Nachtreinigung Halle', kurzzeichen: 'NH', sollzeit: 480,
    bezeichnung: 'Grundreinigung Nachtschicht',
    rrule: 'FREQ=WEEKLY;BYDAY=SA', beginnLokal: '22:00',
    dauerMinuten: 480, feiertagsregel: 'unveraendert',
  },
];

export interface DienstplanErgebnis {
  readonly reviere: number;
  readonly turnusse: number;
  readonly serien: number;
  readonly einsaetze: number;
}

/**
 * Der Feiertagskalender VOR dem ersten Generatorlauf (V-178, D-672).
 *
 * Derselbe Dienst wie der Nachtlauf `feiertage_pflegen`, mit einem Jahr mehr
 * nach hinten: der Seed legt drei Wochen Vergangenheit an, und im Januar
 * liegen die im Vorjahr. Ohne diesen Schritt plante der Seed genau den Fehler
 * vor, den der Befund beschreibt — die Nachtreinigung am 3. Oktober ohne
 * Feiertag, die Unterhaltsreinigung an einem Feiertag, der als Werktag galt.
 *
 * Geschrieben wird als Eigentuemer der Seed-Verbindung; im Betrieb schreibt
 * `cse_job` ueber `f_job` (0028). Dieselben Zeilen, derselbe
 * Konfliktschluessel — ein zweiter Seed traegt nichts doppelt ein.
 */
export async function seedFeiertage(sql: Sql): Promise<FeiertagPflegeBericht> {
  const [heute] = await sql<{ jahr: number }[]>`
    select extract(year from app.berlin_heute())::int as jahr`;
  const jahr = Number(heute?.jahr);
  return pflegeFeiertage(
    {
      abfrage: async <T,>(anweisung: string, werte: readonly unknown[] = []) =>
        (await sql.unsafe(anweisung, werte as never[])) as unknown as readonly T[],
    },
    [jahr - 1, ...pflegeJahre(jahr)],
  );
}

export async function seedDienstplan(
  sql: Sql, ids: ReadonlyMap<string, string>,
): Promise<DienstplanErgebnis> {
  const reinigung = ids.get('reinigung');
  if (reinigung === undefined) throw new Error('Bereich reinigung fehlt');

  const objekte = await sql<{ id: string; bezeichnung: string }[]>`
    select id, bezeichnung from objekt
     where mandant_id = ${reinigung} and archiviert_am is null
       and kunde_id is not null
     order by objektnummer limit 2`;
  if (objekte.length === 0) return { reviere: 0, turnusse: 0, serien: 0, einsaetze: 0 };

  const katalogPositionId = await katalogposition(sql, reinigung);

  /**
   * Der Anker liegt drei Wochen VOR dem Montag dieser Woche.
   *
   * Nicht aus Nostalgie: ohne Vergangenheit gibt es nichts zu erfassen. Ein
   * `zeiteintrag` haengt an einer Schicht, die stattgefunden hat, und mit
   * einem Plan, der heute beginnt, blieben Zeitliste, Live-Brett,
   * MiLoG-Aufzeichnung und Stundenkonto auf jedem Bildschirm leer — ohne
   * Fehlermeldung, ohne Luecke, nur nichts. Genau die Sorte Zustand, in der
   * ein Fehler monatelang niemandem auffaellt.
   *
   * Der Horizont der Serie (56 Tage) reicht vom Anker aus bis fuenf Wochen
   * in die Zukunft, die laufende Woche also in jedem Fall gefuellt.
   */
  const heute = await berlinHeute(sql as unknown as Abfrage);
  const dieseWoche = montag(heute);
  const anker = tagePlus(dieseWoche, -21);

  let reviere = 0;
  let turnusse = 0;
  let serien = 0;

  for (const objekt of objekte) {
    for (const v of TURNUSSE) {
      const revierId = await revier(sql, reinigung, objekt.id, v);
      if (revierId === null) continue;
      reviere += 1;

      const [vorhanden] = await sql<{ id: string }[]>`
        select id from turnus
         where mandant_id = ${reinigung} and revier_id = ${revierId}
           and archiviert_am is null limit 1`;
      const turnusId = vorhanden?.id ?? (await sql<{ id: string }[]>`
        insert into turnus (mandant_id, revier_id, leistungskatalog_position_id, bezeichnung,
                            rrule, dtstart_lokal, dauer_minuten, feiertagsregel,
                            gueltig_ab, erstellt_von_art)
        values (${reinigung}, ${revierId}, ${katalogPositionId}, ${v.bezeichnung},
                ${v.rrule}, ${`${anker} ${v.beginnLokal}`}::timestamp, ${v.dauerMinuten},
                ${v.feiertagsregel}::turnus_feiertagsregel, ${anker}::date, 'system')
        returning id`)[0]!.id;
      turnusse += 1;

      const [serieDa] = await sql<{ id: string }[]>`
        select id from planungsserie
         where mandant_id = ${reinigung} and turnus_id = ${turnusId}
           and archiviert_am is null limit 1`;
      if (serieDa === undefined) {
        await sql`
          insert into planungsserie (mandant_id, turnus_id, quelle, zeitzone,
                                     feiertage_ueberspringen, feiertag_bundesland,
                                     horizont_tage, erstellt_von_art)
          values (${reinigung}, ${turnusId}, 'turnus', 'Europe/Berlin',
                  ${v.feiertagsregel === 'ausfall'}, 'BE', 56, 'system')`;
      }
      serien += 1;
    }
  }

  /**
   * Eine dokumentierte Ausnahme — der Fall, den ein Screenshot braucht.
   *
   * Ohne sie sieht der Dienstplan aus wie ein Kalender, in dem nie etwas
   * dazwischenkommt. Sie traegt einen Grund, weil `turnus_ausnahme.grund`
   * ihn verlangt: ein EXDATE ohne Grund ist wertlos.
   */
  const [ersterTurnus] = await sql<{ id: string }[]>`
    select t.id from turnus t
     where t.mandant_id = ${reinigung} and t.rrule like 'FREQ=WEEKLY;BYDAY=MO%'
     order by t.erstellt_am limit 1`;
  if (ersterTurnus !== undefined) {
    // Die Ausnahme liegt in der ZUKUNFT: ein Ausfall, der schon vorbei ist,
    // erklaert im Plan nichts mehr.
    const tag = tagePlus(dieseWoche, 7);
    const [da] = await sql<{ id: string }[]>`
      select id from turnus_ausnahme
       where turnus_id = ${ersterTurnus.id} and datum = ${tag}::date limit 1`;
    if (da === undefined) {
      await sql`
        insert into turnus_ausnahme (mandant_id, turnus_id, datum, art, grund, erstellt_von_art)
        values (${reinigung}, ${ersterTurnus.id}, ${tag}::date, 'ausfall',
                'Objekt wegen Umbau geschlossen — vom Kunden schriftlich bestätigt.', 'system')`;
    }
  }

  /**
   * Und dann der ECHTE Lauf — vom Anker aus, nicht von heute: der Generator
   * beginnt bei dem Tag, den er bekommt, und ein Lauf ab heute liesse die
   * drei Wochen davor leer.
   */
  const berichte = await generiereEinsaetze(sql as unknown as Abfrage, reinigung, {
    heute: anker, laufId: null,
    /* Vom Anker aus, und der liegt drei Wochen zurück: nur der Seed legt
       Vergangenes an (V-135) — daran hängen Zeiteinträge und Nachweise. */
    vergangenheitAnlegen: true,
  });
  const einsaetze = berichte.reduce((a, b) => a + b.erzeugt + b.aktualisiert, 0);
  return { reviere, turnusse, serien, einsaetze };
}

/**
 * Die Katalogposition, an der ein Turnus haengt (CLN-05).
 *
 * Der gepflegte Katalog kommt aus `pnpm katalog` und ist beim Seed noch nicht
 * da. Statt hier auszusteigen — und damit einen leeren Dienstplan zu
 * hinterlassen, der wie ein Fehler des Generators aussieht — entsteht eine
 * ausdruecklich als Platzhalter markierte Zeile. `ist_platzhalter = true` ist
 * dabei kein Schmuck: die Oberflaeche zeigt sie als solche an, und der
 * Produktionsbuild bricht darauf ab.
 */
async function katalogposition(sql: Sql, mandant: string): Promise<string> {
  const [da] = await sql<{ id: string }[]>`
    select id from leistungskatalog_position
     where mandant_id = ${mandant} order by oz limit 1`;
  if (da !== undefined) return da.id;

  const [katalogDa] = await sql<{ id: string }[]>`
    select id from leistungskatalog where mandant_id = ${mandant} limit 1`;
  const katalogId = katalogDa?.id ?? (await sql<{ id: string }[]>`
    insert into leistungskatalog (mandant_id, schluessel, bezeichnung, gueltig_ab)
    values (${mandant}, 'demo-reinigung', 'Demokatalog Reinigung', current_date)
    returning id`)[0]!.id;

  const [neu] = await sql<{ id: string }[]>`
    insert into leistungskatalog_position (mandant_id, katalog_id, oz, kurztext, einheit,
                                           zeitwert_minuten, ist_platzhalter, gueltig_ab)
    values (${mandant}, ${katalogId}, '01.001', 'Unterhaltsreinigung', 'h',
            60, true, current_date)
    returning id`;
  return neu!.id;
}

async function revier(
  sql: Sql, mandant: string, objektId: string, v: TurnusVorgabe,
): Promise<string | null> {
  const [da] = await sql<{ id: string }[]>`
    select id from revier
     where mandant_id = ${mandant} and objekt_id = ${objektId}
       and bezeichnung = ${v.revier} and archiviert_am is null limit 1`;
  if (da !== undefined) return da.id;
  const [neu] = await sql<{ id: string }[]>`
    insert into revier (mandant_id, objekt_id, bezeichnung, kurzzeichen, sollzeit_minuten,
                        aktiv_ab, erstellt_von_art)
    values (${mandant}, ${objektId}, ${v.revier}, ${v.kurzzeichen}, ${v.sollzeit},
            current_date, 'system')
    returning id`;
  return neu?.id ?? null;
}

