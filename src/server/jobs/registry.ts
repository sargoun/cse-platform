/**
 * Das Job-Register (SPEC §14).
 *
 * Ein Job wird REGISTRIERT, nicht aufgerufen. Der Unterschied ist Akzeptanz
 * (4): wer einen Job ohne erklaerten Mandantenbezug registriert, bekommt einen
 * Fehler — nicht beim ersten Lauf um drei Uhr nachts, sondern beim
 * Registrieren, wo jemand hinschaut.
 *
 * n8n fuehrt hier keine Geschaeftslogik aus. Es klebt externe Systeme
 * aneinander; was die Plattform entscheidet, entscheidet die Plattform.
 */

export type JobBereich =
  /** Laeuft je Mandant, einmal pro Mandant. Das Ergebnis geht nach `job_lauf_mandant`. */
  | 'je_mandant'
  /** Laeuft einmal ueber alle Mandanten und weiss das. */
  | 'uebergreifend'
  /** Beruehrt gar keine Mandantendaten (Aufraeumen, Telemetrie-Purge). */
  | 'plattform';

export interface JobKontext {
  /** Bei `je_mandant` gesetzt, sonst null. */
  readonly mandantId: string | null;
  readonly laufId: string;
  readonly versuch: number;
}

export interface JobDefinition {
  readonly schluessel: string;
  readonly bezeichnung: string;
  /** 5-Feld-Cron, UTC. */
  readonly zeitplan: string;
  readonly bereich: JobBereich;
  /**
   * Wie oft wiederholt wird, bevor der Lauf als `fehler` gilt. `0` heisst:
   * ein Versuch. Es gibt kein "unendlich" — ein Job, der ewig wiederholt,
   * stirbt nicht, er faellt nur nie auf.
   */
  readonly versuche: number;
  readonly ausfuehren: (kontext: JobKontext) => Promise<Record<string, unknown>>;
}

export class JobRegistrierungsFehler extends Error {
  constructor(nachricht: string) {
    super(nachricht);
    this.name = 'JobRegistrierungsFehler';
  }
}

const REGISTER = new Map<string, JobDefinition>();

const CRON = /^(\S+\s+){4}\S+$/u;

/**
 * Registriert einen Job. Wirft, wenn etwas fehlt, das spaeter niemand
 * bemerken wuerde.
 */
export function registriere(job: JobDefinition): JobDefinition {
  if (!/^[a-z][a-z0-9_]{2,63}$/u.test(job.schluessel)) {
    throw new JobRegistrierungsFehler(`Ungueltiger Job-Schluessel: ${job.schluessel}`);
  }
  if (REGISTER.has(job.schluessel)) {
    throw new JobRegistrierungsFehler(`Job ${job.schluessel} ist bereits registriert.`);
  }
  if (!CRON.test(job.zeitplan)) {
    throw new JobRegistrierungsFehler(
      `Zeitplan "${job.zeitplan}" ist kein 5-Feld-Cron. Zeitplaene laufen in UTC.`,
    );
  }
  // Akzeptanz (4): der Bereich ist Pflicht, und `uebergreifend` muss man
  // hinschreiben. Ein Job ohne erklaerten Mandantenbezug ist einer, bei dem
  // niemand entschieden hat, ob er Mandantengrenzen ueberschreitet.
  if (!(['je_mandant', 'uebergreifend', 'plattform'] as const).includes(job.bereich)) {
    throw new JobRegistrierungsFehler(
      `Job ${job.schluessel} erklaert keinen Mandantenbezug. `
      + 'je_mandant | uebergreifend | plattform — eines davon, ausdruecklich.',
    );
  }
  if (job.versuche < 0 || job.versuche > 10) {
    throw new JobRegistrierungsFehler(
      `Job ${job.schluessel}: versuche muss zwischen 0 und 10 liegen. `
      + 'Ein Job, der ewig wiederholt, stirbt nicht — er faellt nur nie auf.',
    );
  }
  REGISTER.set(job.schluessel, job);
  return job;
}

export function jobs(): readonly JobDefinition[] {
  return [...REGISTER.values()];
}

export function finde(schluessel: string): JobDefinition | undefined {
  return REGISTER.get(schluessel);
}

/** Nur fuer Tests. */
export function leereRegister(): void {
  REGISTER.clear();
}
