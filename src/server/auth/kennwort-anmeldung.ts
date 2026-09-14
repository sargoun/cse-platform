import 'server-only';
import { createHash } from 'node:crypto';
import type { Route } from 'next';
import type { Transaktion } from '../kontext/index.js';
import { neuerToken, tokenHash } from './sitzung.js';
import {
  neuerWiederherstellungscode, neuesGeheimnis, otpauth, pruefe,
} from '../../lib/totp.js';

/**
 * Die Anmeldung mit E-Mail und Kennwort (AUT-01) und der zweite Faktor
 * (AUT-02) — als Dienst, nicht in einer Seite.
 *
 * **Jede Entscheidung faellt in der Datenbank.** Der Kennwort-Hash wird dort
 * verglichen (`crypt`), die Bremse laeuft dort (`app.versuch_protokollieren`),
 * die Sitzung entsteht dort. Hier steht nur, was Node kann und Postgres nicht:
 * ein HMAC ueber einen Zeitschritt und das Bilden zufaelliger Werte.
 */

/** Der aktive Anbieter — sichtbar auf dem Anmeldebildschirm. */
export type Anbieter = 'demo' | 'supabase';

/**
 * Welcher Anbieter gilt?
 *
 * Supabase Auth ist gesetzt (CLAUDE.md, Stack). Ohne Projekt-URL und
 * Schluessel ist es aber nicht VERBUNDEN, und dann gilt der hausinterne Weg —
 * derselbe Umgang wie bei SMS, DATEV und den Modellen: der Adapter existiert,
 * sein Zustand steht auf dem Bildschirm, und nichts tut so, als sei es
 * angeschlossen.
 */
export function anbieter(): Anbieter {
  const url = process.env['SUPABASE_URL'] ?? '';
  const schluessel = process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '';
  return url !== '' && schluessel !== '' ? 'supabase' : 'demo';
}

export type AnmeldeErgebnis = 'ok' | 'falsch' | 'gesperrt' | 'gebremst' | 'fremd';

export interface Anmeldung {
  readonly ergebnis: AnmeldeErgebnis;
  readonly token: string | null;
  readonly sitzungId: string | null;
  readonly benutzerId: string | null;
  /** Verlangt eine Rolle dieses Kontos den zweiten Faktor (AUT-02)? */
  readonly brauchtFaktor: boolean;
  /** Ist einer hinterlegt? Wenn nicht, fuehrt der Weg zum Einrichten. */
  readonly faktorVorhanden: boolean;
  readonly mussWechseln: boolean;
}

interface AnmeldeZeile {
  ergebnis: AnmeldeErgebnis;
  sitzung_id: string | null;
  benutzer_id: string | null;
  braucht_faktor: boolean;
  faktor_vorhanden: boolean;
  muss_wechseln: boolean;
}

/**
 * Die erste Stufe. Der Rueckgabewert traegt den Token nur bei `'ok'` —
 * jeder andere Ausgang hat keinen, und ein Feld, das mal einen Token enthaelt
 * und mal einen leeren String, wird irgendwann ungeprueft gesetzt.
 */
export async function meldeAnMitKennwort(
  tx: Transaktion,
  email: string,
  kennwort: string,
  ip: string | null,
  userAgent: string | null,
): Promise<Anmeldung> {
  const token = neuerToken();
  const zeilen = (await tx.unsafe(
    `select * from app.kennwort_anmelden($1, $2, $3, $4::inet, $5)`,
    [email, kennwort, tokenHash(token), ip, userAgent],
  )) as readonly AnmeldeZeile[];

  const z = zeilen[0];
  if (z === undefined || z.ergebnis !== 'ok') {
    return {
      ergebnis: z?.ergebnis ?? 'falsch',
      token: null, sitzungId: null, benutzerId: z?.benutzer_id ?? null,
      brauchtFaktor: false, faktorVorhanden: false, mussWechseln: false,
    };
  }
  return {
    ergebnis: 'ok',
    token,
    sitzungId: z.sitzung_id,
    benutzerId: z.benutzer_id,
    brauchtFaktor: z.braucht_faktor,
    faktorVorhanden: z.faktor_vorhanden,
    mussWechseln: z.muss_wechseln,
  };
}

/**
 * Ein Rueckweg, der von aussen kommt — geprueft, nicht nur angeschaut.
 *
 * **`startsWith('/')` genuegt NICHT.** `//boese.example` beginnt mit einem
 * Schraegstrich und ist trotzdem eine fremde Adresse: der Browser liest zwei
 * fuehrende Schraegstriche als „gleiches Protokoll, anderer Host". Ein
 * Anmeldeformular, das danach dorthin weiterleitet, ist eine offene
 * Weiterleitung — die klassische Zutat einer Phishing-Kette, weil der Link
 * zur echten Anmeldung fuehrt und erst danach woandershin.
 *
 * Ebenso abgewiesen: `/\evil` (manche Browser lesen den Rueckstrich wie einen
 * Schraegstrich) und alles mit Steuerzeichen.
 */
export function sichererRueckweg(roh: unknown): string | null {
  if (typeof roh !== 'string' || roh === '') return null;
  if (!roh.startsWith('/')) return null;
  if (roh.startsWith('//') || roh.startsWith('/\\')) return null;
  if (/[\u0000-\u001f\u007f]/u.test(roh)) return null;
  return roh;
}

/**
 * Wohin nach der ersten Stufe — die eine Stelle, die das entscheidet.
 *
 * Die Rueckgabe ist `Route`, weil Next.js Pfade typisiert (`typedRoutes`) und
 * ein Ziel aus einer Abfrage zur Uebersetzungszeit nun einmal unbekannt ist.
 * Die Umdeutung steht **hier**, an genau einer Stelle, direkt hinter
 * `sichererRueckweg` — und nicht als verstreutes `as` in fuenf Seiten, von
 * denen eine das Pruefen vergisst.
 */
export function wegNachAnmeldung(a: Anmeldung, ziel: string | null): Route {
  if (a.brauchtFaktor && !a.faktorVorhanden) return '/auth/zwei-faktor/einrichten';
  if (a.brauchtFaktor) return '/auth/zwei-faktor/pruefen';
  if (a.mussWechseln) return '/auth/passwort-neu?wechsel=1';
  return alsRoute(sichererRueckweg(ziel) ?? '/portal');
}

/** Die eine erlaubte Umdeutung — siehe `wegNachAnmeldung`. */
export function alsRoute(pfad: string): Route {
  return pfad as Route;
}

// ---------------------------------------------------------------------------
// Zweiter Faktor
// ---------------------------------------------------------------------------

export interface FaktorEinrichtung {
  readonly geheimnis: string;
  readonly adresse: string;
}

/** Ein neues Geheimnis anlegen und die `otpauth://`-Adresse dazu bilden. */
export async function richteFaktorEin(
  tx: Transaktion, konto: string,
): Promise<FaktorEinrichtung | null> {
  const geheimnis = neuesGeheimnis();
  const zeilen = (await tx.unsafe(
    `select app.faktor_anlegen($1) as id`, [geheimnis],
  )) as readonly { id: string | null }[];
  if ((zeilen[0]?.id ?? null) === null) return null;
  return { geheimnis, adresse: otpauth(geheimnis, konto) };
}

interface GeheimnisZeile { id: string; geheimnis: string; letzter_schritt: string | number | null }

/**
 * Einen Code pruefen und den Schritt verbrauchen.
 *
 * `nurBestaetigt = false` ist der Einrichtungsfall: der Faktor ist angelegt,
 * aber noch nicht bestaetigt, und genau dieser Aufruf bestaetigt ihn
 * (`app.faktor_schritt_verbrauchen` setzt `bestaetigt_am`, falls es fehlt).
 */
export async function pruefeFaktor(
  tx: Transaktion, code: string, nurBestaetigt = true,
): Promise<boolean> {
  /**
   * **Die Uhr kommt aus der Datenbank, nicht aus Node.** TOTP rechnet ueber
   * einen Zeitschritt; geht die Uhr des Anwendungsservers um eine Minute vor,
   * ist jeder Code falsch — und der Fehler sieht aus wie ein falscher Code.
   * Eine Uhr fuer das ganze Haus ist auch dann noch dieselbe, wenn morgen
   * drei Instanzen laufen.
   */
  const uhr = (await tx.unsafe(`select now() as jetzt`)) as readonly { jetzt: Date | string }[];
  const jetzt = new Date(uhr[0]!.jetzt);
  const zeilen = (await tx.unsafe(
    `select id, geheimnis, letzter_schritt from app.faktor_geheimnis($1)`, [nurBestaetigt],
  )) as readonly GeheimnisZeile[];
  const z = zeilen[0];
  if (z === undefined) return false;

  const zuletzt = z.letzter_schritt === null ? null : Number(z.letzter_schritt);
  const schritt = pruefe(z.geheimnis, code, jetzt, zuletzt);
  if (schritt === null) return false;

  const ok = (await tx.unsafe(
    `select app.faktor_schritt_verbrauchen($1::uuid, $2::bigint) as ok`, [z.id, schritt],
  )) as readonly { ok: boolean }[];
  return ok[0]?.ok === true;
}

/** Die Sitzung auf `aal2` heben — ueber den Besitz des Tokens. */
export async function hebeAufAal2(tx: Transaktion, token: string): Promise<boolean> {
  const zeilen = (await tx.unsafe(
    `select app.sitzung_faktor_bestaetigt($1) as ok`, [tokenHash(token)],
  )) as readonly { ok: boolean }[];
  return zeilen[0]?.ok === true;
}

// ---------------------------------------------------------------------------
// Wiederherstellungscodes
// ---------------------------------------------------------------------------

export function codeHash(code: string): string {
  return createHash('sha256').update(code.toUpperCase().replace(/[^A-Z0-9]/gu, '')).digest('hex');
}

/**
 * Codes ausgeben — der Klartext existiert genau einmal, in dieser Antwort.
 *
 * Gespeichert wird der SHA-256. Wer die Datenbank liest, kann sich damit nicht
 * anmelden; wer den Zettel hat, schon. Das ist der ganze Zweck.
 */
export async function gibWiederherstellungscodesAus(
  tx: Transaktion, anzahl: number,
): Promise<readonly string[]> {
  const codes = Array.from({ length: anzahl }, () => neuerWiederherstellungscode());
  await tx.unsafe(
    `select app.wiederherstellungscodes_setzen($1::text[])`, [codes.map(codeHash)],
  );
  return codes;
}

export async function loeseWiederherstellungscodeEin(
  tx: Transaktion, code: string,
): Promise<boolean> {
  const zeilen = (await tx.unsafe(
    `select app.wiederherstellungscode_einloesen($1) as ok`, [codeHash(code)],
  )) as readonly { ok: boolean }[];
  return zeilen[0]?.ok === true;
}

export async function offeneWiederherstellungscodes(tx: Transaktion): Promise<number> {
  const zeilen = (await tx.unsafe(
    `select app.wiederherstellungscodes_offen() as n`,
  )) as readonly { n: number }[];
  return zeilen[0]?.n ?? 0;
}

// ---------------------------------------------------------------------------
// Einladung und Zuruecksetzung
// ---------------------------------------------------------------------------

export type Zweck = 'zuruecksetzen' | 'einladung';

/** Immer `true` — ob es die Adresse gibt, sagt dieser Weg bewusst nicht. */
export async function legeKennwortTokenAn(
  tx: Transaktion, email: string, zweck: Zweck,
): Promise<string> {
  const token = neuerToken();
  await tx.unsafe(
    `select app.kennwort_token_anlegen($1, $2, $3)`, [email, zweck, tokenHash(token)],
  );
  return token;
}

export interface TokenInhalt {
  readonly benutzerId: string;
  readonly name: string;
  readonly email: string | null;
  readonly zweck: Zweck;
}

export async function leseKennwortToken(
  tx: Transaktion, token: string,
): Promise<TokenInhalt | null> {
  const zeilen = (await tx.unsafe(
    `select benutzer_id, name, email, zweck from app.kennwort_token_lesen($1)`,
    [tokenHash(token)],
  )) as readonly { benutzer_id: string; name: string; email: string | null; zweck: Zweck }[];
  const z = zeilen[0];
  return z === undefined
    ? null
    : { benutzerId: z.benutzer_id, name: z.name, email: z.email, zweck: z.zweck };
}

export interface Einloesung {
  readonly benutzerId: string;
  /**
   * Das Kennwort steht, aber das Konto darf noch nicht `aktiv` werden: eine
   * Rolle verlangt den zweiten Faktor (AUT-02). Der Token bleibt offen, und
   * der naechste Schritt ist das Einrichten mit DEMSELBEN Token.
   */
  readonly brauchtFaktor: boolean;
}

export async function loeseKennwortTokenEin(
  tx: Transaktion, token: string, kennwort: string,
): Promise<Einloesung | null> {
  const zeilen = (await tx.unsafe(
    `select o_benutzer_id as benutzer_id, o_braucht_faktor as braucht_faktor
       from app.kennwort_token_einloesen($1, $2)`,
    [tokenHash(token), kennwort],
  )) as readonly { benutzer_id: string; braucht_faktor: boolean }[];
  const z = zeilen[0];
  return z === undefined ? null : { benutzerId: z.benutzer_id, brauchtFaktor: z.braucht_faktor };
}

// ---------------------------------------------------------------------------
// Der zweite Faktor, ausgewiesen durch den Einladungstoken
// ---------------------------------------------------------------------------

/**
 * Dieselben drei Schritte wie oben, nur haengt der Ausweis am Token statt an
 * einer Sitzung — ein eingeladenes Konto hat keine (siehe `0155`).
 */
export async function richteFaktorMitTokenEin(
  tx: Transaktion, token: string, konto: string,
): Promise<FaktorEinrichtung | null> {
  const geheimnis = neuesGeheimnis();
  const zeilen = (await tx.unsafe(
    `select app.token_faktor_anlegen($1, $2) as id`, [tokenHash(token), geheimnis],
  )) as readonly { id: string | null }[];
  if ((zeilen[0]?.id ?? null) === null) return null;
  return { geheimnis, adresse: otpauth(geheimnis, konto) };
}

/** Prueft, bestaetigt, aktiviert und verbraucht den Token — oder nichts davon. */
export async function bestaetigeFaktorMitToken(
  tx: Transaktion, token: string, code: string,
): Promise<string | null> {
  const uhr = (await tx.unsafe(`select now() as jetzt`)) as readonly { jetzt: Date | string }[];
  const zeilen = (await tx.unsafe(
    `select id, geheimnis, letzter_schritt from app.token_faktor_geheimnis($1)`,
    [tokenHash(token)],
  )) as readonly GeheimnisZeile[];
  const z = zeilen[0];
  if (z === undefined) return null;

  const zuletzt = z.letzter_schritt === null ? null : Number(z.letzter_schritt);
  const schritt = pruefe(z.geheimnis, code, new Date(uhr[0]!.jetzt), zuletzt);
  if (schritt === null) return null;

  const fertig = (await tx.unsafe(
    `select app.token_faktor_bestaetigen($1, $2::uuid, $3::bigint) as benutzer_id`,
    [tokenHash(token), z.id, schritt],
  )) as readonly { benutzer_id: string | null }[];
  return fertig[0]?.benutzer_id ?? null;
}

export async function aendereKennwort(
  tx: Transaktion, alt: string, neu: string,
): Promise<boolean> {
  const zeilen = (await tx.unsafe(
    `select app.kennwort_aendern($1, $2) as ok`, [alt, neu],
  )) as readonly { ok: boolean }[];
  return zeilen[0]?.ok === true;
}

/**
 * Wie stark ist dieses Kennwort — als Pruefung, die auf dem Server laeuft.
 *
 * Kein Zeichenklassen-Katalog („mindestens eine Ziffer, ein Sonderzeichen"):
 * das BSI hat diese Regeln 2020 aus dem Grundschutz genommen, weil sie zu
 * `Sommer2024!` fuehren. Was zaehlt, ist Laenge — und dass es nicht eines der
 * paar Dutzend ist, die jeder zuerst probiert.
 */
export const KENNWORT_MIN = 12;

const ZU_HAEUFIG = new Set([
  'passwort', 'password', 'kennwort', '123456789012', 'qwertzuiopü',
  'administrator', 'willkommen1', 'geheimgeheim',
]);

export function kennwortFehler(kennwort: string, mindest = KENNWORT_MIN): string | null {
  if (kennwort.length < mindest) {
    return `Mindestens ${String(mindest)} Zeichen — je länger, desto besser.`;
  }
  if (ZU_HAEUFIG.has(kennwort.toLowerCase())) {
    return 'Dieses Kennwort steht in jeder Wortliste. Bitte ein anderes.';
  }
  if (new Set(kennwort).size < 5) {
    return 'Zu wenige verschiedene Zeichen.';
  }
  return null;
}
