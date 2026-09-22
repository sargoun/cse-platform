import { registriere, type JobDefinition } from './registry.js';
import { alsJobRolle, alsJobSitzung, type JobVerbindung } from './sitzung.js';

/**
 * Der Lauf, der jedem Beschäftigten sein Stundenkonto des Monats öffnet
 * (V-008, EMP-04, §12.2).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund: `eroeffneKonto` hatte keinen einzigen Aufrufer.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Jedes Stundenkonto der Plattform entstand im Seed. `bucheFreigegebeneZeiten`
 * wirft `KontoFehltFehler`, wenn es keines gibt; `bucheKorrektur` ebenso. Am
 * 1. Januar wäre damit für jeden Menschen die Zeitbuchung gescheitert — nicht
 * laut, sondern als Fehler in einem Nachtlauf, den niemand liest.
 *
 * Der Kommentar an `saldo_vortrag_minuten` verwies seit je auf
 * `job:konten_rollover`. Diese Datei ist er.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Was er tut — und wovon er die Finger lässt.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  * **Er öffnet, was fehlt.** Je aktiver Anstellung das Konto des laufenden
 *    Berliner Monats, idempotent (`on conflict do nothing`). Ein zweiter Lauf
 *    am selben Tag ändert nichts.
 *  * **Er trägt den Vortrag nach, wenn der Vormonat gesperrt ist.** Nicht,
 *    weil er rechnet: `saldo_minuten` ist eine generierte Spalte. Er reicht
 *    die fertige Zahl weiter, und zwar nur in ein OFFENES Konto.
 *  * **Er setzt keine Sollzeit.** Welche Sollstunden ein Monat hat, ist offen
 *    (O-18) — eine hergeleitete Zahl sähe aus wie eine hinterlegte und würde
 *    zur Grundlage eines Saldos, den niemand vereinbart hat. `soll_minuten`
 *    bleibt 0, und die Oberfläche sagt „nicht hinterlegt".
 *  * **Er sperrt nichts.** Einen Monat abzuschliessen ist eine Entscheidung
 *    eines Menschen mit `zeit.konto_abschliessen`, kein Nachtlauf — und sie
 *    ist unumkehrbar.
 *
 * **Am ersten des Monats um 00:30 Berliner Zeit, und zusätzlich täglich.**
 * Der erste Lauf öffnet die Konten des neuen Monats; der tägliche fängt die
 * Anstellung ab, die am 12. beginnt. Ein Konto, das erst am nächsten Ersten
 * entstünde, liesse die Zeiten der ersten drei Wochen ins Leere buchen.
 *
 * **`app.berlin_heute()` und nicht `current_date`** (V-103): zwischen 23:00
 * und 24:00 UTC ist in Berlin schon der Folgetag — und am Monatsletzten wäre
 * das der falsche Monat.
 */
export function registriereKontenRollover(db: JobVerbindung): JobDefinition {
  return registriere({
    schluessel: 'konten_rollover',
    bezeichnung: 'Stundenkonten des laufenden Monats öffnen und Vortrag setzen (EMP-04)',
    zeitplan: '30 0 * * *',
    bereich: 'uebergreifend',
    versuche: 2,
    ausfuehren: async () => {
      /*
       * Gefunden wird als `cse_job` ueber alle Gesellschaften, geschrieben je
       * Mandant in dessen Sitzung — dieselbe Bauart wie `bewerberLoeschung`.
       * Ueber die rohe Verbindung ginge es in CI gut (Superuser) und faende
       * in einer Auslieferung null Zeilen.
       */
      const offen = await alsJobRolle(db, (jd) => jd.abfrage<{
        mandant_id: string; anstellung_id: string;
        jahr: number; monat: number;
        vortrag: number | null;
      }>(
        `with heute as (select app.berlin_heute() as tag)
         select a.mandant_id,
                a.id                                   as anstellung_id,
                extract(year  from h.tag)::int         as jahr,
                extract(month from h.tag)::int         as monat,
                (select k.saldo_minuten
                   from stundenkonto k
                  where k.anstellung_id = a.id
                    and k.status = 'gesperrt'
                    and make_date(k.jahr, k.monat, 1)
                        = date_trunc('month', h.tag)::date - interval '1 month'
                  limit 1)                             as vortrag
           from anstellung a
           cross join heute h
          where a.geloescht_am is null
            and a.status = 'aktiv'
            and not exists (
                  select 1 from stundenkonto k
                   where k.anstellung_id = a.id
                     and k.jahr  = extract(year  from h.tag)::int
                     and k.monat = extract(month from h.tag)::int)
          order by a.mandant_id, a.id
          limit 5000`));

      const jeMandant = new Map<string, typeof offen>();
      for (const z of offen) {
        jeMandant.set(z.mandant_id, [...(jeMandant.get(z.mandant_id) ?? []), z]);
      }

      let eroeffnet = 0;
      let mitVortrag = 0;

      for (const [mandantId, zeilen] of jeMandant) {
        await alsJobSitzung(db, mandantId, async (jd) => {
          for (const z of zeilen) {
            /*
             * `on conflict do nothing` und nicht „erst pruefen, dann
             * schreiben": zwei gleichzeitige Laeufe saehen beide kein Konto.
             * Die Eindeutigkeit `(anstellung_id, jahr, monat)` entscheidet,
             * nicht die Reihenfolge.
             */
            const zeile = await jd.abfrage<{ id: string }>(
              `insert into stundenkonto
                 (mandant_id, anstellung_id, jahr, monat, soll_minuten,
                  saldo_vortrag_minuten)
               values ($1, $2, $3, $4, 0, coalesce($5::int, 0))
               on conflict (anstellung_id, jahr, monat) do nothing
               returning id`,
              [mandantId, z.anstellung_id, z.jahr, z.monat, z.vortrag]);
            if (zeile.length > 0) {
              eroeffnet += 1;
              if (z.vortrag !== null && Number(z.vortrag) !== 0) mitVortrag += 1;
            }
          }
        }, {
          /*
           * **`nurLesen: false` — dieser Lauf SCHREIBT** (V-119).
           *
           * `alsJobSitzung` setzt `app.readonly` sonst auf `on`, und die
           * Policy `j_konto_anlegen` (0380) verlangt `not app.ist_readonly()`.
           * Ohne diese Zeile scheitert der Lauf sichtbar — was besser ist,
           * als still nichts zu tun, und genau deshalb steht die Bedingung
           * in der Policy.
           */
          nurLesen: false,
        });
      }

      return {
        gepruefte_anstellungen: offen.length,
        eroeffnet,
        mit_vortrag: mitVortrag,
        /*
         * Die Zahl ohne Vortrag ist keine Warnung: die allermeisten Monate
         * beginnen bei null, weil der Vormonat noch offen ist. Sie steht im
         * Protokoll, damit die andere Zahl einen Bezug hat.
         */
        ohne_vortrag: eroeffnet - mitVortrag,
      };
    },
  });
}
