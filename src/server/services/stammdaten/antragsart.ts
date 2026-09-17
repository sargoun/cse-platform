import 'server-only';
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import {
  StammdatenFehler, alsStammdatenFehler, i18nAus, pflichttext, pruefeSchluessel,
} from './katalog.js';

/**
 * Der Antragsartenkatalog als PFLEGBARER Bestand (EMP-10, EMP-12, K-17,
 * O-142; 01-KERN §6.28, `04-SEITENKARTE` §5.13).
 *
 * **Die drei vorhandenen Arten sind nicht pflegbar, und das ist richtig.**
 * `urlaub`, `krankmeldung` und `schichttausch` tragen `ist_system` und
 * `mandant_id IS NULL`. An ihnen haengen zwei Ausloeser
 * (`kern.antrag_pflichtfelder`, `kern.antrag_erzeugt_abwesenheit`) und damit
 * die Kette Antrag → Abwesenheit; sie umzuschalten aendert rueckwirkend, was
 * eine Genehmigung bewirkt. Die Policy `t_plattform_aendern` (0275) laesst
 * sie deshalb auch dem Super-Admin nicht.
 *
 * **Offen ist damit nicht die Pflege, sondern der Bestand: O-142.** Welche
 * WEITEREN Arten die Gruppe fuehrt — unbezahlte Freistellung,
 * Freizeitausgleich, Schichtabgabe, Stammdatenaenderung — hat niemand
 * beantwortet. Diese Schicht legt sie an, sobald jemand es sagt; sie erfindet
 * keine.
 *
 * **Vier der sechs Schalter erreichen das Antragsformular, zwei nicht.**
 * `leseAntragsarten` (`mitarbeiter/antraege.ts`) traegt `erfordert_zeitraum`,
 * `erfordert_abwesenheitsart`, `erfordert_einsatz` und
 * `erfordert_tauschpartner` ins Formular. `erzeugt_abwesenheit` wirkt erst bei
 * der ENTSCHEIDUNG, `ist_stammdatenaenderung` ausschliesslich im Ausloeser
 * `kern.antrag_pflichtfelder` — in keiner TypeScript-Zeile. Wer sie fuer
 * Formularschalter haelt, beschriftet die teuersten beiden falsch.
 */

/** Wo ein Schalter wirkt — die Seite schreibt es an jede Zeile. */
export interface Schalter {
  readonly feld: string;
  readonly label: string;
  readonly wirkung: string;
  /** `formular`: im Mitarbeiterportal. `entscheidung`: erst danach. */
  readonly wo: 'formular' | 'entscheidung' | 'datenbank';
}

export const SCHALTER: readonly Schalter[] = [
  {
    feld: 'erfordertZeitraum', label: 'Zeitraum',
    wo: 'formular',
    wirkung: 'Das Antragsformular verlangt von- und bis-Datum; ohne sie weist '
      + 'kern.antrag_pflichtfelder den Antrag ab.',
  },
  {
    feld: 'erfordertAbwesenheitsart', label: 'Abwesenheitsart',
    wo: 'formular',
    wirkung: 'Der Mensch wählt eine Art aus dem Abwesenheitskatalog — genau die '
      + 'Liste, die die Seite „Abwesenheitsarten" pflegt.',
  },
  {
    feld: 'erfordertEinsatz', label: 'Schicht',
    wo: 'formular',
    wirkung: 'Der Antrag hängt an einer konkreten Schicht (Schichttausch, '
      + 'Schichtabgabe).',
  },
  {
    feld: 'erfordertTauschpartner', label: 'Tauschpartner',
    wo: 'formular',
    wirkung: 'Eine zweite Beschäftigung derselben Gesellschaft muss benannt '
      + 'werden. Über Gesellschaftsgrenzen wird nicht getauscht (D-09).',
  },
  {
    feld: 'erzeugtAbwesenheit', label: 'Erzeugt Abwesenheit',
    wo: 'entscheidung',
    wirkung: 'Wirkt NICHT im Formular, sondern bei der Genehmigung: der Dienst '
      + 'schreibt die Abwesenheit, und kern.antrag_erzeugt_abwesenheit fängt den '
      + 'Fall ab, dass jemand daran vorbei genehmigt. Braucht deshalb Zeitraum '
      + 'UND Abwesenheitsart — beide Spalten sind in abwesenheit NOT NULL.',
  },
  {
    feld: 'istStammdatenaenderung', label: 'Stammdatenänderung',
    wo: 'datenbank',
    wirkung: 'Kommt in keiner TypeScript-Zeile vor: nur kern.antrag_pflichtfelder '
      + 'prüft ihn und weist einen Änderungswunsch ohne diesen Schalter ab.',
  },
];

export interface AntragsartZeile {
  readonly id: string;
  readonly istPlattform: boolean;
  readonly istSystem: boolean;
  readonly schluessel: string;
  readonly bezeichnung: string;
  readonly bezeichnungI18n: Readonly<Record<string, string>>;
  readonly erfordertZeitraum: boolean;
  readonly erfordertAbwesenheitsart: boolean;
  readonly erfordertEinsatz: boolean;
  readonly erfordertTauschpartner: boolean;
  readonly erzeugtAbwesenheit: boolean;
  readonly istStammdatenaenderung: boolean;
  readonly archiviertAm: string | null;
  /** Wie viele Anträge auf diese Art zeigen — `null`, wo das Recht fehlt. */
  readonly antraege: number | null;
}

interface Roh {
  id: string; ist_plattform: boolean; ist_system: boolean; schluessel: string;
  bezeichnung: string; bezeichnung_i18n: Record<string, string> | null;
  erfordert_zeitraum: boolean; erfordert_abwesenheitsart: boolean;
  erfordert_einsatz: boolean; erfordert_tauschpartner: boolean;
  erzeugt_abwesenheit: boolean; ist_stammdatenaenderung: boolean;
  archiviert_am: string | null;
}

function zuZeile(r: Roh, antraege: number | null): AntragsartZeile {
  return {
    id: r.id, istPlattform: r.ist_plattform, istSystem: r.ist_system,
    schluessel: r.schluessel, bezeichnung: r.bezeichnung,
    bezeichnungI18n: r.bezeichnung_i18n ?? {},
    erfordertZeitraum: r.erfordert_zeitraum,
    erfordertAbwesenheitsart: r.erfordert_abwesenheitsart,
    erfordertEinsatz: r.erfordert_einsatz,
    erfordertTauschpartner: r.erfordert_tauschpartner,
    erzeugtAbwesenheit: r.erzeugt_abwesenheit,
    istStammdatenaenderung: r.ist_stammdatenaenderung,
    archiviertAm: r.archiviert_am, antraege,
  };
}

/**
 * Der Katalog — und, wo das Recht es zulaesst, die Zahl der Antraege je Art.
 *
 * `antrag.antragsart_id` ist `cse_app` NICHT entzogen (anders als
 * `abwesenheit.abwesenheitsart_id`, K-05): die ART eines Antrags ist keine
 * Gesundheitsangabe, der GRUND steckt in der verknuepften Abwesenheit. Die
 * Zahl entscheidet, ob ein Archivieren einen Bestand zurueckliesse — deshalb
 * steht sie hier und nicht in einer zweiten Abfrage der Seite.
 *
 * `zaehle` trennt „null Antraege" von „darf die Antraege nicht sehen":
 * `t_mandant` auf `antrag` verlangt `zeit.abwesenheit_lesen`, und eine 0 aus
 * einer leeren RLS-Antwort waere eine Behauptung ueber den Bestand.
 */
export async function ladeAntragsarten(
  kontext: LeseKontext, zaehle: boolean,
): Promise<readonly AntragsartZeile[]> {
  const roh = await kontext.abfrage<Roh>(
    `select id, (mandant_id is null) as ist_plattform, ist_system, schluessel,
            bezeichnung, bezeichnung_i18n, erfordert_zeitraum,
            erfordert_abwesenheitsart, erfordert_einsatz, erfordert_tauschpartner,
            erzeugt_abwesenheit, ist_stammdatenaenderung,
            archiviert_am::text as archiviert_am
       from antragsart
      order by (archiviert_am is not null), (mandant_id is null) desc, bezeichnung`);
  if (!zaehle) return roh.map((r) => zuZeile(r, null));
  const zeilen = await kontext.abfrage<{ art: string; anzahl: string }>(
    `select antragsart_id as art, count(*)::text as anzahl
       from antrag group by antragsart_id`);
  const karte = new Map(zeilen.map((z) => [z.art, Number(z.anzahl)]));
  return roh.map((r) => zuZeile(r, karte.get(r.id) ?? 0));
}

export interface AntragsartEingabe {
  readonly schluessel: string;
  readonly bezeichnung: string;
  readonly i18n: Readonly<Record<string, string>>;
  readonly erfordertZeitraum: boolean;
  readonly erfordertAbwesenheitsart: boolean;
  readonly erfordertEinsatz: boolean;
  readonly erfordertTauschpartner: boolean;
  readonly erzeugtAbwesenheit: boolean;
  readonly istStammdatenaenderung: boolean;
  readonly plattform: boolean;
}

/**
 * Die Eingabe — mit der EINEN Stimmigkeitspruefung, die spaeter teuer wird.
 *
 * `erzeugt_abwesenheit` ohne Zeitraum oder ohne Abwesenheitsart ist kein
 * Geschmacksfall: `kern.antrag_erzeugt_abwesenheit` fuegt bei der Genehmigung
 * in `abwesenheit` ein, und dort sind `von`, `bis` und `abwesenheitsart_id`
 * NOT NULL. Die Art liesse sich anlegen, jeder Antrag darauf einreichen — und
 * erst die GENEHMIGUNG scheiterte, mit einem NOT-NULL-Fehler an einer Stelle,
 * an der niemand mehr nach dem Katalog sucht. Die Pruefung gehoert deshalb
 * hierhin, wo der Satz noch ins Formular passt.
 */
export function pruefeAntragsartEingabe(
  lies: (feld: string) => string | null, plattform: boolean,
): AntragsartEingabe {
  const bezeichnung = pflichttext(lies('bezeichnung'), 'Bezeichnung');
  const ja = (feld: string): boolean => lies(feld) === 'ja';
  const erzeugt = ja('erzeugtAbwesenheit');
  const zeitraum = ja('erfordertZeitraum');
  const art = ja('erfordertAbwesenheitsart');
  if (erzeugt && !(zeitraum && art)) {
    throw new StammdatenFehler('ungueltig',
      'Eine Art, die eine Abwesenheit erzeugt, muss Zeitraum UND Abwesenheitsart '
      + 'verlangen: die Abwesenheit trägt beide Angaben als Pflichtfeld. Sonst '
      + 'scheitert erst die Genehmigung — nicht der Antrag.');
  }
  return {
    schluessel: pruefeSchluessel(lies('schluessel') ?? ''),
    bezeichnung,
    i18n: i18nAus(lies, bezeichnung),
    erfordertZeitraum: zeitraum,
    erfordertAbwesenheitsart: art,
    erfordertEinsatz: ja('erfordertEinsatz'),
    erfordertTauschpartner: ja('erfordertTauschpartner'),
    erzeugtAbwesenheit: erzeugt,
    istStammdatenaenderung: ja('istStammdatenaenderung'),
    plattform,
  };
}

async function pruefeStufenkollision(
  kontext: LeseKontext, schluessel: string, plattform: boolean,
): Promise<void> {
  const [zeile] = await kontext.abfrage<{ anzahl: string }>(
    `select count(*)::text as anzahl
       from antragsart
      where schluessel = $1 and archiviert_am is null
        and (mandant_id is null) = $2`,
    [schluessel, !plattform]);
  if (Number(zeile?.anzahl ?? '0') > 0) {
    throw new StammdatenFehler('kollision', plattform
      ? `Den Schlüssel „${schluessel}" führt mindestens eine Gesellschaft schon als `
        + 'eigene Art.'
      : `Den Schlüssel „${schluessel}" führt der Plattformkatalog schon — im `
        + 'Antragsformular stünden sonst zwei gleich aussehende Einträge (0276).');
  }
}

export async function legeAntragsartAn(
  kontext: SchreibKontext, e: AntragsartEingabe,
): Promise<string> {
  await pruefeStufenkollision(kontext, e.schluessel, e.plattform);
  try {
    const [zeile] = await kontext.schreibe<{ id: string }>(
      `insert into antragsart
         (mandant_id, schluessel, bezeichnung, bezeichnung_i18n, erfordert_zeitraum,
          erfordert_abwesenheitsart, erfordert_einsatz, erfordert_tauschpartner,
          erzeugt_abwesenheit, ist_stammdatenaenderung, ist_system, erstellt_von)
       values (case when $10::boolean then null else app.aktiver_mandant() end,
               $1, $2, $3::jsonb, $4::boolean, $5::boolean, $6::boolean,
               $7::boolean, $8::boolean, $9::boolean, false, $11::uuid)
       returning id`,
      [e.schluessel, e.bezeichnung, e.i18n, e.erfordertZeitraum,
        e.erfordertAbwesenheitsart, e.erfordertEinsatz, e.erfordertTauschpartner,
        e.erzeugtAbwesenheit, e.istStammdatenaenderung, e.plattform,
        kontext.benutzerId]);
    const id = zeile?.id;
    if (id === undefined) {
      throw new StammdatenFehler('plattform',
        'Die Art wurde nicht angelegt — der Plattformkatalog wird von der '
        + 'Super-Administration gepflegt.');
    }
    await protokolliere(kontext, 'stammdaten.antragsart_angelegt', id, null, e);
    return id;
  } catch (fehler: unknown) {
    throw alsStammdatenFehler(fehler, 'dieser Katalog') ?? fehler;
  }
}

/**
 * `ist_system` wird hier NIE gesetzt und nie entfernt.
 *
 * Es ist die Marke der drei Arten aus EMP-10 und keine Einstellung: eine neu
 * angelegte Art, die sich selbst zur Systemart erklaerte, waere danach von
 * keiner Oberflaeche mehr aenderbar — und die Policy weist sie ohnehin ab.
 */
export async function aendereAntragsart(
  kontext: SchreibKontext, id: string, e: AntragsartEingabe,
): Promise<void> {
  const vorher = await einZeile(kontext, id);
  if (vorher?.['ist_system'] === true) {
    throw new StammdatenFehler('system',
      'Die drei Antragsarten aus EMP-10 sind unveränderlich — auch für die '
      + 'Super-Administration. An ihnen hängt die Kette Antrag → Abwesenheit.');
  }
  try {
    const [zeile] = await kontext.schreibe<{ id: string }>(
      `update antragsart
          set bezeichnung = $2, bezeichnung_i18n = $3::jsonb,
              erfordert_zeitraum = $4::boolean,
              erfordert_abwesenheitsart = $5::boolean,
              erfordert_einsatz = $6::boolean,
              erfordert_tauschpartner = $7::boolean,
              erzeugt_abwesenheit = $8::boolean,
              ist_stammdatenaenderung = $9::boolean,
              geaendert_am = now(), geaendert_von = $10::uuid
        where id = $1 and archiviert_am is null and not ist_system
        returning id`,
      [id, e.bezeichnung, e.i18n, e.erfordertZeitraum,
        e.erfordertAbwesenheitsart, e.erfordertEinsatz, e.erfordertTauschpartner,
        e.erzeugtAbwesenheit, e.istStammdatenaenderung, kontext.benutzerId]);
    if (zeile === undefined) throw nichtAenderbar(vorher !== null);
    await protokolliere(kontext, 'stammdaten.antragsart_geaendert', id, vorher, e);
  } catch (fehler: unknown) {
    throw alsStammdatenFehler(fehler, 'dieser Katalog') ?? fehler;
  }
}

export async function archiviereAntragsart(
  kontext: SchreibKontext, id: string,
): Promise<void> {
  const vorher = await einZeile(kontext, id);
  if (vorher?.['ist_system'] === true) {
    throw new StammdatenFehler('system',
      'Eine Systemart wird nicht archiviert: ohne sie gäbe es keinen Weg, '
      + 'Urlaub oder eine Krankmeldung zu melden (EMP-10).');
  }
  const [zeile] = await kontext.schreibe<{ id: string }>(
    `update antragsart
        set archiviert_am = now(), geaendert_am = now(), geaendert_von = $2::uuid
      where id = $1 and archiviert_am is null and not ist_system
      returning id`,
    [id, kontext.benutzerId]);
  if (zeile === undefined) throw nichtAenderbar(vorher !== null);
  await protokolliere(kontext, 'stammdaten.antragsart_archiviert', id, vorher, null);
}

function nichtAenderbar(sichtbar: boolean): StammdatenFehler {
  return sichtbar
    ? new StammdatenFehler('plattform',
      'Diese Art ist nicht änderbar: sie gehört dem Plattformkatalog (den pflegt '
      + 'die Super-Administration mit zweitem Faktor), ist eine Systemart oder '
      + 'bereits archiviert.')
    : new StammdatenFehler('nicht_gefunden', 'Diese Antragsart gibt es nicht.');
}

async function einZeile(
  kontext: LeseKontext, id: string,
): Promise<Readonly<Record<string, unknown>> | null> {
  const [zeile] = await kontext.abfrage<Record<string, unknown>>(
    `select schluessel, bezeichnung, ist_system, erfordert_zeitraum,
            erfordert_abwesenheitsart, erfordert_einsatz, erfordert_tauschpartner,
            erzeugt_abwesenheit, ist_stammdatenaenderung, archiviert_am
       from antragsart where id = $1`, [id]);
  return zeile ?? null;
}

/** `antragsart` traegt keinen Audit-Ausloeser — die Zeile kommt von Hand. */
async function protokolliere(
  kontext: SchreibKontext, aktion: string, id: string,
  vorher: unknown, nachher: unknown,
): Promise<void> {
  await kontext.schreibe(
    `select app.protokolliere($1, 'antragsart', $2, $3::jsonb, $4::jsonb,
                              app.aktiver_mandant())`,
    [aktion, id, vorher, nachher]);
}
