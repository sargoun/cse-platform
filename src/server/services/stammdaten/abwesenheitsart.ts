import 'server-only';
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import {
  StammdatenFehler, alsStammdatenFehler, alsStufenkollision, i18nAus, pflichttext,
  pruefeSchluessel,
} from './katalog.js';

/**
 * Der Abwesenheitskatalog als PFLEGBARER Bestand (EMP-05, K-17, O-139;
 * 01-KERN §6.22, `04-SEITENKARTE` §5.13).
 *
 * **Was es bisher gab, war ein Leser fuer ein anderes Publikum.**
 * `mitarbeiter/antraege.ts` → `leseAbwesenheitsarten` gibt die Auswahlliste
 * des Mitarbeiterportals: drei Spalten, uebersetzt, ohne Verwaltungsfelder.
 * Keine Funktion im Haus legte eine Art an, aenderte sie oder archivierte
 * sie. Die Antwort auf O-139 — bezahlt, Nachweis ab Tag N, Lohnart je Art —
 * war damit nur „direkt in der Datenbank" eintragbar.
 *
 * **`bezahlt` hat DREI Zustaende, und das ist der Kern.** `true`, `false`
 * und NULL = ungeklaert (0073 setzt ausdruecklich keinen Default). Der
 * Abwesenheitsdienst weist die Verwendung einer ungeklaerten Art mit
 * `ArtUngeklaertFehler` ab; NULL still als „nein" zu lesen liesse jede
 * Krankmeldung unbezahlt durchlaufen. Diese Schicht laesst NULL deshalb nach
 * `false` nicht zufaellig kippen — sie verlangt die Angabe ausdruecklich —
 * und `kern.abwesenheitsart_schutz` verhindert den Rueckweg von einer Antwort
 * zu „ungeklaert".
 *
 * **Zwei Stufen** (K-17): `mandant_id IS NULL` ist der Plattformkatalog, den
 * alle vier Gesellschaften teilen und den nur der Super-Admin pflegt (0275);
 * eigene Arten gehoeren der Gesellschaft und tragen `stammdaten.verwalten`.
 *
 * **Geloescht wird nie** (Invariante 8): `kern.verhindere_loeschung` liegt als
 * Ausloeser auf der Tabelle, `delete` ist keiner Rolle gewaehrt. Das Ende
 * einer Art ist `archiviert_am`.
 */

/** Die Farbtokens, die `aa_farbe_token` zulaesst — semantisch, kein Hex. */
export const FARBTOKEN = ['success', 'warning', 'danger', 'info', 'neutral'] as const;
export type Farbtoken = typeof FARBTOKEN[number];

export interface AbwesenheitsartZeile {
  readonly id: string;
  readonly istPlattform: boolean;
  readonly schluessel: string;
  readonly bezeichnung: string;
  readonly bezeichnungI18n: Readonly<Record<string, string>>;
  /** `null` heisst UNGEKLAERT (O-139), nie „nein". */
  readonly bezahlt: boolean | null;
  readonly zaehltAufUrlaubskonto: boolean;
  readonly erzeugtStundenkontoBewegung: boolean;
  readonly istGesundheitsbezogen: boolean;
  readonly nachweisPflichtAbTagen: number | null;
  readonly lohnartSchluessel: string | null;
  readonly farbeToken: string | null;
  readonly archiviertAm: string | null;
}

interface Roh {
  id: string; ist_plattform: boolean; schluessel: string; bezeichnung: string;
  bezeichnung_i18n: Record<string, string> | null;
  bezahlt: boolean | null; zaehlt_auf_urlaubskonto: boolean;
  erzeugt_stundenkonto_bewegung: boolean; ist_gesundheitsbezogen: boolean;
  nachweis_pflicht_ab_tagen: number | null; lohnart_schluessel: string | null;
  farbe_token: string | null; archiviert_am: string | null;
}

function zuZeile(r: Roh): AbwesenheitsartZeile {
  return {
    id: r.id, istPlattform: r.ist_plattform, schluessel: r.schluessel,
    bezeichnung: r.bezeichnung, bezeichnungI18n: r.bezeichnung_i18n ?? {},
    bezahlt: r.bezahlt,
    zaehltAufUrlaubskonto: r.zaehlt_auf_urlaubskonto,
    erzeugtStundenkontoBewegung: r.erzeugt_stundenkonto_bewegung,
    istGesundheitsbezogen: r.ist_gesundheitsbezogen,
    nachweisPflichtAbTagen: r.nachweis_pflicht_ab_tagen === null
      ? null : Number(r.nachweis_pflicht_ab_tagen),
    lohnartSchluessel: r.lohnart_schluessel, farbeToken: r.farbe_token,
    archiviertAm: r.archiviert_am,
  };
}

/**
 * Der ganze Katalog — Plattformzeilen zuerst, archivierte am Ende.
 *
 * ARCHIVIERTE stehen mit drin, anders als in der Auswahlliste des
 * Mitarbeiterportals. Die Pflegeseite ist der einzige Ort, an dem sichtbar
 * ist, dass eine Art es gab: ein Stundennachweis von vorletztem Jahr beruft
 * sich auf sie, und wer sie dort nicht findet, haelt den Nachweis fuer
 * falsch.
 */
export async function ladeAbwesenheitsarten(
  kontext: LeseKontext,
): Promise<readonly AbwesenheitsartZeile[]> {
  const roh = await kontext.abfrage<Roh>(
    `select id, (mandant_id is null) as ist_plattform, schluessel, bezeichnung,
            bezeichnung_i18n, bezahlt, zaehlt_auf_urlaubskonto,
            erzeugt_stundenkonto_bewegung, ist_gesundheitsbezogen,
            nachweis_pflicht_ab_tagen, lohnart_schluessel, farbe_token,
            archiviert_am::text as archiviert_am
       from abwesenheitsart
      order by (archiviert_am is not null), (mandant_id is null) desc, bezeichnung`);
  return roh.map(zuZeile);
}

/**
 * **Wie oft eine Art verwendet wird, sagt diese Seite NICHT — und das ist
 * kein Mangel.**
 *
 * `abwesenheit.abwesenheitsart_id` ist `cse_app` spaltenweise ENTZOGEN
 * (K-05, 0073: der Grant nennt die Spalte nicht, und in Postgres deckt ein
 * spaeteres `revoke (spalte)` nichts ab). Ein `group by abwesenheitsart_id`
 * scheitert deshalb mit `42501` — nicht versehentlich, sondern weil eine
 * Zaehlung je Art die Auskunft „wie viele Krankmeldungen gab es" waere, und
 * die ist ein Gesundheitsdatum nach Art. 9 DSGVO. Der eine Weg zum Grund
 * fuehrt ueber `app.abwesenheit_grund_lesen`, je Zeile, mit Auditeintrag.
 *
 * Fuer die Pflege bleibt damit `kern.abwesenheitsart_schutz` die Instanz, die
 * weiss, ob eine Art benutzt ist: er weist den Rueckweg ab, und
 * `uebersetzeSchutz` macht daraus einen Satz. Die Seite kuendigt das vorher
 * an, statt eine Zahl zu zeigen, die sie nicht haben darf.
 */

export interface ArtEingabe {
  readonly schluessel: string;
  readonly bezeichnung: string;
  readonly i18n: Readonly<Record<string, string>>;
  /** `undefined` heisst „nicht angegeben" und bleibt NULL (O-139). */
  readonly bezahlt: boolean | null;
  readonly zaehltAufUrlaubskonto: boolean;
  readonly erzeugtStundenkontoBewegung: boolean;
  readonly istGesundheitsbezogen: boolean;
  readonly nachweisPflichtAbTagen: number | null;
  readonly lohnartSchluessel: string | null;
  readonly farbeToken: string | null;
  /** `true`: Plattformzeile fuer alle vier Gesellschaften (nur Super-Admin). */
  readonly plattform: boolean;
}

/** Die Eingabe aus dem Formular — einmal geprueft, danach benutzbar. */
export function pruefeArtEingabe(
  lies: (feld: string) => string | null, plattform: boolean,
): ArtEingabe {
  const bezeichnung = pflichttext(lies('bezeichnung'), 'Bezeichnung');
  const farbe = (lies('farbeToken') ?? '').trim();
  if (farbe !== '' && !(FARBTOKEN as readonly string[]).includes(farbe)) {
    throw new StammdatenFehler('ungueltig',
      `„${farbe}" ist kein Farbtoken. DESIGN §1 kennt `
      + `${FARBTOKEN.join(', ')} — ein Hexwert wäre eine Gestaltungsentscheidung `
      + 'an der falschen Stelle.');
  }
  const bezahltRoh = (lies('bezahlt') ?? '').trim();
  if (!['ja', 'nein', 'offen'].includes(bezahltRoh)) {
    throw new StammdatenFehler('ungueltig',
      'Bezahlt: „ja", „nein" oder „offen" — und „offen" heisst ungeklärt (O-139), '
      + 'nicht „nein".');
  }
  const tage = (lies('nachweisAbTagen') ?? '').trim();
  // Neun Stellen = die Kapazitaet von `integer`, nicht eine hier erfundene
  // Hoechstzahl von Tagen: welche Frist sinnvoll ist, beantwortet O-139.
  if (tage !== '' && !/^\d{1,9}$/u.test(tage)) {
    throw new StammdatenFehler('ungueltig',
      'Nachweis ab Tag: eine ganze Zahl bis 999999999 oder leer.');
  }
  return {
    schluessel: pruefeSchluessel(lies('schluessel') ?? ''),
    bezeichnung,
    i18n: i18nAus(lies, bezeichnung),
    bezahlt: bezahltRoh === 'offen' ? null : bezahltRoh === 'ja',
    zaehltAufUrlaubskonto: lies('zaehltAufUrlaubskonto') === 'ja',
    erzeugtStundenkontoBewegung: lies('erzeugtStundenkontoBewegung') === 'ja',
    istGesundheitsbezogen: lies('istGesundheitsbezogen') === 'ja',
    nachweisPflichtAbTagen: tage === '' ? null : Number.parseInt(tage, 10),
    lohnartSchluessel: (lies('lohnartSchluessel') ?? '').trim() === ''
      ? null : (lies('lohnartSchluessel') ?? '').trim(),
    farbeToken: farbe === '' ? null : farbe,
    plattform,
  };
}

/**
 * Der Spaltensatz, den VORHER und NACHHER im Pruefprotokoll TEILEN.
 *
 * **Beide Seiten muessen dasselbe Vokabular sprechen.** `app.protokolliere`
 * rechnet `geaendert_felder` als „welcher Schluessel von NACHHER steht in
 * VORHER anders" (0004). Stuende dort das Eingabeobjekt dieser Schicht
 * (`zaehltAufUrlaubskonto`, camelCase, dazu `i18n` und `plattform`, die gar
 * keine Spalten sind) gegen eine gelesene Zeile (`zaehlt_auf_urlaubskonto`,
 * snake_case), waere jedes nur-camelCase-Feld immer `distinct` von NULL: das
 * Protokoll meldete bei JEDER Aenderung dieselben sechs Felder als geaendert,
 * und eine ECHTE Umstellung von `bezahlt` oder `ist_gesundheitsbezogen` waere
 * darin nicht mehr zu erkennen. Genau das soll diese Zeile beantworten —
 * „seit wann rechnet das so".
 *
 * Vorher wird gelesen (`einZeile`), nachher kommt aus dem `returning`
 * DESSELBEN Satzes. Beide tragen damit die Spaltennamen der Tabelle, und
 * `geaendert_felder` nennt genau die Felder, die sich wirklich geaendert
 * haben.
 */
const PROTOKOLL_SPALTEN = `schluessel, bezeichnung, bezeichnung_i18n, bezahlt,
            zaehlt_auf_urlaubskonto, erzeugt_stundenkonto_bewegung,
            ist_gesundheitsbezogen, nachweis_pflicht_ab_tagen,
            lohnart_schluessel, farbe_token, archiviert_am`;

/**
 * Traegt die ANDERE Katalogstufe diesen Schluessel schon?
 *
 * **Diese Vorpruefung sieht nur den AKTIVEN Mandanten — und das ist ihre
 * Grenze.** Die Lesepolicy `t_katalog` zeigt `mandant_id is null` plus
 * `app.sichtbare_mandanten()`, und das ist in der Mandantensicht genau die
 * eine aktive Gesellschaft. In der MANDANTENRICHTUNG (eigene Art gegen den
 * Plattformkatalog) ist die Antwort damit vollstaendig. In der
 * PLATTFORMRICHTUNG — ein Super-Admin legt eine Art an, deren Schluessel eine
 * ANDERE Gesellschaft fuehrt — sieht sie die fremde Zeile nicht und schweigt.
 *
 * Sie ist deshalb nicht die Sperre, sondern der Satz davor. Die Sperre ist
 * `kern.katalog_schluessel_frei` (0276): `security definer` und damit an der
 * RLS vorbei, genau fuer diesen Fall. `alsStufenkollision` holt ihre Meldung
 * zurueck in dieselbe Sprache — ohne das faende der Mensch die Meldung fuer
 * eine Dublette auf DERSELBEN Stufe vor.
 */
async function pruefeStufenkollision(
  kontext: LeseKontext, schluessel: string, plattform: boolean,
): Promise<void> {
  const [zeile] = await kontext.abfrage<{ anzahl: string }>(
    `select count(*)::text as anzahl
       from abwesenheitsart
      where schluessel = $1 and archiviert_am is null
        and (mandant_id is null) = $2`,
    [schluessel, !plattform]);
  if (Number(zeile?.anzahl ?? '0') > 0) {
    throw new StammdatenFehler('kollision', plattform
      ? `Den Schlüssel „${schluessel}" führt mindestens eine Gesellschaft schon `
        + 'als eigene Art. Im Antragsformular stünden zwei gleich aussehende '
        + 'Einträge mit verschiedener Lohnfolge.'
      : `Den Schlüssel „${schluessel}" führt der Plattformkatalog schon. Diese Art `
        + 'steht Ihnen bereits zur Verfügung — eine zweite mit demselben Schlüssel '
        + 'wäre im Antragsformular nicht unterscheidbar.');
  }
}

function uebersetzeSchutz(fehler: unknown): StammdatenFehler | null {
  const f = fehler as { code?: unknown; message?: unknown };
  const text = typeof f.message === 'string' ? f.message : '';
  if (f.code !== '23514') return null;
  if (text.includes('bezahlt')) {
    return new StammdatenFehler('benutzt',
      'Für diese Art ist die Lohnfrage schon beantwortet. Sie auf „offen" '
      + 'zurückzusetzen hiesse, eine Antwort zu verlieren, die jemand gegeben hat '
      + '(0073).');
  }
  if (text.includes('Art-9') || text.includes('Einstufung')) {
    return new StammdatenFehler('benutzt',
      'Die Art-9-Einstufung einer bereits verwendeten Art bleibt, wie sie ist: sie '
      + 'färbt jede Zeile, die auf sie zeigt, und damit auch das Auditprotokoll.');
  }
  if (text.includes('Schluessel')) {
    return new StammdatenFehler('benutzt',
      'Der Schlüssel einer bereits verwendeten Art bleibt, wie er ist — er steht '
      + 'in Exporten und Lohnzuordnungen.');
  }
  return null;
}

/** Eine neue Art — auf der Stufe, die der Aufrufer angibt. */
export async function legeAbwesenheitsartAn(
  kontext: SchreibKontext, e: ArtEingabe,
): Promise<string> {
  await pruefeStufenkollision(kontext, e.schluessel, e.plattform);
  try {
    const [zeile] = await kontext.schreibe<Record<string, unknown>>(
      `insert into abwesenheitsart
         (mandant_id, schluessel, bezeichnung, bezeichnung_i18n, bezahlt,
          zaehlt_auf_urlaubskonto, erzeugt_stundenkonto_bewegung,
          ist_gesundheitsbezogen, nachweis_pflicht_ab_tagen, lohnart_schluessel,
          farbe_token, erstellt_von)
       values (case when $11::boolean then null else app.aktiver_mandant() end,
               $1, $2, $3::jsonb, $4::boolean, $5::boolean, $6::boolean,
               $7::boolean, $8::int, $9, $10, $12::uuid)
       returning id, ${PROTOKOLL_SPALTEN}`,
      [e.schluessel, e.bezeichnung, e.i18n, e.bezahlt,
        e.zaehltAufUrlaubskonto, e.erzeugtStundenkontoBewegung,
        e.istGesundheitsbezogen, e.nachweisPflichtAbTagen, e.lohnartSchluessel,
        e.farbeToken, e.plattform, kontext.benutzerId]);
    const id = zeile?.['id'];
    if (typeof id !== 'string') {
      throw new StammdatenFehler('plattform',
        'Die Art wurde nicht angelegt — der Plattformkatalog wird von der '
        + 'Super-Administration gepflegt.');
    }
    await kontext.schreibe(
      `select app.protokolliere('stammdaten.abwesenheitsart_angelegt',
                                'abwesenheitsart', $1, null, $2::jsonb,
                                app.aktiver_mandant())`,
      [id, zeile]);
    return id;
  } catch (fehler: unknown) {
    throw alsStufenkollision(fehler)
      ?? alsStammdatenFehler(fehler, 'dieser Katalog') ?? fehler;
  }
}

/**
 * Eine bestehende Art aendern — OHNE ihren Schluessel.
 *
 * Der Schluessel wird hier bewusst nicht angefasst: er steht in Exporten und
 * Lohnzuordnungen, `kern.abwesenheitsart_schutz` friert ihn ohnehin ein,
 * sobald eine Abwesenheit darauf zeigt, und eine Umbenennung, die je nach
 * Verwendung gelingt oder scheitert, ist kein Formularfeld, sondern eine
 * Falle. Wer einen anderen Schluessel braucht, legt eine Art an und
 * archiviert die alte — dann bleibt die Geschichte lesbar.
 */
export async function aendereAbwesenheitsart(
  kontext: SchreibKontext, id: string, e: ArtEingabe,
): Promise<void> {
  const vorher = await einZeile(kontext, id);
  try {
    const [nachher] = await kontext.schreibe<Record<string, unknown>>(
      `update abwesenheitsart
          set bezeichnung = $2, bezeichnung_i18n = $3::jsonb, bezahlt = $4::boolean,
              zaehlt_auf_urlaubskonto = $5::boolean,
              erzeugt_stundenkonto_bewegung = $6::boolean,
              ist_gesundheitsbezogen = $7::boolean, nachweis_pflicht_ab_tagen = $8::int,
              lohnart_schluessel = $9, farbe_token = $10,
              geaendert_am = now(), geaendert_von = $11::uuid
        where id = $1 and archiviert_am is null
        returning ${PROTOKOLL_SPALTEN}`,
      [id, e.bezeichnung, e.i18n, e.bezahlt,
        e.zaehltAufUrlaubskonto, e.erzeugtStundenkontoBewegung,
        e.istGesundheitsbezogen, e.nachweisPflichtAbTagen, e.lohnartSchluessel,
        e.farbeToken, kontext.benutzerId]);
    if (nachher === undefined) throw nichtAenderbar(vorher !== null);
    await kontext.schreibe(
      `select app.protokolliere('stammdaten.abwesenheitsart_geaendert',
                                'abwesenheitsart', $1, $2::jsonb, $3::jsonb,
                                app.aktiver_mandant())`,
      [id, vorher, nachher]);
  } catch (fehler: unknown) {
    throw uebersetzeSchutz(fehler) ?? alsStammdatenFehler(fehler, 'dieser Katalog') ?? fehler;
  }
}

/** Ende einer Art: `archiviert_am`. Nie DELETE (Invariante 8). */
export async function archiviereAbwesenheitsart(
  kontext: SchreibKontext, id: string,
): Promise<void> {
  const vorher = await einZeile(kontext, id);
  const [nachher] = await kontext.schreibe<Record<string, unknown>>(
    `update abwesenheitsart
        set archiviert_am = now(), geaendert_am = now(), geaendert_von = $2::uuid
      where id = $1 and archiviert_am is null
      returning ${PROTOKOLL_SPALTEN}`,
    [id, kontext.benutzerId]);
  if (nachher === undefined) throw nichtAenderbar(vorher !== null);
  await kontext.schreibe(
    `select app.protokolliere('stammdaten.abwesenheitsart_archiviert',
                              'abwesenheitsart', $1, $2::jsonb, $3::jsonb,
                              app.aktiver_mandant())`,
    [id, vorher, nachher]);
}

/**
 * Ein UPDATE ohne getroffene Zeile hat genau zwei Ursachen, und sie sind
 * verschieden: die Zeile ist nicht sichtbar (dann gibt es sie fuer diese
 * Sitzung nicht) oder sie ist sichtbar und die Schreibpolicy hat abgewiesen
 * (Plattformzeile ohne Super-Admin, oder Gruppenansicht).
 */
function nichtAenderbar(sichtbar: boolean): StammdatenFehler {
  return sichtbar
    ? new StammdatenFehler('plattform',
      'Diese Art ist nicht änderbar: entweder gehört sie dem Plattformkatalog — '
      + 'den pflegt die Super-Administration mit zweitem Faktor — oder sie ist '
      + 'bereits archiviert.')
    : new StammdatenFehler('nicht_gefunden', 'Diese Abwesenheitsart gibt es nicht.');
}

async function einZeile(
  kontext: LeseKontext, id: string,
): Promise<Readonly<Record<string, unknown>> | null> {
  const [zeile] = await kontext.abfrage<Record<string, unknown>>(
    `select ${PROTOKOLL_SPALTEN} from abwesenheitsart where id = $1`, [id]);
  return zeile ?? null;
}
