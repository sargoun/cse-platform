import 'server-only';
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import {
  StammdatenFehler, alsStammdatenFehler, i18nAus, pflichttext, pruefeSchluessel,
} from './katalog.js';

/**
 * Der Qualifikationskatalog (SEC-01, SEC-04, EMP-08, LEG-04, K-17;
 * O-107, O-144, O-341, O-343; 01-KERN §6.16, `04-SEITENKARTE` §5.13).
 *
 * **Auf diesen Katalog berufen sich zwei Sperren, und eine davon ist hart.**
 * `blockiert_einsatz` einzuschalten laesst ab diesem Moment Einteilungen
 * SCHEITERN — durchgesetzt nicht von einem Dienst, sondern von
 * `app.einsatz_qualifikation_erfuellt` (0031), die `nachweis/tor.ts` fragt
 * und die `dienstplan/einteilung.ts` und `security/eventbesetzung.ts` nur noch
 * fangen. Wer den Schalter ohne die Zahl der betroffenen Posten davor
 * umlegt, erfaehrt die Folge vom Dienstplan. Die Zahl steht deshalb an jeder
 * Zeile.
 *
 * **Zwei Stufen, und die Plattformstufe ist die gesetzliche** (§6.16): §34a
 * GewO gehoert dem MENSCHEN und muss in der Reinigung benennbar sein, nicht
 * nur in der Security. Die vier vorhandenen Zeilen sind plattformweit
 * (`mandant_id IS NULL`); `q_schreiben`/`q_aendern` (0030) lassen sie nur
 * `app.ist_super_admin()`. Ein Mandanten-Admin mit `stammdaten.verwalten`
 * sieht sie, legt aber nur eigene Qualifikationen an — und genau das steht
 * auf dem Bildschirm.
 *
 * **Drei Felder tragen ihre offene Frage sichtbar**, statt wie gepflegte
 * Angaben auszusehen: `standard_gueltigkeit_monate` (O-341 — die Frist des
 * Bewacherausweises), `erfordert_dokument` (O-343 — gehoeren die Urkunden in
 * die Plattform) und `kategorie` (O-144 — welche Kategorien die
 * Nachweisberichte fuehren; `bericht/kacheln.ts` gruppiert danach).
 *
 * **`nachweis_art_id` gehoert NICHT ins Formular.** Die Spalte existiert seit
 * 0030 und wird von keiner Codezeile gelesen; ein Feld dafuer pflegte einen
 * toten Wert und sah dabei aus wie eine Zuordnung, auf die sich etwas stuetzt.
 * Bis O-107 die Artenliste bestaetigt, bleibt sie, wo sie ist.
 *
 * **`rechtsgrundlage` ist ANZEIGETEXT und nie Grundlage einer Entscheidung.**
 * Das Tor hat sie frueher mit `ilike '%34a%'` ausgewertet — „§ 34 a GewO"
 * schaltete die Pruefung lautlos ab. Die maschinenlesbare Haelfte ist
 * `einsatzanforderung.bewacherregister_pflicht`.
 */

export const KATEGORIEN = [
  'gesetzlich', 'fachlich', 'fuehrerschein', 'gesundheit', 'intern',
] as const;
export type Kategorie = typeof KATEGORIEN[number];

export const KATEGORIE_TEXT: Readonly<Record<Kategorie, string>> = {
  gesetzlich: 'gesetzlich', fachlich: 'fachlich',
  fuehrerschein: 'Führerschein', gesundheit: 'Gesundheit', intern: 'intern',
};

/** SPEC §14 nennt genau diese drei Stufen fuer den Ablaufwaechter. */
export const WARNSTUFEN_VORGABE: readonly number[] = [60, 30, 7];

export interface QualifikationZeile {
  readonly id: string;
  readonly istPlattform: boolean;
  readonly schluessel: string;
  readonly bezeichnung: string;
  readonly bezeichnungI18n: Readonly<Record<string, string>>;
  readonly beschreibung: string | null;
  readonly kategorie: Kategorie;
  readonly rechtsgrundlage: string | null;
  readonly laeuftAb: boolean;
  /** `null` heisst: die Frist steht am Nachweis, nicht im Katalog (O-341). */
  readonly standardGueltigkeitMonate: number | null;
  readonly warnungTage: readonly number[];
  readonly blockiertEinsatz: boolean;
  readonly erfordertDokument: boolean;
  readonly archiviertAm: string | null;
  /** Nachweise auf diese Qualifikation — `null` ohne `personal.nachweis_lesen`. */
  readonly nachweise: number | null;
  /** Posten-Anforderungen — `null` ohne `security.lesen`. */
  readonly anforderungen: number | null;
}

interface Roh {
  id: string; ist_plattform: boolean; schluessel: string; bezeichnung: string;
  bezeichnung_i18n: Record<string, string> | null; beschreibung: string | null;
  kategorie: string; rechtsgrundlage: string | null; laeuft_ab: boolean;
  standard_gueltigkeit_monate: number | null; warnung_tage: number[] | null;
  blockiert_einsatz: boolean; erfordert_dokument: boolean;
  archiviert_am: string | null;
}

/**
 * Der Katalog mit seiner Reichweite.
 *
 * Die beiden Zahlen sind rechtegebunden und werden nur gefragt, wenn der
 * Aufrufer das Recht haelt: `nachweis` liest mit `personal.nachweis_lesen`,
 * `einsatzanforderung` mit `security.lesen`. Ohne das Recht bleibt `null` —
 * „0 Nachweise" waere sonst eine Aussage ueber den Bestand statt ueber die
 * Rechte, und genau darauf stuetzte sich dann eine Entscheidung ueber
 * `blockiert_einsatz`.
 */
export async function ladeQualifikationen(
  kontext: LeseKontext,
  rechte: { readonly nachweise: boolean; readonly anforderungen: boolean },
): Promise<readonly QualifikationZeile[]> {
  const roh = await kontext.abfrage<Roh>(
    `select id, (mandant_id is null) as ist_plattform, schluessel, bezeichnung,
            bezeichnung_i18n, beschreibung, kategorie::text as kategorie,
            rechtsgrundlage, laeuft_ab, standard_gueltigkeit_monate, warnung_tage,
            blockiert_einsatz, erfordert_dokument,
            archiviert_am::text as archiviert_am
       from qualifikation
      order by (archiviert_am is not null), (mandant_id is null) desc,
               kategorie, bezeichnung`);

  const nachweise = rechte.nachweise
    ? new Map((await kontext.abfrage<{ q: string; anzahl: string }>(
      `select qualifikation_id as q, count(*)::text as anzahl
         from nachweis group by qualifikation_id`)).map((z) => [z.q, Number(z.anzahl)]))
    : null;
  const anforderungen = rechte.anforderungen
    ? new Map((await kontext.abfrage<{ q: string; anzahl: string }>(
      `select qualifikation_id as q, count(*)::text as anzahl
         from einsatzanforderung
        where archiviert_am is null
        group by qualifikation_id`)).map((z) => [z.q, Number(z.anzahl)]))
    : null;

  return roh.map((r) => ({
    id: r.id, istPlattform: r.ist_plattform, schluessel: r.schluessel,
    bezeichnung: r.bezeichnung, bezeichnungI18n: r.bezeichnung_i18n ?? {},
    beschreibung: r.beschreibung, kategorie: r.kategorie as Kategorie,
    rechtsgrundlage: r.rechtsgrundlage, laeuftAb: r.laeuft_ab,
    standardGueltigkeitMonate: r.standard_gueltigkeit_monate === null
      ? null : Number(r.standard_gueltigkeit_monate),
    warnungTage: (r.warnung_tage ?? []).map((t) => Number(t)),
    blockiertEinsatz: r.blockiert_einsatz,
    erfordertDokument: r.erfordert_dokument,
    archiviertAm: r.archiviert_am,
    nachweise: nachweise === null ? null : nachweise.get(r.id) ?? 0,
    anforderungen: anforderungen === null ? null : anforderungen.get(r.id) ?? 0,
  }));
}

export interface QualifikationEingabe {
  readonly schluessel: string;
  readonly bezeichnung: string;
  readonly i18n: Readonly<Record<string, string>>;
  readonly beschreibung: string | null;
  readonly kategorie: Kategorie;
  readonly rechtsgrundlage: string | null;
  readonly laeuftAb: boolean;
  readonly standardGueltigkeitMonate: number | null;
  readonly warnungTage: readonly number[];
  readonly blockiertEinsatz: boolean;
  readonly erfordertDokument: boolean;
  readonly plattform: boolean;
}

/**
 * `60, 30, 7` → `[60, 30, 7]`; absteigend, ohne Dubletten, alle positiv.
 *
 * `qualifikation_warnstufen` verlangt in der Datenbank eine nicht leere Liste
 * mit ausschliesslich positiven Werten. Eine leere Liste hiesse „nie warnen",
 * eine `0` hiesse „immer warnen" — beides sind Zustaende, die ein Mensch
 * benennen koennen soll, statt sie durch ein leeres Feld zu erzeugen.
 */
export function pruefeWarnstufen(eingabe: string): readonly number[] {
  const roh = eingabe.trim();
  if (roh === '') return WARNSTUFEN_VORGABE;
  const teile = roh.split(/[,;\s]+/u).filter((t) => t !== '');
  const zahlen: number[] = [];
  for (const teil of teile) {
    if (!/^\d{1,4}$/u.test(teil)) {
      throw new StammdatenFehler('ungueltig',
        `Warnstufen: „${teil}" ist keine Anzahl von Tagen. Erwartet wird eine `
        + 'Liste wie „60, 30, 7".');
    }
    const zahl = Number.parseInt(teil, 10);
    if (zahl <= 0) {
      throw new StammdatenFehler('ungueltig',
        'Eine Warnstufe von 0 Tagen hiesse „immer warnen" — SPEC §14 nennt '
        + '60, 30 und 7.');
    }
    if (!zahlen.includes(zahl)) zahlen.push(zahl);
  }
  return [...zahlen].sort((a, b) => b - a);
}

export function pruefeQualifikationEingabe(
  lies: (feld: string) => string | null, plattform: boolean,
): QualifikationEingabe {
  const bezeichnung = pflichttext(lies('bezeichnung'), 'Bezeichnung');
  const kategorie = (lies('kategorie') ?? '').trim();
  if (!(KATEGORIEN as readonly string[]).includes(kategorie)) {
    throw new StammdatenFehler('ungueltig',
      `„${kategorie}" ist keine Kategorie. Der Aufzählungstyp `
      + `qualifikation_kategorie kennt ${KATEGORIEN.join(', ')} (O-144).`);
  }
  const laeuftAb = lies('laeuftAb') === 'ja';
  const monateRoh = (lies('standardGueltigkeitMonate') ?? '').trim();
  if (monateRoh !== '' && !/^\d{1,3}$/u.test(monateRoh)) {
    throw new StammdatenFehler('ungueltig',
      'Standardgültigkeit: eine ganze Zahl in Monaten oder leer.');
  }
  const monate = monateRoh === '' ? null : Number.parseInt(monateRoh, 10);
  if (monate !== null && monate <= 0) {
    throw new StammdatenFehler('ungueltig',
      'Eine Standardgültigkeit von 0 Monaten ergibt einen Nachweis, der am Tag '
      + 'seiner Ausstellung abläuft.');
  }
  if (monate !== null && !laeuftAb) {
    throw new StammdatenFehler('ungueltig',
      'Eine Qualifikation, die nicht abläuft, hat keine Standardgültigkeit. Eine '
      + 'bestandene Sachkundeprüfung verfällt nicht — ein Ablaufdatum darauf wäre '
      + 'eine erfundene Frist, und der Wächter mahnte eine Erneuerung an, die es '
      + 'nicht gibt.');
  }
  const beschreibung = (lies('beschreibung') ?? '').trim();
  const grundlage = (lies('rechtsgrundlage') ?? '').trim();
  return {
    schluessel: pruefeSchluessel(lies('schluessel') ?? ''),
    bezeichnung,
    i18n: i18nAus(lies, bezeichnung),
    beschreibung: beschreibung === '' ? null : beschreibung,
    kategorie: kategorie as Kategorie,
    rechtsgrundlage: grundlage === '' ? null : grundlage,
    laeuftAb,
    standardGueltigkeitMonate: monate,
    warnungTage: pruefeWarnstufen(lies('warnungTage') ?? ''),
    blockiertEinsatz: lies('blockiertEinsatz') === 'ja',
    erfordertDokument: lies('erfordertDokument') === 'ja',
    plattform,
  };
}

async function pruefeStufenkollision(
  kontext: LeseKontext, schluessel: string, plattform: boolean,
): Promise<void> {
  const [zeile] = await kontext.abfrage<{ anzahl: string }>(
    `select count(*)::text as anzahl
       from qualifikation
      where schluessel = $1 and archiviert_am is null
        and (mandant_id is null) = $2`,
    [schluessel, !plattform]);
  if (Number(zeile?.anzahl ?? '0') > 0) {
    throw new StammdatenFehler('kollision', plattform
      ? `Den Schlüssel „${schluessel}" führt mindestens eine Gesellschaft schon als `
        + 'eigene Qualifikation.'
      : `Den Schlüssel „${schluessel}" führt der Plattformkatalog schon — diese `
        + 'Qualifikation steht Ihnen bereits zur Verfügung, gesellschaftsübergreifend '
        + 'für denselben Menschen (D-09).');
  }
}

export async function legeQualifikationAn(
  kontext: SchreibKontext, e: QualifikationEingabe,
): Promise<string> {
  await pruefeStufenkollision(kontext, e.schluessel, e.plattform);
  try {
    const [zeile] = await kontext.schreibe<{ id: string }>(
      `insert into qualifikation
         (mandant_id, schluessel, bezeichnung, bezeichnung_i18n, beschreibung,
          kategorie, rechtsgrundlage, laeuft_ab, standard_gueltigkeit_monate,
          warnung_tage, blockiert_einsatz, erfordert_dokument, erstellt_von)
       values (case when $12::boolean then null else app.aktiver_mandant() end,
               $1, $2, $3::jsonb, $4, $5::qualifikation_kategorie, $6,
               $7::boolean, $8::int, $9::int[], $10::boolean, $11::boolean,
               $13::uuid)
       returning id`,
      [e.schluessel, e.bezeichnung, e.i18n, e.beschreibung,
        e.kategorie, e.rechtsgrundlage, e.laeuftAb, e.standardGueltigkeitMonate,
        `{${e.warnungTage.join(',')}}`, e.blockiertEinsatz, e.erfordertDokument,
        e.plattform, kontext.benutzerId]);
    const id = zeile?.id;
    if (id === undefined) {
      throw new StammdatenFehler('plattform',
        'Die Qualifikation wurde nicht angelegt. Plattformweite Katalogzeilen '
        + 'pflegt die Super-Administration (§6.16); eigene Qualifikationen '
        + 'brauchen stammdaten.verwalten in dieser Gesellschaft.');
    }
    await protokolliere(kontext, 'stammdaten.qualifikation_angelegt', id, null, e);
    return id;
  } catch (fehler: unknown) {
    throw alsStammdatenFehler(fehler, 'dieser Katalog') ?? fehler;
  }
}

/**
 * Aendern OHNE `schluessel` — `kern.qualifikation_katalog_schutz` friert ihn
 * ein, und zwar zu Recht: er steht in Berichten und Exporten.
 */
export async function aendereQualifikation(
  kontext: SchreibKontext, id: string, e: QualifikationEingabe,
): Promise<void> {
  const vorher = await einZeile(kontext, id);
  try {
    const [zeile] = await kontext.schreibe<{ id: string }>(
      `update qualifikation
          set bezeichnung = $2, bezeichnung_i18n = $3::jsonb, beschreibung = $4,
              kategorie = $5::qualifikation_kategorie, rechtsgrundlage = $6,
              laeuft_ab = $7::boolean, standard_gueltigkeit_monate = $8::int,
              warnung_tage = $9::int[], blockiert_einsatz = $10::boolean,
              erfordert_dokument = $11::boolean, geaendert_von = $12::uuid
        where id = $1 and archiviert_am is null
        returning id`,
      [id, e.bezeichnung, e.i18n, e.beschreibung, e.kategorie,
        e.rechtsgrundlage, e.laeuftAb, e.standardGueltigkeitMonate,
        `{${e.warnungTage.join(',')}}`, e.blockiertEinsatz, e.erfordertDokument,
        kontext.benutzerId]);
    if (zeile === undefined) throw nichtAenderbar(vorher !== null);
    await protokolliere(kontext, 'stammdaten.qualifikation_geaendert', id, vorher, e);
  } catch (fehler: unknown) {
    throw alsStammdatenFehler(fehler, 'dieser Katalog') ?? fehler;
  }
}

/**
 * Ende einer Qualifikation: `archiviert_am` UND `archiviert_von` (Invariante
 * 8). Die Nachweise bleiben — ein abgelaufener §34a-Nachweis von 2027 ist die
 * Zeile, mit der eine Aufsicht die Zulaessigkeit eines vergangenen Einsatzes
 * prueft.
 */
export async function archiviereQualifikation(
  kontext: SchreibKontext, id: string,
): Promise<void> {
  const vorher = await einZeile(kontext, id);
  const [zeile] = await kontext.schreibe<{ id: string }>(
    `update qualifikation
        set archiviert_am = now(), archiviert_von = $2::uuid, geaendert_von = $2::uuid
      where id = $1 and archiviert_am is null
      returning id`,
    [id, kontext.benutzerId]);
  if (zeile === undefined) throw nichtAenderbar(vorher !== null);
  await protokolliere(kontext, 'stammdaten.qualifikation_archiviert', id, vorher, null);
}

function nichtAenderbar(sichtbar: boolean): StammdatenFehler {
  return sichtbar
    ? new StammdatenFehler('plattform',
      'Diese Qualifikation ist nicht änderbar: plattformweite Katalogzeilen pflegt '
      + 'die Super-Administration mit zweitem Faktor (§6.16) — oder sie ist bereits '
      + 'archiviert.')
    : new StammdatenFehler('nicht_gefunden', 'Diese Qualifikation gibt es nicht.');
}

async function einZeile(
  kontext: LeseKontext, id: string,
): Promise<Readonly<Record<string, unknown>> | null> {
  const [zeile] = await kontext.abfrage<Record<string, unknown>>(
    `select schluessel, bezeichnung, beschreibung, kategorie::text as kategorie,
            rechtsgrundlage, laeuft_ab, standard_gueltigkeit_monate, warnung_tage,
            blockiert_einsatz, erfordert_dokument, archiviert_am
       from qualifikation where id = $1`, [id]);
  return zeile ?? null;
}

/**
 * `qualifikation` traegt bewusst KEINEN Audit-Ausloeser (`rls.ts`: „`nachweis`
 * und `bewacher_eintrag` ja, `qualifikation` nein"). Fuer `blockiert_einsatz`
 * genuegt das nicht: der Schalter entscheidet, ob eine Einteilung verweigert
 * wird, und „seit wann sperrt das" ist eine Frage, die im Streitfall gestellt
 * wird. Diese Zeile beantwortet sie.
 */
async function protokolliere(
  kontext: SchreibKontext, aktion: string, id: string,
  vorher: unknown, nachher: unknown,
): Promise<void> {
  await kontext.schreibe(
    `select app.protokolliere($1, 'qualifikation', $2, $3::jsonb, $4::jsonb,
                              app.aktiver_mandant())`,
    [aktion, id, vorher, nachher]);
}
