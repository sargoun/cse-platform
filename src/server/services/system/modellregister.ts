import 'server-only';
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';

/**
 * Das Modellregister — die Bezeugung, dass ein Modell benutzt werden darf
 * (V-120, D-04, 07-INTEGRATIONEN §3.6, §8).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund: die Freigabe war eine handgeschriebene SQL-Zeile.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `docs/EINRICHTEN-*.md` §9 beschrieb den letzten Schritt der KI-Einrichtung
 * als `insert into modell_register …` in einem Datenbankwerkzeug — weil
 * `0154` `cse_app` auf dieser Tabelle nur `select` gab. Genau dort bleibt ein
 * Betreiber stehen, und zu Recht: er soll eine RECHTSAUSSAGE eintragen und
 * bekommt dafür eine Zeile SQL.
 *
 * **Was das praktisch bedeutete.** Ohne Formular gibt es keine Pflichtfelder.
 * `geprueft_von` hätte der Betreiber selbst eintippen müssen — ein Name, den
 * jemand über sich selbst schreibt, ist keine Bezeugung. Der CHECK
 * `mr_fremder_anbieter_braucht_menschen` fängt den leeren Fall, aber erst als
 * Datenbankfehler.
 *
 * **Die drei Flaggen sind eine Konjunktion, keine Summe.** `app.modell_fuer`
 * (0154) verlangt `eu_verarbeitung AND zero_retention AND freigegeben`. Ein
 * Anbieter kann EU-Verarbeitung anbieten und Nullspeicherung nicht; eine
 * einzelne Sammelflagge verschwiege, WAS geprüft wurde.
 *
 * **Dieser Dienst prüft die Flaggen nicht auf Wahrheit — das kann er nicht.**
 * Ob OpenAI tatsächlich in der EU verarbeitet, weiss der Vertrag und nicht
 * die Software. Was er tut: er verlangt, dass eine Freigabe einen Nachweis
 * trägt, und er lässt die Datenbank den Zeugen setzen.
 */

export class ModellFehler extends Error {
  constructor(nachricht: string, readonly grund: string, readonly status = 400) {
    super(nachricht);
    this.name = 'ModellFehler';
  }
}

/** Die Fähigkeiten aus `ki_faehigkeit` (0154). */
export type Faehigkeit =
  | 'chat_intern' | 'entwurf_text' | 'extraktion_dokument' | 'extraktion_beleg'
  | 'klassifikation' | 'embedding' | 'vision';

export const FAEHIGKEITEN: readonly Faehigkeit[] = [
  'chat_intern', 'entwurf_text', 'extraktion_dokument', 'extraktion_beleg',
  'klassifikation', 'embedding', 'vision',
];

export interface ModellZeile {
  readonly id: string;
  readonly anbieter: string;
  readonly modell: string;
  readonly faehigkeit: Faehigkeit;
  readonly euVerarbeitung: boolean;
  readonly zeroRetention: boolean;
  readonly freigegeben: boolean;
  /** Wahr nur, wenn alle drei stehen — genau `app.modell_fuer`. */
  readonly aufrufbar: boolean;
  readonly geprueftAm: string | null;
  readonly geprueftVon: string | null;
  readonly nachweisUrl: string | null;
  readonly bemerkung: string | null;
}

const FELDER = `r.id, r.anbieter, r.modell, r.faehigkeit::text as faehigkeit,
                r.eu_verarbeitung as "euVerarbeitung",
                r.zero_retention as "zeroRetention",
                r.freigegeben,
                (r.eu_verarbeitung and r.zero_retention and r.freigegeben) as aufrufbar,
                to_char(r.geprueft_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
                  as "geprueftAm",
                (select b.name from benutzer b where b.id = r.geprueft_von) as "geprueftVon",
                r.nachweis_url as "nachweisUrl", r.bemerkung`;

export async function modelle(kontext: LeseKontext): Promise<readonly ModellZeile[]> {
  return kontext.abfrage<ModellZeile>(
    `select ${FELDER} from modell_register r
      order by (r.anbieter = 'demo'), r.anbieter, r.faehigkeit, r.modell`);
}

export interface NeuesModell {
  readonly anbieter: string;
  readonly modell: string;
  readonly faehigkeit: string;
  readonly euVerarbeitung: boolean;
  readonly zeroRetention: boolean;
  readonly freigegeben: boolean;
  readonly nachweisUrl?: string | undefined;
  readonly bemerkung?: string | undefined;
}

function leer(wert: string | undefined): string | null {
  const t = wert?.trim() ?? '';
  return t === '' ? null : t;
}

/**
 * Der Nachweis — bei einer Freigabe PFLICHT, sonst freiwillig.
 *
 * **Warum nicht immer.** Eine Zeile ohne Freigabe ist eine Notiz („dieses
 * Modell haben wir angesehen"); von ihr hängt nichts ab. Eine Zeile MIT
 * Freigabe ist die Grundlage dafür, dass Vertragstext an einen fremden
 * Dienstleister geht — und im Prüfungsfall wird genau nach dem Papier
 * gefragt, auf das sie sich stützt.
 */
function pruefeNachweis(eingabe: NeuesModell): string | null {
  const url = leer(eingabe.nachweisUrl);
  if (!eingabe.freigegeben) return url;
  if (url === null && leer(eingabe.bemerkung) === null) {
    throw new ModellFehler(
      'Zu einer Freigabe gehört der Nachweis: ein Link auf den '
      + 'Auftragsverarbeitungsvertrag, oder wenigstens eine Bemerkung, worauf '
      + 'sie sich stützt. Sie ist das, was eine Aufsichtsbehörde liest.',
      'ohne_nachweis');
  }
  if (url !== null && !/^https:\/\/\S+$/u.test(url)) {
    throw new ModellFehler(
      'Der Nachweis ist eine https-Adresse — oder leer.', 'nachweis_ungueltig');
  }
  return url;
}

export async function legeModellAn(
  kontext: SchreibKontext, eingabe: NeuesModell,
): Promise<string> {
  const anbieter = eingabe.anbieter.trim().toLowerCase();
  const modell = eingabe.modell.trim();

  if (!/^[a-z][a-z0-9_-]*$/u.test(anbieter)) {
    throw new ModellFehler(
      'Der Anbieter besteht aus Kleinbuchstaben, Ziffern, Strich und '
      + 'Unterstrich — zum Beispiel `openai`.', 'anbieter_ungueltig');
  }
  if (modell === '') {
    throw new ModellFehler('Ohne Modellkennung keine Zeile.', 'modell_fehlt');
  }
  if (!FAEHIGKEITEN.includes(eingabe.faehigkeit as Faehigkeit)) {
    throw new ModellFehler('Unbekannte Fähigkeit.', 'faehigkeit_unbekannt');
  }
  /*
   * **Freigegeben, aber nicht EU oder nicht Nullspeicherung — das geht nicht
   * durch.** `app.modell_fuer` verlangt die Konjunktion; eine solche Zeile
   * waere damit ohnehin wirkungslos, und eine wirkungslose Freigabe im
   * Register sieht aus wie eine wirksame. Der Satz sagt, welche der drei
   * fehlt, statt die Zeile stillschweigend nutzlos zu speichern.
   */
  if (eingabe.freigegeben && !(eingabe.euVerarbeitung && eingabe.zeroRetention)) {
    throw new ModellFehler(
      'Eine Freigabe ohne EU-Verarbeitung und ohne Nullspeicherung bleibt '
      + 'wirkungslos — das Modell wäre trotzdem nicht aufrufbar. Bestätigen '
      + 'Sie beide, oder nehmen Sie die Freigabe heraus.',
      'freigabe_unvollstaendig');
  }

  const nachweis = pruefeNachweis(eingabe);

  const zeilen = await kontext.schreibe<{ id: string }>(
    /*
     * `geprueft_von` und `geprueft_am` stehen NICHT in der Spaltenliste: der
     * Ausloeser `trg_modell_register_zeuge` (0381) setzt sie. Ein Formular,
     * das den Zeugen mitschickt, schickt eine Behauptung ueber einen Dritten.
     */
    `insert into modell_register
       (anbieter, modell, faehigkeit, eu_verarbeitung, zero_retention,
        freigegeben, nachweis_url, bemerkung)
     values ($1, $2, $3::ki_faehigkeit, $4, $5, $6, $7, $8)
     returning id`,
    [anbieter, modell, eingabe.faehigkeit, eingabe.euVerarbeitung,
      eingabe.zeroRetention, eingabe.freigegeben, nachweis, leer(eingabe.bemerkung)]);

  const z = zeilen[0];
  if (z === undefined) {
    throw new ModellFehler(
      'Die Zeile wurde nicht angelegt — fehlt `system.einstellung_verwalten`?',
      'kein_schreibrecht', 403);
  }
  return z.id;
}

/**
 * Eine Freigabe zurücknehmen oder erteilen.
 *
 * **Gelöscht wird nicht** (Invariante 8, §3.6): das Register ist der Beleg,
 * wer wann bezeugt hat, dass ein Modell benutzt werden darf. Eine gelöschte
 * Zeile nimmt diesen Beleg mit. Zurückgenommen wird über `freigegeben =
 * false`, und die Zeile bleibt stehen.
 */
export async function setzeFreigabe(
  kontext: SchreibKontext, id: string, frei: boolean,
): Promise<void> {
  const zeilen = await kontext.schreibe<{ id: string }>(
    `update modell_register
        set freigegeben = $2,
            eu_verarbeitung = case when $2 then eu_verarbeitung else eu_verarbeitung end
      where id = $1::uuid
        and (not $2 or (eu_verarbeitung and zero_retention))
      returning id`,
    [id, frei]);
  if (zeilen[0] === undefined) {
    throw new ModellFehler(
      'Diese Zeile gibt es nicht — oder die Freigabe bliebe wirkungslos, weil '
      + 'EU-Verarbeitung oder Nullspeicherung nicht bestätigt sind.',
      'nicht_gefunden', 404);
  }
}
