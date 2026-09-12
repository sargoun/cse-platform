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

/**
 * **Was hier NOCH NICHT steht, und warum — damit niemand es fuer erledigt
 * haelt.**
 *
 * SPEC §14 nennt acht Waechter. Vier laufen (oben). Von den uebrigen vier ist
 * einer vollstaendig gebaut und trotzdem nicht registriert:
 *
 *   `src/server/services/finanz/kettenlauf.ts` — der naechtliche
 *   Hashketten-Pruefer (FIN-06, LEG-01). Der Dienst ist fertig und geprueft,
 *   und 0101 hat `cse_job` die Leserechte auf `rechnung_snapshot` und
 *   `rechnung_hash` nachgezogen, die 0077 ihm schon gewaehrt hatte.
 *
 * Es fehlt eine Sache, und sie ist keine Kleinigkeit: `pruefeKette` filtert
 * ueber `app.aktiver_mandant()`, braucht also eine GEBUNDENE Sitzung. Ein
 * Job hat keine — `JobKontext` reicht eine `mandantId` durch, aber niemand
 * setzt daraus die Sitzungsvariablen, und `cse_job` ist nicht `cse_app`. Den
 * Pruefer heute einzutragen hiesse, einen Lauf zu registrieren, der jede
 * Nacht null Rechnungen prueft und „ok" meldet — schlimmer als kein Pruefer,
 * weil eine gruene Meldung Vertrauen schafft, das sie nicht deckt.
 *
 * Der richtige Schritt ist ein Sitzungsbinder fuer `je_mandant`-Jobs; das ist
 * eine eigene Runde mit eigenen Tests. Die drei weiteren Waechter (Schicht
 * beendet ohne Zeiteintrag, morgige Schicht unbesetzt, Rechnung ueber 14 Tage
 * faellig) haengen an Diensten, die es noch nicht gibt.
 *
 * // TODO(client, O-357): Sollen die Waechter-Meldungen aus SPEC §14 in den
 * Posteingang, per Mail oder beides — und wer bekommt die Kettenmeldung,
 * deren Empfaenger nicht die Person, sondern die Buchhaltung ist?
 */
