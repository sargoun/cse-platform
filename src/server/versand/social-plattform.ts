import 'server-only';
import {
  type BeitragAuftrag, KanalNichtVerbundenFehler, PLATTFORM_NAME, type Plattform,
  type SocialKanalPort, type Veroeffentlicht,
} from '../services/social/port.js';

/**
 * Die fuenf fremden Plattformen — **gebaut, nicht verbunden** (SOC-06, SOC-07).
 *
 * **Warum diese Datei in `server/versand` liegt.** Ein Beitrag geht nach
 * draussen: Text, Bild, Firmenname, oft ein Projekt mit erkennbarem Ort. Das
 * ist der eine Ausgang aus Invariante 7, und die Merge-Wache `ein-ausgang`
 * besteht darauf, dass jeder Sender hier steht — auch einer, der heute nichts
 * sendet. Waere er anderswo, waere die Wache beim Anschliessen des ersten
 * echten Anbieters genau einmal umsonst grün.
 *
 * **Was hier NICHT steht.** Kein `fetch` mit einer erratenen Adresse, keine
 * Warteschlange, kein Wiederholen. Solange O-10 offen ist, gibt es kein Konto,
 * keine App-Registrierung und keinen Auftragsverarbeitungsvertrag — und ein
 * Adapter, der so tut, als gaebe es sie, ist genau die Simulation, die SOC-07
 * verbietet.
 */

/**
 * Welche Plattform welche Zugangsdaten braucht — und welche davon fehlen.
 *
 * Die Namen stehen hier und nicht in der Datenbank, weil sie keine
 * Einstellung sind, sondern eine Eigenschaft der Plattform: Meta verlangt
 * eine App und ein Seiten-Token, LinkedIn eine Organisations-URN, YouTube
 * OAuth mit Kanalbindung. Was davon hinterlegt ist, sagt die Umgebung.
 */
const ZUGANG: Readonly<Record<Plattform, readonly string[]>> = {
  instagram: ['CSE_META_APP_ID', 'CSE_INSTAGRAM_TOKEN'],
  facebook: ['CSE_META_APP_ID', 'CSE_FACEBOOK_SEITEN_TOKEN'],
  linkedin: ['CSE_LINKEDIN_ORG_URN', 'CSE_LINKEDIN_TOKEN'],
  tiktok: ['CSE_TIKTOK_CLIENT_KEY', 'CSE_TIKTOK_TOKEN'],
  youtube: ['CSE_YOUTUBE_CLIENT_ID', 'CSE_YOUTUBE_REFRESH_TOKEN'],
};

export type Umgebung = Readonly<Record<string, string | undefined>>;

/** Sind ALLE Schluessel dieser Plattform gesetzt? Einer allein reicht nie. */
export function zugangVollstaendig(
  plattform: Plattform, umgebung: Umgebung = process.env,
): boolean {
  return ZUGANG[plattform].every((name) => {
    const wert = umgebung[name];
    return wert !== undefined && wert.trim() !== '';
  });
}

/** Welche Schluessel fehlen — damit der Bildschirm es benennen kann. */
export function fehlendeSchluessel(
  plattform: Plattform, umgebung: Umgebung = process.env,
): readonly string[] {
  return ZUGANG[plattform].filter((name) => {
    const wert = umgebung[name];
    return wert === undefined || wert.trim() === '';
  });
}

/**
 * Der Adapter, solange nichts hinterlegt ist.
 *
 * **Er wirft, statt eine Kennung zu erfinden.** Eine erfundene `externeRef`
 * waere ein Beleg fuer etwas, das nie geschah — und der Beitrag saehe im
 * Portal veroeffentlicht aus.
 */
export class NichtVerbundenePlattform implements SocialKanalPort {
  readonly verbunden = false;
  readonly hinweis: string;

  constructor(readonly plattform: Plattform, umgebung: Umgebung = process.env) {
    const fehlt = fehlendeSchluessel(plattform, umgebung);
    this.hinweis = `${PLATTFORM_NAME[plattform]}: nicht verbunden — `
      + `es fehlen ${fehlt.join(' und ')}. Ohne App-Registrierung und `
      + 'Auftragsverarbeitungsvertrag geht kein Beitrag hinaus (O-10).';
  }

  veroeffentliche(auftrag: BeitragAuftrag): Promise<Veroeffentlicht> {
    void auftrag;
    return Promise.reject(new KanalNichtVerbundenFehler(this.plattform, this.hinweis));
  }
}

/**
 * Der Anschluss fuer eine Plattform.
 *
 * Heute immer `NichtVerbundenePlattform` — und die Verzweigung steht trotzdem
 * schon hier, weil sie die Stelle ist, an die der erste echte Adapter kommt.
 *
 * // TODO(client): O-10 — welche Plattformkonten gehoeren welcher
 * // Gesellschaft, wer ist dort Administrator, und liegt fuer jedes ein
 * // Auftragsverarbeitungsvertrag vor? Ohne Antwort bleibt jeder Kanal
 * // unverbunden; ein geratenes Konto veroeffentlichte im Namen der falschen
 * // Firma.
 */
export function plattformKanal(
  plattform: Plattform, umgebung: Umgebung = process.env,
): SocialKanalPort {
  /*
   * Auch mit vollstaendigen Schluesseln gibt es heute keinen sendenden
   * Adapter -- der Hinweis sagt dann etwas anderes, aber das Ergebnis bleibt
   * dasselbe. Lieber ein ehrliches "nicht verbunden" als ein halber Sender.
   */
  return new NichtVerbundenePlattform(plattform, umgebung);
}
