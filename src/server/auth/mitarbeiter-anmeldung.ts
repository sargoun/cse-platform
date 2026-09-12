import 'server-only';
import { createHash, randomInt } from 'node:crypto';
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

/**
 * Eine deutsche Telefonnummer auf E.164 bringen.
 *
 * **Warum das nicht der Eingabe ueberlassen wird.** `0170 1234567`,
 * `+49 170 1234567`, `0049-170-1234567` und `(0170) 1234567` sind dieselbe
 * Nummer. Ohne Normalisierung legt jede Schreibweise einen eigenen Zugang an,
 * und die Spalte `telefon_e164 unique` haelt genau nichts mehr zusammen.
 *
 * **Die Laenderkennung ist ein Parameter, kein Literal.** Die Vorwahl `49`
 * steht hier als Vorgabe, weil die Gruppe in Berlin arbeitet und ihre
 * Beschaeftigten deutsche Nummern haben; wer eine auslaendische Nummer
 * eintraegt, schreibt sie mit `+` und wird durchgereicht. Ein hart
 * verdrahtetes `+49` haette eine polnische oder tuerkische Mobilnummer still
 * zu einer deutschen gemacht — und das faellt erst auf, wenn die SMS nicht
 * ankommt.
 */
export function normalisiereTelefon(eingabe: string, laenderkennung = '49'): string | null {
  const roh = eingabe.replace(/[\s/()\-.]/gu, '');
  if (roh === '') return null;

  let ziffern: string;
  if (roh.startsWith('+')) ziffern = roh.slice(1);
  else if (roh.startsWith('00')) ziffern = roh.slice(2);
  else if (roh.startsWith('0')) ziffern = laenderkennung + roh.slice(1);
  else return null;   // Weder international noch mit nationaler Null: unklar.

  if (!/^[1-9][0-9]{6,14}$/u.test(ziffern)) return null;
  return `+${ziffern}`;
}

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
   * Der Code im Klartext — NUR auf den Entwicklungsflaechen und nur, wenn
   * kein Dienst verbunden ist. Sonst `null`. Er steht hier, damit die
   * Anmeldung ohne Gateway pruefbar ist, und er wird von der Oberflaeche
   * sichtbar als Entwicklungsauskunft gezeigt, nie als „gesendet".
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
    codeFuerEntwicklung: angelegt && !sms.verbunden ? code : null,
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
export async function codeEinloesen(
  tx: Abfrage,
  rohesTelefon: string,
  code: string,
): Promise<string | null> {
  const telefon = normalisiereTelefon(rohesTelefon);
  if (telefon === null) return null;
  if (!/^[0-9]{6}$/u.test(code)) return null;

  const zeilen = (await tx.unsafe(
    `select app.zugang_code_einloesen($1, $2) as person_id`,
    [telefon, codeHash(code)],
  )) as { person_id: string | null }[];

  return zeilen[0]?.person_id ?? null;
}
