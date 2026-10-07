/**
 * Der Alarm eines gescheiterten Laufs — und die ehrliche Auskunft, wohin er
 * heute geht.
 *
 * `runner.ts` verspricht: „KEIN stiller Tod." Das Versprechen hielt bisher
 * nur im Test, denn eine `Alarm`-Implementierung gab es im ganzen Zweig
 * nicht. Ein Job, der um drei Uhr nachts scheitert und niemanden erreicht,
 * ist ein Job, der nicht laeuft — und das faellt erst auf, wenn jemand die
 * Zahlen vermisst.
 *
 * **Was hier NICHT passiert: eine Zustellung erfinden.** Es ist kein
 * Bereitschaftskanal verbunden — keine Mailadresse, kein Dienst, keine
 * Nummer (CLAUDE.md „no fake integrations"). Diese Klasse schreibt deshalb
 * zwei Dinge, die beide echt sind:
 *
 *  - eine Zeile auf `stderr`, in einer Form, die sich greppen laesst. Auf
 *    Vercel landet sie in den Funktionsprotokollen; das ist der Ort, an dem
 *    heute jemand nachsehen KANN.
 *  - `job_lauf.ergebnis = 'fehler'` — das schreibt der Runner selbst, und
 *    deshalb steht der Ausfall in der Datenbank und nicht nur in einem
 *    Protokoll, das rotiert.
 *
 * **Der Weg nach draussen ist der zweite Empfaenger** (`PostfachAlarm`,
 * V-374, D-823): eine E-Mail an das Betriebspostfach der Gruppe — aber nur,
 * wenn ein Postausgang wirklich verbunden ist (`EmailDienst.verbunden`) und
 * der Betreiber die Adresse eingetragen hat (`CSE_ALARM_POSTFACH`). Fehlt
 * eines davon, geht nichts hinaus, und die Betriebsansicht sagt „nicht
 * verbunden" und warum (`alarmKanal`). Kein Versand wird vorgetaeuscht.
 *
 * // TODO(client, O-354): Voreinstellung — ein Alarm je endgueltig
 * gescheitertem Lauf (nach den Wiederholungen des Runners) und je Lauf mit
 * fehlerhaften Mandanten; geweckt wird niemand, die Gruppe hat keinen
 * Bereitschaftsdienst. Der Alarm steht in der Betriebsansicht
 * (`/einstellungen/betrieb`), im Funktionsprotokoll und in `job_lauf`, und
 * per E-Mail an das Betriebspostfach, sobald Postausgang (O-116, O-501) und
 * Adresse (Betreiberdaten) eingetragen sind. D-799, D-823.
 */
import type { Alarm } from './runner.js';
import type { EmailDienst } from '../versand/email.js';

export class ProtokollAlarm implements Alarm {
  melde(job: string, laufId: string, fehler: string, versuche: number): Promise<void> {
    /*
     * Eine Zeile, maschinenlesbar, mit dem Praefix `JOB-ALARM` — damit sich
     * ein Filter darauf setzen laesst, ohne dass jemand die Formulierung
     * raten muss. `console.error` und nicht `console.log`: der Unterschied
     * entscheidet auf den meisten Plattformen, ob eine Meldung als Stoerung
     * gilt.
     */
    console.error(JSON.stringify({
      ereignis: 'JOB-ALARM', job, laufId, versuche, fehler,
    }));
    return Promise.resolve();
  }
}

/**
 * Das Betriebspostfach der Gruppe — Betreiberdatum, aus der Umgebung
 * (`CSE_ALARM_POSTFACH`). Leer oder keine Adresse: `null`, und dann geht kein
 * Alarm per E-Mail hinaus.
 */
export function betriebspostfach(
  umgebung: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  const roh = (umgebung['CSE_ALARM_POSTFACH'] ?? '').trim();
  return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/iu.test(roh) ? roh : null;
}

/** Wohin ein Alarm heute ausserdem geht — die Auskunft der Betriebsansicht. */
export type AlarmKanal =
  | { readonly verbunden: true; readonly an: string; readonly dienst: string }
  | { readonly verbunden: false; readonly grund: 'kein_postausgang' | 'kein_postfach' };

export function alarmKanal(email: EmailDienst, an: string | null): AlarmKanal {
  if (!email.verbunden) return { verbunden: false, grund: 'kein_postausgang' };
  if (an === null) return { verbunden: false, grund: 'kein_postfach' };
  return { verbunden: true, an, dienst: email.name };
}

/**
 * Der zweite Empfaenger: eine E-Mail an das Betriebspostfach — nur über einen
 * verbundenen Postausgang. Ein Fehler beim Senden faellt nicht auf den Lauf
 * zurueck (der ist schon gescheitert); er steht als eigene Zeile im
 * Funktionsprotokoll.
 */
export class PostfachAlarm implements Alarm {
  constructor(private readonly email: EmailDienst, private readonly an: string | null) {}

  async melde(job: string, laufId: string, fehler: string, versuche: number): Promise<void> {
    const kanal = alarmKanal(this.email, this.an);
    if (!kanal.verbunden) return;
    try {
      await this.email.sende({
        an: kanal.an,
        betreff: `Nachtlauf gescheitert: ${job}`,
        text: `Der Lauf ${job} ist gescheitert (Lauf ${laufId}, ${String(versuche)} `
          + `Versuch${versuche === 1 ? '' : 'e'}).\n\n${fehler}\n\n`
          + 'Einzelheiten stehen in der Betriebsansicht (Einstellungen › Betrieb) und im '
          + 'Nachtlauf-Protokoll. Geweckt wird niemand; diese Nachricht ist die Meldung.',
      });
    } catch (versand: unknown) {
      console.error(JSON.stringify({
        ereignis: 'JOB-ALARM-POSTFACH', job, laufId,
        fehler: versand instanceof Error ? versand.message : String(versand),
      }));
    }
  }
}

/** Mehrere Empfaenger; scheitert einer, erreichen die uebrigen ihr Ziel trotzdem. */
export class MehrfachAlarm implements Alarm {
  private readonly alarme: readonly Alarm[];

  constructor(...alarme: readonly Alarm[]) {
    this.alarme = alarme;
  }

  async melde(job: string, laufId: string, fehler: string, versuche: number): Promise<void> {
    for (const a of this.alarme) {
      try {
        await a.melde(job, laufId, fehler, versuche);
      } catch (f: unknown) {
        console.error(JSON.stringify({
          ereignis: 'JOB-ALARM-EMPFAENGER', job, laufId,
          fehler: f instanceof Error ? f.message : String(f),
        }));
      }
    }
  }
}

/** Der Alarm eines Laufs: Funktionsprotokoll immer, Betriebspostfach, wo verbunden. */
export function alarmFuerLauf(email: EmailDienst, an: string | null): Alarm {
  return new MehrfachAlarm(new ProtokollAlarm(), new PostfachAlarm(email, an));
}
