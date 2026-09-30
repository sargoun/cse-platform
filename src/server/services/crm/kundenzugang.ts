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

/**
 * Jeder Grund, mit dem ein Zugang nicht ausgestellt, erneuert oder entzogen
 * wird — er reist als `?fehler=` auf die Zugangsseite (D-769, D-772, V-274).
 *
 * **Die Definer aus 0249 antworten mit einem deutschen SATZ**, nicht mit einem
 * Schlüssel: als `grund` ihrer Antwort (`ok = false`) und als Text ihrer
 * Würfe (`insufficient_privilege`, `no_data_found`). Die Route reichte beides
 * roh durch die Adresse, und die Seite zeigte es — dazu jeden anderen
 * einzeiligen Fehlertext, auch „Nicht gefunden" eines fehlenden Rechts.
 * Jetzt bildet `grundAusDatenbank` jeden bekannten Satz auf seinen Grund ab;
 * ein Satz, den dieser Dienst nicht kennt, wird `abgewiesen` — der
 * allgemeine Satz der Seite, nie der Text der Datenbank.
 */
export const ZUGANG_GRUENDE = [
  /* die Route und dieser Dienst */
  'nicht_gefunden', 'anbieter_fremd',
  /* die Antworten der Definer (`ok = false`) */
  'kunde_unbekannt', 'email_ungueltig', 'name_fehlt', 'internes_konto', 'zugang_besteht',
  'entzug_ohne_grund',
  /* ihre Würfe (`insufficient_privilege`, `no_data_found`) */
  'zweiter_faktor', 'nur_intern', 'gruppenansicht', 'ohne_gesellschaft', 'kein_recht',
  'rolle_fehlt',
  /* eine Abweisung, deren Satz dieser Dienst nicht kennt */
  'abgewiesen',
] as const;
export type ZugangGrund = (typeof ZUGANG_GRUENDE)[number];

/** Wie die Route einen Erfolg meldet (`?erfolg=`) — der Satz steht auf der Seite. */
export const ZUGANG_ERFOLGE = [
  'ausgestellt', 'eingeladen', 'entzogen', 'entzogen_mit_sitzungen',
] as const;
export type ZugangErfolg = (typeof ZUGANG_ERFOLGE)[number];

export class ZugangFehler extends Error {
  constructor(nachricht: string, readonly grund: ZugangGrund, readonly status = 400) {
    super(nachricht);
    this.name = 'ZugangFehler';
  }
}

/**
 * Die Sätze der Definer aus 0249 und ihr Grund — wörtlich, wie die Datenbank
 * sie liefert (`tests/kern/crm-zugang-rueckweg.test.ts` liest sie aus der
 * Migration, `tests/isolation/crm-rueckweg-datenbank.test.ts` löst sie an der
 * echten Datenbank aus).
 */
export const ZUGANG_DATENBANK_GRUENDE: ReadonlyMap<string, ZugangGrund> = new Map([
  ['Diesen Kunden gibt es in dieser Gesellschaft nicht.', 'kunde_unbekannt'],
  ['Ohne gueltige E-Mail-Adresse gibt es kein Konto.', 'email_ungueltig'],
  ['Ein Konto braucht einen Namen — er steht in jeder Freigabe und in jedem '
    + 'Protokolleintrag.', 'name_fehlt'],
  ['Diese Adresse gehoert einem internen Konto. Ein Kundenzugang dafuer wuerde die '
    + 'Trennung der Portale aufheben (K-04).', 'internes_konto'],
  ['Dieses Konto hat in dieser Gesellschaft schon einen Zugang. Entziehen Sie ihn zuerst.',
    'zugang_besteht'],
  ['Diesen Zugang gibt es nicht — oder er ist entzogen.', 'nicht_gefunden'],
  ['Ein Entzug traegt einen Grund — er steht spaeter in der Frage, warum der Kunde nicht '
    + 'mehr hineinkommt.', 'entzug_ohne_grund'],
  ['Diesen Zugang gibt es nicht — oder er ist schon entzogen.', 'nicht_gefunden'],
  ['Ein Kundenzugang wird nur im internen Portal ausgestellt (K-04)', 'nur_intern'],
  ['Eine Einladung wird nur im internen Portal ausgestellt (K-04)', 'nur_intern'],
  ['Ein Kundenzugang wird nur im internen Portal entzogen (K-04)', 'nur_intern'],
  ['In der Gruppenansicht wird kein Zugang ausgestellt (Invariante 10)', 'gruppenansicht'],
  ['In der Gruppenansicht wird nichts eingeladen (Invariante 10)', 'gruppenansicht'],
  ['In der Gruppenansicht wird nichts entzogen (Invariante 10)', 'gruppenansicht'],
  ['Ohne aktive Gesellschaft gibt es keinen Kundenzugang (K-20)', 'ohne_gesellschaft'],
  ['system.benutzer_verwalten fehlt', 'kein_recht'],
  ['Ein Kundenzugang wird nur mit zweitem Faktor ausgestellt (AUT-02)', 'zweiter_faktor'],
  ['Eine neue Einladung wird nur mit zweitem Faktor ausgestellt (AUT-02)', 'zweiter_faktor'],
  ['Die Rolle `kunde` fehlt im Rollenkatalog', 'rolle_fehlt'],
]);

/** Der Grund zu einem Satz der Datenbank — ein unbekannter Satz ist `abgewiesen`, nie er selbst. */
export function grundAusDatenbank(satz: string): ZugangGrund {
  return ZUGANG_DATENBANK_GRUENDE.get(satz) ?? 'abgewiesen';
}

/**
 * Die SQLSTATE, mit denen ein Definer aus 0249 ABWEIST: ein fehlendes Recht,
 * Portal oder Faktor (`insufficient_privilege`) und die fehlende Rolle
 * `kunde` (`no_data_found`). Ein anderer Wurf — `check_violation` am
 * Einladungstoken, eine abgebrochene Verbindung — ist ein Fehler und bleibt
 * einer: keine erfundene Abweisung (D-769 Nr. 8).
 */
const ABWEISUNG_DER_DATENBANK: ReadonlySet<string> = new Set(['42501', 'P0002']);

/** Ein Aufruf eines Definers — seine Abweisungen als `ZugangFehler` mit Grund. */
async function definer<T>(aufruf: () => Promise<T>): Promise<T> {
  try {
    return await aufruf();
  } catch (fehler) {
    const f = fehler as { readonly code?: unknown; readonly message?: unknown };
    if (typeof f.code === 'string' && ABWEISUNG_DER_DATENBANK.has(f.code)) {
      const satz = typeof f.message === 'string' ? f.message : '';
      throw new ZugangFehler(satz, grundAusDatenbank(satz), f.code === '42501' ? 403 : 500);
    }
    throw fehler;
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

/**
 * Was ein Vorgang am Zugang ergab — ein Schlüssel, nie ein Satz: bei Erfolg
 * der Schlüssel der Bestätigung, sonst der Grund der Abweisung.
 */
export type ZugangErgebnis =
  | {
    readonly ok: true;
    readonly erfolg: ZugangErfolg;
    /** Der Klartext des Einladungslinks — nur beim Ausstellen und Erneuern, nur einmal. */
    readonly token: string | null;
    readonly neuesKonto: boolean;
  }
  | { readonly ok: false; readonly grund: ZugangGrund };

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
  const [z] = await definer(() => kontext.schreibe<{
    ok: boolean; grund: string; neues_konto: boolean;
  }>(
    `select ok, grund, neues_konto
       from app.kundenzugang_ausstellen($1::uuid, $2, $3, $4)`,
    [eingabe.kundeId, eingabe.email, eingabe.name, tokenHash(token)]));
  if (z === undefined) return { ok: false, grund: 'abgewiesen' };
  if (!z.ok) return { ok: false, grund: grundAusDatenbank(z.grund) };
  return { ok: true, erfolg: 'ausgestellt', token, neuesKonto: z.neues_konto };
}

/** Ein frischer Einladungslink; der alte verfällt dabei. */
export async function ladeNeuEin(
  kontext: SchreibKontext, zugangId: string,
): Promise<ZugangErgebnis> {
  pruefeAnbieter();
  const token = neuerToken();
  const [z] = await definer(() => kontext.schreibe<{ ok: boolean; grund: string }>(
    `select ok, grund from app.kundenzugang_neu_einladen($1::uuid, $2)`,
    [zugangId, tokenHash(token)]));
  if (z === undefined) return { ok: false, grund: 'abgewiesen' };
  if (!z.ok) return { ok: false, grund: grundAusDatenbank(z.grund) };
  return { ok: true, erfolg: 'eingeladen', token, neuesKonto: false };
}

/**
 * Einen Zugang entziehen — mit Grund.
 *
 * Der Definer beendet dabei die laufenden Sitzungen dieses Kontos. Ohne das
 * wirkte der Entzug erst, wenn die Sitzung von allein abläuft, und ein
 * Entzug, der morgen wirkt, ist kein Entzug. Ob dabei Sitzungen endeten,
 * sagt der Schlüssel des Erfolgs (`entzogen_mit_sitzungen`); die Zahl reiste
 * bis hierher im Satz durch die Adresse und bleibt jetzt im Protokoll des
 * Definers (`beendete_sitzungen`).
 */
export async function entzieheZugang(
  kontext: SchreibKontext, zugangId: string, grund: string,
): Promise<ZugangErgebnis> {
  const [z] = await definer(() => kontext.schreibe<{
    ok: boolean; grund: string; sitzungen: number;
  }>(
    `select ok, grund, sitzungen from app.kundenzugang_entziehen($1::uuid, $2)`,
    [zugangId, grund]));
  if (z === undefined) return { ok: false, grund: 'abgewiesen' };
  if (!z.ok) return { ok: false, grund: grundAusDatenbank(z.grund) };
  return {
    ok: true, erfolg: z.sitzungen > 0 ? 'entzogen_mit_sitzungen' : 'entzogen',
    token: null, neuesKonto: false,
  };
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
