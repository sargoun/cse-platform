import { registriere, type JobDefinition } from './registry.js';
import { alsJobSitzung, type JobVerbindung } from './sitzung.js';
import { pruefeAbgleich, type Drift } from '../services/zeit/stundenkonto.js';

/**
 * **Der nächtliche Abgleich des Stundenkontos gegen sein Journal** (V-073,
 * EMP-04, §12.2 — analog FIN-06).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `pruefeAbgleich` steht seit `0060` im Dienst, trägt im Kopf ausdrücklich
 * „(`job:stundenkonto_abgleich`, naechtlich)" und ist in
 * `tests/isolation/stundenkonto.test.ts` geprüft. **Den Lauf gab es nicht.**
 * Eine Wache ohne Uhr ist eine Funktion, die niemand ruft — derselbe Befund
 * wie beim Kettenprüfer (FIN-06) und bei der Nachtragswache (BAU-04), und
 * jedes Mal fiel er niemandem auf, weil eine nicht laufende Prüfung keine
 * Meldung erzeugt und damit aussieht wie eine, die nichts findet.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Was er tut — und was ausdrücklich nicht.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Er MELDET und korrigiert nicht. Ein Konto, dessen Summe von seinem Journal
 * abweicht, ist ein Befund: entweder hat etwas an `bewegung_summe` vorbei
 * geschrieben, oder eine Buchung fehlt. Beides will man sehen. Ein Lauf, der
 * die Zahl still geradezieht, macht aus dem Befund eine Statistik, die immer
 * sauber ist — und aus dem Guthaben eines Menschen eine Zahl, die sich nachts
 * von selbst ändert.
 *
 * Dass die Abweichung heute gar nicht erst entstehen KANN, ist kein Grund,
 * ihn wegzulassen: `stundenkonto_summe` weist sie im laufenden Betrieb ab,
 * aber nicht das, was ein Wartungszugang oder eine künftige Migration
 * schreibt. Genau dafür ist er da.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Drei Entscheidungen, die man sonst für Kleinigkeiten hält.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **1. `mandantId` als FILTER, obwohl der Binder den Mandanten setzt.** Unter
 * `cse_job` greift `t_job … using (true)` (0060) — die RLS grenzt hier NICHT
 * ein. Ein `je_mandant`-Lauf ohne den Filter meldete in jedem Durchgang die
 * Abweichungen aller vier Gesellschaften, also viermal dieselbe, und jede
 * unter dem falschen Namen.
 *
 * **2. `versuche: 0`.** Eine Abweichung wird beim zweiten Hinsehen nicht
 * kleiner. Was ein Wiederholungsversuch kaufte, ist Verzögerung zwischen Fund
 * und Meldung.
 *
 * **3. Nach dem Monatswechsel-Lauf und vor dem Arbeitstag.** Geprüft wird der
 * Stand, mit dem die Personalstelle morgens anfängt — nicht einer von
 * mittendrin, an dem gerade gebucht wird.
 */

export class KontoDriftGefunden extends Error {
  constructor(text: string) {
    super(text);
    this.name = 'KontoDriftGefunden';
  }
}

/**
 * Der Satz zum Befund — mit ZAHLEN, nicht mit „es gibt Abweichungen".
 *
 * Die Meldung landet in `job_lauf_mandant`, und wer sie morgens liest, soll
 * ohne eine zweite Abfrage wissen, wo er nachsieht.
 */
export function meldung(driften: readonly Drift[]): string {
  const erste = driften.slice(0, 5).map((d) =>
    `${String(d.jahr)}-${String(d.monat).padStart(2, '0')} `
    + `(Anstellung ${d.anstellungId}): Konto ${String(d.istMinutenKonto)} min, `
    + `Journal ${String(d.istMinutenJournal)} min`);
  const rest = driften.length > erste.length
    ? ` … und ${String(driften.length - erste.length)} weitere`
    : '';
  return `${String(driften.length)} Stundenkonto/-konten weichen von ihrem Journal ab: `
    + `${erste.join('; ')}${rest}`;
}

export function registriereStundenkontoAbgleich(sql: JobVerbindung): JobDefinition {
  return registriere({
    schluessel: 'stundenkonto_abgleich',
    bezeichnung: 'Nächtlicher Abgleich Stundenkonto ↔ Journal (EMP-04, §12.2)',
    zeitplan: '40 3 * * *',
    bereich: 'je_mandant',
    versuche: 0,
    ausfuehren: async (kontext): Promise<Record<string, unknown>> => {
      if (kontext.mandantId === null) {
        throw new Error(
          'stundenkonto_abgleich ist je_mandant und braucht einen Mandanten.');
      }
      const mandantId = kontext.mandantId;
      const driften = await alsJobSitzung(sql, mandantId, async (db) =>
        pruefeAbgleich(db, { mandantId }));
      if (driften.length > 0) throw new KontoDriftGefunden(meldung(driften));
      return { geprueft: 'ohne Abweichung', abweichungen: 0 };
    },
  });
}
