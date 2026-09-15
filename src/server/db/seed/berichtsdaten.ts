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
  readonly uebersprungen: boolean;
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
      const tageHer = woche * 7 + i;
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
          from (select ((app.berlin_heute() - ${tageHer}::int)::timestamp
                        + interval '7 hours') at time zone 'Europe/Berlin' as beginn) b
         -- Werktags: ein Bautrupp arbeitet nicht am Sonntag, und ein Bericht,
         -- der das behauptet, faellt jedem Bauleiter sofort auf.
         where extract(isodow from app.berlin_heute() - ${tageHer}::int) <= 5`;
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
  if (!demodaten) return { leads: 0, vorgaenge: 0, zeiten: 0, uebersprungen: true };

  let leads = 0;
  let vorgaenge = 0;
  let zeiten = 0;

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

  return { leads, vorgaenge, zeiten, uebersprungen: false };
}
