import 'server-only';
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import { neuerToken, tokenHash } from '../../auth/sitzung.js';
import { anbieter } from '../../auth/kennwort-anmeldung.js';

/**
 * Der Portalzugang eines Kunden — ausstellen, neu einladen, entziehen
 * (AUT-01, AUT-04, CRM-01, DOC-04, K-04).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Einladungslink wird EINMAL angezeigt und von Hand übergeben.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Es ist kein EU-Mailanbieter verbunden (O-501); `/auth/passwort-vergessen`
 * antwortet „nicht verbunden". Eine Einladung kann also nicht versendet
 * werden — und deshalb wird hier kein Versand vorgetäuscht. Es gilt dasselbe
 * Muster wie beim Mitarbeiter-Anmeldecode (D-487): der Klartext entsteht
 * hier, wandert über einen kurzlebigen Keks auf die Zugangsseite, steht dort
 * genau einmal, und gespeichert ist nur sein SHA-256.
 *
 * **Nie über die Adresse.** Ein Token in der URL steht in jedem
 * Zugriffsprotokoll, in jedem Proxy-Log und im Verlauf des Browsers.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Solange Supabase Auth nicht angeschlossen ist, IST der hausinterne Weg
 * der echte Weg — danach nicht mehr.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `anbieter()` antwortet heute `'demo'`: `app.kennwort_anmelden` prüft gegen
 * `kern.zugangsdaten`, und ein von `app.kundenzugang_ausstellen` (0249)
 * angelegtes Konto meldet sich wirklich an. Sobald ein Supabase-Projekt
 * verbunden IST und der Codetausch gebaut ist, gehört das Anlegen eines
 * Kontos in die Admin-API — ein `insert` in `auth.users` erzeugte dann ein
 * Konto, mit dem sich niemand anmelden kann. Diese Datei weist das deshalb
 * benannt ab, statt es zu tun.
 *
 * // TODO(client, O-662): Wird ein Kundenzugang nach dem Anschluss von
 * Supabase Auth (O-501) über die Admin-API angelegt, und wer trägt den
 * Auftragsverarbeitungsvertrag für die Konten externer Ansprechpartner?
 */

/** Der kurzlebige Keks, in dem die Route den Klartext an die Seite reicht. */
export const EINLADUNG_COOKIE = 'cse_kundeneinladung';

export class ZugangFehler extends Error {
  constructor(nachricht: string, readonly grund: string, readonly status = 400) {
    super(nachricht);
    this.name = 'ZugangFehler';
  }
}

export interface ZugangZeile {
  readonly zugang_id: string;
  readonly konto_id: string;
  readonly email: string | null;
  readonly name: string;
  readonly konto_status: string;
  readonly aktiviert_am: Date;
  readonly entzogen_am: Date | null;
  readonly entzogen_von: string | null;
  readonly einladung_offen: boolean;
  readonly einladung_bis: Date | null;
  readonly letzte_anmeldung: Date | null;
}

/**
 * Die Zugänge eines Kunden — über den Definer aus 0249.
 *
 * Warum nicht direkt: `benutzer` steht hinter `t_benutzer_lesen` und damit
 * hinter `system.benutzer_lesen`. Die Seite trägt aber
 * `system.benutzer_verwalten`. Wem das Leserecht einzeln entzogen ist, sähe
 * die Zeilen ohne E-Mail und ohne Namen — eine Liste aus Bindestrichen, die
 * aussieht, als sei kein Konto hinterlegt.
 */
export async function leseZugaenge(
  kontext: LeseKontext, kundeId: string,
): Promise<readonly ZugangZeile[]> {
  const zeilen = await kontext.abfrage<ZugangZeile & { benutzer_id: string }>(
    `select zugang_id, benutzer_id, email, name, konto_status, aktiviert_am,
            entzogen_am, entzogen_von, einladung_offen, einladung_bis,
            letzte_anmeldung
       from app.kundenzugang_liste($1::uuid)`, [kundeId]);
  return zeilen.map((z) => ({ ...z, konto_id: z.benutzer_id }));
}

export interface ZugangErgebnis {
  readonly ok: boolean;
  /** Deutsch, immer gesetzt — auch bei Erfolg. */
  readonly grund: string;
  /** Der Klartext des Einladungslinks — nur bei Erfolg, nur einmal. */
  readonly token: string | null;
  readonly neuesKonto: boolean;
}

function pruefeAnbieter(): void {
  if (anbieter() !== 'demo') {
    throw new ZugangFehler(
      'Supabase Auth ist als Anbieter aktiv. Ein Konto entsteht dort über die '
      + 'Admin-API und nicht in dieser Datenbank — ein hier angelegtes Konto könnte '
      + 'sich nicht anmelden. Der Weg dafür ist nicht gebaut (O-501, O-662).',
      'anbieter_fremd', 501);
  }
}

/**
 * Einen Zugang ausstellen.
 *
 * Alles Weitere steckt in `app.kundenzugang_ausstellen` (0249): Recht, zweiter
 * Faktor, Konto, Mitgliedschaft mit der Rolle `kunde`, Bindung an den Kunden,
 * Einladungstoken, Protokoll — in einem Vorgang. Diese Funktion bildet den
 * Klartext und gibt ihn zurück; gespeichert wird nur der Hash.
 */
export async function stelleZugangAus(
  kontext: SchreibKontext,
  eingabe: { readonly kundeId: string; readonly email: string; readonly name: string },
): Promise<ZugangErgebnis> {
  pruefeAnbieter();
  const token = neuerToken();
  const [z] = await kontext.schreibe<{
    ok: boolean; grund: string; neues_konto: boolean;
  }>(
    `select ok, grund, neues_konto
       from app.kundenzugang_ausstellen($1::uuid, $2, $3, $4)`,
    [eingabe.kundeId, eingabe.email, eingabe.name, tokenHash(token)]);
  if (z === undefined) {
    return {
      ok: false, token: null, neuesKonto: false,
      grund: 'Der Zugang wurde nicht ausgestellt.',
    };
  }
  return {
    ok: z.ok,
    grund: z.grund,
    token: z.ok ? token : null,
    neuesKonto: z.neues_konto,
  };
}

/** Ein frischer Einladungslink; der alte verfällt dabei. */
export async function ladeNeuEin(
  kontext: SchreibKontext, zugangId: string,
): Promise<ZugangErgebnis> {
  pruefeAnbieter();
  const token = neuerToken();
  const [z] = await kontext.schreibe<{ ok: boolean; grund: string }>(
    `select ok, grund from app.kundenzugang_neu_einladen($1::uuid, $2)`,
    [zugangId, tokenHash(token)]);
  if (z === undefined) {
    return { ok: false, grund: 'Die Einladung wurde nicht erneuert.', token: null,
      neuesKonto: false };
  }
  return { ok: z.ok, grund: z.grund, token: z.ok ? token : null, neuesKonto: false };
}

/**
 * Einen Zugang entziehen — mit Grund.
 *
 * Der Definer beendet dabei die laufenden Sitzungen dieses Kontos. Ohne das
 * wirkte der Entzug erst, wenn die Sitzung von allein abläuft, und ein
 * Entzug, der morgen wirkt, ist kein Entzug.
 */
export async function entzieheZugang(
  kontext: SchreibKontext, zugangId: string, grund: string,
): Promise<{ readonly ok: boolean; readonly grund: string; readonly sitzungen: number }> {
  const [z] = await kontext.schreibe<{
    ok: boolean; grund: string; sitzungen: number;
  }>(
    `select ok, grund, sitzungen from app.kundenzugang_entziehen($1::uuid, $2)`,
    [zugangId, grund]);
  if (z === undefined) {
    return { ok: false, grund: 'Der Zugang wurde nicht entzogen.', sitzungen: 0 };
  }
  return { ok: z.ok, grund: z.grund, sitzungen: z.sitzungen };
}

/**
 * Was der Kundenzugang öffnet — in Worten, für den Bildschirm.
 *
 * Die K-04-Decke ist keine Einstellung, sondern zwei restriktive Policies:
 * `p_kunde_decke` auf jeder Kundentabelle und `app.aktuelle_kunden()` als
 * Filter. Wer einen Zugang ausstellt, soll lesen können, was er damit
 * herausgibt — nicht später erfahren, dass es mehr war als gedacht.
 */
export const ZUGANG_UMFANG: readonly string[] = [
  'Die eigenen Aufträge, Objekte und Einsätze — nur die dieses Kunden.',
  'Die eigenen Rechnungen und Leistungsnachweise, mit Unterschrift.',
  'Die eigenen Reklamationen und Dokumente aus dem privaten Speicher.',
  'Keine Personaldaten, keine Konditionen, keine Vorgänge anderer Kunden.',
];
