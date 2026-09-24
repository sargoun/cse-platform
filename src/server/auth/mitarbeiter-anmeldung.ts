import 'server-only';
import { createHash, randomInt } from 'node:crypto';
import { normalisiereTelefon } from '../../lib/telefon.js';
import { bindeHerkunft } from '../kontext/index.js';
import { type SmsDienst } from './sms.js';

/**
 * Die Anmeldung mit Telefon und Einmalcode (EMP-01, PR 20).
 *
 * **Die Entscheidungen liegen in der Datenbank, nicht hier.** Ob es die
 * Nummer gibt, ob noch ein Code offen ist, ob der eingegebene stimmt und ob
 * er schon verbraucht wurde — all das beantworten `app.zugang_code_anfordern`
 * und `app.zugang_code_einloesen` (0114). Dieser Dienst erzeugt den Code,
 * schickt ihn weg und reicht die Antwort durch. Die Trennung ist kein
 * Geschmack: ein Wiedereinloese-Schutz, der zwischen zwei Anweisungen dieser
 * Datei liegt, hat ein Fenster; einer innerhalb einer Funktion mit
 * `for update` hat keines.
 */

/**
 * Sechs Stellen, gleichverteilt, aus `randomInt`.
 *
 * **Nicht `Math.random()`.** Das ist ein schneller Pseudozufall fuer
 * Animationen, kein Zufall fuer ein Geheimnis: sein Zustand laesst sich aus
 * wenigen Ausgaben rekonstruieren, und wer ihn hat, kennt jeden naechsten
 * Code. `randomInt` zieht aus derselben Quelle wie die Sitzungstoken.
 *
 * Fuehrende Nullen bleiben erhalten — `000123` ist ein gueltiger Code, und
 * eine Zahl waere hier sechsstellig nur manchmal.
 */
export function neuerCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function codeHash(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex');
}

export { normalisiereTelefon };

/** Zehn Minuten — siehe 0113. */
export const CODE_GUELTIG_MINUTEN = 10;

export interface Abfrage {
  unsafe(anweisung: string, werte?: readonly unknown[]): Promise<readonly unknown[]>;
}

export interface AnforderungsErgebnis {
  /**
   * **Immer `true`, wenn die Eingabe eine Nummer WAR.**
   *
   * Nicht, ob eine SMS rausging — das waere das Orakel, das 0114 vermeidet:
   * wer Nummern durchprobiert, erfuehre, welche Menschen hier arbeiten. Die
   * Oberflaeche sagt deshalb immer denselben Satz: „Falls diese Nummer
   * hinterlegt ist, kommt gleich ein Code."
   */
  readonly angenommen: boolean;
  /**
   * Der Code im Klartext — NUR auf den Entwicklungsflaechen. Sonst `null`.
   *
   * Er steht hier, damit die Anmeldung ohne Gateway pruefbar ist, und die
   * Oberflaeche zeigt ihn sichtbar als Entwicklungsauskunft, nie als
   * „gesendet". Die Entscheidung darueber gehoert dem Dienst
   * (`SmsDienst.zeigtCode`) und NICHT dem Umkehrschluss aus `verbunden` —
   * siehe die Begruendung dort.
   */
  readonly codeFuerEntwicklung: string | null;
}

export async function codeAnfordern(
  tx: Abfrage,
  rohesTelefon: string,
  sms: SmsDienst,
  ip: string | null = null,
): Promise<AnforderungsErgebnis> {
  const telefon = normalisiereTelefon(rohesTelefon);
  if (telefon === null) return { angenommen: false, codeFuerEntwicklung: null };

  /**
   * **Ohne Zustellung kein Code.** Ein Dienst, der weder sendet noch zeigt
   * (O-82 offen, keine Entwicklungsflaeche), legte einen Code an, den
   * niemand je erhaelt — und der den Code VERDRAENGTE, den die
   * Einsatzleitung ausgestellt hat: 0114 loest nur den juengsten ein. Genau
   * so scheiterte die Anmeldung am Handy (D-487): Code ausgestellt, die
   * Mitarbeiterin tippt „Code anfordern", und der ausgestellte gilt nicht
   * mehr. Der Tipp fuehrt jetzt nur zur Codeeingabe; die Bremse (drei offene
   * Codes) bleibt frei, und nach aussen bleibt die Antwort dieselbe.
   */
  if (!sms.verbunden && !sms.zeigtCode) return { angenommen: true, codeFuerEntwicklung: null };

  const code = neuerCode();
  const zeilen = (await tx.unsafe(
    `select app.zugang_code_anfordern($1, $2, now() + ($3 || ' minutes')::interval, $4) as ok`,
    [telefon, codeHash(code), String(CODE_GUELTIG_MINUTEN), ip],
  )) as { ok: boolean }[];

  const angelegt = zeilen[0]?.ok === true;

  /**
   * **Der Versand nur, wenn ein Code entstanden ist** — und ein Fehlschlag
   * beim Senden aendert die Antwort nach aussen nicht. Sonst waere „SMS
   * fehlgeschlagen" wieder die Auskunft „diese Nummer gibt es".
   */
  if (angelegt && sms.verbunden) {
    try {
      await sms.sende({ an: telefon, text: `CSE Gruppe: Ihr Anmeldecode lautet ${code}.` });
    } catch {
      // Bewusst geschluckt: siehe oben. Der Code verfaellt von selbst.
    }
  }

  return {
    angenommen: true,
    codeFuerEntwicklung: angelegt && sms.zeigtCode ? code : null,
  };
}

/**
 * Einen Code einloesen. Gibt die `person_id` — oder `null`.
 *
 * Ein einziger Rueckgabewert fuer jeden Fehlschlag, aus demselben Grund wie
 * in 0114: „Code falsch", „abgelaufen", „schon benutzt" und „Nummer
 * unbekannt" sind vier Hinweise fuer den, der raet, und null Hilfe fuer den,
 * der sich vertippt hat — der tippt einfach nochmal.
 */
/**
 * Der getippte oder eingefuegte Code, auf seine Ziffern reduziert.
 *
 * **Warum nicht einfach `^[0-9]{6}$` verlangen.** Wer den Code auf dem
 * Bildschirm der Einsatzleitung markiert und einfuegt, bringt Leerzeichen
 * mit; manche Tastatur setzt ein schmales Leerzeichen zwischen Dreiergruppen,
 * und ein `pattern` im Formular blockiert das ohne sichtbare Meldung — die
 * Seite tut dann gar nichts, und genau so hat der Nutzer es beschrieben
 * (D-488). Die Ziffern sind der Code; alles andere ist Formatierung.
 */
export function nurZiffern(eingabe: string): string {
  return eingabe.replace(/[^0-9]/gu, '');
}

export async function codeEinloesen(
  tx: Abfrage,
  rohesTelefon: string,
  rohEingabe: string,
  /**
   * Die Adresse der Anfrage (`herkunft`) — PFLICHT, `null` heisst: keine
   * bekannt. `app.zugang_code_einloesen` setzt `mitarbeiter_zugang.letzter_login_am`,
   * und der Ausloeser dort schreibt eine Protokollzeile; bis V-235 trug sie
   * `ip = NULL`, weil dieser Weg vor jeder Sitzung laeuft und nichts `app.ip`
   * band (SEC-A9, D-729).
   */
  ip: string | null,
): Promise<string | null> {
  const telefon = normalisiereTelefon(rohesTelefon);
  if (telefon === null) return null;
  const code = nurZiffern(rohEingabe);
  if (!/^[0-9]{6}$/u.test(code)) return null;

  await bindeHerkunft(tx, ip);
  const zeilen = (await tx.unsafe(
    `select app.zugang_code_einloesen($1, $2) as person_id`,
    [telefon, codeHash(code)],
  )) as { person_id: string | null }[];

  return zeilen[0]?.person_id ?? null;
}
