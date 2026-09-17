import 'server-only';
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import type { Bauleistungsart, StatusZeile } from './steuer/nachweis.js';
import type { Uebertragungsweg, Rechnungsformat } from '../crm/erechnung.js';

/**
 * Das Steuerblatt eines KUNDEN — §13b-Zeitscheiben, §48b-Bescheinigungen und
 * die Angaben für die elektronische Rechnung (FIN-09, FIN-10, FIN-11, LEG-05,
 * LEG-06).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Diese Datei ENTSCHEIDET nichts. Sie erfasst und liest.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Ob die Steuerschuld übergeht, entscheidet `reverseChargeLage`
 * (`steuer/nachweis.ts`) — rein, aus datierten Zeilen und einem Stichtag. Ob
 * abgezogen wird, entscheidet `estg48/abzug.ts`. Beide sind geprüft und
 * werden hier gerufen, nicht nachformuliert: eine zweite Fassung derselben
 * Regel auf einer Kundenseite wäre die, die niemand testet.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Drei Rechte, nicht eines — und das Manifest nennt nur das dritte.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `routen.generiert.ts` bewacht `/crm/kunden/[id]/steuer` mit
 * `abrechnung.lesen`. Das allein trägt die Seite NIE:
 *
 *  - `kunde` steht unter `t_mandant` und verlangt zum Lesen `crm.lesen`. Ohne
 *    es kommt die Kundenzeile nicht zurück, das Hausmuster antwortet
 *    `notFound()` — ein 404 auf einem Kunden, der existiert.
 *  - `kunde_bauleistender_status` und `freistellungsbescheinigung` verlangen
 *    `finanzen.lesen` zum Lesen und `finanzen.schreiben` zum Schreiben.
 *  - `kunde.leitweg_id`, `.kaeufer_referenz`, `.elektronische_adresse`,
 *    `.uebertragungsweg`, `.rechnungsformat` sind lesbar, aber nur mit
 *    `crm.schreiben` änderbar.
 *
 * Wer `finanzen.lesen` nicht hält, sähe ohne Prüfung **leere Listen** — und
 * eine leere §13b-Liste ist eine Aussage über den KUNDEN („kein Status
 * hinterlegt, also Umsatzsteuer ausweisen"), nicht über die Berechtigung.
 * Genau dieser stille Fehler kostet Geld. `leseSteuerblatt` gibt die Rechte
 * deshalb mit zurück, und die Seite schreibt hin, was fehlt.
 *
 * // TODO(client, O-104): Welche Tatbestände des § 13b Abs. 2 UStG berühren
 * die Gruppe (Nr. 4 Bauleistungen, Nr. 8 Gebäudereinigung, weitere?), und
 * wie wird der Status des Kunden belegt — Bestätigung USt 1 TG, schriftliche
 * Erklärung, Eigenauskunft?
 * // TODO(client, O-67): Wird die §48b-Freistellungsbescheinigung je Kunde,
 * je Auftrag oder je Nachunternehmer geführt, und wer prüft ihre Gültigkeit
 * vor der Zahlung?
 * // TODO(client, O-21): Welcher Stichtag gilt, wenn der Leistungszeitraum
 * eine Statusgrenze überschreitet — Leistungsende, Rechnungsdatum oder eine
 * Aufteilung?
 */

export class SteuerFehler extends Error {
  constructor(nachricht: string, readonly grund: string, readonly status = 400) {
    super(nachricht);
    this.name = 'SteuerFehler';
  }
}

export interface SteuerRechte {
  readonly finanzenLesen: boolean;
  readonly finanzenSchreiben: boolean;
  readonly crmSchreiben: boolean;
}

export interface BauleistenderZeile {
  readonly id: string;
  readonly leistungsart: Bauleistungsart;
  readonly ist_bauleistender: boolean;
  readonly gilt_ab: string;
  readonly gilt_bis: string | null;
  readonly grundlage: string;
  readonly dokument_id: string | null;
}

export interface BescheinigungZeile {
  readonly id: string;
  readonly bescheinigung_nummer: string;
  readonly finanzamt: string;
  readonly gueltig_von: string;
  readonly gueltig_bis: string;
  readonly widerrufen_am: string | null;
  readonly umfang: string;
  readonly auftrag_id: string | null;
  readonly auftragsnummer: string | null;
  readonly dokument_id: string | null;
}

export interface SteuerKopf {
  readonly ust_id: string | null;
  readonly steuernummer: string | null;
  readonly leitweg_id: string | null;
  readonly kaeufer_referenz: string | null;
  readonly elektronische_adresse: string | null;
  readonly elektronische_adresse_schema: string | null;
  readonly ist_oeffentlicher_auftraggeber: boolean;
  readonly xrechnung_pflicht: boolean;
  readonly uebertragungsweg: Uebertragungsweg | null;
  readonly rechnungsformat: Rechnungsformat | null;
  readonly rechnung_email: string | null;
}

export interface Steuerblatt {
  readonly kopf: SteuerKopf;
  readonly rechte: SteuerRechte;
  readonly bauleistender: readonly BauleistenderZeile[];
  readonly bescheinigungen: readonly BescheinigungZeile[];
  /** `app.berlin_heute()` — der Stichtag, wenn keiner gewählt ist. */
  readonly heute: string;
}

/**
 * Das Steuerblatt lesen.
 *
 * `null` heisst: diesen Kunden gibt es nicht, oder `crm.lesen` fehlt. Beides
 * beantwortet die Seite mit 404 — der Unterschied wäre eine Auskunft über
 * die Existenz (AUT-06).
 */
export async function leseSteuerblatt(
  kontext: LeseKontext, kundeId: string,
): Promise<Steuerblatt | null> {
  const [kopf] = await kontext.abfrage<SteuerKopf>(
    `select k.ust_id, k.steuernummer, k.leitweg_id, k.kaeufer_referenz,
            k.elektronische_adresse, k.elektronische_adresse_schema,
            k.ist_oeffentlicher_auftraggeber, k.xrechnung_pflicht,
            k.uebertragungsweg::text as uebertragungsweg,
            k.rechnungsformat::text as rechnungsformat,
            k.rechnung_email
       from kunde k
      where k.mandant_id = app.aktiver_mandant() and k.id = $1::uuid`, [kundeId]);
  if (kopf === undefined) return null;

  const [rechte] = await kontext.abfrage<{
    finanzen_lesen: boolean; finanzen_schreiben: boolean; crm_schreiben: boolean;
    heute: string;
  }>(
    `select app.hat_recht('finanzen.lesen', app.aktiver_mandant()) as finanzen_lesen,
            app.hat_recht('finanzen.schreiben', app.aktiver_mandant())
              as finanzen_schreiben,
            app.hat_recht('crm.schreiben', app.aktiver_mandant()) as crm_schreiben,
            app.berlin_heute()::text as heute`);

  /*
   * Die engste Annahme ist die sichere: fehlt die Zeile, gilt kein Recht.
   * Ein `?? true` hätte die Seite behaupten lassen, die leeren Listen seien
   * vollständig.
   */
  const r: SteuerRechte = {
    finanzenLesen: rechte?.finanzen_lesen === true,
    finanzenSchreiben: rechte?.finanzen_schreiben === true,
    crmSchreiben: rechte?.crm_schreiben === true,
  };

  /*
   * Ohne `finanzen.lesen` wird GAR NICHT gefragt. Die Policy gäbe null
   * Zeilen zurück, und null Zeilen sind hier nicht unterscheidbar von „kein
   * Status hinterlegt" — die Seite bekommt deshalb leere Listen UND den
   * Merker, dass sie nichts bedeuten.
   */
  const bauleistender = r.finanzenLesen
    ? await kontext.abfrage<BauleistenderZeile>(
      `select kbs.id, kbs.leistungsart::text as leistungsart, kbs.ist_bauleistender,
              kbs.gilt_ab::text as gilt_ab, kbs.gilt_bis::text as gilt_bis,
              kbs.grundlage, kbs.dokument_id
         from kunde_bauleistender_status kbs
        where kbs.mandant_id = app.aktiver_mandant() and kbs.kunde_id = $1::uuid
        order by kbs.leistungsart, kbs.gilt_ab desc`, [kundeId])
    : [];

  const bescheinigungen = r.finanzenLesen
    ? await kontext.abfrage<BescheinigungZeile>(
      `select f.id, f.bescheinigung_nummer, f.finanzamt,
              f.gueltig_von::text as gueltig_von, f.gueltig_bis::text as gueltig_bis,
              f.widerrufen_am::text as widerrufen_am, f.umfang::text as umfang,
              f.auftrag_id, a.auftragsnummer, f.dokument_id
         from freistellungsbescheinigung f
         left join auftrag a
           on a.mandant_id = f.mandant_id and a.id = f.auftrag_id
        where f.mandant_id = app.aktiver_mandant() and f.kunde_id = $1::uuid
        order by f.gueltig_bis desc`, [kundeId])
    : [];

  return {
    kopf, rechte: r, bauleistender, bescheinigungen,
    heute: rechte?.heute ?? '',
  };
}

/** Die Zeilen in der Form, die `reverseChargeLage` erwartet. */
export function alsStatusZeilen(
  zeilen: readonly BauleistenderZeile[],
): readonly StatusZeile[] {
  return zeilen.map((z) => ({
    leistungsart: z.leistungsart,
    istBauleistender: z.ist_bauleistender,
    giltAb: z.gilt_ab,
    giltBis: z.gilt_bis,
    grundlage: z.grundlage,
  }));
}

/**
 * Gilt AM LEISTUNGSDATUM eine §48b-Bescheinigung?
 *
 * **Nicht „heute".** Eine Bescheinigung, die im August galt und im September
 * abgelaufen ist, deckt die Leistung aus August. Ein Blick auf „heute" hätte
 * jede Altrechnung beim nächsten Ablauf rückwirkend umgedeutet — derselbe
 * Fehler, den `steuer/nachweis.ts` für §13b beschreibt.
 *
 * Rein: der Aufrufer übergibt die Zeilen und den Tag.
 */
export function bescheinigungAm(
  zeilen: readonly BescheinigungZeile[], stichtag: string, auftragId?: string | null,
): BescheinigungZeile | null {
  const passend = zeilen.filter((z) =>
    z.gueltig_von <= stichtag
    && z.gueltig_bis >= stichtag
    && (z.widerrufen_am === null || z.widerrufen_am > stichtag)
    && (z.umfang === 'unbeschraenkt'
      || (auftragId != null && z.auftrag_id === auftragId)));
  /*
   * Die unbeschränkte gewinnt: sie deckt jeden Auftrag, die
   * auftragsbezogene nur ihren. Stünden beide, wäre die Antwort sonst von
   * der Sortierung abhängig.
   */
  return passend.find((z) => z.umfang === 'unbeschraenkt') ?? passend[0] ?? null;
}

/* --------------------------------------------------------------- Schreiben */

export interface NeueZeitscheibe {
  readonly kundeId: string;
  readonly leistungsart: Bauleistungsart;
  readonly istBauleistender: boolean;
  readonly giltAb: string;
  readonly giltBis?: string | undefined;
  readonly grundlage: string;
  readonly dokumentId?: string | undefined;
}

/**
 * Eine §13b-Zeitscheibe anlegen.
 *
 * **Der Überlapp wird VORHER gesucht, nicht vom Index gemeldet.** Der
 * EXCLUDE-Index `kbs_kein_ueberlapp` weist Überschneidungen ab — mit
 * `conflicting key value violates exclusion constraint`, einer Meldung, in
 * der weder die kollidierende Zeile noch ihr Zeitraum steht. Hier wird sie
 * gesucht und genannt: „vom 01.01.2025 bis offen". Der Index bleibt die
 * zweite Linie, und der Fehler wird zusätzlich abgefangen, falls zwei
 * Eingaben gleichzeitig laufen.
 */
export async function legeZeitscheibeAn(
  kontext: SchreibKontext, eingabe: NeueZeitscheibe,
): Promise<string> {
  const grundlage = eingabe.grundlage.trim();
  if (grundlage.length < 3) {
    throw new SteuerFehler(
      'Zu einem §13b-Status gehört seine Grundlage — womit ist er belegt? '
      + 'Beispiel: „Bestätigung USt 1 TG vom 12.01.2025" oder „schriftliche '
      + 'Erklärung des Kunden vom 03.03." Ohne Belegangabe ist der Status in einer '
      + 'Prüfung nichts wert (O-104).', 'grundlage_fehlt');
  }
  if (eingabe.giltAb.trim() === '') {
    throw new SteuerFehler('Ohne Beginn gibt es keine Zeitscheibe.', 'ohne_beginn');
  }
  if (eingabe.giltBis !== undefined && eingabe.giltBis !== ''
    && eingabe.giltBis < eingabe.giltAb) {
    throw new SteuerFehler('Das Ende liegt vor dem Beginn.', 'zeitraum_verdreht');
  }

  const [recht] = await kontext.abfrage<{ darf: boolean }>(
    `select app.hat_recht('finanzen.schreiben', app.aktiver_mandant()) as darf`);
  if (recht?.darf !== true) {
    throw new SteuerFehler(
      'Einen §13b-Status trägt ein, wer `finanzen.schreiben` hält. Das Tor dieser '
      + 'Seite (`abrechnung.lesen`) genügt dafür nicht.', 'kein_schreibrecht', 403);
  }

  const [kollision] = await kontext.abfrage<{ von: string; bis: string | null }>(
    `select gilt_ab::text as von, gilt_bis::text as bis
       from kunde_bauleistender_status
      where mandant_id = app.aktiver_mandant() and kunde_id = $1::uuid
        and leistungsart = $2::bauleistungsart
        and daterange(gilt_ab, gilt_bis, '[]')
            && daterange($3::date, $4::date, '[]')
      limit 1`,
    [eingabe.kundeId, eingabe.leistungsart, eingabe.giltAb,
      eingabe.giltBis === undefined || eingabe.giltBis === '' ? null : eingabe.giltBis]);
  if (kollision !== undefined) {
    throw new SteuerFehler(
      `Für diese Leistungsart ist schon ein Status vom ${kollision.von} bis `
      + `${kollision.bis ?? 'offen'} hinterlegt. Zwei überlappende Zeiträume liessen `
      + 'offen, welcher am Leistungsdatum gilt — beenden Sie den bestehenden zuerst.',
      'ueberlapp');
  }

  try {
    const zeilen = await kontext.schreibe<{ id: string }>(
      `insert into kunde_bauleistender_status
         (mandant_id, kunde_id, leistungsart, ist_bauleistender, gilt_ab, gilt_bis,
          grundlage, dokument_id, erstellt_von_art, erstellt_von)
       values (app.aktiver_mandant(), $1::uuid, $2::bauleistungsart, $3::boolean,
               $4::date, $5::date, $6, $7::uuid, 'mensch', app.aktueller_benutzer())
       returning id`,
      [eingabe.kundeId, eingabe.leistungsart, eingabe.istBauleistender,
        eingabe.giltAb,
        eingabe.giltBis === undefined || eingabe.giltBis === ''
          ? null : eingabe.giltBis,
        grundlage, eingabe.dokumentId ?? null]);
    const z = zeilen[0];
    if (z === undefined) {
      throw new SteuerFehler('Die Zeitscheibe wurde nicht angelegt.', 'nicht_angelegt');
    }
    return z.id;
  } catch (fehler) {
    // 23P01 = exclusion_violation. Der Index hat gewonnen, weil eine zweite
    // Eingabe zwischen Prüfung und Einfügen lag.
    if (typeof fehler === 'object' && fehler !== null
      && (fehler as { code?: string }).code === '23P01') {
      throw new SteuerFehler(
        'Für diese Leistungsart wurde gerade ein überlappender Zeitraum eingetragen. '
        + 'Laden Sie die Seite neu.', 'ueberlapp_gleichzeitig', 409);
    }
    throw fehler;
  }
}

export interface NeueBescheinigung {
  readonly kundeId: string;
  readonly nummer: string;
  readonly finanzamt: string;
  readonly gueltigVon: string;
  readonly gueltigBis: string;
  readonly umfang: 'unbeschraenkt' | 'auftragsbezogen';
  readonly auftragId?: string | undefined;
  readonly dokumentId?: string | undefined;
}

/**
 * Eine §48b-Freistellungsbescheinigung erfassen.
 *
 * `fsb_umfang_auftrag` verlangt: `umfang = 'auftragsbezogen'` genau dann,
 * wenn ein Auftrag benannt ist. Der Satz dazu steht hier, nicht in der
 * Datenbankmeldung.
 */
export async function legeBescheinigungAn(
  kontext: SchreibKontext, eingabe: NeueBescheinigung,
): Promise<string> {
  const nummer = eingabe.nummer.trim();
  const finanzamt = eingabe.finanzamt.trim();
  if (nummer.length < 3) {
    throw new SteuerFehler(
      'Die Nummer der Bescheinigung fehlt — sie ist das, womit das Finanzamt sie '
      + 'wiederfindet.', 'nummer_fehlt');
  }
  if (finanzamt.length < 3) {
    throw new SteuerFehler('Welches Finanzamt hat sie ausgestellt?', 'finanzamt_fehlt');
  }
  if (eingabe.gueltigVon === '' || eingabe.gueltigBis === '') {
    throw new SteuerFehler(
      'Eine Freistellungsbescheinigung gilt für einen Zeitraum — beide Tage gehören '
      + 'dazu. Sie wird AM LEISTUNGSDATUM geprüft, nicht heute.', 'zeitraum_fehlt');
  }
  if (eingabe.gueltigBis < eingabe.gueltigVon) {
    throw new SteuerFehler('Das Ende liegt vor dem Beginn.', 'zeitraum_verdreht');
  }
  const auftrag = eingabe.auftragId === undefined || eingabe.auftragId === ''
    ? null : eingabe.auftragId;
  if ((eingabe.umfang === 'auftragsbezogen') !== (auftrag !== null)) {
    throw new SteuerFehler(
      eingabe.umfang === 'auftragsbezogen'
        ? 'Eine auftragsbezogene Bescheinigung braucht den Auftrag, für den sie gilt.'
        : 'Eine unbeschränkte Bescheinigung gilt für jeden Auftrag — nennen Sie '
          + 'keinen einzelnen.', 'umfang_unstimmig');
  }

  const [recht] = await kontext.abfrage<{ darf: boolean }>(
    `select app.hat_recht('finanzen.schreiben', app.aktiver_mandant()) as darf`);
  if (recht?.darf !== true) {
    throw new SteuerFehler(
      'Eine Freistellungsbescheinigung erfasst, wer `finanzen.schreiben` hält.',
      'kein_schreibrecht', 403);
  }

  const zeilen = await kontext.schreibe<{ id: string }>(
    `insert into freistellungsbescheinigung
       (mandant_id, kunde_id, bescheinigung_nummer, finanzamt, gueltig_von,
        gueltig_bis, umfang, auftrag_id, dokument_id, erstellt_von_art, erstellt_von)
     values (app.aktiver_mandant(), $1::uuid, $2, $3, $4::date, $5::date,
             $6::freistellung_umfang, $7::uuid, $8::uuid, 'mensch',
             app.aktueller_benutzer())
     returning id`,
    [eingabe.kundeId, nummer, finanzamt, eingabe.gueltigVon, eingabe.gueltigBis,
      eingabe.umfang, auftrag, eingabe.dokumentId ?? null]);
  const z = zeilen[0];
  if (z === undefined) {
    throw new SteuerFehler('Die Bescheinigung wurde nicht erfasst.', 'nicht_angelegt');
  }
  return z.id;
}

/**
 * Eine Bescheinigung widerrufen — **ein Datum, keine Löschung.**
 *
 * Invariante 8: im Finanzbereich wird nicht hart gelöscht. Eine widerrufene
 * Bescheinigung muss lesbar bleiben, weil jede Rechnung, die sich auf sie
 * berufen hat, sonst nicht mehr herzuleiten wäre.
 */
export async function widerrufeBescheinigung(
  kontext: SchreibKontext, id: string, am: string,
): Promise<void> {
  const [recht] = await kontext.abfrage<{ darf: boolean }>(
    `select app.hat_recht('finanzen.schreiben', app.aktiver_mandant()) as darf`);
  if (recht?.darf !== true) {
    throw new SteuerFehler(
      'Einen Widerruf trägt ein, wer `finanzen.schreiben` hält.',
      'kein_schreibrecht', 403);
  }
  if (am.trim() === '') {
    throw new SteuerFehler(
      'Ab welchem Tag ist sie widerrufen? Ohne Datum wäre offen, welche Leistungen '
      + 'noch gedeckt waren.', 'ohne_datum');
  }

  const zeilen = await kontext.schreibe<{ id: string }>(
    `update freistellungsbescheinigung
        set widerrufen_am = $2::date, geaendert_am = now(),
            geaendert_von_art = 'mensch', geaendert_von = app.aktueller_benutzer()
      where mandant_id = app.aktiver_mandant() and id = $1::uuid
        and widerrufen_am is null
      returning id`, [id, am]);
  if (zeilen[0] === undefined) {
    throw new SteuerFehler(
      'Diese Bescheinigung gibt es nicht — oder sie ist schon widerrufen.',
      'nicht_gefunden', 404);
  }
}

export interface ERechnungSetzen {
  readonly kundeId: string;
  readonly leitwegId?: string | undefined;
  readonly kaeuferReferenz?: string | undefined;
  readonly elektronischeAdresse?: string | undefined;
  readonly elektronischeAdresseSchema?: string | undefined;
  readonly uebertragungsweg?: string | undefined;
  readonly rechnungsformat?: string | undefined;
  readonly xrechnungPflicht: boolean;
}

const WEGE = ['peppol', 'zre', 'ozg_re', 'email', 'kundenportal', 'post'];
const FORMATE = ['xrechnung_ubl', 'zugferd', 'pdf'];

/**
 * Die Angaben für die elektronische Rechnung setzen (FIN-11).
 *
 * **Der Weg wird nicht vorbelegt.** Leer heisst „nicht verabredet" und nicht
 * „E-Mail": ein Pflichtkäufer ohne Weg sperrt den Versand
 * (`crm/erechnung.ts`, 07-INTEGRATIONEN §12.1, O-22).
 */
export async function setzeERechnung(
  kontext: SchreibKontext, eingabe: ERechnungSetzen,
): Promise<void> {
  const [recht] = await kontext.abfrage<{ darf: boolean }>(
    `select app.hat_recht('crm.schreiben', app.aktiver_mandant()) as darf`);
  if (recht?.darf !== true) {
    throw new SteuerFehler(
      'Die Rechnungsangaben am Kunden ändert, wer `crm.schreiben` hält.',
      'kein_schreibrecht', 403);
  }

  const leer = (w: string | undefined): string | null => {
    const t = w?.trim() ?? '';
    return t === '' ? null : t;
  };
  const weg = leer(eingabe.uebertragungsweg);
  if (weg !== null && !WEGE.includes(weg)) {
    throw new SteuerFehler('Diesen Übertragungsweg gibt es nicht.', 'weg_unbekannt');
  }
  const format = leer(eingabe.rechnungsformat);
  if (format !== null && !FORMATE.includes(format)) {
    throw new SteuerFehler('Dieses Rechnungsformat gibt es nicht.', 'format_unbekannt');
  }
  const adresse = leer(eingabe.elektronischeAdresse);
  const schema = leer(eingabe.elektronischeAdresseSchema);
  if (adresse !== null && schema === null) {
    throw new SteuerFehler(
      'Eine elektronische Adresse ohne Schema (BT-49-1) ist nicht auflösbar — '
      + '`0204` für die Leitweg-ID, `EM` für E-Mail, `0088` für eine GLN.',
      'schema_fehlt');
  }

  const zeilen = await kontext.schreibe<{ id: string }>(
    `update kunde
        set leitweg_id = $2,
            kaeufer_referenz = $3,
            elektronische_adresse = $4,
            elektronische_adresse_schema = $5,
            uebertragungsweg = $6::uebertragungsweg,
            rechnungsformat = $7::rechnungsformat,
            xrechnung_pflicht = $8::boolean,
            geaendert_am = now(), geaendert_von = app.aktueller_benutzer()
      where mandant_id = app.aktiver_mandant() and id = $1::uuid
        and archiviert_am is null
      returning id`,
    [eingabe.kundeId, leer(eingabe.leitwegId), leer(eingabe.kaeuferReferenz),
      adresse, schema, weg, format, eingabe.xrechnungPflicht]);
  if (zeilen[0] === undefined) {
    throw new SteuerFehler('Diesen Kunden gibt es nicht.', 'nicht_gefunden', 404);
  }
}
