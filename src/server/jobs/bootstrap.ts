/**
 * Wo die Jobs tatsaechlich entstehen — der Teil, der fehlte.
 *
 * **Der Befund, der hierher fuehrte.** Es gab ein Register, einen Runner,
 * ein Laufprotokoll gegen Postgres und vier Jobdefinitionen — und keine
 * einzige Stelle ausserhalb der Tests, die sie registriert. `jobs()` war in
 * Produktion also leer: der Dienstplan materialisierte sich nie, Konflikte
 * wurden nie erkannt, Nachweise liefen unbemerkt ab. Jede einzelne Datei war
 * gebaut und geprueft; zusammen taten sie nichts.
 *
 * Das ist die teuerste Sorte Luecke, weil sie nirgends rot wird. Ein Test,
 * der einen Job direkt registriert und ausfuehrt, ist gruen — er beweist,
 * dass der Job funktioniert, und sagt nichts darueber, ob ihn jemand aufruft.
 *
 * **Einmal je Prozess.** `registriere()` wirft beim zweiten Mal mit demselben
 * Schluessel, und das soll es auch: ein doppelt registrierter Job ist ein
 * doppelt ausgefuehrter Job. Next.js laedt Module in der Entwicklung mehrfach
 * neu, also wird hier gemerkt, statt sich darauf zu verlassen.
 */
import { jobs, type JobDefinition } from './registry.js';
import { registriereEinsatzGenerator } from './einsaetzeGenerieren.js';
import { registriereKonfliktDetektor } from './konflikteErkennen.js';
import { registriereLeadSlaJob } from './lead-sla.js';
import { registriereNachweisWarnungen } from './nachweisWarnungen.js';

/*
 * Methodensyntax, nicht Eigenschaftssyntax — wie ueberall sonst im Baum
 * (`generator.ts`, `ablauf.ts`, `postgres-protokoll.ts`). TypeScript prueft
 * Methoden bivariant und Funktionseigenschaften streng kontravariant; mit
 * `unsafe: (…) => …` laesst sich `postgres.Sql` hier gar nicht uebergeben,
 * weil dessen Parameterliste ein veraenderliches Array verlangt.
 */
export interface Abfrage {
  unsafe(anweisung: string, werte?: readonly unknown[]): Promise<readonly unknown[]>;
}

let geschehen = false;

/**
 * Registriert alle Jobs der Plattform und gibt das Register zurueck.
 *
 * Wer einen Job baut, traegt ihn HIER ein. Eine Datei unter `jobs/`, die in
 * dieser Liste fehlt, laeuft nicht — unabhaengig davon, wie gut sie geprueft
 * ist.
 */
export function alleJobs(db: Abfrage): readonly JobDefinition[] {
  if (!geschehen) {
    registriereEinsatzGenerator(db);
    registriereKonfliktDetektor(db);
    registriereLeadSlaJob(db);
    registriereNachweisWarnungen(db);
    geschehen = true;
  }
  return jobs();
}

/** Nur fuer Tests: erlaubt ein zweites `alleJobs` nach `leereRegister()`. */
export function vergissRegistrierung(): void {
  geschehen = false;
}
