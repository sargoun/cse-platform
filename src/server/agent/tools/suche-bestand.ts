import 'server-only';
import type { Quelle, WerkzeugErgebnis } from './typen.js';
import type { Wertregister } from './register.js';

/**
 * `suche_bestand` — der Katalog, aus dem der CEO-Assistent antwortet
 * (AGT-07, DSH-01…DSH-05).
 *
 * **Die Zusage von AGT-07 lautet wörtlich: „No invented data. When it cannot
 * answer from the schema, it says so."** Beides folgt aus derselben
 * Entscheidung: **kein Werkzeug formuliert SQL.** Ein Modell, das eine Abfrage
 * schreibt, kann eine Verknüpfung vergessen, eine Mandantengrenze übersehen
 * oder eine Zahl aus einer Spalte ziehen, die etwas anderes bedeutet — und
 * das Ergebnis sieht in allen drei Fällen aus wie eine Antwort.
 *
 * Stattdessen ein **Katalog**: benannte Abfragen, jede mit ihrer Parameterform
 * und ihrem Satz. Was nicht im Katalog steht, kann der Assistent nicht
 * beantworten — und sagt genau das, statt etwas Ähnliches zu liefern.
 *
 * **Jede Abfrage trägt die Mandantengrenze IM SQL**, zusätzlich zu RLS. Die
 * zweite Linie ist RLS, nicht die erste (Invariante 3).
 *
 * **Parameter sind nie freie Werte**: ein Handle, ein gebundenes Datum oder
 * ein Wert aus einer geschlossenen Liste. Deshalb hat keine Abfrage hier eine
 * Zeichenkette, die ein Modell frei füllen könnte.
 */

export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export type ParameterArt = 'handle' | 'datum' | 'auswahl';

export interface KatalogEintrag {
  readonly id: string;
  /** Die Frage in der Sprache des Betriebs — sie steht in der Oberfläche. */
  readonly frage: string;
  readonly sql: string;
  readonly parameter: readonly {
    readonly name: string;
    readonly art: ParameterArt;
    /** Bei `auswahl`: die geschlossene Menge. Sonst leer. */
    readonly werte?: readonly string[];
  }[];
  /** Welche Spalte die Antwort trägt, und wie sie heisst. */
  readonly antwortSpalte: string;
  readonly einheit: string | null;
}

/**
 * **Der Katalog, Stand heute.** Er ist kurz, und das ist kein Mangel: jede
 * Zeile hier ist eine Frage, die jemand wirklich stellt, mit einer Abfrage,
 * die jemand geprüft hat. Ein langer Katalog aus erfundenen Fragen wäre
 * dasselbe wie ein Modell, das SQL schreibt — nur langsamer.
 */
export const KATALOG: readonly KatalogEintrag[] = [
  {
    id: 'mitarbeiter_heute_im_einsatz',
    frage: 'Wie viele Menschen arbeiten heute?',
    sql: `select count(distinct ez.person_id)::int as antwort
            from einsatz_zuordnung ez
            join einsatz e on e.id = ez.einsatz_id and e.mandant_id = ez.mandant_id
           where ez.mandant_id = $1::uuid
             and ez.status = 'zugesagt' and ez.entfernt_am is null
             and e.status <> 'storniert'
             and (e.beginn_zeitpunkt at time zone 'Europe/Berlin')::date = app.berlin_heute()`,
    parameter: [],
    antwortSpalte: 'antwort',
    einheit: 'Personen',
  },
  {
    id: 'offene_schichten_morgen',
    frage: 'Wie viele Schichten sind morgen noch nicht voll besetzt?',
    sql: `select count(*)::int as antwort
            from einsatz e
           where e.mandant_id = $1::uuid
             and e.status <> 'storniert' and e.storniert_am is null
             and (e.beginn_zeitpunkt at time zone 'Europe/Berlin')::date
                 = app.berlin_heute() + 1
             and (select count(*) from einsatz_zuordnung z
                   where z.einsatz_id = e.id and z.status = 'zugesagt'
                     and z.entfernt_am is null) < e.min_besetzung`,
    parameter: [],
    antwortSpalte: 'antwort',
    einheit: 'Schichten',
  },
  {
    id: 'offene_ausschreibungen',
    frage: 'Wie viele Ausschreibungen laufen gerade?',
    sql: `select count(*)::int as antwort
            from ausschreibung a
            join ausschreibung_vorgang v
              on v.ausschreibung_id = a.id and v.mandant_id = $1::uuid
           where a.quell_status = 'aktiv'
             and a.frist_angebot > now()
             and v.geloescht_am is null
             and v.status in ('neu', 'geprueft', 'in_bearbeitung')`,
    parameter: [],
    antwortSpalte: 'antwort',
    einheit: 'Ausschreibungen',
  },
  {
    id: 'nachweise_ablaufend',
    frage: 'Wie viele Nachweise laufen in den nächsten dreissig Tagen ab?',
    sql: `select count(*)::int as antwort
            from nachweis n
           where n.erfasst_von_mandant_id = $1::uuid
             and n.gueltig_bis is not null
             and n.gueltig_bis between app.berlin_heute() and app.berlin_heute() + 30`,
    parameter: [],
    antwortSpalte: 'antwort',
    einheit: 'Nachweise',
  },
];

export class BestandFehler extends Error {
  constructor(nachricht: string) { super(nachricht); this.name = 'BestandFehler'; }
}

export interface BestandDaten {
  readonly abfrageId: string;
  readonly frage: string;
  /**
   * **Der Token, nicht die Zahl.** Der Vertrag dieses Werkzeugs verlangt, dass
   * jede Zahl und jeder Zeitpunkt aus dem Wertregister kommt: ein Modell soll
   * eine Zahl nur mit ihrer Herkunft wiederholen können, und eine rohe `12`
   * im Antworttext liesse sich von einer erfundenen `12` nicht unterscheiden.
   * Der Zahlenwert steht im gebundenen Wert daneben (`werte`).
   */
  readonly antwortToken: string;
  readonly standToken: string;
  readonly einheit: string | null;
}

/**
 * Führt eine Katalogabfrage aus — oder sagt, dass sie nicht im Katalog steht.
 *
 * **`kein_ergebnis` ist die wichtigste Antwort dieses Werkzeugs.** Sie ist
 * das, was AGT-07 verlangt: lieber „das kann ich aus dem Schema nicht
 * beantworten" als eine Zahl, die entsteht, weil eine Zahl erwartet wurde.
 */
export async function sucheBestand(
  db: Abfrage, mandantId: string, abfrageId: string, register: Wertregister,
): Promise<WerkzeugErgebnis<BestandDaten>> {
  const start = performance.now();
  const eintrag = KATALOG.find((k) => k.id === abfrageId);
  if (eintrag === undefined) {
    return {
      ok: false,
      fehler: {
        code: 'kein_ergebnis',
        nachricht: `Diese Frage steht nicht im Katalog (${abfrageId}). Beantwortbar sind: `
          + `${KATALOG.map((k) => k.id).join(', ')}. `
          + 'Eine Abfrage, die es nicht gibt, wird nicht erfunden (AGT-07).',
      },
    };
  }

  const zeilen = await db.abfrage<Record<string, unknown>>(eintrag.sql, [mandantId]);
  const [z] = zeilen;
  if (z === undefined) {
    return {
      ok: false,
      fehler: { code: 'kein_ergebnis', nachricht: 'Die Abfrage lieferte keine Zeile.' },
    };
  }

  /*
   * Der Stand kommt aus der DATENBANK, nicht aus der Uhr des Prozesses
   * (Invariante 5, R-11) — beides: die Anzeige in Berliner Ortszeit und der
   * Zeitpunkt, den der gebundene Wert traegt.
   */
  const [stand] = await db.abfrage<{ jetzt: string; instant: string }>(
    `select to_char(now() at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI') as jetzt,
            to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as instant`);

  const quelle: Quelle = {
    art: 'abfrage',
    abfrageId: eintrag.id,
    stand: stand?.jetzt ?? 'unbekannt',
    datensatzRefs: [],
  };

  const antwort = register.binde({
    art: 'menge',
    wert: String(Number(z[eintrag.antwortSpalte])),
    ...(eintrag.einheit === null ? {} : { einheit: eintrag.einheit }),
    anzeige: `${String(Number(z[eintrag.antwortSpalte]))}${
      eintrag.einheit === null ? '' : ` ${eintrag.einheit}`}`,
    quelle,
  });
  const standWert = register.binde({
    art: 'datum',
    instant: stand?.instant ?? '',
    anzeige: quelle.art === 'abfrage' ? quelle.stand : 'unbekannt',
    quelle,
  });

  return {
    ok: true,
    daten: {
      abfrageId: eintrag.id,
      frage: eintrag.frage,
      antwortToken: antwort.token,
      standToken: standWert.token,
      einheit: eintrag.einheit,
    },
    werte: register.alle(),
    dauerMs: Math.round(performance.now() - start),
  };
}
