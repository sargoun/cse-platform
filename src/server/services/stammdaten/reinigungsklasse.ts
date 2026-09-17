import 'server-only';
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import {
  StammdatenFehler, alsStammdatenFehler, ganzzahlOderNull, pflichttext,
} from './katalog.js';

/**
 * Die Reinigungsklassen einer Gesellschaft (OPS-02, K-17, O-55;
 * 01-KERN §6.7, `04-SEITENKARTE` §5.13).
 *
 * **Was eine Reinigungsklasse heute steuert — und was nicht.** Sie steuert
 * genau zwei Dinge: `raum.reinigungsklasse_id` und die Code-Zuordnung des
 * Raumbuch-Imports (`raumbuch/import.ts`). Sie geht in KEINE Sollzeit und in
 * KEINE Kalkulation: `reinigung/revier.ts` und `kalkulation/raumbuch.ts`
 * rechnen ueber die BELAGSART und `app.leistungswerte_lesen`. Die Tabelle
 * traegt deshalb ausdruecklich keinen Frequenzfaktor und keine Preiswirkung
 * (0021) — einen anzuhaengen hiesse, eine Preisregel zu erfinden (K-17).
 *
 * **Die vier vorhandenen Klassen sind geraten** (`ist_platzhalter = true`,
 * O-55): RK1 Büro, RK2 Verkehrsfläche, RK3 Sanitär, RK4 Technik. Ob die Gruppe
 * DIN 77400 folgt oder ein eigenes Schema fuehrt, hat niemand gesagt. Diese
 * Schicht nimmt die Antwort entgegen — `bestaetigt` setzt `ist_platzhalter`
 * auf `false` — und raet nichts.
 *
 * **Anders als die drei Personal-Kataloge ist dieser mandantengebunden**
 * (`mandant_id not null`): es gibt hier keine Plattformzeile und keinen
 * Super-Admin-Fall. Jede Gesellschaft fuehrt ihre eigene Liste; heute ist nur
 * die der Reinigung befuellt, und in den drei anderen ist die Seite leer —
 * richtig und nicht kaputt.
 *
 * **Gelesen mit `objekt.lesen`, gepflegt mit `stammdaten.verwalten`** (0021,
 * `t_mandant`). Die beiden Rechtemengen sind nicht dieselben; wem das
 * Leserecht fehlt, sieht eine leere Liste statt einer Sperre, und deshalb sagt
 * die Seite es ausdruecklich.
 */

export interface ReinigungsklasseZeile {
  readonly id: string;
  readonly code: string;
  readonly bezeichnung: string;
  readonly beschreibung: string | null;
  readonly sortierung: number;
  readonly istPlatzhalter: boolean;
  readonly archiviertAm: string | null;
  /** Raeume, die auf die Klasse zeigen — `null`, wo `objekt.lesen` fehlt. */
  readonly raeume: number | null;
  /** Importzeilen mit diesem Code — `null` ohne `objekt_import.lesen`. */
  readonly importzeilen: number | null;
}

interface Roh {
  id: string; code: string; bezeichnung: string; beschreibung: string | null;
  sortierung: number; ist_platzhalter: boolean; archiviert_am: string | null;
}

/**
 * Der Katalog in seiner Sortierreihenfolge, archivierte am Ende.
 *
 * Die beiden Zahlen daneben sind keine Zierde: `reinigungsklasse_code_uk` gibt
 * den Code erst nach dem Archivieren wieder frei, und eine Klasse
 * wegzunehmen, an der noch Raeume haengen, liesse diese Raeume ohne
 * Einstufung zurueck — sichtbar wird das erst im naechsten Leistungsnachweis.
 * Die Zaehlung ist rechtegebunden: `raum` liest mit `objekt.lesen`,
 * `raumbuch_import_zeile` mit `objekt_import.lesen`. Was der Aufrufer nicht
 * halten darf, bleibt `null` — eine 0 waere hier eine Behauptung.
 */
export async function ladeReinigungsklassen(
  kontext: LeseKontext,
  rechte: { readonly raeume: boolean; readonly importzeilen: boolean },
): Promise<readonly ReinigungsklasseZeile[]> {
  const roh = await kontext.abfrage<Roh>(
    `select id, code, bezeichnung, beschreibung, sortierung, ist_platzhalter,
            archiviert_am::text as archiviert_am
       from reinigungsklasse
      order by (archiviert_am is not null), sortierung, code`);

  const raeume = rechte.raeume
    ? new Map((await kontext.abfrage<{ klasse: string; anzahl: string }>(
      `select reinigungsklasse_id as klasse, count(*)::text as anzahl
         from raum
        where reinigungsklasse_id is not null and archiviert_am is null
        group by reinigungsklasse_id`)).map((z) => [z.klasse, Number(z.anzahl)]))
    : null;
  /*
   * Gezaehlt wird ueber `reinigungsklasse_id`, nicht ueber
   * `reinigungsklasse_code`: die Importzeile traegt beides — den Code, wie er
   * in der Datei stand, und die Zuordnung, die daraus wurde. Die Frage vor dem
   * Archivieren ist, was noch an der ZEILE haengt.
   */
  const importe = rechte.importzeilen
    ? new Map((await kontext.abfrage<{ klasse: string; anzahl: string }>(
      `select reinigungsklasse_id as klasse, count(*)::text as anzahl
         from raumbuch_import_zeile
        where reinigungsklasse_id is not null
        group by reinigungsklasse_id`)).map((z) => [z.klasse, Number(z.anzahl)]))
    : null;

  return roh.map((r) => ({
    id: r.id, code: r.code, bezeichnung: r.bezeichnung,
    beschreibung: r.beschreibung, sortierung: Number(r.sortierung),
    istPlatzhalter: r.ist_platzhalter, archiviertAm: r.archiviert_am,
    raeume: raeume === null ? null : raeume.get(r.id) ?? 0,
    importzeilen: importe === null ? null : importe.get(r.id) ?? 0,
  }));
}

export interface KlasseEingabe {
  readonly code: string;
  readonly bezeichnung: string;
  readonly beschreibung: string | null;
  readonly sortierung: number;
  /** `true`: der Mandant bestaetigt die Klasse (O-55 fuer diese Zeile beantwortet). */
  readonly bestaetigt: boolean;
}

/**
 * Der Code ist KEIN Schluessel im Sinne der Personal-Kataloge.
 *
 * `RK1`, `RK 1`, `SAN` — die Tabelle prueft keine Form, weil der Code aus dem
 * Raumbuch des Kunden kommt und dort so aussieht, wie er dort aussieht. Was
 * geprueft wird: er ist da, er ist kurz, und er traegt keinen Randleerraum
 * (der Import vergleicht auf Gleichheit, und `„RK1 "` fand nichts).
 */
export function pruefeKlasseEingabe(
  lies: (feld: string) => string | null,
): KlasseEingabe {
  const code = pflichttext(lies('code'), 'Code');
  if (code.length > 20) {
    throw new StammdatenFehler('ungueltig',
      'Der Code ist höchstens 20 Zeichen lang — er steht in jeder Zeile des '
      + 'Raumbuchs.');
  }
  const beschreibung = (lies('beschreibung') ?? '').trim();
  return {
    code,
    bezeichnung: pflichttext(lies('bezeichnung'), 'Bezeichnung'),
    beschreibung: beschreibung === '' ? null : beschreibung,
    sortierung: ganzzahlOderNull(lies('sortierung'), 'Sortierung') ?? 0,
    bestaetigt: lies('bestaetigt') === 'ja',
  };
}

export async function legeReinigungsklasseAn(
  kontext: SchreibKontext, e: KlasseEingabe,
): Promise<string> {
  try {
    const [zeile] = await kontext.schreibe<{ id: string }>(
      `insert into reinigungsklasse
         (mandant_id, code, bezeichnung, beschreibung, sortierung, ist_platzhalter,
          erstellt_von)
       values (app.aktiver_mandant(), $1, $2, $3, $4::int, $5::boolean, $6::uuid)
       returning id`,
      [e.code, e.bezeichnung, e.beschreibung, e.sortierung, !e.bestaetigt,
        kontext.benutzerId]);
    const id = zeile?.id;
    if (id === undefined) {
      throw new StammdatenFehler('nicht_gefunden',
        'Die Klasse wurde nicht angelegt. Zum Pflegen des Katalogs gehört '
        + 'stammdaten.verwalten in dieser Gesellschaft.');
    }
    await protokolliere(kontext, 'stammdaten.reinigungsklasse_angelegt', id, null, e);
    return id;
  } catch (fehler: unknown) {
    throw alsStammdatenFehler(fehler, 'diese Gesellschaft') ?? fehler;
  }
}

/**
 * Umbenennen, umsortieren, bestaetigen — und den Code aendern.
 *
 * Der Code darf sich aendern, anders als der `schluessel` der
 * Personal-Kataloge: er ist keine Exportkennung, sondern die Spalte, gegen die
 * der Raumbuch-Import vergleicht. Wer ihn aendert, aendert damit, welche
 * kuenftigen Importzeilen zuordnen — die bereits zugeordneten Raeume haengen
 * an der `id` und bleiben, wo sie sind. Genau das sagt die Seite auch.
 */
export async function aendereReinigungsklasse(
  kontext: SchreibKontext, id: string, e: KlasseEingabe,
): Promise<void> {
  const vorher = await einZeile(kontext, id);
  try {
    const [zeile] = await kontext.schreibe<{ id: string }>(
      `update reinigungsklasse
          set code = $2, bezeichnung = $3, beschreibung = $4, sortierung = $5::int,
              ist_platzhalter = $6::boolean, geaendert_von = $7::uuid
        where id = $1 and archiviert_am is null
        returning id`,
      [id, e.code, e.bezeichnung, e.beschreibung, e.sortierung, !e.bestaetigt,
        kontext.benutzerId]);
    if (zeile === undefined) {
      throw new StammdatenFehler(vorher === null ? 'nicht_gefunden' : 'benutzt',
        vorher === null
          ? 'Diese Reinigungsklasse gibt es nicht.'
          : 'Diese Klasse ist archiviert; eine archivierte Klasse wird nicht mehr '
            + 'geändert — sonst änderte sich rückwirkend, was in einem Raumbuch stand.');
    }
    await protokolliere(kontext, 'stammdaten.reinigungsklasse_geaendert', id, vorher, e);
  } catch (fehler: unknown) {
    throw alsStammdatenFehler(fehler, 'diese Gesellschaft') ?? fehler;
  }
}

/**
 * Ende einer Klasse: `archiviert_am`. Nie DELETE (Invariante 8, 0021).
 *
 * **Die Raeume bleiben zugeordnet.** Die Klasse aus `raum` zu entfernen waere
 * die zweite, verlockende Haelfte dieses Knopfs — und sie liesse ein Raumbuch
 * ohne Einstufung zurueck, dessen Leistungsnachweis niemand mehr herleiten
 * kann. Die Seite nennt die Zahl der betroffenen Raeume vorher; was danach
 * mit ihnen geschieht, entscheidet ein Mensch im Raumbuch.
 */
export async function archiviereReinigungsklasse(
  kontext: SchreibKontext, id: string,
): Promise<void> {
  const vorher = await einZeile(kontext, id);
  const [zeile] = await kontext.schreibe<{ id: string }>(
    `update reinigungsklasse
        set archiviert_am = now(), geaendert_von = $2::uuid
      where id = $1 and archiviert_am is null
      returning id`,
    [id, kontext.benutzerId]);
  if (zeile === undefined) {
    throw new StammdatenFehler(vorher === null ? 'nicht_gefunden' : 'benutzt',
      vorher === null
        ? 'Diese Reinigungsklasse gibt es nicht.'
        : 'Diese Klasse ist bereits archiviert.');
  }
  await protokolliere(kontext, 'stammdaten.reinigungsklasse_archiviert', id, vorher, null);
}

async function einZeile(
  kontext: LeseKontext, id: string,
): Promise<Readonly<Record<string, unknown>> | null> {
  const [zeile] = await kontext.abfrage<Record<string, unknown>>(
    `select code, bezeichnung, beschreibung, sortierung, ist_platzhalter,
            archiviert_am
       from reinigungsklasse where id = $1`, [id]);
  return zeile ?? null;
}

/**
 * `reinigungsklasse` traegt `trg_reinigungsklasse_geaendert_am`, aber KEINEN
 * Audit-Ausloeser (`rls.ts`: `belagsart` ja, die Klasse nein). Wer eine Klasse
 * umbenennt oder archiviert, aendert, was im Leistungsverzeichnis eines
 * laufenden Auftrags steht — diese Zeile ist die Antwort auf „seit wann heisst
 * das so".
 */
async function protokolliere(
  kontext: SchreibKontext, aktion: string, id: string,
  vorher: unknown, nachher: unknown,
): Promise<void> {
  await kontext.schreibe(
    `select app.protokolliere($1, 'reinigungsklasse', $2, $3::jsonb, $4::jsonb,
                              app.aktiver_mandant())`,
    [aktion, id, vorher, nachher]);
}
