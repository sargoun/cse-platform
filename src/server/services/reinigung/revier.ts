/**
 * Reviere und ihre Räume (CLN-01, OPS-02, OPS-03, OPS-07).
 *
 * Der Dienst tut drei Dinge und keines davon zweimal:
 *
 *  1. Er liest die Räume einer Zone samt Fläche und Leistungswert — die
 *     Flächen unter RLS aus `raum`, die Leistungswerte über
 *     `app.leistungswerte_lesen()`, weil `belagsart.leistungswert_qm_pro_stunde`
 *     `cse_app` entzogen ist (K-05). Zusammengefügt wird in TypeScript,
 *     dieselbe Bauart wie `kalkulation/raumbuch.ts`.
 *  2. Er ruft `berechneRevierSollzeit` auf — die eine getestete Funktion, die
 *     `Σ m² ÷ Leistungswert` über `kalkulation/richtzeit.ts` rechnet.
 *  3. Er schreibt Kopf und Räume in EINER Transaktion, mit der Gegenprobe
 *     davor: `Σ revier_raum.sollzeit_minuten = revier.sollzeit_minuten`.
 *
 * **Was er NICHT tut: eine Zuordnung lösen.** `revier_raum` steht unter
 * Löschsperre (§5.2 nennt `kern.verhindere_loeschung()`) und hat keine
 * Lebendigkeitsspalte — die Quelldokumente beschreiben schlicht keinen Weg,
 * einen Raum wieder aus einer Zone zu nehmen. Statt eine Spalte zu erfinden,
 * die kein Dokument beschreibt, wirft `setzeRaeume` eine benannte Ausnahme und
 * nennt den einzigen beschriebenen Weg: die Zone archivieren und neu
 * zuschneiden. Die offene Frage steht im Abschlussbericht dieses PRs.
 */
import type { SchreibKontext, LeseKontext } from '../../kontext/index.js';
import { mengeAusPostgresOderNull, type MilliMenge } from '../finanz/menge.js';
import { berlinKalendertag } from '../zeit/dauer.js';
import {
  berechneRevierSollzeit, summeDerRaeume,
  type RaumEingabe, type RevierSollzeit,
} from './sollzeit.js';

export class RevierNichtGefunden extends Error {
  readonly code = 'nicht_gefunden';
  readonly status = 404;
  constructor(id: string) {
    // 404 und nicht 403: dass es die Zone anderswo gibt, ist selbst eine
    // Auskunft (AUT-06).
    super(`Revier ${id} gibt es in dieser Gesellschaft nicht.`);
    this.name = 'RevierNichtGefunden';
  }
}

export class RaumNichtEntfernbar extends Error {
  readonly code = 'ungueltiger_zustand';
  readonly status = 409;
  constructor(readonly raumIds: readonly string[]) {
    super(
      `${String(raumIds.length)} Raum/Räume sollen aus dem Revier verschwinden. `
      + 'Eine Revierzuordnung ist der Rechenweg einer Kalkulation und steht unter '
      + 'Löschsperre — sie lässt sich nicht lösen. Wer eine Zone neu zuschneidet, '
      + 'archiviert das Revier und legt ein neues an.',
    );
    this.name = 'RaumNichtEntfernbar';
  }
}

export class SollzeitUneinig extends Error {
  readonly code = 'ungueltiger_zustand';
  readonly status = 500;
  constructor(kopf: bigint, summe: bigint) {
    super(
      `Die Sollzeit des Reviers (${String(kopf)} Hundertstelminuten) und die Summe `
      + `seiner Räume (${String(summe)}) gehen auseinander. Es wird nichts geschrieben.`,
    );
    this.name = 'SollzeitUneinig';
  }
}

export interface RaumZeile {
  readonly raumId: string;
  readonly raumnummer: string | null;
  readonly bezeichnung: string | null;
  readonly etage: string | null;
  readonly belagsartId: string | null;
  readonly belagsartBezeichnung: string | null;
  readonly flaeche: MilliMenge;
  readonly fensterFlaeche: MilliMenge;
  readonly leistungswert: MilliMenge | null;
  /** Stand der Leistungswert selbst noch auf einer offenen Frage (O-17)? */
  readonly leistungswertIstPlatzhalter: boolean;
  readonly reihenfolge: number;
}

interface RaumDbZeile {
  readonly id: string;
  readonly raumnummer: string | null;
  readonly bezeichnung: string | null;
  readonly etage: string | null;
  readonly belagsart_id: string | null;
  readonly flaeche_qm: string | null;
  readonly fenster_flaeche_qm: string | null;
  readonly sortierung: number;
}

interface KatalogZeile {
  readonly belagsart_id: string;
  readonly bezeichnung: string;
  readonly leistungswert_qm_pro_stunde: string;
  readonly ist_platzhalter: boolean;
}

/**
 * Die zugeordneten Räume MIT ihren Schnappschüssen liest die Oberfläche, nicht
 * dieser Dienst: `app/portal/[mandant]/reinigung/daten.ts#ladeZugeordneteRaeume`
 * stellt genau die Spalten zusammen, die das Revierblatt zeigt.
 *
 * Hier stand einmal dieselbe Abfrage ein zweites Mal. Zwei Lesewege auf
 * dieselbe Zeile sind zwei Wahrheiten darüber, was in ihr steht — und die eine
 * bleibt beim ersten Spaltenzusatz stehen. Was der Dienst braucht, ist die
 * HEUTIGE Grösse aus dem Raumbuch (`ladeRaeume`), nicht der Schnappschuss von
 * damals.
 */

/**
 * Die Räume einer Auswahl, mit Fläche und Leistungswert von HEUTE.
 *
 * Das ist die Eingabe der Kalkulation: gerechnet wird mit dem, was jetzt im
 * Raumbuch und im Katalog steht, und genau dieser Stand wird anschliessend als
 * Schnappschuss in `revier_raum` festgehalten.
 */
export async function ladeRaeume(
  kontext: LeseKontext, objektId: string, raumIds: readonly string[], stichtag: Date,
): Promise<readonly RaumZeile[]> {
  if (raumIds.length === 0) return [];
  const zeilen = await kontext.abfrage<RaumDbZeile>(
    `select r.id, r.raumnummer, r.bezeichnung, r.etage, r.belagsart_id,
            r.flaeche_qm::text as flaeche_qm,
            r.fenster_flaeche_qm::text as fenster_flaeche_qm,
            r.sortierung
       from raum r
      where r.objekt_id = $1::uuid
        and r.id = any ($2::uuid[])
        and r.archiviert_am is null
      order by r.sortierung, r.raumnummer nulls last`,
    [objektId, raumIds],
  );
  return verbindeMitKatalog(kontext, zeilen, stichtag);
}

async function verbindeMitKatalog(
  kontext: LeseKontext, zeilen: readonly RaumDbZeile[], stichtag: Date,
): Promise<readonly RaumZeile[]> {
  const katalog = await kontext.abfrage<KatalogZeile>(
    `select belagsart_id, bezeichnung, leistungswert_qm_pro_stunde, ist_platzhalter
       from app.leistungswerte_lesen($1::date)`,
    /**
     * Der BERLINER Kalendertag (K-11). `toISOString()` gäbe den von UTC, und
     * eine Kalkulation um 00:30 Berliner Zeit befragte den Katalog des
     * Vortags — an einem Wechseltag ein anderer Leistungswert und damit eine
     * andere Sollzeit, ohne dass irgendetwas danach aussieht.
     */
    [berlinKalendertag(stichtag)],
  );
  const nachId = new Map(katalog.map((k) => [k.belagsart_id, k]));

  return zeilen.map((z) => {
    const k = z.belagsart_id === null ? undefined : nachId.get(z.belagsart_id);
    return {
      raumId: z.id,
      raumnummer: z.raumnummer,
      bezeichnung: z.bezeichnung,
      etage: z.etage,
      belagsartId: z.belagsart_id,
      belagsartBezeichnung: k?.bezeichnung ?? null,
      flaeche: mengeAusPostgresOderNull(z.flaeche_qm),
      fensterFlaeche: mengeAusPostgresOderNull(z.fenster_flaeche_qm),
      leistungswert: k === undefined
        ? null
        : mengeAusPostgresOderNull(k.leistungswert_qm_pro_stunde),
      leistungswertIstPlatzhalter: k?.ist_platzhalter ?? false,
      reihenfolge: z.sortierung,
    };
  });
}

/** Nur die Räume, für die sich überhaupt rechnen lässt. */
function alsEingabe(raeume: readonly RaumZeile[]): readonly RaumEingabe[] {
  return raeume
    .filter((r): r is RaumZeile & { belagsartId: string; leistungswert: MilliMenge } =>
      r.belagsartId !== null && r.leistungswert !== null && r.leistungswert > 0n)
    .map((r) => ({
      raumId: r.raumId,
      belagsartId: r.belagsartId,
      belagsartBezeichnung: r.belagsartBezeichnung ?? r.belagsartId,
      flaeche: r.flaeche,
      leistungswert: r.leistungswert,
      fensterFlaeche: r.fensterFlaeche,
      reihenfolge: r.reihenfolge,
    }));
}

export interface RaeumeErgebnis {
  readonly zeit: RevierSollzeit;
  /** Räume ohne Belagsart oder ohne geltenden Leistungswert — benannt, nie verrechnet. */
  readonly ohneLeistungswert: readonly string[];
  /** Räume, deren Leistungswert selbst ein Platzhalter ist (O-17). */
  readonly aufPlatzhalter: readonly string[];
}

/**
 * Die Zuordnung setzen und die Sollzeit neu rechnen — in EINER Transaktion.
 *
 * **Additiv.** Räume, die heute zugeordnet sind und in `raumIds` fehlen,
 * führen zu `RaumNichtEntfernbar`; siehe die Vorbemerkung dieser Datei. Wer
 * dieselbe Menge noch einmal schickt, bekommt die Schnappschüsse neu
 * geschrieben — genau das ist „neu kalkulieren".
 */
export async function setzeRaeume(
  kontext: SchreibKontext,
  revierId: string,
  raumIds: readonly string[],
  stichtag: Date,
): Promise<RaeumeErgebnis> {
  const [revier] = await kontext.schreibe<{ id: string; objekt_id: string }>(
    `select id, objekt_id from revier where id = $1::uuid and archiviert_am is null
      for update`,
    [revierId],
  );
  if (revier === undefined) throw new RevierNichtGefunden(revierId);

  const vorhanden = await kontext.schreibe<{ raum_id: string }>(
    `select raum_id from revier_raum where revier_id = $1::uuid`, [revierId],
  );
  const gewuenscht = new Set(raumIds);
  const entfallen = vorhanden.map((v) => v.raum_id).filter((id) => !gewuenscht.has(id));
  if (entfallen.length > 0) throw new RaumNichtEntfernbar(entfallen);

  const raeume = await ladeRaeume(kontext, revier.objekt_id, raumIds, stichtag);
  const rechenbar = alsEingabe(raeume);
  const zeit = berechneRevierSollzeit(rechenbar);

  /**
   * Die Gegenprobe VOR dem Schreiben, nicht danach.
   *
   * Sie kann nach Konstruktion nicht fehlschlagen — und steht trotzdem hier:
   * eine Zusage, die nur ein Test prüft, gilt für die Daten, die der Test
   * kennt. Schlägt sie an, wird nichts geschrieben und die Transaktion
   * rollt zurück.
   */
  const summe = summeDerRaeume(zeit);
  if (summe !== zeit.hundertstelMinuten) {
    throw new SollzeitUneinig(zeit.hundertstelMinuten, summe);
  }

  const nachRaum = new Map(raeume.map((r) => [r.raumId, r]));
  for (const [index, anteil] of zeit.raeume.entries()) {
    const raum = nachRaum.get(anteil.raumId)!;
    await kontext.schreibe(
      `insert into revier_raum (mandant_id, revier_id, objekt_id, raum_id, reihenfolge,
                                sollzeit_minuten, leistungswert_qm_pro_stunde,
                                flaeche_qm, fenster_flaeche_qm, erstellt_von)
       values (app.aktiver_mandant(), $1::uuid, $2::uuid, $3::uuid, $4,
               $5::numeric, $6::numeric, $7::numeric, $8::numeric, app.aktueller_benutzer())
       on conflict (revier_id, raum_id) do update
          set reihenfolge = excluded.reihenfolge,
              sollzeit_minuten = excluded.sollzeit_minuten,
              leistungswert_qm_pro_stunde = excluded.leistungswert_qm_pro_stunde,
              flaeche_qm = excluded.flaeche_qm,
              fenster_flaeche_qm = excluded.fenster_flaeche_qm`,
      [
        revierId, revier.objekt_id, anteil.raumId, index,
        anteil.sollzeitMinuten,
        raum.leistungswert === null ? null : mengeNachText(raum.leistungswert),
        mengeNachText(raum.flaeche),
        mengeNachText(raum.fensterFlaeche),
      ],
    );
  }

  /**
   * Ein Revier ohne rechenbare Räume behält seine bisherige Sollzeit, statt
   * auf null zu fallen: `revier.sollzeit_minuten` ist `not null` und
   * `> 0` (0029), und eine Zone, deren Räume noch keine Belagsart haben,
   * ist keine Zone ohne Arbeit — sie ist eine ohne Kalkulation.
   */
  if (zeit.hundertstelMinuten > 0n) {
    await kontext.schreibe(
      `update revier set sollzeit_minuten = $2::numeric where id = $1::uuid`,
      [revierId, zeit.sollzeitMinuten],
    );
  }

  return {
    zeit,
    ohneLeistungswert: raeume
      .filter((r) => r.belagsartId === null || r.leistungswert === null)
      .map((r) => r.raumId),
    aufPlatzhalter: raeume.filter((r) => r.leistungswertIstPlatzhalter).map((r) => r.raumId),
  };
}

/** Milli-Menge als `numeric`-Text — drei Nachkommastellen, ohne Gleitkomma. */
function mengeNachText(menge: MilliMenge): string {
  const negativ = menge < 0n;
  const abs = negativ ? -menge : menge;
  return `${negativ ? '-' : ''}${String(abs / 1000n)}.${String(abs % 1000n).padStart(3, '0')}`;
}
