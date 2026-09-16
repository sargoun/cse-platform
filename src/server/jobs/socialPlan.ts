import { registriere, type JobDefinition } from './registry.js';
import { alsJobRolle, alsJobSitzung, type JobVerbindung } from './sitzung.js';
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
export function registriereSocialPlan(db: JobVerbindung): JobDefinition {
  return registriere({
    schluessel: 'social_plan',
    bezeichnung: 'Geplante Beiträge veröffentlichen (SOC-03)',
    zeitplan: '*/5 * * * *',
    bereich: 'uebergreifend',
    versuche: 2,
    ausfuehren: async () => {
      /*
       * **Gefunden wird als `cse_job`, gearbeitet je Mandant.**
       *
       * Vorher lief beides ueber die rohe Verbindung. Das ging in CI und im
       * Seed gut, weil dort `postgres` in `DATABASE_URL` steht — ein
       * Superuser mit `BYPASSRLS`. In einer Auslieferung mit der
       * Anwendungsrolle haette derselbe Lauf NULL Zeilen gefunden und brav
       * `faellig: 0` gemeldet, jede Nacht, ohne ein einziges rotes Zeichen.
       * Die `j_*`-Policies aus 0163 stehen genau fuer diesen Fall bereit
       * (`to cse_job`, `using (true)`) — sie mussten nur benutzt werden.
       */
      const faellig = await alsJobRolle(db, (jd) => jd.abfrage<{
        id: string; mandant_id: string;
      }>(
        `select id, mandant_id from beitrag
          where status = 'geplant' and geplant_fuer is not null and geplant_fuer <= now()
          order by geplant_fuer
          limit 50`));

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
          /*
           * **Je Beitrag eine Sitzung mit SEINEM Mandanten.**
           *
           * Der Riegel aus 0163 fragt beim Veroeffentlichen
           * `app.freigabe_genehmigt` — einen Definer, dessen Policy auf
           * `freigabe` den aktiven Mandanten verlangt. Ohne ihn saehe er null
           * Zeilen und der Riegel schloesse: der Lauf koennte nie
           * veroeffentlichen, und zwar aus einem Grund, der wie „keine
           * Freigabe" aussaehe.
           *
           * `nurLesen: false`, weil dieser Lauf schreibt — und das steht
           * hier, wie es `BinderOptionen` verlangt: er setzt den Beitrag auf
           * `veroeffentlicht` und traegt je Kanal das Ergebnis ein.
           */
          const ergebnis = await alsJobSitzung(db, z.mandant_id, async (jd) => {
            /*
             * Der Lauf hat keine Sitzung. `benutzerId: null` sagt das so:
             * eine Aenderung ohne Menschen dahinter traegt keinen Namen, und
             * einen erfundenen einzutragen waere schlimmer als keiner.
             */
            const zugriff: SchreibZugriff = {
              abfrage: jd.abfrage.bind(jd),
              schreibe: jd.abfrage.bind(jd),
              benutzerId: null,
            };
            return veroeffentliche(zugriff, z.id, basis);
          }, { nurLesen: false });
          hinaus += 1;
          liegenGeblieben += ergebnis.kanaele
            .filter((k) => k.ergebnis === 'nicht_verbunden').length;
          /*
           * **Ein gescheiterter Kanal wird BENANNT, nicht gezaehlt.**
           *
           * Am Knopf sieht ihn ein Mensch: die Beitragsseite zeigt je Kanal
           * das Ergebnis und die Meldung. Im Lauf sieht ihn niemand — hier
           * stand nur eine Zahl, und „kanaele_fehlgeschlagen: 1" im
           * Laufprotokoll sagt nicht, welcher Beitrag auf welcher Plattform
           * nicht ankam. Wer das nachts liest, muesste erst suchen; wer es
           * nicht liest, erfaehrt es nie.
           *
           * Ein nicht verbundener Kanal bleibt eine Zahl: der ist ein
           * bekannter Zustand (O-10) und steht bei jedem Beitrag gleich da.
           */
          const schlecht = ergebnis.kanaele.filter((k) => k.ergebnis === 'fehlgeschlagen');
          gescheitert += schlecht.length;
          for (const k of schlecht) {
            gruende.push(`${z.id}: Kanal ${k.plattform} fehlgeschlagen — ${k.meldung ?? 'ohne Meldung'}`);
          }
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
        /*
         * Abgewiesene Beitraege UND gescheiterte Kanaele — beides sind Saetze
         * und keine Zahlen, weil beides jemanden zu einer Stelle fuehren muss.
         */
        abgewiesen: gruende,
      };
    },
  });
}
