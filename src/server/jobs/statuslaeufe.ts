import { registriere, type JobDefinition } from './registry.js';
import { alsJobRolle, type JobVerbindung } from './sitzung.js';

/**
 * **Zwei Zustände, die der Kalender setzt — und niemand setzte sie** (V-085,
 * V-089).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund, zweimal in derselben Form.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **`angebot.status = 'abgelaufen'`.** `0024` legt eigens den Teilindex
 * `angebot_ablauf_idx on angebot (mandant_id, gueltig_bis) where status =
 * 'versendet'` an — ein Index für eine Abfrage, die niemand stellt. Ein
 * versendetes Angebot mit abgelaufener Frist stand für immer als offen in der
 * Liste; die Vertriebspipeline zählte es mit, und die Nachfassliste ebenso.
 *
 * **`nachweis.status = 'abgelaufen'`.** `0030` schreibt die Policy dafür
 * wörtlich hin: „Der naechtliche Statuslauf `gueltig → abgelaufen` (§12.3)".
 * Die Policy gibt es, den Lauf nicht.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Warum sie in EINER Datei stehen und trotzdem zwei Jobs sind.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Sie teilen die Bauart — ein UPDATE, das einen Zustand nachzieht, der aus
 * einem Datum folgt — und sonst nichts: verschiedene Tabellen, verschiedene
 * Rechte, verschiedene Folgen. Zwei Schlüssel im Auslöseplan heissen, dass
 * ein fehlgeschlagener Lauf den anderen nicht mitnimmt und dass im Protokoll
 * steht, WELCHER nichts gefunden hat.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Drei Dinge, die hier bewusst NICHT passieren.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **1. Keine Meldung an einen Menschen.** Ein abgelaufenes Angebot ist keine
 * Störung, sondern der Normalfall; die Ablaufwarnung für Nachweise hat ihren
 * eigenen Lauf mit 60/30/7 Tagen (EMP-08) und meldet VORHER. Ein Alarm für
 * etwas, das jede Nacht regelmässig passiert, ist ein Alarm, den nach einer
 * Woche niemand mehr liest.
 *
 * **2. Kein Rückweg.** Der Lauf setzt `versendet → abgelaufen` und
 * `gueltig → abgelaufen`, nie zurück. Eine verlängerte Frist ist eine
 * kaufmännische Entscheidung eines Menschen — und ein Nachtlauf, der einen
 * Zustand hin und her schiebt, macht aus dem Protokoll Rauschen.
 *
 * **3. Der Stichtag kommt aus der DATENBANK** (Invariante 5, K-11).
 * `current_date` im UTC-Prozess zeigt zwischen 00:00 und 02:00 Berliner Zeit
 * noch den Vortag — und genau in diesem Fenster laufen Nachtläufe. Ein
 * Angebot, das heute abläuft, wäre damit einen Tag zu früh oder gar nicht
 * abgelaufen.
 */

/** Die eine Stelle, an der der Berliner Kalendertag entsteht. */
const HEUTE = `(now() at time zone 'Europe/Berlin')::date`;

export function registriereAngebotAblauf(sql: JobVerbindung): JobDefinition {
  return registriere({
    schluessel: 'angebot_ablauf',
    bezeichnung: 'Versendete Angebote nach Fristablauf auf „abgelaufen" setzen (OPS-08)',
    /*
     * Kurz nach Mitternacht Berliner Zeit und vor dem Arbeitstag: die Liste,
     * die der Vertrieb morgens öffnet, soll schon stimmen. Die Stundenwache
     * braucht es hier nicht — der Lauf fragt den Berliner Tag selbst ab und
     * ist an jedem Tag genau einmal fällig.
     */
    zeitplan: '10 2 * * *',
    bereich: 'uebergreifend',
    versuche: 2,
    ausfuehren: async (): Promise<Record<string, unknown>> =>
      alsJobRolle(sql, async (db) => {
        const zeilen = await db.abfrage<{ id: string; mandant_id: string }>(
          `update angebot
              set status = 'abgelaufen'
            where status = 'versendet'
              and gueltig_bis is not null
              and gueltig_bis < ${HEUTE}
              and archiviert_am is null
           returning id, mandant_id`);
        return {
          abgelaufen: zeilen.length,
          gesellschaften: new Set(zeilen.map((z) => z.mandant_id)).size,
        };
      }, { nurLesen: false }),
  });
}

export function registriereNachweisAblauf(sql: JobVerbindung): JobDefinition {
  return registriere({
    schluessel: 'nachweis_ablauf',
    bezeichnung: 'Nachweise nach Fristablauf auf „abgelaufen" setzen (§12.3, EMP-08)',
    /*
     * NACH `nachweis_warnungen` (02:05) und vor dem Dienstplangenerator
     * (02:15): erst warnen, dann den Zustand nachziehen, dann planen. Umgekehrt
     * wäre die Warnung über einen Nachweis, der schon abgelaufen dasteht.
     */
    zeitplan: '10 2 * * *',
    bereich: 'uebergreifend',
    versuche: 2,
    ausfuehren: async (): Promise<Record<string, unknown>> =>
      alsJobRolle(sql, async (db) => {
        const zeilen = await db.abfrage<{ id: string }>(
          `update nachweis
              set status = 'abgelaufen'
            where status = 'gueltig'
              and gueltig_bis is not null
              and gueltig_bis < ${HEUTE}
              and widerrufen_am is null
           returning id`);
        return { abgelaufen: zeilen.length };
      }, { nurLesen: false }),
  });
}
