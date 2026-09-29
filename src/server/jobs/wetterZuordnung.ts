/**
 * `wetter_zuordnung` — das Wetter an die Bautage heften, taeglich je Mandant
 * (BAU-08 „Weather auto-attached from DWD open data", V-183, D-677).
 *
 * **Der Befund.** `hefteWetterAn` lief nur, wenn jemand auf der Tagesseite
 * „Wetter vom DWD nachtragen" drueckte; ausser dem Seed rief ihn niemand. Den
 * Lauf, den `03-GEWERKE` §13.2 vorsieht, gab es nicht — ein Bautag, den
 * niemand oeffnete, blieb ohne Wetter, auch mit verbundenem DWD. Genau der
 * Beleg, der im Behinderungs- oder Bauzeitenstreit fehlt.
 *
 * **`je_mandant`.** Der Bautag ist eine Zeile einer Gesellschaft; der Lauf
 * bindet ihren Mandanten (`alsJobSitzung`) und sieht nur ihre Tage — die
 * Policies `j_wetter_*` aus 0468 sind an `app.aktiver_mandant()` gebunden.
 *
 * **Ohne DWD geschieht nichts, und das steht im Protokoll.** `wetterPort()`
 * ist ohne `DWD_OPENDATA_BASE` der nicht verbundene Port; dann zaehlt der
 * Lauf die Tage, die er angefasst haette, meldet `verbunden: false` und
 * schreibt nichts. Kein vorgetaeuschter Abruf, kein erfundener Wert.
 *
 * **Um 04:40 UTC** — nach Mitternacht Berliner Zeit in beiden Zeitzonen des
 * Jahres, damit „gestern" ein vollstaendiger Tag ist, und mit Abstand zu den
 * Laeufen davor. Der Zeitplan ist UTC (K-21); „heute" kommt aus der
 * Datenbank (`app.berlin_heute()`), nicht aus der Prozessuhr.
 *
 * **Je Bautag eine eigene Transaktion** (`KontextLauf`): der Abruf beim DWD
 * darf dauern, und eine Transaktion ueber alle Tage hielte die schon
 * angehefteten Zeilen so lange gesperrt.
 */
import { registriere, type JobDefinition, type JobKontext } from './registry.js';
import { alsJobSitzung, type JobAbfrage, type JobVerbindung } from './sitzung.js';
import type { SchreibKontext } from '../kontext/index.js';
import { ordneWetterZu, WETTER_ZUORDNUNG_TAGE } from '../services/bau/wetter.js';
import { wetterPort } from '../versand/dwd.js';

/** Die Job-Abfrage in der Form, die der Dienst erwartet (wie `dokumentAufbewahrung`). */
function alsKontext(db: JobAbfrage, mandantId: string): SchreibKontext {
  return {
    scope: 'mandant',
    portal: 'intern',
    /* Leer: ein Nachtlauf ist kein Benutzer — `geaendert_von` bleibt NULL. */
    benutzerId: '',
    aktiverMandantId: mandantId,
    mandantIds: [mandantId],
    abfrage: db.abfrage.bind(db),
    schreibe: db.abfrage.bind(db),
  };
}

export function registriereWetterZuordnung(sql: JobVerbindung): JobDefinition {
  return registriere({
    schluessel: 'wetter_zuordnung',
    bezeichnung: 'Wetter vom DWD an die offenen Bautage der letzten Tage heften',
    zeitplan: '40 4 * * *',
    bereich: 'je_mandant',
    /* Ein Netzfehler je Tag steht im Befund; ein zweiter Versuch haengt nichts doppelt an. */
    versuche: 1,
    ausfuehren: async (kontext: JobKontext): Promise<Record<string, unknown>> => {
      const mandantId = kontext.mandantId;
      if (mandantId === null) {
        throw new Error('wetter_zuordnung ist je_mandant und braucht einen Mandanten.');
      }
      const port = wetterPort();
      const ergebnis = await ordneWetterZu(
        (arbeit, optionen) => alsJobSitzung(
          sql, mandantId, (db) => arbeit(alsKontext(db, mandantId)),
          { nurLesen: !optionen.schreibend },
        ),
        port,
      );
      return {
        quelle: port.bezeichnung,
        verbunden: ergebnis.verbunden,
        fenster_tage: WETTER_ZUORDNUNG_TAGE,
        offen: ergebnis.offen,
        angeheftet: ergebnis.angeheftet,
        ohne_wetter: ergebnis.befunde,
        abgeschlossen_ohne_wetter: ergebnis.abgeschlossenOhneWetter,
        ...(ergebnis.verbunden ? {} : { befund: 'nicht_verbunden' }),
      };
    },
  });
}
