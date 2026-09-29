/**
 * Der Feiertagskalender in der Tabelle `feiertag` — der Schreiber, den es
 * nicht gab (CLN-03, TIM-02, V-178).
 *
 * **Der Befund.** Generator, Turnusvorschau und Dienstplanansicht lesen die
 * Feiertage ausschliesslich aus `feiertag` (`generator.ts: ladeFeiertage`).
 * Die Tabelle hatte keinen einzigen Schreiber: `0028` kuendigte
 * `job:feiertage_pflegen` an, `src/lib/datum/feiertage-berlin.ts` rechnete
 * die Tage — und niemand trug sie ein. `ladeFeiertage` lieferte deshalb immer
 * eine leere Karte, ein Turnus mit `feiertagsregel = 'ausfall'` legte am
 * 3. Oktober eine Reinigung an, und `einsatz.feiertag_id` blieb NULL.
 *
 * **Was diese Datei tut.** Sie schreibt die GERECHNETEN Tage
 * (`feiertageBerlin`) eines Jahres in die Tabelle — idempotent ueber
 * `feiertag_uk (bundesland, datum)`. Die Rechnung steht weiterhin genau
 * einmal im Baum, in `src/lib/datum/feiertage-berlin.ts`; hier wird nichts
 * gerechnet und kein Tag erfunden. Heiligabend und Silvester reisen mit
 * `gesetzlich = false` mit, wie §5.1 es will — der Generator liest nur
 * `gesetzlich` und streicht an ihnen nichts (O-167).
 *
 * **Was sie NICHT tut: einen vorhandenen Tag still umschreiben.**
 * Feiertagsrecht aendert sich (2019 kam der Frauentag). Steht fuer ein Jahr
 * schon eine Zeile, die von der Rechnung abweicht — anderer Name, andere
 * Gesetzlichkeit —, bleibt sie stehen und wird GEMELDET. Ebenso eine Zeile,
 * die die Rechnung gar nicht kennt (ein Import, ein von Hand eingetragener
 * Tag): sie ist eine Tatsache, die jemand gesetzt hat, und keine, die dieser
 * Lauf widerlegen kann. Geloescht wird ohnehin nie (`trg_feiertag_kein_hard_delete`).
 *
 * **Wer schreibt.** Der Nachtlauf `feiertage_pflegen` als `cse_job` (Policy
 * `f_job`, 0028) und der Seed vor seinem Generatorlauf. `cse_app` hat auf
 * `feiertag` nur Lesen: ein Feiertag ist eine Tatsache des Landesrechts, kein
 * Stammdatensatz, den ein Planer anlegt.
 *
 * **Nur Berlin.** `feiertage-berlin.ts` rechnet Berlin und sagt das im Namen.
 * Ob die Gruppe ausserhalb Berlins arbeitet, ist offen (O-167); eine Serie mit
 * einem anderen Bundesland findet deshalb keinen Kalender — und der Generator
 * sagt das, statt still ohne Feiertage zu planen (`fehlendeJahre`).
 */
import {
  BUNDESLAND_BERLIN, feiertageBerlin, type Feiertag,
} from '@/lib/datum/feiertage-berlin';

/** Was dieser Dienst von einer Verbindung braucht — Jobsitzung wie Seed. */
export interface FeiertagAbfrage {
  abfrage<T>(anweisung: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

/** Eine gespeicherte Zeile, wie der Vergleich sie braucht. */
export interface GespeicherterFeiertag {
  readonly datum: string;
  readonly bezeichnung: string;
  readonly gesetzlich: boolean;
}

/** Ein Tag, den die Tabelle anders fuehrt als die Rechnung. */
export interface FeiertagAbweichung {
  readonly datum: string;
  readonly gespeichert: { readonly bezeichnung: string; readonly gesetzlich: boolean };
  readonly berechnet: { readonly bezeichnung: string; readonly gesetzlich: boolean };
}

export interface FeiertagVergleich {
  /** Gerechnet, aber noch nicht in der Tabelle — die werden eingetragen. */
  readonly fehlend: readonly Feiertag[];
  /** Gerechnet und gleich gespeichert. */
  readonly gleich: number;
  /** Gerechnet und ANDERS gespeichert — gemeldet, nicht ueberschrieben. */
  readonly abweichend: readonly FeiertagAbweichung[];
  /** Gespeichert, aber nicht gerechnet — gemeldet, nicht entfernt. */
  readonly ungerechnet: readonly GespeicherterFeiertag[];
}

/**
 * Welche Jahre ein Lauf pflegt: das laufende und die zwei folgenden.
 *
 * Zwei, weil der laengste Horizont einer Serie 400 Tage betraegt
 * (`serie-pflege.ts`) — ein Lauf am 31. Dezember muss also das uebernaechste
 * Jahr schon kennen. Mehr Jahre waeren eine Zusage ueber Recht, das es noch
 * nicht gibt (siehe Kopf von `feiertage-berlin.ts`: „Zukunft ist Rechnung,
 * nicht Zusage").
 */
export const PFLEGE_FOLGEJAHRE = 2;

export function pflegeJahre(laufendesJahr: number): readonly number[] {
  if (!Number.isInteger(laufendesJahr)) {
    throw new Error(`Das laufende Jahr ist eine Ganzzahl, nicht ${String(laufendesJahr)}.`);
  }
  return Array.from({ length: PFLEGE_FOLGEJAHRE + 1 }, (_, i) => laufendesJahr + i);
}

/**
 * Rechnung gegen Bestand — REIN, ohne Datenbank.
 *
 * Verglichen wird je Kalendertag, weil `feiertag_uk (bundesland, datum)` genau
 * eine Zeile je Tag zulaesst: fallen zwei Feste zusammen, fuehrt die Rechnung
 * sie schon als EINE Zeile mit beiden Namen (`fasseGleicheTageZusammen`).
 */
export function vergleicheFeiertage(
  berechnet: readonly Feiertag[], gespeichert: readonly GespeicherterFeiertag[],
): FeiertagVergleich {
  const nachTag = new Map(gespeichert.map((g) => [g.datum, g]));
  const gerechnet = new Set(berechnet.map((b) => b.datum));
  const fehlend: Feiertag[] = [];
  const abweichend: FeiertagAbweichung[] = [];
  let gleich = 0;
  for (const b of berechnet) {
    const g = nachTag.get(b.datum);
    if (g === undefined) {
      fehlend.push(b);
    } else if (g.bezeichnung === b.bezeichnung && g.gesetzlich === b.gesetzlich) {
      gleich += 1;
    } else {
      abweichend.push({
        datum: b.datum,
        gespeichert: { bezeichnung: g.bezeichnung, gesetzlich: g.gesetzlich },
        berechnet: { bezeichnung: b.bezeichnung, gesetzlich: b.gesetzlich },
      });
    }
  }
  const ungerechnet = gespeichert.filter((g) => !gerechnet.has(g.datum));
  return { fehlend, gleich, abweichend, ungerechnet };
}

/** Der Bericht eines Laufs — steht im Laufprotokoll (`job_lauf`). */
export interface FeiertagPflegeBericht {
  readonly bundesland: typeof BUNDESLAND_BERLIN;
  readonly jahre: readonly number[];
  readonly eingetragen: number;
  readonly unveraendert: number;
  readonly abweichungen: readonly FeiertagAbweichung[];
  readonly ungerechnet: readonly GespeicherterFeiertag[];
  // Ein Index, damit der Bericht als `Record<string, unknown>` ins
  // Laufprotokoll passt, ohne dass jemand ihn umkopiert.
  readonly [feld: string]: unknown;
}

/**
 * Traegt die Berliner Feiertage der genannten Jahre ein.
 *
 * `on conflict … do nothing` und nicht `do update`: siehe Kopf — ein
 * vorhandener Tag wird gemeldet, nicht umgeschrieben. Zweimal laufen ergibt
 * beim zweiten Mal `eingetragen: 0`.
 */
export async function pflegeFeiertage(
  db: FeiertagAbfrage, jahre: readonly number[],
): Promise<FeiertagPflegeBericht> {
  let eingetragen = 0;
  let unveraendert = 0;
  const abweichungen: FeiertagAbweichung[] = [];
  const ungerechnet: GespeicherterFeiertag[] = [];

  for (const jahr of [...new Set(jahre)].sort((a, b) => a - b)) {
    const berechnet = feiertageBerlin(jahr);
    const gespeichert = await db.abfrage<GespeicherterFeiertag>(
      `select to_char(datum, 'YYYY-MM-DD') as datum, bezeichnung, gesetzlich
         from feiertag
        where bundesland = $1
          and datum between make_date($2::int, 1, 1) and make_date($2::int, 12, 31)
        order by datum`,
      [BUNDESLAND_BERLIN, jahr],
    );
    const vergleich = vergleicheFeiertage(berechnet, gespeichert);

    if (vergleich.fehlend.length > 0) {
      /*
       * Als JSON-TEXT und nicht als drei Felder: der Treiber reicht ein
       * Wahrheitswertfeld als einzelnen `boolean` durch, und `$4::boolean[]`
       * scheitert dann am Cast. `$2::text::jsonb` ist derselbe Weg wie beim
       * Quittungsabzug (`security/schluessel.ts`) — der Text wird in der
       * Datenbank gelesen, nicht vom Treiber geraten.
       */
      const neu = await db.abfrage<{ datum: string }>(
        `insert into feiertag (bundesland, datum, bezeichnung, gesetzlich, quelle)
         select $1, t.datum, t.bezeichnung, t.gesetzlich, 'berechnet'
           from jsonb_to_recordset($2::text::jsonb)
                  as t(datum date, bezeichnung text, gesetzlich boolean)
         on conflict (bundesland, datum) do nothing
         returning to_char(datum, 'YYYY-MM-DD') as datum`,
        [
          BUNDESLAND_BERLIN,
          JSON.stringify(vergleich.fehlend.map((f) => ({
            datum: f.datum, bezeichnung: f.bezeichnung, gesetzlich: f.gesetzlich,
          }))),
        ],
      );
      eingetragen += neu.length;
    }
    unveraendert += vergleich.gleich;
    abweichungen.push(...vergleich.abweichend);
    ungerechnet.push(...vergleich.ungerechnet);
  }

  return {
    bundesland: BUNDESLAND_BERLIN,
    jahre: [...new Set(jahre)].sort((a, b) => a - b),
    eingetragen,
    unveraendert,
    abweichungen,
    ungerechnet,
  };
}
