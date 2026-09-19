import 'server-only';
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import { StammdatenFehler, isoDatum, pflichttext } from './katalog.js';

/**
 * Die Belagsarten und ihre Leistungswerte (OPS-03, K-05, O-17, O-349;
 * 01-KERN §6.6, `04-SEITENKARTE` §5.13).
 *
 * **Eine Aenderung ist hier kein UPDATE.** Aus dem Leistungswert (m²/h) und
 * der Flaeche entsteht die Sollzeit und daraus der Angebotspreis. Wer den Wert
 * in der Zeile ueberschreibt, aendert rueckwirkend den Preis JEDER schon
 * gerechneten Kalkulation — und keine davon laesst sich danach mehr
 * herleiten. Die Tabelle traegt deshalb `gueltig_ab`/`gueltig_bis` und die
 * Ausschluss-Schranke `belagsart_zeitraum_eindeutig`: die laufende Fassung
 * wird zum Vortag geschlossen, die neue beginnt am gewaehlten Tag.
 *
 * **Alle sechs Zeilen tragen `ist_platzhalter = true`** und als Quelle
 * „Branchenuebliche Groessenordnung — nicht bestaetigt (O-17)". Die Zahl, mit
 * der heute gerechnet wird, hat niemand bestaetigt. `bestaetigt` setzt die
 * Marke ab; sie zu setzen ist die Antwort auf O-17, nicht eine Formalie.
 *
 * **Der Leistungswert ist `cse_app` entzogen** (K-05, 0021): er ist die Marge
 * in einer Spalte. Gelesen wird er ueber `app.belagsart_historie_lesen()`
 * (0277, prueft `stammdaten.verwalten`), geschrieben ueber die normale Policy
 * — und die liest mit `objekt.lesen`. Wer pflegen will, braucht deshalb BEIDE
 * Rechte; die Seite sagt das, statt ein Formular anzubieten, das die
 * Datenbank abweist.
 *
 * **Gerechnet wird hier nichts.** `leistungswert_qm_pro_stunde` ist
 * `numeric(10,3)` und reist als TEXT — durch keine Gleitkommazahl (K-16).
 * Die Sollzeit rechnet `reinigung/sollzeit.ts`, den Preis
 * `kalkulation/raumbuch.ts`.
 */

/**
 * `39,5` → `39.500`; nie ueber eine Gleitkommazahl (K-16).
 *
 * Sieben Vorkommastellen, nicht sechs: `leistungswert_qm_pro_stunde` ist
 * `numeric(10,3)` und traegt damit genau 10 − 3 = 7 Stellen vor dem Komma.
 * Eine engere Form hier waere eine Grenze, die die Tabelle nicht kennt — und
 * die Meldung nennt sie nicht einmal, sodass ein abgewiesener Wert wie ein
 * Tippfehler aussaehe.
 */
const WERT_FORM = /^\d{1,7}(?:[.,]\d{1,3})?$/u;

export function alsLeistungswert(eingabe: string): string {
  const roh = eingabe.trim();
  if (!WERT_FORM.test(roh)) {
    throw new StammdatenFehler('ungueltig',
      `„${roh}" ist kein Leistungswert. Erlaubt sind Quadratmeter je Stunde mit `
      + 'bis zu drei Nachkommastellen, z. B. 250 oder 187,5.');
  }
  const [ganz, teil = ''] = roh.replace(',', '.').split('.');
  const wert = `${ganz ?? '0'}.${teil.padEnd(3, '0')}`;
  if (/^0+\.0{3}$/u.test(wert)) {
    throw new StammdatenFehler('ungueltig',
      'Ein Leistungswert von 0 m²/h ergibt eine unendliche Sollzeit — '
      + '`belagsart_leistungswert_positiv` weist ihn ab.');
  }
  return wert;
}

/** Der Tag davor, als ISO-Text — ohne Zeitzone und ohne Uhr (K-11). */
export function vortag(iso: string): string {
  const [jahr, monat, tag] = iso.split('-').map((t) => Number.parseInt(t, 10));
  const zeit = Date.UTC(jahr ?? 1970, (monat ?? 1) - 1, (tag ?? 1)) - 86_400_000;
  return new Date(zeit).toISOString().slice(0, 10);
}

export interface BelagsartFassung {
  readonly id: string;
  readonly code: string;
  readonly bezeichnung: string;
  readonly beschreibung: string | null;
  /** m²/h als TEXT, genau so, wie `numeric(10,3)` ihn fuehrt. */
  readonly leistungswert: string;
  readonly quelle: string;
  readonly istPlatzhalter: boolean;
  readonly gueltigAb: string;
  readonly gueltigBis: string | null;
  /** Raeume, die auf DIESE Fassung zeigen — `null` ohne `objekt.lesen`. */
  readonly raeume: number | null;
}

interface Roh {
  belagsart_id: string; code: string; bezeichnung: string;
  beschreibung: string | null; leistungswert_qm_pro_stunde: string;
  quelle: string; ist_platzhalter: boolean;
  gueltig_ab: string; gueltig_bis: string | null;
}

/**
 * Jede Fassung jedes Codes — ueber den Definer aus 0277.
 *
 * Nicht `app.leistungswerte_lesen(date)`: die gibt genau die zu EINEM Stichtag
 * gueltige Scheibe und prueft `objekt.lesen`. Diese Seite braucht die
 * Geschichte und traegt `stammdaten.verwalten`.
 */
export async function ladeBelagsarten(
  kontext: LeseKontext, mitRaeumen: boolean,
): Promise<readonly BelagsartFassung[]> {
  const roh = await kontext.abfrage<Roh>(
    `select belagsart_id, code, bezeichnung, beschreibung,
            leistungswert_qm_pro_stunde::text as leistungswert_qm_pro_stunde,
            quelle, ist_platzhalter,
            gueltig_ab::text as gueltig_ab, gueltig_bis::text as gueltig_bis
       from app.belagsart_historie_lesen()`);
  const raeume = mitRaeumen
    ? new Map((await kontext.abfrage<{ art: string; anzahl: string }>(
      `select belagsart_id as art, count(*)::text as anzahl
         from raum
        where belagsart_id is not null and archiviert_am is null
        group by belagsart_id`)).map((z) => [z.art, Number(z.anzahl)]))
    : null;
  return roh.map((r) => ({
    id: r.belagsart_id, code: r.code, bezeichnung: r.bezeichnung,
    beschreibung: r.beschreibung,
    leistungswert: r.leistungswert_qm_pro_stunde,
    quelle: r.quelle, istPlatzhalter: r.ist_platzhalter,
    gueltigAb: r.gueltig_ab, gueltigBis: r.gueltig_bis,
    raeume: raeume === null ? null : raeume.get(r.belagsart_id) ?? 0,
  }));
}

/** Die heute laufende Fassung je Code — `gueltig_bis is null`. */
export function laufendeFassungen(
  fassungen: readonly BelagsartFassung[],
): readonly BelagsartFassung[] {
  return fassungen.filter((f) => f.gueltigBis === null);
}

export interface BelagsartEingabe {
  readonly code: string;
  readonly bezeichnung: string;
  readonly beschreibung: string | null;
  readonly leistungswert: string;
  readonly quelle: string;
  readonly bestaetigt: boolean;
  readonly gueltigAb: string;
}

export function pruefeBelagsartEingabe(
  lies: (feld: string) => string | null,
): BelagsartEingabe {
  /*
   * **Der Code wird auf Länge NICHT geprueft, und das ist Absicht.**
   *
   * `belagsart.code` ist `text` ohne CHECK und ohne `varchar(n)` — die
   * Tabelle fuehrt keine Grenze, SPEC und DECISIONS nennen keine, und der
   * Code kommt aus dem Raumbuch DES KUNDEN, weshalb ihn diese Schicht auch
   * nicht umschreibt. Eine hier erfundene Obergrenze wiese eine echte
   * Kundendatei mit einem laengeren Belagscode ab — mit einer Zahl, die
   * niemand entschieden hat. `bezeichnung` und `beschreibung` sind aus
   * demselben Grund ungeprueft lang.
   *
   * // TODO(client, O-694): Gibt es eine Hoechstlaenge fuer Belagsart- und
   * Reinigungsklassen-Codes aus dem Kundenraumbuch — und wenn ja, welche?
   */
  const code = pflichttext(lies('code'), 'Code');
  const beschreibung = (lies('beschreibung') ?? '').trim();
  return {
    code,
    bezeichnung: pflichttext(lies('bezeichnung'), 'Bezeichnung'),
    beschreibung: beschreibung === '' ? null : beschreibung,
    leistungswert: alsLeistungswert(lies('leistungswert') ?? ''),
    /*
     * Die Quelle ist Pflicht — in der Datenbank (`quelle text not null`) und
     * hier. Ein Leistungswert ohne genannte Herkunft laesst sich im Preisstreit
     * nicht verteidigen, und „Branchenueblich" ist eine Herkunft, die man
     * nachlesen kann. Ein Vorgabewert waere die Herkunft, die niemand gewaehlt
     * hat.
     */
    quelle: pflichttext(lies('quelle'), 'Quelle'),
    bestaetigt: lies('bestaetigt') === 'ja',
    gueltigAb: isoDatum(lies('gueltigAb'), 'Gültig ab'),
  };
}

export type Datierung =
  | { readonly art: 'erste' }
  | { readonly art: 'ablösung'; readonly schliesseZu: string }
  | { readonly art: 'fehler'; readonly satz: string };

/**
 * **Die eine Entscheidung dieses Dienstes, und sie ist testbar ohne
 * Datenbank:** was mit der laufenden Fassung geschieht, wenn eine neue ab
 * einem Tag gelten soll.
 *
 *  · Es gibt keine laufende Fassung → die neue ist die erste.
 *  · Die laufende begann FRUEHER → sie endet am Vortag der neuen.
 *  · Die laufende begann am selben Tag oder spaeter → Fehler. Sie zum Vortag
 *    zu schliessen ergaebe `gueltig_bis < gueltig_ab`
 *    (`belagsart_zeitraum_stimmig` weist das ab), und ein Zeitraum, der vor
 *    seinem Beginn endet, ist keine Lage, die jemand gemeint haben kann.
 *
 * **Eine neue Fassung beginnt damit STRIKT NACH dem Beginn der laufenden** —
 * nicht aus Vorsicht, sondern weil es anders nicht geht: die laufende traegt
 * `gueltig_bis is null`, ihr Bereich ist `daterange(gueltig_ab, 'infinity')`,
 * und JEDER Tag vor ihrem Beginn ueberschneidet ihn.
 * `belagsart_zeitraum_eindeutig` liesse das nie zu; ein frueherer Beginn ist
 * also keine Lage, die die Datenbank noch pruefen koennte.
 *
 * **Rueckwirkend heisst hier: zwischen dem Beginn der laufenden Fassung und
 * heute — und genau dieser Bereich ist unbewacht.** Ein Beginn in ihm wird
 * angenommen und aendert die Grundlage jeder Kalkulation aus dieser Zeit,
 * ohne dass jemand zustimmt. Ob das so bleiben soll, ist O-692; die strengere
 * Variante — Beginn nie vor `app.berlin_heute()` — waere eine Zeile hier.
 */
export function pruefeDatierung(
  gueltigAb: string, laufendeSeit: string | null,
): Datierung {
  if (laufendeSeit === null) return { art: 'erste' };
  if (laufendeSeit >= gueltigAb) {
    return {
      art: 'fehler',
      satz: `Für diesen Code läuft schon eine Fassung ab ${laufendeSeit}. Eine neue `
        + 'Fassung beginnt NACH ihr — sonst endete die alte vor ihrem eigenen '
        + 'Beginn, und „der Leistungswert am Stichtag" hätte zwei Antworten.',
    };
  }
  return { art: 'ablösung', schliesseZu: vortag(gueltigAb) };
}

/**
 * Eine neue Fassung — und die Abloesung der laufenden in einem Zug.
 *
 * Die Reihenfolge ist die Zusage: erst schliessen, dann anlegen. Andersherum
 * stiessen beide fuer einen Augenblick zusammen, und
 * `belagsart_zeitraum_eindeutig` wiese die neue ab — mit einer Meldung ueber
 * einen Zustand, den niemand gewollt hat.
 *
 * Die ALTE Fassung bleibt stehen. Jede Kalkulation, die mit ihr gerechnet hat,
 * bleibt damit nachrechenbar (`kalkulation_position` und
 * `raumbuch_import_zeile` zeigen auf die Fassung, nicht auf den Code).
 */
export async function datiereBelagsartUm(
  kontext: SchreibKontext, e: BelagsartEingabe,
): Promise<void> {
  /*
   * **Der Wert wird HIER normalisiert, nicht nur im Formularleser.**
   *
   * `pruefeBelagsartEingabe` ruft `alsLeistungswert` schon — aber
   * `BelagsartEingabe.leistungswert` ist ein `string`, und dieser Dienst ist
   * exportiert: ein Aufrufer, der die Eingabe selbst zusammensetzt (ein Job,
   * ein Import, ein Test), reicht `300,5` mit deutschem Komma herein. Das
   * kommt als `invalid input syntax for type numeric` aus Postgres zurueck —
   * eine Meldung ueber einen Datentyp, wo ein Satz ueber ein Formularfeld
   * hingehoert, und sie faellt erst beim Schreiben, nach dem Schliessen der
   * laufenden Fassung. `alsLeistungswert` ist dieselbe getestete Funktion
   * (K-16, Invariante 6) und auf `300.500` idempotent.
   */
  const leistungswert = alsLeistungswert(e.leistungswert);

  const [laufend] = await kontext.abfrage<{ gueltig_ab: string }>(
    `select gueltig_ab::text as gueltig_ab
       from app.belagsart_historie_lesen()
      where code = $1 and gueltig_bis is null`, [e.code]);
  const datierung = pruefeDatierung(e.gueltigAb, laufend?.gueltig_ab ?? null);
  if (datierung.art === 'fehler') {
    throw new StammdatenFehler('ungueltig', datierung.satz);
  }

  if (datierung.art === 'ablösung') {
    await kontext.schreibe(
      `update belagsart
          set gueltig_bis = $3::date, geaendert_von = $4::uuid
        where mandant_id = app.aktiver_mandant() and code = $1
          and gueltig_bis is null and gueltig_ab = $2::date`,
      [e.code, laufend?.gueltig_ab ?? null, datierung.schliesseZu,
        kontext.benutzerId]);
  }

  try {
    await kontext.schreibe(
      `insert into belagsart
         (mandant_id, code, bezeichnung, beschreibung,
          leistungswert_qm_pro_stunde, quelle, ist_platzhalter, gueltig_ab,
          erstellt_von)
       values (app.aktiver_mandant(), $1, $2, $3, $4::numeric, $5, $6::boolean,
               $7::date, $8::uuid)`,
      [e.code, e.bezeichnung, e.beschreibung, leistungswert, e.quelle,
        !e.bestaetigt, e.gueltigAb, kontext.benutzerId]);
  } catch (fehler: unknown) {
    const f = fehler as { code?: unknown; constraint_name?: unknown };
    if (f.code === '23P01' && f.constraint_name === 'belagsart_zeitraum_eindeutig') {
      throw new StammdatenFehler('doppelt',
        `Für „${e.code}" gilt am ${e.gueltigAb} schon eine Fassung. Zwei gleichzeitig `
        + 'gültige Leistungswerte sind keine Lage, die ein Mensch gemeint haben kann: '
        + 'jede Kalkulation müsste raten, welcher gilt.');
    }
    if (f.code === '23505' && f.constraint_name === 'belagsart_code_uk') {
      throw new StammdatenFehler('doppelt',
        `Für „${e.code}" läuft bereits eine offene Fassung. Sie muss zuerst enden, `
        + 'bevor eine zweite beginnt.');
    }
    if (f.code === '42501') {
      throw new StammdatenFehler('plattform',
        'Der Katalog wird mit `objekt.lesen` gelesen und mit '
        + '`stammdaten.verwalten` gepflegt (0021). Ihrer Rolle fehlt eines der '
        + 'beiden — geschrieben wurde nichts.');
    }
    throw fehler;
  }

  /*
   * `belagsart` ist die EINE der fuenf Katalogtabellen MIT Audit-Ausloeser
   * (`trg_belagsart_audit`, 0021): Vorher und Nachher stehen ohnehin im
   * Protokoll, und eine zweite Zeile von Hand waere dieselbe Aussage zweimal.
   */
}

/**
 * Bezeichnung, Beschreibung und Quelle der LAUFENDEN Fassung richtigstellen —
 * ohne neue Fassung.
 *
 * Bewusst ohne `leistungswert`: ein Tippfehler im Namen ist eine
 * Richtigstellung, eine andere Zahl ist eine neue Tatsache. Die Trennung ist
 * der ganze Sinn der Datierung; ein Formular, das beides in einem Feld
 * anbietet, macht aus jeder Korrektur eine rueckwirkende Preisaenderung.
 */
export async function stelleBelagsartRichtig(
  kontext: SchreibKontext, id: string,
  e: { readonly bezeichnung: string; readonly beschreibung: string | null;
    readonly quelle: string; readonly bestaetigt: boolean },
): Promise<void> {
  const [zeile] = await kontext.schreibe<{ id: string }>(
    `update belagsart
        set bezeichnung = $2, beschreibung = $3, quelle = $4,
            ist_platzhalter = $5::boolean, geaendert_von = $6::uuid
      where id = $1 and mandant_id = app.aktiver_mandant()
      returning id`,
    [id, e.bezeichnung, e.beschreibung, e.quelle, !e.bestaetigt,
      kontext.benutzerId]);
  if (zeile === undefined) {
    throw new StammdatenFehler('nicht_gefunden',
      'Diese Fassung gibt es in dieser Gesellschaft nicht — oder Ihrer Rolle fehlt '
      + '`objekt.lesen` beziehungsweise `stammdaten.verwalten` (0021).');
  }
}
