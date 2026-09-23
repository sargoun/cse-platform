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
import { registriereKettenpruefer } from './kettenpruefer.js';
import { registriereStundenkontoAbgleich } from './stundenkontoAbgleich.js';
import { registrierePostenabgleich } from './postenabgleich.js';
import { registriereMahnlauf } from './mahnlauf.js';
import { registriereBasiszinssatzWaechter } from './basiszinssatz.js';
import { registriereBelegarchiv } from './belegarchiv.js';
import { registriereAkquise } from './akquise.js';
import { registriereRadar } from './radar.js';
import { registriereRadarWarnungen } from './radarWarnungen.js';
import {
  registriereMorgenUnbesetzt, registriereSchichtOhneZeiteintrag,
} from './dienstplanWachen.js';
import { registriereNachtragWache } from './nachtragWache.js';
import { registriereFreigabeFenster } from './freigabeFenster.js';
import { registriereSocialPlan } from './socialPlan.js';
import { registriereBewerberLoeschung } from './bewerberLoeschung.js';
import { registriereDokumentAufbewahrung } from './dokumentAufbewahrung.js';
import { registriereKontenRollover } from './kontenRollover.js';
import { registriereUrlaubskontenJahr } from './urlaubskontenJahr.js';

/*
 * Methodensyntax, nicht Eigenschaftssyntax — wie ueberall sonst im Baum
 * (`generator.ts`, `ablauf.ts`, `postgres-protokoll.ts`). TypeScript prueft
 * Methoden bivariant und Funktionseigenschaften streng kontravariant; mit
 * `unsafe: (…) => …` laesst sich `postgres.Sql` hier gar nicht uebergeben,
 * weil dessen Parameterliste ein veraenderliches Array verlangt.
 */
export interface Abfrage {
  unsafe(anweisung: string, werte?: readonly unknown[]): Promise<readonly unknown[]>;
  /*
   * `begin` steht hier, seit der Kettenpruefer registriert ist: er braucht
   * eine TRANSAKTION, weil seine Sitzungsvariablen transaktionslokal sind
   * (`sitzung.ts`). Jeder Aufrufer von `alleJobs` reicht ohnehin eine
   * `postgres.Sql` herein, die beides kann — die Erweiterung kostet also
   * keinen Aufrufer und macht die Abhaengigkeit sichtbar.
   */
  begin<T>(rueckruf: (tx: {
    unsafe(anweisung: string, werte?: readonly unknown[]): Promise<readonly unknown[]>;
  }) => Promise<T>): Promise<T>;
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
    registriereKettenpruefer(db);
    registriereStundenkontoAbgleich(db);
    registrierePostenabgleich(db);
    registriereMahnlauf(db);
    registriereBasiszinssatzWaechter(db);
    registriereBelegarchiv(db);
    registriereRadarWarnungen(db);
    registriereSchichtOhneZeiteintrag(db);
    registriereMorgenUnbesetzt(db);
    registriereNachtragWache(db);
    registriereFreigabeFenster(db);
    registriereSocialPlan(db);
    registriereBewerberLoeschung(db);
    registriereDokumentAufbewahrung(db);
    registriereKontenRollover(db);
    registriereUrlaubskontenJahr(db);
    registriereRadar(db);
    registriereAkquise(db);
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
 * SPEC §14 nennt acht Waechter. Fuenf laufen (oben). Der Kettenpruefer
 * (`kette_pruefen`) kam zuletzt dazu; was ihn aufgehalten hatte, war keine
 * fehlende Zeile, sondern eine fehlende Sitzung: `pruefeKette` filtert ueber
 * `app.aktiver_mandant()`, und ein Job hatte keine. Beides steht jetzt —
 * `sitzung.ts` bindet den Mandanten unter `set local role cse_job`, `0108`
 * gibt `cse_job` die beiden Leserechte samt mandantengebundener Policies,
 * die ihm auf `nummernkreis` und `rechnung` fehlten.
 *
 * Die drei uebrigen Waechter — Schicht beendet ohne Zeiteintrag, morgige
 * Schicht unbesetzt, Rechnung ueber 14 Tage faellig — haengen an Diensten,
 * die es noch nicht gibt.
 *
 * **Und eine Altlast, die der Kettenpruefer sichtbar gemacht hat.** Die
 * uebrigen Jobs laufen weiterhin OHNE `set local role cse_job`: sie
 * nehmen die Rolle, die in `DATABASE_URL` steht. DREI binden sie inzwischen —
 * der Kettenpruefer, `social_plan` (D-546) und `bewerber_loeschung` (D-570);
 * der Rest nicht. Die Kommentare an vielen
 * Stellen („der Job verbindet sich als `cse_job`") beschrieben eine Absicht,
 * die nichts umsetzte — jede Policy und jedes Spaltenrecht, das seit 0012
 * fuer `cse_job` geschrieben wurde, lief bis hierher ungeprueft mit. Sie
 * umzustellen heisst, fuer jeden einzeln Rechte und Policies nachzuziehen und
 * jeden einzeln gegen die enge Rolle zu fahren; das ist eine eigene Runde mit
 * eigenen Tests, kein Nebenschritt. Siehe D-378.
 *
 * // TODO(client, O-357): Sollen die Waechter-Meldungen aus SPEC §14 in den
 * Posteingang, per Mail oder beides — und wer bekommt die Kettenmeldung,
 * deren Empfaenger nicht die Person, sondern die Buchhaltung ist?
 */
