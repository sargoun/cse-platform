import { registriere, type JobDefinition } from './registry.js';
import type { Abfrage } from '../benachrichtigung/ablage.js';
import {
  SocialFehler, type SchreibZugriff, veroeffentliche,
} from '../services/social/dienst.js';

/**
 * Der Lauf, der geplante Beiträge zu ihrer Zeit hinausgibt (SOC-03).
 *
 * **Er veröffentlicht über DENSELBEN Dienst wie der Knopf.** Das ist der
 * ganze Grund, warum `veroeffentliche` einen schmalen Zugriff verlangt und
 * nicht eine Sitzung: eine zweite Fassung des Wegs nach draussen im Lauf wäre
 * zwei Wege, und der eine bliebe beim nächsten Umbau zurück — mit dem
 * Unterschied, dass niemand ihn drückt und deshalb niemand merkt, dass er
 * anders geworden ist.
 *
 * **Er entscheidet nichts.** Was er hinausgibt, hat ein Mensch freigegeben
 * (SOC-08) und ein Mensch auf diesen Zeitpunkt gelegt. Der Lauf prüft nur die
 * Uhr — und zwar die des Servers (Invariante 5).
 *
 * **Ein nicht verbundener Kanal bricht ihn nicht ab.** Er ist ein bekannter
 * Zustand: der Beitrag steht danach auf der eigenen Seite, und am Kanal steht,
 * dass dort nichts ankam (SOC-07). Was ihn abbricht, ist ein echter Fehler —
 * und dann bleibt der Beitrag geplant und kommt beim nächsten Lauf wieder.
 *
 * **Alle fünf Minuten.** Ein Beitrag auf 09:00 gelegt und ein Lauf zur vollen
 * Stunde erschiene irgendwann zwischen 09:00 und 10:00; das wäre keine
 * Planung, sondern eine Spanne — dieselbe Überlegung wie beim
 * Einspruchsfenster.
 */
export function registriereSocialPlan(db: Abfrage): JobDefinition {
  return registriere({
    schluessel: 'social_plan',
    bezeichnung: 'Geplante Beiträge veröffentlichen (SOC-03)',
    zeitplan: '*/5 * * * *',
    bereich: 'uebergreifend',
    versuche: 2,
    ausfuehren: async () => {
      const faellig = (await db.unsafe(
        `select id from beitrag
          where status = 'geplant' and geplant_fuer is not null and geplant_fuer <= now()
          order by geplant_fuer
          limit 50`)) as readonly { id: string }[];

      /*
       * Der Lauf hat keine Sitzung. `benutzerId: null` sagt das so: eine
       * Aenderung ohne Menschen dahinter traegt keinen Namen, und einen
       * erfundenen einzutragen waere schlimmer als keiner.
       */
      const zugriff: SchreibZugriff = {
        abfrage: async <T,>(sql: string, werte: readonly unknown[] = []) =>
          (await db.unsafe(sql, werte as never[])) as readonly T[],
        schreibe: async <T,>(sql: string, werte: readonly unknown[] = []) =>
          (await db.unsafe(sql, werte as never[])) as readonly T[],
        benutzerId: null,
      };

      let hinaus = 0;
      let liegenGeblieben = 0;
      let gescheitert = 0;
      const gruende: string[] = [];

      for (const z of faellig) {
        try {
          /*
           * Ohne kanonische Basis kein absoluter Link -- und kein geratener:
           * der Lauf hat keine Anfrage, aus der er einen Wirt lesen koennte.
           * `CSE_KANONISCHE_BASIS` ist die einzige Quelle, die er hat (O-08).
           */
          const basis = process.env['CSE_KANONISCHE_BASIS'] ?? null;
          const adresse = basis === null || basis === ''
            ? null
            : `${basis.replace(/\/+$/u, '')}/beitrag/${z.id}`;
          const ergebnis = await veroeffentliche(zugriff, z.id, adresse);
          hinaus += 1;
          liegenGeblieben += ergebnis.kanaele
            .filter((k) => k.ergebnis === 'nicht_verbunden').length;
          gescheitert += ergebnis.kanaele
            .filter((k) => k.ergebnis === 'fehlgeschlagen').length;
        } catch (fehler: unknown) {
          /*
           * **Ein abgewiesener Beitrag nimmt die uebrigen nicht mit.** Ein
           * Zustand, der sich zwischen Auswahl und Ausfuehrung geaendert hat
           * (jemand hat gerade zurueckgenommen), ist kein Vorfall -- er steht
           * im Laufprotokoll und der naechste Beitrag ist an der Reihe.
           */
          if (!(fehler instanceof SocialFehler)) throw fehler;
          gruende.push(`${z.id}: ${fehler.grund}`);
        }
      }

      return {
        faellig: faellig.length,
        veroeffentlicht: hinaus,
        kanaele_nicht_verbunden: liegenGeblieben,
        kanaele_fehlgeschlagen: gescheitert,
        abgewiesen: gruende,
      };
    },
  });
}
