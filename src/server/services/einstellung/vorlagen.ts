import 'server-only';
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import { ladeVorlagen, type VorlageZeile } from '../bau/behinderung.js';
import { mahnstufen, type StufenZeile } from '../finanz/mahnung/stufen.js';
import { ladeIdentitaet, type Identitaet } from '../mandant/identitaet.js';
import { alleArten, modulTitel, modulVon } from '../../benachrichtigung/bootstrap.js';

/**
 * Die Vorlagen dieser Gesellschaft, aus ihren VIER echten Quellen
 * (OPS-08, BAU-06, FIN-15, NOT-02, 04-SEITENKARTE §5.24).
 *
 * **Vier Abschnitte, vier verschiedene Wahrheiten — und keiner erfunden:**
 *  - **Behinderungsanzeige** (BAU-06): Zeilen in `behinderung_vorlage`,
 *    pflegbar. Solange `ist_platzhalter` steht, ist der Wortlaut geraten —
 *    und eine Anzeige nach § 6 VOB/B ist eine anspruchswahrende Erklaerung,
 *    also weist der Versand sie ohnehin ab.
 *  - **Mahnwesen** (FIN-15): der `textbaustein` liegt auf `mahnstufe` und
 *    wird HIER NUR GEZEIGT. Gepflegt wird er unter
 *    `/einstellungen/mahnwesen`, wo auch Frist, Gebuehr und Zinsart stehen —
 *    zwei Editoren auf einer Zeile waeren ein Defekt.
 *  - **E-Mail** (NOT-02): die Texte stehen im CODE
 *    (`benachrichtigung/registry.ts`, Titel und Text als Funktionen). Es gibt
 *    keine Datenbankvorlage, und die Seite sagt das statt ein Formular zu
 *    zeigen, das nichts speichert. Ausserdem: es geht ohnehin nichts hinaus
 *    (O-36 / O-501).
 *  - **Fusszeilen und Absender** (DESIGN §11): sie stehen in
 *    `mandant_identitaet` (0200) und werden dort gepflegt.
 *
 * **Der Rechtekonflikt, den diese Datei sichtbar macht.** Die Route ist mit
 * `system.einstellung_verwalten` bewacht; die RLS von `behinderung_vorlage`
 * verlangt `bau.lesen`/`bau.schreiben`, die von `mahnstufe`
 * `mahnung.lesen`/`mahnung.schreiben`. Eine Sitzung mit dem Recht der SEITE
 * und ohne das Recht des GEWERKS sieht ohne Zutun eine leere Liste — und
 * „keine Vorlage hinterlegt" ist eine ganz andere Auskunft als „Sie dürfen
 * sie nicht sehen". Deshalb fragt dieser Dienst die drei Rechte
 * ausdruecklich und gibt sie zurueck; die Seite sagt dann, was der Fall ist.
 * Geweitet wird die RLS NICHT: eine Vorlage fuer eine VOB/B-Erklaerung
 * gehoert dem Gewerk, nicht der Verwaltung.
 */

export class VorlagenFehler extends Error {
  constructor(
    readonly grund: 'ungueltig' | 'kein_recht' | 'nicht_gefunden',
    nachricht: string,
  ) {
    super(nachricht);
    this.name = 'VorlagenFehler';
  }
}

/** Die im Code definierte E-Mail-/Posteingangsvorlage einer Benachrichtigungsart. */
export interface ArtZeile {
  readonly schluessel: string;
  readonly modul: string;
  readonly modulTitel: string;
  readonly kanaele: readonly string[];
  readonly sammelbar: boolean;
}

export interface Rechte {
  readonly bauLesen: boolean;
  readonly bauSchreiben: boolean;
  readonly mahnungLesen: boolean;
}

export interface Vorlagenuebersicht {
  readonly rechte: Rechte;
  readonly behinderung: readonly VorlageZeile[];
  readonly mahnstufen: readonly StufenZeile[];
  readonly arten: readonly ArtZeile[];
  readonly identitaet: Identitaet | null;
  /** Die Platzhalter, die `setzeVorlage` kennt — die einzigen erlaubten. */
  readonly erlaubtePlatzhalter: readonly string[];
}

/**
 * Die Platzhalter, die `setzeVorlage` (`services/bau/behinderung.ts`) ersetzt.
 *
 * Die Liste steht hier als DATEN, weil `Vorlagenwerte` eine Schnittstelle ist
 * und ein Typ zur Laufzeit nicht aufzaehlbar ist. Sie ist die einzige Quelle
 * fuer die Oberflaeche; ein unbekannter Platzhalter wird beim Versand
 * abgewiesen (`platzhalter_unbekannt`), nicht leer ersetzt — ein Schreiben
 * mit offener geschweifter Klammer geht sonst an den Auftraggeber hinaus.
 * `tests/kern/vorlagen.test.ts` haelt die Liste gegen `Vorlagenwerte`.
 */
export const ERLAUBTE_PLATZHALTER: readonly string[] =
  ['projekt', 'ursache', 'grund', 'beginn', 'auswirkung', 'absender'];

export async function ladeVorlagenuebersicht(
  kontext: LeseKontext,
): Promise<Vorlagenuebersicht> {
  const [r] = await kontext.abfrage<{
    bau_lesen: boolean; bau_schreiben: boolean; mahnung_lesen: boolean;
  }>(`select app.hat_recht('bau.lesen', app.aktiver_mandant())      as bau_lesen,
             app.hat_recht('bau.schreiben', app.aktiver_mandant())  as bau_schreiben,
             app.hat_recht('mahnung.lesen', app.aktiver_mandant())  as mahnung_lesen`);
  const rechte: Rechte = {
    bauLesen: r?.bau_lesen === true,
    bauSchreiben: r?.bau_schreiben === true,
    mahnungLesen: r?.mahnung_lesen === true,
  };

  /*
   * Gefragt wird nur, wo das Recht gehalten wird. Eine Abfrage ohne Recht
   * kaeme leer zurueck und saehe wie „nichts hinterlegt" aus — genau die
   * Verwechslung, die diese Datei verhindern soll.
   */
  const behinderung = rechte.bauLesen ? await ladeVorlagen(kontext) : [];
  const stufen = rechte.mahnungLesen
    ? await mahnstufen(kontext as SchreibKontext)
    : [];
  const identitaet = await ladeIdentitaet(kontext);

  const arten: readonly ArtZeile[] = alleArten().map((a) => ({
    schluessel: a.schluessel,
    modul: modulVon(a.schluessel),
    modulTitel: modulTitel(modulVon(a.schluessel)),
    kanaele: [...a.kanaeleVorgabe],
    sammelbar: a.sammelbar,
  })).sort((a, b) => a.schluessel.localeCompare(b.schluessel, 'de'));

  return {
    rechte,
    behinderung,
    mahnstufen: stufen.filter((s) => s.gueltigBis === null),
    arten,
    identitaet,
    erlaubtePlatzhalter: ERLAUBTE_PLATZHALTER,
  };
}

export interface BehinderungsvorlageEingabe {
  readonly schluessel: string;
  readonly bezeichnung: string;
  readonly fundstelle: string;
  readonly betreff: string;
  readonly rumpf: string;
}

/** Jeder `{platzhalter}` im Text — auch die, die es nicht gibt. */
export function platzhalterIn(text: string): readonly string[] {
  return [...new Set([...text.matchAll(/\{([a-z_]+)\}/gu)].map((m) => m[1] ?? ''))];
}

/**
 * Eine Behinderungsvorlage bestaetigen — die bisherige wird ARCHIVIERT, nicht
 * ueberschrieben.
 *
 * **Warum archiviert statt aktualisiert.** Eine versendete Behinderungsanzeige
 * beruft sich auf den Wortlaut, wie er GALT; § 6 Abs. 1 VOB/B macht daraus
 * eine anspruchswahrende Erklaerung, und ohne den damaligen Text liesse sich
 * spaeter nicht belegen, was erklaert wurde (Invariante 8). Die Tabelle traegt
 * `archiviert_am` seit 0081, und der Teilindex
 * `behinderung_vorlage_schluessel_uk` laesst je Schluessel genau eine
 * unarchivierte Zeile zu — die Ablösung ist damit in der Datenbank erzwungen
 * und nicht nur hier beschrieben.
 *
 * **`ist_platzhalter` wird `false`.** Wer den Wortlaut eintraegt, bestaetigt
 * ihn; das ist die Antwort auf die Frage, die die Platzhalterzeilen stellen.
 * Der Versand laesst eine Platzhalterzeile nicht hinaus, und genau darum ist
 * die Bestaetigung hier der einzige Weg, ihn zu oeffnen.
 */
export async function setzeBehinderungsvorlage(
  kontext: SchreibKontext, e: BehinderungsvorlageEingabe,
): Promise<void> {
  const schluessel = e.schluessel.trim();
  if (schluessel === '' || e.bezeichnung.trim() === ''
      || e.betreff.trim() === '' || e.rumpf.trim() === '') {
    throw new VorlagenFehler('ungueltig',
      'Schlüssel, Bezeichnung, Betreff und Rumpf sind Pflicht — eine Erklärung nach '
      + '§ 6 VOB/B ohne Betreff ist kein Schreiben.');
  }
  if (e.fundstelle.trim() === '') {
    throw new VorlagenFehler('ungueltig',
      'Die Fundstelle fehlt (z. B. „§ 6 Abs. 1 VOB/B"). Ohne sie ist die Vorlage eine '
      + 'Behauptung über ihre eigene Rechtsgrundlage.');
  }
  const unbekannt = [...platzhalterIn(e.betreff), ...platzhalterIn(e.rumpf)]
    .filter((p) => !ERLAUBTE_PLATZHALTER.includes(p));
  if (unbekannt.length > 0) {
    throw new VorlagenFehler('ungueltig',
      `Unbekannte Platzhalter: ${unbekannt.map((p) => `{${p}}`).join(', ')}. Erlaubt `
      + `sind ${ERLAUBTE_PLATZHALTER.map((p) => `{${p}}`).join(', ')} — ein `
      + 'unbekannter Platzhalter bleibt beim Versand als geschweifte Klammer im '
      + 'Schreiben stehen oder fehlt als Angabe, die § 6 Abs. 1 VOB/B verlangt.');
  }

  /*
   * Erst archivieren, dann anlegen: andersherum stiessen beide fuer einen
   * Augenblick auf den Teilindex, und die neue Zeile waere abgewiesen — mit
   * einer Meldung ueber einen Zustand, den niemand gewollt hat.
   */
  await kontext.schreibe(
    `update behinderung_vorlage
        set archiviert_am = now(), archiviert_von = $3::uuid
      where mandant_id = $1::uuid and schluessel = $2 and archiviert_am is null`,
    [kontext.aktiverMandantId, schluessel, kontext.benutzerId]);

  await kontext.schreibe(
    `insert into behinderung_vorlage
       (mandant_id, schluessel, bezeichnung, fundstelle, betreff, rumpf,
        ist_platzhalter, erstellt_von, geaendert_von)
     values ($1::uuid, $2, $3, $4, $5, $6, false, $7::uuid, $7::uuid)`,
    [kontext.aktiverMandantId, schluessel, e.bezeichnung.trim(), e.fundstelle.trim(),
      e.betreff.trim(), e.rumpf.trim(), kontext.benutzerId]);

  await kontext.schreibe(
    `select app.protokolliere('bau.behinderung_vorlage_bestaetigt',
                              'behinderung_vorlage', $1, null, $2::jsonb,
                              app.aktiver_mandant())`,
    [schluessel, { schluessel, fundstelle: e.fundstelle.trim(), istPlatzhalter: false }]);
}
