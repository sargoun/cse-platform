import type postgres from 'postgres';

/**
 * Die CRM-Angaben, die auf vier Unterseiten stehen — und ohne die diese vier
 * Seiten in den Demodaten LEER wären (CRM-04, CRM-05, FIN-11, § 13b UStG,
 * § 48b EStG).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund, der diese Datei gebracht hat.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Nachgezählt vor diesem Commit, auf der migrierten Datenbank:
 *
 *  | was                            | Zeilen |
 *  |--------------------------------|--------|
 *  | `kunde.debitorennummer`        | 0 von 7 |
 *  | `kunde.zahlungsziel_tage`      | 0 von 7 |
 *  | `kunde.mahnsperre_bis`         | 0 von 7 |
 *  | `kunde.uebertragungsweg`       | 0 von 7 |
 *  | `kunde_bauleistender_status`   | 0 |
 *  | `freistellungsbescheinigung`   | 0 |
 *  | `lead_aktivitaet.faellig_am`   | 0 von 5 |
 *
 * Vier Seiten hätten damit eine Überschrift und sonst nichts gezeigt:
 * `/crm/kunden/[id]/konditionen`, `/crm/kunden/[id]/steuer`,
 * `/crm/wiedervorlagen` und der Nachweisteil von `/crm/kontakte`. Eine Seite,
 * die nichts zeigt, beweist nicht, dass sie funktioniert — und der
 * Unterschied zwischen „nichts hinterlegt" und „Abfrage kaputt" ist auf einem
 * leeren Bildschirm nicht zu sehen. Genau das ist der Grund, warum die
 * Definition-of-done Seeddaten verlangt und nicht nur grüne Tests.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Nur mit `CSE_DEV_FLAECHEN`** — und warum das hier strenger gilt als sonst.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Jede Angabe unten ist eine STEUERLICHE oder ZAHLUNGSWIRKSAME Tatsache über
 * einen benannten Kunden: ein Zahlungsziel, eine Mahnsperre, eine
 * Freistellungsbescheinigung mit Finanzamt und Nummer. In einem echten Bau hat
 * so etwas nicht erfunden dazustehen — eine geratene § 48b-Bescheinigung ist
 * schlimmer als keine, weil der Bauabzug dann unterbleibt und die Haftung
 * bleibt. Deshalb: dieselbe Schranke wie im Datenschutz-Seed, und jeder Text
 * trägt „(Demodaten)" im Klartext.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Was hier NICHT geraten wird.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Das Standard-Zahlungsziel je Gesellschaft ist offen (O-66) und bleibt es:
 * dieser Seed setzt am ERSTEN Kunden der Reinigung eine Debitorennummer und
 * ein Zahlungsziel, am ZWEITEN nur eine Mahnsperre, und lässt alle übrigen
 * leer. Damit kommen beide Fälle auf der Seite vor — der gepflegte und der
 * ungepflegte, der die Faktura mit Grund abweisen lässt. Ein Seed, der jeden
 * Kunden auf 14 Tage setzte, hätte O-66 stillschweigend beantwortet und die
 * offene Frage unsichtbar gemacht.
 *
 * Ebenso der Übertragungsweg (O-22): er wird auf dem EINEN Behördenkunden
 * gesetzt, den der Seed anlegt, und zwar als klar bezeichneter Demowert. Die
 * Sperre selbst — Pflichtkäufer ohne Weg — wird nicht geseedet, sondern
 * geprüft (`tests/kern/crm-erechnung-versand.test.ts`): sie ist eine Regel,
 * kein Datensatz.
 */

export interface CrmErgebnis {
  readonly konditionen: number;
  readonly mahnsperren: number;
  readonly erechnung: number;
  readonly zeitscheiben: number;
  readonly bescheinigungen: number;
  readonly wiedervorlagen: number;
  readonly aehnlicheLeistung: number;
  readonly uebersprungen: boolean;
}

const LEER: CrmErgebnis = {
  konditionen: 0, mahnsperren: 0, erechnung: 0, zeitscheiben: 0,
  bescheinigungen: 0, wiedervorlagen: 0, aehnlicheLeistung: 0,
  uebersprungen: true,
};

/**
 * Der Mensch, dem die Wiedervorlagen gehören — dasselbe Konto, mit dem sich
 * ein Mensch in der Vorführung anmeldet.
 *
 * Ohne ihn zeigte `/crm/wiedervorlagen` in der Vorgabeansicht („nur meine")
 * eine leere Liste, und die Seite sähe aus wie ein Fehler, obwohl die Zeilen
 * da sind. Sie hingen dann nur an niemandem.
 */
async function bearbeiterId(sql: postgres.Sql): Promise<string | null> {
  const [b] = await sql<{ id: string }[]>`
    select id from benutzer where email = 'admin@cse-gruppe.de' limit 1`;
  return b?.id ?? null;
}

/** Die Kunden einer Gesellschaft, nach Nummer — stabil sortiert. */
async function kunden(
  sql: postgres.Sql, mandantId: string,
): Promise<readonly { id: string; name: string; typ: string }[]> {
  return sql<{ id: string; name: string; typ: string }[]>`
    select id, name, typ::text as typ
      from kunde
     where mandant_id = ${mandantId} and archiviert_am is null
     order by kundennummer`;
}

export async function seedCrm(
  sql: postgres.Sql,
  ids: ReadonlyMap<string, string>,
  demodaten: boolean,
): Promise<CrmErgebnis> {
  if (!demodaten) return LEER;

  const bearbeiter = await bearbeiterId(sql);
  let konditionen = 0;
  let mahnsperren = 0;
  let erechnung = 0;
  let zeitscheiben = 0;
  let bescheinigungen = 0;
  let wiedervorlagen = 0;
  let aehnlicheLeistung = 0;

  // -------------------------------------------------------------------------
  // 1 — Zahlungskonditionen und eine Mahnsperre (CRM-05)
  // -------------------------------------------------------------------------

  const reinigung = ids.get('reinigung');
  if (reinigung !== undefined) {
    const liste = await kunden(sql, reinigung);
    const [erster, zweiter] = liste;

    /*
     * `where zahlungsziel_tage is null` — nachtragen, aber nur was fehlt,
     * dieselbe Regel wie im Kundenstamm: wer eine Demozeile von Hand
     * korrigiert hat, behält sie. Ein Seed, der bei jedem Lauf zurückschreibt,
     * macht das Ausprobieren der Seite unmöglich.
     */
    if (erster !== undefined) {
      const geaendert = await sql`
        update kunde
           set debitorennummer = coalesce(debitorennummer, '10001'),
               zahlungsziel_tage = coalesce(zahlungsziel_tage, 30)
         where id = ${erster.id}
           and (debitorennummer is null or zahlungsziel_tage is null)`;
      konditionen += geaendert.count;
    }

    /*
     * Die Mahnsperre als PAAR — `kunde_mahnsperre_begruendet` lässt „bis" und
     * „Grund" nur gemeinsam zu. Eine Sperre ohne Grund wäre auf der Seite
     * nicht erklärbar und in einer Prüfung nicht verteidigbar.
     *
     * Das Ende liegt 30 Tage in der Zukunft, gerechnet aus dem BERLINER Tag
     * der Datenbank (`app.berlin_heute()`), nicht aus `new Date()`: der
     * Node-Prozess läuft in UTC und zeigte zwischen Mitternacht und 02:00 den
     * Vortag (Invariante 2, K-11). Damit hält die Sperre in der Vorführung
     * WIRKLICH — `app.kunde_mahnsperre_aktiv` antwortet mit `true`, und die
     * Seite zeigt den angehaltenen Mahnlauf statt einer abgelaufenen Zeile.
     */
    if (zweiter !== undefined) {
      const gesperrt = await sql`
        update kunde
           set mahnsperre_bis = app.berlin_heute() + 30,
               mahnsperre_grund = 'Stundung bis Quartalsende vereinbart (Demodaten)'
         where id = ${zweiter.id}
           and mahnsperre_bis is null and mahnsperre_grund is null`;
      mahnsperren += gesperrt.count;
    }

    // -----------------------------------------------------------------------
    // 2 — der Weg der elektronischen Rechnung (FIN-11, O-22)
    // -----------------------------------------------------------------------

    /*
     * NUR der Behördenkunde, und nur wenn der Weg leer ist.
     *
     * `ozg_re` ist in dieser Installation NICHT verbunden — die Oberfläche
     * schreibt das an die Auswahl, und `versandLage` gibt darauf
     * `nicht_verbunden` zurück statt `bereit`. Das ist der Zustand, den die
     * Seite zeigen soll: ein vollständig gepflegter Käufer, dessen Kanal
     * trotzdem keinen Zusteller hat. Ein geseedeter `email`-Weg hätte statt
     * dessen einen grünen Haken gezeigt, den kein Versand einlöst.
     */
    for (const k of liste) {
      if (k.typ !== 'behoerde') continue;
      const gesetzt = await sql`
        update kunde
           set uebertragungsweg = 'ozg_re',
               rechnungsformat = 'xrechnung_ubl'
         where id = ${k.id}
           and xrechnung_pflicht
           and uebertragungsweg is null and rechnungsformat is null`;
      erechnung += gesetzt.count;
    }
  }

  // -------------------------------------------------------------------------
  // 3 — § 13b-Zeitscheiben und die § 48b-Bescheinigung
  // -------------------------------------------------------------------------

  /*
   * Im BAU, nicht in der Reinigung: § 13b Abs. 2 Nr. 4 UStG trifft
   * Bauleistungen, und `leistungsart = 'bau'` gehört zu der Gesellschaft, die
   * sie erbringt. Die Zeitscheibe sagt etwas über den KUNDEN — ob er selbst
   * nachhaltig Bauleistungen erbringt —, und das entscheidet, wer die
   * Umsatzsteuer schuldet.
   */
  const bau = ids.get('bau');
  if (bau !== undefined && bearbeiter !== null) {
    const [kundeBau] = await kunden(sql, bau);
    if (kundeBau !== undefined) {
      /*
       * ZWEI Scheiben, lückenlos aneinander und ohne Überlappung — der
       * EXCLUDE-Index `kbs_kein_ueberlapp` weist alles andere ab. Erst „kein
       * Bauleistender", dann ab dem Jahreswechsel „Bauleistender": genau der
       * Verlauf, für den es Zeitscheiben überhaupt gibt, und der Grund, warum
       * die Seite die Lage AM LEISTUNGSDATUM zeigt und nicht die von heute
       * (O-21). Mit nur einer Scheibe wäre der Stichtagswechsel auf der Seite
       * nicht vorführbar.
       */
      const [vorhanden] = await sql<{ id: string }[]>`
        select id from kunde_bauleistender_status
         where mandant_id = ${bau} and kunde_id = ${kundeBau.id} limit 1`;
      if (vorhanden === undefined) {
        const jahr = (await sql<{ j: string }[]>`
          select to_char(app.berlin_heute(), 'YYYY') as j`)[0]!.j;
        await sql`
          insert into kunde_bauleistender_status
            (mandant_id, kunde_id, leistungsart, ist_bauleistender,
             gilt_ab, gilt_bis, grundlage, erstellt_von_art, erstellt_von)
          values
            (${bau}, ${kundeBau.id}, 'bau', false,
             ${`${String(Number(jahr) - 1)}-01-01`}, ${`${String(Number(jahr) - 1)}-12-31`},
             'Eigenauskunft des Kunden vom Vorjahr (Demodaten)', 'mensch', ${bearbeiter}),
            (${bau}, ${kundeBau.id}, 'bau', true,
             ${`${jahr}-01-01`}, null,
             'Bestätigung USt 1 TG des Finanzamts (Demodaten)', 'mensch', ${bearbeiter})`;
        zeitscheiben += 2;
      }

      /*
       * Die § 48b-Bescheinigung: `unbeschraenkt`, also NICHT auftragsbezogen —
       * `fsb_umfang_auftrag` verlangt sonst eine `auftrag_id`, und die zu
       * erfinden hiesse, eine Bescheinigung an einen Auftrag zu hängen, den
       * das Finanzamt nie gesehen hat.
       *
       * Der Gültigkeitszeitraum umspannt den heutigen Berliner Tag, damit die
       * Seite eine GÜLTIGE Bescheinigung zeigt; dass sie am Leistungsdatum
       * geprüft wird und nicht am Aufrufdatum, steht als Zusage im Dienst.
       */
      const [fsbDa] = await sql<{ id: string }[]>`
        select id from freistellungsbescheinigung
         where mandant_id = ${bau} and kunde_id = ${kundeBau.id} limit 1`;
      if (fsbDa === undefined) {
        await sql`
          insert into freistellungsbescheinigung
            (mandant_id, kunde_id, bescheinigung_nummer, finanzamt,
             gueltig_von, gueltig_bis, umfang, erstellt_von_art, erstellt_von)
          values
            (${bau}, ${kundeBau.id}, 'DEMO-48b-0001',
             'Finanzamt Berlin Mitte/Tiergarten (Demodaten)',
             app.berlin_heute() - 90, app.berlin_heute() + 275,
             'unbeschraenkt', 'mensch', ${bearbeiter})`;
        bescheinigungen += 1;
      }
    }
  }

  // -------------------------------------------------------------------------
  // 4 — Wiedervorlagen in allen vier Fächern (CRM-04)
  // -------------------------------------------------------------------------

  /*
   * Vier Zeilen, eine je Fach: überfällig, heute, diese Woche, später.
   *
   * `gruppiere` teilt nach dem BERLINER Tag gegen `app.berlin_heute()` und
   * gegen den daraus in `ZEITANKER_SQL` gerechneten Wochenschluss
   * (`date_trunc('week', app.berlin_heute()::timestamp)::date + 6`). Eine
   * Funktion `app.berlin_wochenende()` gibt es NICHT — der Name stand hier
   * und nirgends sonst im Baum; ein Kommentar, der mehr verspricht als der
   * Code, ist die Quelle, aus der die nächste Behauptung entsteht. Ein Seed
   * mit vier Zeilen „irgendwann" liesse
   * drei Fächer leer und die Eskalationsfarbe ungeprüft. Die Fälligkeit wird
   * deshalb AUS DER DATENBANK gerechnet: `(app.berlin_heute() + n)` als
   * Kalendertag, um 09:00 Berliner Zeit in einen Zeitpunkt gelegt. Ein
   * `new Date()` im Node-Prozess hätte hier zwischen Mitternacht und 02:00
   * das falsche Fach erzeugt — und zwar genau in der Nacht, in der niemand
   * hinsieht.
   *
   * `richtung = 'intern'` und `zweck = 'intern'`: eine Wiedervorlage ist eine
   * Notiz an die eigene Mannschaft, kein Kontakt. `kern.uwg_sendetor` lässt
   * sie deshalb ohne Prüfung durch — eine geseedete AUSGEHENDE Zeile hätte
   * dagegen am § 7-Tor gehangen, und das zu Recht.
   */
  if (reinigung !== undefined && bearbeiter !== null) {
    const [kundeR] = await kunden(sql, reinigung);
    if (kundeR !== undefined) {
      const [da] = await sql<{ id: string }[]>`
        select id from lead_aktivitaet
         where mandant_id = ${reinigung} and faellig_am is not null limit 1`;
      if (da === undefined) {
        const faellig: readonly (readonly [number, string, string])[] = [
          [-3, 'Angebot Treppenhausreinigung nachfassen',
            'Der Kunde wollte bis Monatsende entscheiden (Demodaten).'],
          [0, 'Rückruf Objektleitung Mitte',
            'Heute vereinbart — Fensterturnus klären (Demodaten).'],
          [2, 'Jahresgespräch vorbereiten',
            'Zahlen aus dem Leistungsnachweis mitbringen (Demodaten).'],
          [21, 'Rahmenvertrag zur Verlängerung vorlegen',
            'Läuft zum Quartalsende aus (Demodaten).'],
        ];
        for (const [versatz, betreff, inhalt] of faellig) {
          await sql`
            insert into lead_aktivitaet
              (mandant_id, kunde_id, typ, richtung, zweck, betreff, inhalt,
               benutzer_id, zustaendig_benutzer_id, faellig_am, erinnerung_am)
            values
              (${reinigung}, ${kundeR.id}, 'aufgabe', 'intern', 'intern',
               ${betreff}, ${inhalt}, ${bearbeiter}, ${bearbeiter},
               ((app.berlin_heute() + ${versatz}::integer)::text || ' 09:00')
                 ::timestamp at time zone 'Europe/Berlin',
               ((app.berlin_heute() + ${versatz}::integer)::text || ' 08:00')
                 ::timestamp at time zone 'Europe/Berlin')`;
          wiedervorlagen += 1;
        }
      }

      // ---------------------------------------------------------------------
      // 5 — die § 7 Abs. 3-Wertung auf EINEM Kontakt (O-95)
      // ---------------------------------------------------------------------

      /*
       * `aehnliche_leistung` ist eine festgehaltene MENSCHLICHE Wertung, kein
       * abgeleitetes Kennzeichen — und die Vorgabe ist `false` (fail closed).
       * Genau EIN Kontakt bekommt sie, mit Begründung, damit auf der Seite
       * beide Zustände nebeneinander stehen: der gewertete und der
       * ungewertete. Der `check`
       * `ansprechpartner_aehnliche_leistung_begruendet` lässt das Kennzeichen
       * ohne Begründungstext ohnehin nicht zu.
       *
       * Dass die Wertung heute noch nicht ins Tor eingeht, ist O-660 und
       * steht so auf der Seite: die Matrix zeigt ihre Antwort neben der des
       * Tores, nicht an deren Stelle.
       */
      const gewertet = await sql`
        update ansprechpartner
           set aehnliche_leistung = true,
               aehnliche_leistung_begruendung =
                 'Bestandskunde der Gebäudereinigung; beworben wird erneut '
                 || 'Gebäudereinigung — gleiche eigene Dienstleistung (Demodaten, O-95)'
         where mandant_id = ${reinigung} and kunde_id = ${kundeR.id}
           and archiviert_am is null
           and not aehnliche_leistung
           and id = (select id from ansprechpartner
                      where mandant_id = ${reinigung} and kunde_id = ${kundeR.id}
                        and archiviert_am is null
                      order by nachname limit 1)`;
      aehnlicheLeistung += gewertet.count;
    }
  }

  return {
    konditionen, mahnsperren, erechnung, zeitscheiben, bescheinigungen,
    wiedervorlagen, aehnlicheLeistung, uebersprungen: false,
  };
}
