import { registriere, type JobDefinition } from './registry.js';
import { alsJobRolle, alsJobSitzung, type JobVerbindung } from './sitzung.js';

/**
 * Der Lauf, der Bewerberdaten wirklich löscht (REC-07, LEG-11).
 *
 * **Er löscht die Nutzlast und anonymisiert die Bewerbung.** Art. 17 DSGVO
 * verlangt die Löschung, sobald der Zweck entfällt — und eine Bewerbung, die
 * nur ein `geloescht_am` bekommt und ihren Namen behält, ist nicht gelöscht.
 * Bewertungen, Kandidatendaten, Gesprächsnotizen und die Begründung einer
 * Absage sind Sätze ÜBER einen Menschen; sie verschwinden ganz. Die
 * `bewerbung` selbst bleibt als Gerippe stehen, damit die Zahl der
 * Bewerbungen je Stelle stimmt — ohne Name, E-Mail, Telefon oder Nachricht.
 *
 * Was ausserdem bleibt, ist das PROTOKOLL (`bewerbung_loeschlauf`) mit Datum
 * und Anzahl: eine Löschung ohne Nachweis wäre im Streit wertlos, und der
 * Nachweis enthält keine personenbezogenen Daten.
 *
 * **Eine Löschsperre hält, und sie braucht einen Grund im Klartext.** Eine
 * Bewerbung in einem laufenden AGG-Verfahren darf nicht verschwinden, weil
 * eine Frist abläuft; § 15 Abs. 4 AGG und die Klagefrist sind genau der Fall.
 * Gezählt wird sie trotzdem — eine Sperre, die niemand sieht, wird nie
 * aufgehoben.
 *
 * **Die Frist selbst gehört dem Mandanten** und steht als
 * `recruiting.aufbewahrung_tage` in den Plattformeinstellungen (O-373, ein
 * ausdrücklicher Platzhalter). Dieser Lauf rechnet sie nicht aus: er liest
 * `aufbewahrung_bis`, das beim Eingang gesetzt wurde. Eine Frist, die der
 * Nachtlauf selbst rechnet, änderte rückwirkend, was gestern galt.
 *
 * **Vier Uhr nachts.** Spät genug, dass der Tageswechsel durch ist, früh
 * genug, dass eine Personalstelle den Stand am Morgen sieht.
 */
export function registriereBewerberLoeschung(db: JobVerbindung): JobDefinition {
  return registriere({
    schluessel: 'bewerber_loeschung',
    bezeichnung: 'Bewerberdaten nach Ablauf der Aufbewahrung löschen (REC-07)',
    zeitplan: '0 4 * * *',
    bereich: 'uebergreifend',
    versuche: 2,
    ausfuehren: async () => {
      /*
       * **Gefunden wird als `cse_job`, gelöscht je Mandant.**
       *
       * Über die rohe Verbindung ginge es in CI gut (dort steht `postgres` in
       * `DATABASE_URL`, ein Superuser mit BYPASSRLS) und fände in einer
       * Auslieferung mit der Anwendungsrolle NULL Zeilen — der Lauf meldete
       * jede Nacht brav „0 gelöscht", ohne ein rotes Zeichen. Die
       * `j_*`-Policies aus 0166 stehen für genau diesen Fall bereit.
       */
      /*
       * **Eine EINGESTELLTE Bewerbung nimmt dieser Lauf nicht mit** (O-376).
       *
       * Das öffentliche Formular sagt seit REC-03: „gelöscht … sofern kein
       * Arbeitsverhältnis zustande kommt". Der Lauf las nur die Frist und nahm
       * jede abgelaufene Zeile mit — samt `einstellungsentscheidung`, also
       * genau dem Nachweis, den REC-08 verlangt. Zusage und Verhalten liefen
       * auseinander; vor der Aufsicht zählt die Zusage. Gemeldet hat das die
       * Copilot-Runde auf PR 16.
       *
       * **Zurückgehalten heisst nicht „für immer".** Welche Frist für die
       * Bewerbungsunterlagen eines Eingestellten gilt, sagt die
       * Personalaktenpraxis des Mandanten und nicht diese Datei — sie hier zu
       * erfinden wäre eine erfundene Rechtsregel (`CLAUDE.md`). Die Zeilen
       * stehen deshalb SICHTBAR auf `/recruiting/datenschutz` als
       * zurückgehalten, statt still liegen zu bleiben.
       *
       * // TODO(client, O-376): Wie lange bleiben die Bewerbungsunterlagen
       * eines EINGESTELLTEN Bewerbers, und wandern sie in die Personalakte?
       */
      const faellig = await alsJobRolle(db, (jd) => jd.abfrage<{
        mandant_id: string; id: string; gesperrt: boolean;
      }>(
        `select mandant_id, id, (loeschsperre is not null) as gesperrt
           from bewerbung
          where geloescht_am is null
            and status <> 'eingestellt'
            and aufbewahrung_bis <= app.berlin_heute()
          order by mandant_id, aufbewahrung_bis
          limit 500`));

      const jeMandant = new Map<string, { zuLoeschen: string[]; gesperrt: number }>();
      for (const z of faellig) {
        const e = jeMandant.get(z.mandant_id) ?? { zuLoeschen: [], gesperrt: 0 };
        if (z.gesperrt) e.gesperrt += 1;
        else e.zuLoeschen.push(z.id);
        jeMandant.set(z.mandant_id, e);
      }

      let geloescht = 0;
      let gesperrt = 0;
      const laeufe: string[] = [];

      for (const [mandantId, e] of jeMandant) {
        /*
         * **Protokoll und Löschung in DERSELBEN Transaktion.** Sonst gäbe es
         * einen Zustand, in dem gelöscht wurde und der Nachweis fehlt — und
         * der ist genau der, den man im Streit vorlegen müsste.
         */
        const n = await alsJobSitzung(db, mandantId, async (jd) => {
          /**
           * **Zwischen dem Finden und dem Löschen liegt eine Lücke — und in
           * ihr kann ein Mensch einstellen.**
           *
           * Die Suche oben läuft quer über alle Gesellschaften, ohne Sperre.
           * Wird eine Bewerbung danach entschieden (`einstellungsentscheidung`
           * → Trigger setzt `status = 'eingestellt'`), löschte dieser Lauf
           * die Entscheidung mitsamt Gesprächen und anonymisierte den
           * Menschen, den man gerade eingestellt hat. `status <>
           * 'eingestellt'` stand nur in der SUCHE; die Löschung selbst hatte
           * keine Bedingung mehr.
           *
           * Deshalb wird hier neu gelesen — unter `for update`, in derselben
           * Transaktion wie die Löschung. Wer die Sperre haelt, entscheidet:
           * eine Einstellung, die vorher committet hat, faellt aus der Menge;
           * eine, die noch laeuft, wartet, bis geloescht ist. Beides ist
           * eindeutig, und nichts dazwischen wird still vernichtet.
           *
           * Gemeldet von der Copilot-Runde auf PR 16 (D-585).
           */
          const bestaetigt = e.zuLoeschen.length === 0 ? [] : (await jd.abfrage<{ id: string }>(
            `select id from bewerbung
              where id = any($1::uuid[])
                and geloescht_am is null
                and status <> 'eingestellt'
                and loeschsperre is null
                and aufbewahrung_bis <= app.berlin_heute()
              order by id
                for update`, [e.zuLoeschen])).map((z) => z.id);
          /*
           * Was zwischen Suche und Sperre verschwunden ist, zaehlt wie eine
           * Sperre: zurueckgehalten, nicht geloescht — und es steht im
           * Protokoll, damit die Zahl auf `/recruiting/datenschutz` erklaerbar
           * bleibt.
           */
          e.gesperrt += e.zuLoeschen.length - bestaetigt.length;
          e.zuLoeschen = bestaetigt;
          if (e.zuLoeschen.length > 0) {
            /*
             * **Die Nutzlast wird gelöscht, die Bewerbung anonymisiert.**
             *
             * Eine Bewertungsbegründung, eine Qualifikationsliste, eine
             * Gesprächsnotiz und die Begründung einer Absage sind Sätze ÜBER
             * einen Menschen — sie zu behalten, während der Name verschwindet,
             * wäre keine Löschung. Die `bewerbung` selbst bleibt als Gerippe
             * stehen: damit die Zahl der Bewerbungen je Stelle stimmt und
             * derselbe Eingang nicht zweimal importiert wird. Was sie über
             * einen Menschen sagte, steht danach nicht mehr darin.
             *
             * Ein `on delete cascade` stand bewusst nicht in 0166 — eine
             * Kaskade löscht auch, was jemand später danebenhängt, ohne dass
             * es hier jemand entschieden hätte.
             */
            await jd.abfrage(
              `delete from bewerbung_bewertung where bewerbung_id = any($1::uuid[])`,
              [e.zuLoeschen]);
            await jd.abfrage(
              `delete from gespraech where bewerbung_id = any($1::uuid[])`, [e.zuLoeschen]);
            await jd.abfrage(
              `delete from kandidat where bewerbung_id = any($1::uuid[])`, [e.zuLoeschen]);
            await jd.abfrage(
              `delete from einstellungsentscheidung where bewerbung_id = any($1::uuid[])`,
              [e.zuLoeschen]);
            /*
             * `example.invalid` ist die von RFC 2606 reservierte Domain: die
             * Adresse erfüllt den CHECK auf die E-Mail-Form und kann niemanden
             * erreichen. Ein leeres Feld ginge nicht — `bewerbung_email_form`
             * lässt es nicht zu, und das ist richtig so.
             */
            await jd.abfrage(
              `update bewerbung
                  set geloescht_am = now(),
                      name = 'gelöscht (Frist abgelaufen)',
                      email = 'geloescht@example.invalid',
                      telefon = null,
                      nachricht = null,
                      geaendert_am = now()
                where id = any($1::uuid[])
                  and status <> 'eingestellt'`,
              [e.zuLoeschen]);
          }
          await jd.abfrage(
            `insert into bewerbung_loeschlauf
               (mandant_id, geloescht, gesperrt, bewerbungen)
             values ($1::uuid, $2::int, $3::int, $4::uuid[])`,
            [mandantId, e.zuLoeschen.length, e.gesperrt, e.zuLoeschen]);
          return e.zuLoeschen.length;
        }, { nurLesen: false });

        geloescht += n;
        gesperrt += e.gesperrt;
        if (e.gesperrt > 0) {
          /*
           * **Eine Sperre wird BENANNT, nicht nur gezählt.** „gesperrt: 3" im
           * Laufprotokoll sagt nicht, in welcher Gesellschaft etwas liegen
           * bleibt — und wer es nachts liest, müsste erst suchen.
           */
          laeufe.push(`${mandantId}: ${String(e.gesperrt)} gesperrt, nicht gelöscht`);
        }
      }

      return {
        faellig: faellig.length,
        geloescht,
        gesperrt,
        mandanten: jeMandant.size,
        sperren: laeufe,
      };
    },
  });
}
