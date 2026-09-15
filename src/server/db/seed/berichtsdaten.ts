import type postgres from 'postgres';

/**
 * Was den sechs Berichten fehlte, damit jede Gesellschaft eine Zeile hat.
 *
 * **Warum das eine eigene Datei ist.** Der übrige Seed baut je Gewerk eine
 * Geschichte: die Reinigung hat Objekte, Räume und Turnusse, der Bau hat ein
 * Projekt mit Leistungsverzeichnis, die Security hat Reviere und ein
 * Wachbuch. Das ist richtig — die Bildschirme dieser Gewerke zeigen dadurch
 * echte Fälle. Die BERICHTE fragen quer dazu: sie fragen jede Gesellschaft
 * dasselbe, und wo eine nichts hat, steht eine Null.
 *
 * Eine Null ist nicht falsch. Sie ist nur nicht zu unterscheiden von „diese
 * Abfrage ist kaputt" — und wer die Plattform zum ersten Mal ansieht,
 * unterscheidet sie erst recht nicht. Diese Datei füllt deshalb genau die
 * Lücken und nicht mehr:
 *
 *  · **Anfragen** für Security und Bau (REP-02, REP-03) — die Reinigung hat
 *    ihre schon aus dem Vertriebsseed.
 *  · **Vergabevorgänge** für Security und Bau (REP-06) — es gibt sieben
 *    Bekanntmachungen im Radar und genau einen Vorgang dazu.
 *  · **Freigegebene Zeiten** für den Bau (REP-04) — die Reinigung und die
 *    Security haben ihre aus dem Zeitseed, der Bau hatte keine einzige.
 *  · **Termine** je Gesellschaft (CAL-01) — der Kalender zeigt Schichten und
 *    Fristen aus ihrer Quelle, aber das, was er SELBST besitzt, besass er in
 *    keinem Bereich.
 *
 * **Was hier NICHT steht, und warum.** Projekte bleiben beim Bau: `projekt`
 * trägt `art` aus `hochbau | ausbau | rueckbau`, und einer Reinigungsfirma ein
 * Hochbauprojekt zu geben hiesse, die Fachsprache zu verlassen, damit eine
 * Tabelle voller aussieht. Der Projektbericht sagt bei den anderen dreien
 * „im Zeitraum liegt keines" — ein Satz, kein leerer Bildschirm.
 *
 * Alles hier läuft nur auf Entwicklungsflächen und ist an den Daten
 * erkennbar: die Anfragen tragen `quelle = 'manuell'` mit einem Betreff, der
 * sagt, woher sie kommen.
 */

type Sql = postgres.Sql<Record<string, unknown>>;

export interface BerichtsdatenErgebnis {
  readonly leads: number;
  readonly vorgaenge: number;
  readonly zeiten: number;
  readonly termine: number;
  readonly uebersprungen: boolean;
}

/**
 * Termine je Gesellschaft (CAL-01).
 *
 * **Relativ zu HEUTE, nicht auf feste Daten.** Ein Seed mit „15.09.2026" zeigt
 * im Oktober einen leeren Kalender, und wer ihn dann ansieht, hält den
 * Kalender für kaputt statt den Seed für alt. Gestreut über die Woche davor
 * und die zwei danach — so sieht jede Ansicht (Monat, Woche, Tag) etwas.
 */
const TERMINE: Readonly<Record<string, readonly {
  art: string; titel: string; ort: string; tage: number; stunde: number; dauer: number;
  ganztaegig?: boolean;
}[]>> = {
  reinigung: [
    { art: 'kundentermin', titel: 'Objektbegehung mit dem Bezirksamt',
      ort: 'Karl-Marx-Allee 31, Berlin', tage: 2, stunde: 10, dauer: 2 },
    { art: 'besprechung', titel: 'Objektleitungsrunde',
      ort: 'Kurfürstendamm 21, Berlin', tage: -3, stunde: 9, dauer: 1 },
    { art: 'wiedervorlage', titel: 'Angebot Unterhaltsreinigung nachfassen',
      ort: '', tage: 5, stunde: 8, dauer: 1 },
  ],
  security: [
    { art: 'kundentermin', titel: 'Sicherheitskonzept Rechenzentrum besprechen',
      ort: 'Rudower Chaussee, Berlin-Adlershof', tage: 1, stunde: 14, dauer: 2 },
    { art: 'besprechung', titel: 'Schichtübergabe-Runde',
      ort: 'Wachzentrale', tage: -1, stunde: 7, dauer: 1 },
    { art: 'sonstiges', titel: 'Bewachungsverordnung: Unterrichtungsnachweise prüfen',
      ort: '', tage: 9, stunde: 0, dauer: 24, ganztaegig: true },
  ],
  bau: [
    { art: 'kundentermin', titel: 'Baustellenbegehung Rückbau Mitte',
      ort: 'Mitte, Berlin', tage: 3, stunde: 7, dauer: 3 },
    { art: 'besprechung', titel: 'Nachtragsbesprechung mit der Bauleitung',
      ort: 'Büro', tage: -2, stunde: 13, dauer: 2 },
    { art: 'bewerbungsgespraech', titel: 'Gespräch: Polier (m/w/d)',
      ort: 'Büro', tage: 6, stunde: 11, dauer: 1 },
  ],
  operations: [
    { art: 'besprechung', titel: 'Gruppenrunde: Zahlen des Monats',
      ort: 'Kurfürstendamm 21, Berlin', tage: 4, stunde: 10, dauer: 2 },
  ],
};

async function legeTermineAn(
  sql: Sql, mandantId: string, besitzer: string, slug: string,
): Promise<number> {
  const [vorhanden] = await sql<{ anzahl: string }[]>`
    select count(*)::text as anzahl from kalender_eintrag where mandant_id = ${mandantId}`;
  if (vorhanden!.anzahl !== '0') return 0;

  let angelegt = 0;
  for (const t of TERMINE[slug] ?? []) {
    const ergebnis = await sql`
      insert into kalender_eintrag
        (mandant_id, art, titel, ort, beginn, ende, ganztaegig, besitzer_benutzer_id,
         erstellt_von)
      select ${mandantId}, ${t.art}::kalender_art, ${t.titel}, ${t.ort},
             b.start, b.start + make_interval(hours => ${t.dauer}::int),
             ${t.ganztaegig ?? false}, ${besitzer}, ${besitzer}
        from (select ((app.berlin_heute() + ${t.tage}::int)::timestamp
                      + make_interval(hours => ${t.stunde}::int))
                     at time zone 'Europe/Berlin' as start) b`;
    angelegt += ergebnis.count;
  }
  return angelegt;
}

/**
 * Freigegebene Zeiten für eine Gesellschaft, die keine hat.
 *
 * **Die Zeiten liegen in der VERGANGENHEIT und sind abgeschlossen** — mit
 * Beginn, Ende, Pause und Freigabe. Eine laufende Zeit ohne Ende wäre kein
 * Stundenbericht, sondern eine offene Schicht; eine ohne Freigabe zählt in
 * REP-04 zu Recht nicht (§7.3, EMP-04: die Freigabe ist ein ZEITPUNKT).
 *
 * Acht Stunden mit dreissig Minuten Pause, an Werktagen — die Rechnung, die
 * jeder Bauleiter kennt. Gestreut über die letzten Wochen, damit der
 * Monatsbericht nicht einen Balken und elf Lücken zeigt.
 */
async function legeZeitenAn(
  sql: Sql, mandantId: string, freigeber: string,
): Promise<number> {
  const anstellungen = await sql<{ id: string; person_id: string }[]>`
    select id, person_id from anstellung
     where mandant_id = ${mandantId} and status = 'aktiv' and geloescht_am is null
     order by personalnummer limit 3`;
  if (anstellungen.length === 0) return 0;

  let angelegt = 0;
  for (const [i, a] of anstellungen.entries()) {
    for (const woche of [1, 2, 3, 4]) {
      /*
       * **Der Versatz darf nicht durch sieben teilbar bleiben.** `woche * 7 + i`
       * ergab fuer einen Menschen vier Abstaende, die alle denselben Rest mod 7
       * haben -- also viermal denselben WOCHENTAG. Faellt der auf einen Samstag
       * oder Sonntag, verwarf der Werktagsfilter unten alle vier auf einmal,
       * und je nachdem, an welchem Tag der Seed lief, bekamen zwei von drei
       * Menschen null Zeiteintraege. Die Null-Pruefung des Aufrufers schrieb
       * das dann fest. Mit `+ woche` verteilt sich derselbe Mensch ueber vier
       * verschiedene Wochentage.
       */
      const tageHer = woche * 7 + i + woche;
      const ergebnis = await sql`
        insert into zeiteintrag
          (mandant_id, anstellung_id, person_id, beginn_zeitpunkt, ende_zeitpunkt,
           pause_minuten, erfassungsart_beginn, erfassungsart_ende,
           quelle_beginn, quelle_ende, status, freigegeben_am, freigegeben_von,
           erstellt_von_art, nacherfasst, behauptet_beginn, behauptet_ende)
        select ${mandantId}, ${a.id}, ${a.person_id},
               b.beginn, b.beginn + interval '8 hours 30 minutes',
               30, 'import', 'import', 'import', 'import',
               'abgeschlossen', now(), ${freigeber}, 'system',
               -- Eine Nacherfassung braucht die behaupteten Zeiten (0034):
               -- wer sie nachtraegt, behauptet etwas, und das steht daneben.
               true, b.beginn, b.beginn + interval '8 hours 30 minutes'
          from (select ((app.berlin_heute() - ${tageHer}::int
                          -- Samstag (6) minus 1, Sonntag (7) minus 2 = Freitag.
                          - greatest(extract(isodow from
                              app.berlin_heute() - ${tageHer}::int)::int - 5, 0))::timestamp
                        + interval '7 hours') at time zone 'Europe/Berlin' as beginn) b
         -- Werktags: ein Bautrupp arbeitet nicht am Sonntag, und ein Bericht,
         -- der das behauptet, faellt jedem Bauleiter sofort auf.
         --
         -- VERSCHOBEN, nicht verworfen: ein Wochenendtag wird auf den Freitag
         -- davor gezogen. Wer ihn wegwirft, laesst je nach Wochentag des
         -- Seedlaufs Menschen ganz ohne Stunden zurueck -- und ein
         -- Stundenbericht mit leeren Zeilen sieht aus wie ein Fehler im
         -- Bericht, nicht wie einer im Seed.
         where true`;
      angelegt += ergebnis.count;
    }
  }
  return angelegt;
}

/** Je Gesellschaft eine Anfrage, die zu ihrem Gewerk passt. */
const ANFRAGEN: Readonly<Record<string, {
  betreff: string; firma: string; bedarf: string; wertCent: bigint; status: string;
}[]>> = {
  security: [
    {
      betreff: 'Objektschutz für ein Rechenzentrum in Adlershof',
      firma: 'Adlershof Data GmbH',
      bedarf: 'Nachtdienst 22:00–06:00, sieben Tage, ein Posten. Beginn zum Quartalsanfang.',
      wertCent: 8_400_000n,
      status: 'in_bearbeitung',
    },
    {
      betreff: 'Veranstaltungsdienst, dreitägige Messe',
      firma: 'Messe Berlin Veranstaltungsservice GmbH',
      bedarf: 'Einlasskontrolle und Rundgänge, drei Tage, acht Kräfte.',
      wertCent: 1_950_000n,
      status: 'gewonnen',
    },
  ],
  bau: [
    {
      betreff: 'Rückbau zweier Geschosse, Bürogebäude Mitte',
      firma: 'Mitte Immobilien Verwaltungs GmbH',
      bedarf: 'Rückbau Trockenbau und Estrich, Entsorgung, sechs Wochen.',
      wertCent: 24_500_000n,
      status: 'angebot',
    },
    {
      betreff: 'Ausbau Ladenfläche, Prenzlauer Berg',
      firma: 'Kastanienallee Handels GmbH',
      bedarf: 'Trockenbau, Elektro in Vorleistung, Bodenaufbau. Termin eng.',
      wertCent: 6_200_000n,
      status: 'verloren',
    },
  ],
};

export async function seedBerichtsdaten(
  sql: Sql, ids: ReadonlyMap<string, string>, demodaten: boolean,
): Promise<BerichtsdatenErgebnis> {
  if (!demodaten) {
    return { leads: 0, vorgaenge: 0, zeiten: 0, termine: 0, uebersprungen: true };
  }

  let leads = 0;
  let vorgaenge = 0;
  let zeiten = 0;
  let termine = 0;

  /*
   * Termine fuer ALLE vier — auch fuer Operations, das keine Rechtseinheit
   * ist und trotzdem einen Kalender fuehrt. Eine Gruppenrunde ist ein Termin,
   * auch wenn niemand dafuer eine Rechnung schreibt.
   */
  for (const slug of ['reinigung', 'security', 'bau', 'operations']) {
    const mandantId = ids.get(slug);
    if (mandantId === undefined) continue;
    /*
     * **Und wenn niemand Mitglied ist, führt es die Gruppenleitung.**
     *
     * CSE Operations hat keine Bereichsrollen: dort arbeitet niemand im Sinne
     * einer Mitgliedschaft, und trotzdem findet dort die Gruppenrunde statt.
     * Ohne diesen Rückfall bliebe der eine Bereich ohne Kalender, der ihn am
     * ehesten braucht — und im Gruppenkalender fehlte er ganz.
     * `super_admin` ist eine GLOBALE Rolle (TEN-08), hängt also an
     * `benutzer.globale_rolle_id` und nicht an `benutzer_mandant`.
     */
    const [wer] = await sql<{ id: string }[]>`
      select b.id from benutzer b
       join benutzer_mandant bm on bm.benutzer_id = b.id and bm.mandant_id = ${mandantId}
       join rolle r on r.id = bm.rolle_id
      where r.schluessel in ('admin', 'leitung') and b.status = 'aktiv'
        and bm.entzogen_am is null
      order by (r.schluessel = 'leitung') desc, b.email limit 1`;
    const [global] = wer !== undefined ? [wer] : await sql<{ id: string }[]>`
      select b.id from benutzer b
       join rolle r on r.id = b.globale_rolle_id
      where r.schluessel = 'super_admin' and b.status = 'aktiv'
      order by b.email limit 1`;
    if (global === undefined) continue;
    termine += await legeTermineAn(sql, mandantId, global.id, slug);
  }

  for (const [slug, anfragen] of Object.entries(ANFRAGEN)) {
    const mandantId = ids.get(slug);
    if (mandantId === undefined) continue;

    const [besitzer] = await sql<{ id: string }[]>`
      select b.id from benutzer b
       join benutzer_mandant bm on bm.benutzer_id = b.id and bm.mandant_id = ${mandantId}
       join rolle r on r.id = bm.rolle_id
      where r.schluessel in ('admin', 'leitung') and b.status = 'aktiv'
        and bm.entzogen_am is null
      order by (r.schluessel = 'leitung') desc, b.email limit 1`;
    if (besitzer === undefined) continue;

    for (const [i, a] of anfragen.entries()) {
      /*
       * **Das Eingangsdatum liegt im laufenden Jahr, gestreut.** Die
       * Abschlussquote gehoert zur KOHORTE: ein Lead zaehlt in dem Monat, in
       * dem er ENTSTAND. Alle auf heute zu legen hiesse, elf Monate im
       * Bericht leer zu lassen und den zwoelften mit allem zu fuellen.
       */
      const tage = 30 * (i + 1) + 11;
      const nummer = `LD-${slug.slice(0, 2).toUpperCase()}-${String(i + 1).padStart(4, '0')}`;
      const ergebnis = await sql`
        insert into lead (mandant_id, leadnummer, quelle, betreff, bedarf_zusammenfassung,
                          status, prioritaet, besitzer_benutzer_id, firma_name,
                          geschaetzter_wert_cent, verloren_grund, erstellt_am)
        values (${mandantId}, ${nummer}, 'manuell'::lead_quelle, ${a.betreff}, ${a.bedarf},
                ${a.status}::lead_status, 'normal'::lead_prioritaet, ${besitzer.id},
                ${a.firma}, ${a.wertCent.toString()},
                ${a.status === 'verloren' ? 'Demodaten: Mitbewerber war günstiger.' : null},
                now() - make_interval(days => ${tage}::int))
        on conflict (mandant_id, leadnummer) do nothing`;
      leads += ergebnis.count;
    }

    /*
     * Ein Vergabevorgang je Gesellschaft — auf eine Bekanntmachung, die der
     * Radar schon kennt. Angelegt wird er NICHT, wenn diese Gesellschaft
     * schon einen hat: der Seed ist wiederholbar, und ein zweiter Lauf soll
     * die Pipeline nicht verdoppeln.
     */
    const [vorhanden] = await sql<{ anzahl: string }[]>`
      select count(*)::text as anzahl from ausschreibung_vorgang
       where mandant_id = ${mandantId}`;
    if (vorhanden!.anzahl !== '0') continue;

    const [bekanntmachung] = await sql<{ id: string }[]>`
      select a.id from ausschreibung a
       where not exists (select 1 from ausschreibung_vorgang v
                          where v.ausschreibung_id = a.id and v.mandant_id = ${mandantId})
       order by a.erstellt_am desc limit 1`;
    if (bekanntmachung === undefined) continue;

    const ergebnis = await sql`
      insert into ausschreibung_vorgang
        (mandant_id, ausschreibung_id, status, plattform_pruefung, erstellt_von_art,
         erstellt_am)
      values (${mandantId}, ${bekanntmachung.id},
              -- geprueft und nicht in_bearbeitung: die Datenbank besteht
              -- darauf, dass "in Bearbeitung" eine VERGABEMAPPE hat, und
              -- "eingereicht" gehoert der Mappe und nicht dem Vorgang
              -- (RAD-07). Ein Seed, der sich daran vorbeischreibt, erzeugt
              -- Zustaende, die es im Betrieb nicht gibt.
              'geprueft'::ausschreibung_status,
              'unbekannt'::plattform_pruefung, 'system',
              now() - make_interval(days => 21))`;
    vorgaenge += ergebnis.count;
  }

  /*
   * Der Bau hat Beschäftigungen und keine einzige freigegebene Zeit — REP-04
   * zeigte für ihn eine Null, die wie ein Fehler aussieht. Nur, wenn wirklich
   * keine da ist: der Seed ist wiederholbar.
   */
  const bau = ids.get('bau');
  if (bau !== undefined) {
    const [vorhanden] = await sql<{ anzahl: string }[]>`
      select count(*)::text as anzahl from zeiteintrag
       where mandant_id = ${bau} and freigegeben_am is not null`;
    if (vorhanden!.anzahl === '0') {
      const [freigeber] = await sql<{ id: string }[]>`
        select b.id from benutzer b
         join benutzer_mandant bm on bm.benutzer_id = b.id and bm.mandant_id = ${bau}
         join rolle r on r.id = bm.rolle_id
        where r.schluessel in ('admin', 'leitung') and b.status = 'aktiv'
          and bm.entzogen_am is null
        order by (r.schluessel = 'leitung') desc, b.email limit 1`;
      if (freigeber !== undefined) zeiten = await legeZeitenAn(sql, bau, freigeber.id);
    }
  }

  return { leads, vorgaenge, zeiten, termine, uebersprungen: false };
}
