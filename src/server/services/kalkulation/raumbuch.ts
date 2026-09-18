/**
 * Die Kalkulationsgrundlage aus dem Raumbuch (OPS-02 → OPS-07).
 *
 * Zwei Abfragen, und beide muessen es sein:
 *
 * 1. Die Flaechen je Belagsart — aus `raum`, unter RLS, also nur die des
 *    aktiven Mandanten.
 * 2. Der Katalog ueber `app.leistungswerte_lesen()` — denn
 *    `leistungswert_qm_pro_stunde` ist `cse_app` entzogen (K-05). Eine
 *    einzelne Abfrage mit `join belagsart` scheiterte an genau dieser Sperre,
 *    und der Weg daran vorbei waere, die Sperre aufzugeben.
 *
 * Zusammengefuegt wird in TypeScript, weil das die getestete Stelle ist
 * (Invariante 6: jede Zahl geht durch eine geprueft Funktion).
 *
 * **Raeume ohne Belagsart verschwinden hier nicht.** Sie kommen als eigene
 * Summe zurueck. Ein Raumbuch-Import, bei dem zehn Zeilen keine Belagsart
 * treffen, ergaebe sonst ein Angebot, das zu billig ist, ohne dass an
 * irgendeiner Stelle etwas falsch aussieht.
 */
import { mengeAusPostgresOderNull, type MilliMenge } from '../finanz/menge.js';
import { berlinKalendertag } from '../zeit/dauer.js';
import { sekundenJeDurchgang, type Flaechenposten } from './richtzeit.js';

export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export interface Kalkulationsgrundlage {
  readonly posten: readonly Flaechenposten[];
  readonly flaecheOhneBelagsart: MilliMenge;
  /** Glasflaeche je Belagsart-Posten, getrennt: CLN-05 rechnet auf Glas. */
  readonly fensterflaeche: MilliMenge;
  /** Belagsarten, die im Raumbuch vorkommen, aber am Stichtag nicht gelten. */
  readonly ohneGueltigenLeistungswert: readonly string[];
}

interface FlaechenZeile {
  readonly belagsart_id: string | null;
  readonly flaeche: string | null;
  readonly fenster: string | null;
}

interface KatalogZeile {
  readonly belagsart_id: string;
  readonly bezeichnung: string;
  readonly leistungswert_qm_pro_stunde: string;
  readonly ist_platzhalter: boolean;
  readonly quelle: string | null;
}

/**
 * `objekt_id` steht als Parameter in der Abfrage, nicht der Mandant: der
 * kommt aus der Sitzung, und die Policy auf `raum` entscheidet, ob dieses
 * Objekt ueberhaupt sichtbar ist (K-02, Invariante 3). Ein fremdes Objekt
 * liefert deshalb null Zeilen statt eines Fehlers — 404, nicht 403.
 */
export async function ladeKalkulationsgrundlage(
  db: Abfrage, objektId: string, stichtag: Date,
): Promise<Kalkulationsgrundlage> {
  const flaechen = await db.abfrage<FlaechenZeile>(
    `select belagsart_id,
            sum(flaeche_qm)::text          as flaeche,
            sum(fenster_flaeche_qm)::text  as fenster
       from raum
      where objekt_id = $1 and archiviert_am is null
      group by belagsart_id`,
    [objektId],
  );

  const katalog = await db.abfrage<KatalogZeile>(
    `select belagsart_id, bezeichnung, leistungswert_qm_pro_stunde,
            ist_platzhalter, quelle
       from app.leistungswerte_lesen($1::date)`,
    /**
     * Der BERLINER Kalendertag. `toISOString()` gaebe den von UTC — und eine
     * Kalkulation um 00:30 Uhr Berliner Zeit befragte den Katalog des
     * VORTAGS. An einem Wechseltag (D-93) ist das ein anderer Leistungswert
     * und damit ein anderer Preis, ohne dass irgendetwas danach aussieht.
     */
    [berlinKalendertag(stichtag)],
  );
  const nachId = new Map(katalog.map((k) => [k.belagsart_id, k]));

  const posten: Flaechenposten[] = [];
  const fehlend: string[] = [];
  let ohneBelagsart = 0n;
  let fenster = 0n;

  for (const zeile of flaechen) {
    const flaeche = mengeAusPostgresOderNull(zeile.flaeche);
    fenster += mengeAusPostgresOderNull(zeile.fenster);
    if (zeile.belagsart_id === null) {
      ohneBelagsart += flaeche;
      continue;
    }
    const eintrag = nachId.get(zeile.belagsart_id);
    if (eintrag === undefined) {
      // Die Belagsart existiert, gilt aber am Stichtag nicht. Auch das ist
      // kein Nullwert: es ist eine Luecke im Katalog, und sie gehoert
      // benannt, nicht als "0 m²" verrechnet.
      fehlend.push(zeile.belagsart_id);
      continue;
    }
    posten.push({
      belagsartId: zeile.belagsart_id,
      bezeichnung: eintrag.bezeichnung,
      flaeche,
      leistungswert: mengeAusPostgresOderNull(eintrag.leistungswert_qm_pro_stunde),
      // O-17 reist MIT. Ohne diese beiden Felder haette die Kalkulation nach
      // der Antwort auf O-16 und O-56 einen Platzhalter-Richtwert als
      // bestaetigten Preis gemeldet.
      leistungswertIstPlatzhalter: eintrag.ist_platzhalter,
      ...(eintrag.quelle === null ? {} : { leistungswertQuelle: eintrag.quelle }),
    });
  }

  posten.sort((a, b) => a.bezeichnung.localeCompare(b.bezeichnung, 'de'));
  return {
    posten,
    flaecheOhneBelagsart: ohneBelagsart as MilliMenge,
    fensterflaeche: fenster as MilliMenge,
    ohneGueltigenLeistungswert: fehlend,
  };
}

// ---------------------------------------------------------------------------
// Ein EINZELNER Raum
// ---------------------------------------------------------------------------

/**
 * Die Kalkulationsgrundlage EINES Raums — fuer das Raumblatt.
 *
 * **Warum das nicht `ladeKalkulationsgrundlage` kann.** Die fasst mit
 * `group by belagsart_id` ueber das GANZE Objekt zusammen und kennt keine
 * einzelne Raumzeile. Fuer „welche Richtzeit traegt DIESER Raum bei" gab es
 * deshalb keine Lesequelle — und die Zahl in der Seite selbst zu rechnen
 * waere genau das, was Invariante 6 verbietet.
 *
 * Gelesen wird derselbe Weg wie oben: `app.leistungswerte_lesen`, weil
 * `belagsart.leistungswert_qm_pro_stunde` der Rolle `cse_app` entzogen ist
 * (K-05), und mit dem BERLINER Kalendertag als Stichtag (D-93).
 *
 * `null` heisst: dieser Raum traegt keine Richtzeit bei — keine Belagsart,
 * oder ihr Leistungswert gilt am Stichtag nicht. Beides ist eine Luecke und
 * wird als solche zurueckgegeben, nie als Null-Sekunden: eine Flaeche, die
 * mit 0 Sekunden in eine Summe eingeht, ist eine Flaeche, die niemand
 * bezahlt.
 */
export interface RaumRichtzeit {
  readonly posten: Flaechenposten;
  /** Sekunden fuer EINEN Durchgang ueber die Raumflaeche. */
  readonly sekundenJeDurchgang: bigint;
}

export async function ladeRaumRichtzeit(
  db: Abfrage, raumId: string, stichtag: Date,
): Promise<{ readonly richtzeit: RaumRichtzeit | null; readonly grund: string | null }> {
  const [raum] = await db.abfrage<{
    belagsart_id: string | null; flaeche: string | null;
  }>(
    `select belagsart_id, flaeche_qm::text as flaeche
       from raum where id = $1 and archiviert_am is null`,
    [raumId],
  );
  if (raum === undefined) return { richtzeit: null, grund: 'Raum nicht gefunden' };
  if (raum.belagsart_id === null) {
    return {
      richtzeit: null,
      grund: 'Dieser Raum trägt keine Belagsart — ohne sie gibt es keinen '
        + 'Leistungswert und damit keine Richtzeit.',
    };
  }

  const katalog = await db.abfrage<KatalogZeile>(
    `select belagsart_id, bezeichnung, leistungswert_qm_pro_stunde,
            ist_platzhalter, quelle
       from app.leistungswerte_lesen($1::date)
      where belagsart_id = $2`,
    [berlinKalendertag(stichtag), raum.belagsart_id],
  );
  const eintrag = katalog[0];
  if (eintrag === undefined) {
    return {
      richtzeit: null,
      grund: 'Die Belagsart dieses Raums hat am Stichtag keinen gültigen '
        + 'Leistungswert (O-17). Seine Fläche fehlt deshalb in jeder Summe.',
    };
  }

  const posten: Flaechenposten = {
    belagsartId: raum.belagsart_id,
    bezeichnung: eintrag.bezeichnung,
    flaeche: mengeAusPostgresOderNull(raum.flaeche),
    leistungswert: mengeAusPostgresOderNull(eintrag.leistungswert_qm_pro_stunde),
    leistungswertIstPlatzhalter: eintrag.ist_platzhalter,
    ...(eintrag.quelle === null ? {} : { leistungswertQuelle: eintrag.quelle }),
  };
  return {
    richtzeit: { posten, sekundenJeDurchgang: sekundenJeDurchgang(posten) },
    grund: null,
  };
}
