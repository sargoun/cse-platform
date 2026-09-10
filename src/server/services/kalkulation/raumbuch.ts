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
import type { Flaechenposten } from './richtzeit.js';

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
