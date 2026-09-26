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

/**
 * **Der Schwanz des Einsatzstatus** (V-082, TIM-01).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Was der Auslöser NICHT sehen kann.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `kern.einsatz_status_ableiten` (`0390`) zieht den Zustand einer Schicht bei
 * jedem Stempeln, Beenden, Stornieren und Nacherfassen nach — und das deckt
 * alles ab, was ein Mensch tut. Es deckt eines NICHT ab: die Uhr.
 *
 * Wer um 11:00 aus einer Schicht bis 14:00 aussteigt, lässt eine Schicht
 * zurück, die keinen offenen Eintrag mehr hat und deren Ende noch bevorsteht.
 * Sie steht auf `laufend` — richtig in dieser Minute — und danach stempelt
 * niemand mehr, also feuert auch kein Auslöser mehr. Um 14:01 wäre sie
 * `abgeschlossen`, und niemand sagt es ihr.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Lauf rechnet NICHTS Eigenes.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Er ruft dieselbe Ableitung, die der Auslöser ruft — für die Schichten,
 * deren Ende gerade vorbeigegangen ist. Eine zweite Formulierung derselben
 * Regel wäre eine zweite Wahrheit, und `04-PLANUNG-ZEIT.md` sagt an dieser
 * Tabelle selbst, was daraus wird: „two sources of truth would drift within
 * one sprint".
 *
 * **Stündlich und nicht nächtlich.** Eine Schicht, die um 14:00 endet, soll
 * um 15:00 abgeschlossen dastehen und nicht am nächsten Morgen: die
 * Disposition liest diese Liste im Lauf des Tages.
 *
 * **Ein Fenster von zwei Tagen.** Der Lauf ist stündlich; er rollt nicht die
 * halbe Vergangenheit auf, sondern nur, was seit dem letzten Lauf fällig
 * geworden sein kann — mit reichlich Rand für einen ausgefallenen Lauf.
 * Dieselbe Überlegung wie bei `schicht_ohne_zeiteintrag` (sieben Tage dort,
 * weil die Meldung sonst ausbliebe; hier genügt weniger, weil ein verpasster
 * Lauf nur eine Anzeige verzögert).
 */
export function registriereEinsatzAbschluss(sql: JobVerbindung): JobDefinition {
  return registriere({
    schluessel: 'einsatz_abschluss',
    bezeichnung: 'Beendete Schichten auf „abgeschlossen" nachziehen (V-082, TIM-01)',
    /* Zur Viertelstunde: nicht mit `schicht_ohne_zeiteintrag` (:30) kollidieren. */
    zeitplan: '15 * * * *',
    bereich: 'uebergreifend',
    versuche: 2,
    ausfuehren: async (): Promise<Record<string, unknown>> =>
      alsJobRolle(sql, async (db) => {
        /*
         * Gesucht wird nach dem, was die Ableitung ÄNDERN würde: eine Schicht,
         * die vorbei ist, auf `laufend` oder `geplant` steht und mindestens
         * einen nicht stornierten Eintrag ohne offenes Ende trägt. Die
         * Ableitung selbst entscheidet danach noch einmal — sie ist die eine
         * Stelle, an der die Regel steht.
         */
        const kandidaten = await db.abfrage<{ id: string }>(
          `select e.id
             from einsatz e
            where e.status in ('geplant', 'laufend')
              and e.storniert_am is null
              and e.ende_zeitpunkt < now()
              and e.ende_zeitpunkt > now() - interval '2 days'
              and exists (select 1 from zeiteintrag z
                           where z.einsatz_id = e.id
                             and z.storniert_am is null
                             and z.status <> 'storniert')
            order by e.ende_zeitpunkt
            limit 2000`);
        for (const k of kandidaten) {
          await db.abfrage(`select kern.einsatz_status_ableiten($1::uuid)`, [k.id]);
        }
        return { geprueft: kandidaten.length };
      }, { nurLesen: false }),
  });
}
