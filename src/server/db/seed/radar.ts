import type postgres from 'postgres';
import { bewerteLauf } from '../../services/radar/lauf.js';
import { uebernimmAusschreibungAlsLead } from '../../services/crm/lead-radar.js';
import { alsPortalSitzung } from './sitzung.js';

/**
 * Demodaten für den Vergaberadar (RAD-01 … RAD-09, D-490).
 *
 * **Was hier entsteht und was mit Absicht nicht.**
 *
 * Drei Suchprofile — eines je Gewerk — mit den CPV-Codes, die SPEC §6 als
 * Ausgangspunkt nennt. Sie tragen alle `ist_platzhalter`, weil derselbe
 * Abschnitt ausdrücklich „verify against the official list" sagt (O-98); die
 * Profilseite weist sie deshalb als unbestätigt aus.
 *
 * Sechs Bekanntmachungen, die die Fälle abdecken, an denen eine Liste
 * auffällt oder versagt: eine Frist in drei Tagen (RAD-06, rot), eine weit
 * entfernte, eine in Fremdwährung (O-47 — wird nicht umgerechnet), eine
 * aufgehobene, eine europäische oberhalb der Schwellenwerte und eine, die
 * kein Profil trifft.
 *
 * **Kein Quellenlink.** Diese Zeilen sind Demodaten und keine
 * Veröffentlichungen; eine Adresse, die echt aussieht und ins Leere führt,
 * wäre genau die Art Behauptung, die diese Plattform nicht macht. Deshalb
 * `quell_url = null` und `quell_id` mit `demo-`.
 *
 * **Kein Plattformkatalog.** `vergabeplattform` bleibt leer, bis O-07
 * beantwortet ist — welche Plattformen gelten, und wer dort unter welcher
 * Kennung registriert ist, weiss niemand hier. Die Plattformseite sagt das.
 */

interface Vorlage {
  readonly quellId: string;
  readonly quelle: 'oeffentlichevergabe' | 'ted';
  readonly titel: string;
  readonly beschreibung: string;
  readonly stelle: string;
  readonly ort: string;
  readonly plz: string;
  readonly cpv: string;
  readonly cpvWeitere: readonly string[];
  readonly nuts: readonly string[];
  readonly wertCent: bigint | null;
  readonly waehrung: string | null;
  /**
   * Tage ab heute — der Seed rechnet daraus einen Zeitpunkt und legt sechs
   * Stunden drauf. Ohne den Puffer zeigt eine Frist „in drei Tagen" schon
   * Sekunden später „noch 2 Tage": die Anzeige rundet ab, und das ist
   * richtig — eine angebrochene Nacht ist kein Arbeitstag.
   */
  readonly fristInTagen: number | null;
  readonly verfahrensart: string;
  readonly oberhalb: boolean | null;
  readonly aufgehoben?: boolean;
  readonly plattformHinweis?: string;
  /**
   * Die Unterlagen, die die Vergabestelle mit der Bekanntmachung nennt —
   * **ohne Adresse**, wie die Bekanntmachung selbst (siehe oben): eine URL,
   * die echt aussieht und ins Leere fuehrt, waere eine Behauptung.
   */
  readonly dokumente?: readonly { readonly bezeichnung: string; readonly gesperrt?: boolean }[];
}

const BEKANNTMACHUNGEN: readonly Vorlage[] = [
  {
    quellId: 'demo-2026-0001', quelle: 'oeffentlichevergabe',
    titel: 'Unterhaltsreinigung von drei Dienstgebäuden in Berlin-Mitte',
    beschreibung: 'Laufende Unterhaltsreinigung, Glasreinigung zweimal jährlich, Lose 1 bis 3. '
      + 'Vertragslaufzeit 24 Monate mit Verlängerungsoption.',
    stelle: 'Bezirksamt Mitte von Berlin', ort: 'Berlin', plz: '10178',
    cpv: '90910000-9', cpvWeitere: ['90911200-8', '90919200-4'], nuts: ['DE300'],
    wertCent: 486_000_00n, waehrung: 'EUR', fristInTagen: 24,
    verfahrensart: 'Öffentliche Ausschreibung nach UVgO', oberhalb: false,
    dokumente: [
      { bezeichnung: 'Aufforderung zur Abgabe eines Angebots' },
      { bezeichnung: 'Leistungsverzeichnis Lose 1 bis 3' },
      { bezeichnung: 'Formblatt 124 — Eigenerklärung zur Eignung', gesperrt: true },
    ],
  },
  {
    quellId: 'demo-2026-0002', quelle: 'oeffentlichevergabe',
    titel: 'Objektschutz und Empfangsdienst für eine Schulliegenschaft',
    beschreibung: 'Bewachung ausserhalb der Unterrichtszeiten, Empfangsdienst werktags 06:00–18:00. '
      + 'Nachweis nach § 34a GewO erforderlich.',
    stelle: 'Senatsverwaltung für Bildung, Jugend und Familie', ort: 'Berlin', plz: '10707',
    cpv: '79713000-1', cpvWeitere: ['79710000-4'], nuts: ['DE300'],
    wertCent: 212_500_00n, waehrung: 'EUR', fristInTagen: 3,
    verfahrensart: 'Öffentliche Ausschreibung nach UVgO', oberhalb: false,
    plattformHinweis: 'vergabemarktplatz.berlin.de',
  },
  {
    quellId: 'demo-2026-0003', quelle: 'oeffentlichevergabe',
    titel: 'Rückbau und Innenausbau eines Verwaltungsgebäudes',
    beschreibung: 'Rückbau der Bestandsausstattung, Trockenbau, Malerarbeiten, Bodenbeläge. '
      + 'Bauzeit sechs Monate, Abschnitte nach Etagen.',
    stelle: 'Berliner Immobilienmanagement GmbH', ort: 'Berlin', plz: '10555',
    cpv: '45400000-1', cpvWeitere: ['45110000-1'], nuts: ['DE300'],
    wertCent: 1_940_000_00n, waehrung: 'EUR', fristInTagen: 38,
    verfahrensart: 'Öffentliche Ausschreibung nach VOB/A', oberhalb: false,
  },
  {
    quellId: 'demo-2026-0004', quelle: 'ted',
    titel: 'Gebäudereinigung für Liegenschaften des Bundes (Rahmenvereinbarung)',
    beschreibung: 'Rahmenvereinbarung über Unterhaltsreinigung, Laufzeit 48 Monate, '
      + 'mehrere Standorte im Bundesgebiet.',
    stelle: 'Bundesanstalt für Immobilienaufgaben', ort: 'Bonn', plz: '53179',
    cpv: '90910000-9', cpvWeitere: [], nuts: ['DEA22', 'DE300'],
    wertCent: 8_400_000_00n, waehrung: 'EUR', fristInTagen: 46,
    verfahrensart: 'Offenes Verfahren', oberhalb: true,
  },
  {
    quellId: 'demo-2026-0005', quelle: 'ted',
    titel: 'Nettoyage de bâtiments administratifs (Luxembourg)',
    beschreibung: 'Prestations de nettoyage courant pour trois bâtiments administratifs.',
    stelle: 'Administration des bâtiments publics', ort: 'Luxembourg', plz: '1468',
    cpv: '90910000-9', cpvWeitere: [], nuts: ['LU000'],
    /* Fremdwährung: wird NICHT umgerechnet (O-47) — das Wertkriterium bleibt unbewertet. */
    wertCent: 1_250_000_00n, waehrung: 'CHF', fristInTagen: 31,
    verfahrensart: 'Procédure ouverte', oberhalb: true,
  },
  {
    quellId: 'demo-2026-0006', quelle: 'oeffentlichevergabe',
    titel: 'Lieferung von Streusalz für den Winterdienst',
    beschreibung: 'Lieferung von 400 Tonnen Auftausalz, Abruf nach Bedarf.',
    stelle: 'Berliner Stadtreinigung', ort: 'Berlin', plz: '10553',
    cpv: '34927100-2', cpvWeitere: [], nuts: ['DE300'],
    wertCent: 96_000_00n, waehrung: 'EUR', fristInTagen: 12,
    verfahrensart: 'Öffentliche Ausschreibung nach UVgO', oberhalb: false,
  },
  {
    quellId: 'demo-2026-0007', quelle: 'oeffentlichevergabe',
    titel: 'Unterhaltsreinigung Kita-Verbund Pankow — aufgehoben',
    beschreibung: 'Das Verfahren wurde aufgehoben.',
    stelle: 'Bezirksamt Pankow von Berlin', ort: 'Berlin', plz: '13187',
    cpv: '90910000-9', cpvWeitere: [], nuts: ['DE300'],
    wertCent: 310_000_00n, waehrung: 'EUR', fristInTagen: 18,
    verfahrensart: 'Öffentliche Ausschreibung nach UVgO', oberhalb: false,
    aufgehoben: true,
  },
];

interface ProfilVorlage {
  readonly mandant: 'reinigung' | 'security' | 'bau';
  readonly name: string;
  readonly cpv: readonly { readonly code: string; readonly laenge: number }[];
  readonly positiv: readonly string[];
  readonly negativ: readonly string[];
  readonly minCent: bigint | null;
  readonly maxCent: bigint | null;
}

const PROFILE: readonly ProfilVorlage[] = [
  {
    mandant: 'reinigung', name: 'Unterhaltsreinigung Berlin',
    cpv: [{ code: '90910000', laenge: 8 }, { code: '90911200', laenge: 8 }, { code: '90919200', laenge: 8 }],
    positiv: ['Unterhaltsreinigung', 'Gebäudereinigung', 'Glasreinigung'],
    negativ: ['Baureinigung'],
    minCent: 50_000_00n, maxCent: 2_000_000_00n,
  },
  {
    mandant: 'security', name: 'Objektschutz Berlin',
    cpv: [{ code: '79710000', laenge: 8 }, { code: '79713000', laenge: 8 }, { code: '79714000', laenge: 8 }],
    positiv: ['Objektschutz', 'Bewachung', 'Empfangsdienst', 'Sicherheitsdienst'],
    negativ: ['Geld- und Werttransport'],
    minCent: 40_000_00n, maxCent: 1_500_000_00n,
  },
  {
    mandant: 'bau', name: 'Ausbau und Rückbau Berlin',
    /* Länge 2 fängt den ganzen Hochbau (45…) — genau dafür gibt es die Präfixlänge. */
    cpv: [{ code: '45000000', laenge: 2 }],
    positiv: ['Ausbau', 'Rückbau', 'Trockenbau', 'Sanierung'],
    negativ: ['Tiefbau', 'Straßenbau'],
    minCent: 100_000_00n, maxCent: 5_000_000_00n,
  },
];

export interface RadarSeedBefund {
  readonly profile: number;
  readonly bekanntmachungen: number;
  readonly bewertungen: number;
  readonly mappenpositionen: number;
  readonly empfaenger: number;
}

export async function seedRadar(
  sql: postgres.Sql, mandanten: ReadonlyMap<string, string>,
): Promise<RadarSeedBefund> {
  for (const v of BEKANNTMACHUNGEN) {
    const [a] = await sql<{ id: string }[]>`
      insert into ausschreibung
        (quelle, quell_id, quell_url, titel, beschreibung, sprache,
         vergabestelle_name, vergabestelle_ort, vergabestelle_plz,
         cpv_haupt, cpv_weitere, verfahrensart_roh, oberhalb_schwellenwert,
         wert_geschaetzt_cent, waehrung, veroeffentlicht_am, frist_angebot,
         plattform_hinweis, quell_status, rohdaten_hash)
      values (${v.quelle}::ausschreibung_quelle, ${v.quellId}, null, ${v.titel}, ${v.beschreibung},
              ${v.quelle === 'ted' && v.nuts[0]?.startsWith('LU') === true ? 'fr' : 'de'},
              ${v.stelle}, ${v.ort}, ${v.plz},
              ${v.cpv}, ${sql.array([...v.cpvWeitere])}, ${v.verfahrensart}, ${v.oberhalb},
              ${v.wertCent === null ? null : v.wertCent.toString()}::bigint, ${v.waehrung},
              now() - interval '6 days',
              ${v.fristInTagen === null ? null : `${String(v.fristInTagen)} days 6 hours`}::interval + now(),
              ${v.plattformHinweis ?? null},
              ${v.aufgehoben === true ? 'aufgehoben' : 'aktiv'}::quell_status,
              ${`seed-${v.quellId}`})
      on conflict (quelle, quell_id) do update set titel = excluded.titel
      returning id`;
    if (a === undefined) continue;
    for (const n of v.nuts) {
      await sql`insert into ausschreibung_nuts (ausschreibung_id, nuts_code)
                values (${a.id}, ${n}) on conflict do nothing`;
    }
    for (const d of v.dokumente ?? []) {
      await sql`insert into ausschreibung_dokument
                  (ausschreibung_id, bezeichnung, zugriff_gesperrt)
                values (${a.id}, ${d.bezeichnung}, ${d.gesperrt === true})
                on conflict (ausschreibung_id, coalesce(quell_url, bezeichnung)) do nothing`;
    }
  }

  let profile = 0;
  for (const p of PROFILE) {
    const mandantId = mandanten.get(p.mandant);
    if (mandantId === undefined) continue;
    const [zeile] = await sql<{ id: string }[]>`
      insert into radar_profil
        (mandant_id, name, nuts_praefixe, positiv_keywords, negativ_keywords,
         wert_min_cent, wert_max_cent, ist_platzhalter, ist_aktiv)
      values (${mandantId}, ${p.name}, ${sql.array(['DE3'])},
              ${sql.array([...p.positiv])}, ${sql.array([...p.negativ])},
              ${p.minCent === null ? null : p.minCent.toString()}::bigint,
              ${p.maxCent === null ? null : p.maxCent.toString()}::bigint,
              true, true)
      returning id`;
    if (zeile === undefined) continue;
    profile += 1;
    for (const c of p.cpv) {
      await sql`insert into radar_profil_cpv (mandant_id, radar_profil_id, cpv_code, praefix_laenge)
                values (${mandantId}, ${zeile.id}, ${c.code}, ${c.laenge})
                on conflict do nothing`;
    }
  }

  /**
   * **Bewertet wird sofort.** Sonst zeigte die Radarliste in einer frischen
   * Demodatenbank Bekanntmachungen ohne Punkte — und damit den einen
   * Zustand, den kein Mensch je sehen soll: eine Liste ohne Rangfolge, die
   * aussieht, als hätte die Bewertung nichts gefunden.
   */
  const [jetzt] = await sql<{ jetzt: Date }[]>`select now() as jetzt`;
  const lauf = await bewerteLauf(
    { unsafe: (a, w) => sql.unsafe(a, (w ?? []) as never[]) as Promise<readonly unknown[]> },
    { seit: new Date(0), jetzt: jetzt?.jetzt ?? new Date(0) });

  const mappe = await seedVergabemappe(sql, mandanten);
  const empfaenger = await seedEmpfaenger(sql, mandanten);

  return {
    profile, bekanntmachungen: BEKANNTMACHUNGEN.length, bewertungen: lauf.neueZeilen,
    mappenpositionen: mappe, empfaenger,
  };
}

/**
 * Eine Vergabemappe in Arbeit (RAD-07, D-07).
 *
 * **Warum ueberhaupt eine im Seed.** Eine leere Mappe zeigt nicht, wozu sie
 * da ist: der Zaehler steht auf 0 von 0, der Unterschied zwischen „liegt vor"
 * und „geprueft" ist unsichtbar, und die Frage, an der ein Angebot scheitert
 * — was fehlt noch — hat keine Antwort zum Ansehen. Diese Mappe hat beides:
 * Geprueftes und Offenes.
 *
 * **Und sie ist NICHT eingereicht.** Eine eingereichte Demomappe behauptete,
 * die Plattform haette etwas abgegeben; sie gibt nichts ab (D-07). Der Weg
 * dorthin bleibt der Knopf, den ein Mensch drueckt, nachdem er hochgeladen
 * hat.
 *
 * **Die Positionen sind ECHTE Formblattnamen aus deutschen Verfahren**, aber
 * sie sind keine Vorlage: welche Unterlagen eine Plattform bei welcher
 * Verfahrensart verlangt, ist offen (O-194). Sie stehen hier als Demodaten,
 * nicht als Katalog — die Anwendung legt von sich aus keine Position an.
 */
async function seedVergabemappe(
  sql: postgres.Sql, mandanten: ReadonlyMap<string, string>,
): Promise<number> {
  const mandantId = mandanten.get('reinigung');
  if (mandantId === undefined) return 0;

  const [a] = await sql<{ id: string }[]>`
    select id from ausschreibung where quell_id = 'demo-2026-0001'`;
  const [pruefer] = await sql<{ id: string }[]>`
    select id from benutzer where email = 'admin.reinigung@cse-gruppe.de'`;
  if (a === undefined || pruefer === undefined) return 0;

  /**
   * **Die Sitzung wird gesetzt, nicht umgangen.** `geprueft_von` muss die
   * angemeldete Person sein (`kern.unterschrift_ist_die_eigene`) — im Seed
   * heisst das: den Benutzer als GUC setzen und den Trigger arbeiten lassen.
   * Ihn fuer den Seed zu lockern hiesse, die Zusage genau dort aufzugeben, wo
   * sie zum ersten Mal geprueft wird.
   */
  return sql.begin(async (tx) => {
    await tx`select set_config('app.benutzer_id', ${pruefer.id}, true)`;

    const [v] = await tx<{ id: string }[]>`
      insert into ausschreibung_vorgang
        (mandant_id, ausschreibung_id, status, frist_angebot_snapshot,
         verantwortlich_benutzer_id, erstellt_von_art, erstellt_von)
      select ${mandantId}, ${a.id}, 'geprueft'::ausschreibung_status, s.frist_angebot,
             ${pruefer.id}, 'mensch', ${pruefer.id}
        from ausschreibung s where s.id = ${a.id}
      on conflict (mandant_id, ausschreibung_id) where geloescht_am is null do update
        set status = 'geprueft'
      returning id`;
    if (v === undefined) return 0;

    const [m] = await tx<{ id: string }[]>`
      insert into vergabemappe
        (mandant_id, ausschreibung_vorgang_id, status, luecken_hinweis,
         erstellt_von_art, erstellt_von)
      values (${mandantId}, ${v.id}, 'in_arbeit',
              'Die Eigenerklärung zur Eignung liegt nur als Scan des Vorjahres vor — '
              || 'Formblatt 124 muss neu unterschrieben werden.', 'mensch', ${pruefer.id})
      on conflict (mandant_id, ausschreibung_vorgang_id) where geloescht_am is null do update
        set status = 'in_arbeit'
      returning id`;
    if (m === undefined) return 0;

    /* Jetzt erst der Stand: der Trigger verlangt die Mappe VOR `in_bearbeitung`. */
    await tx`update ausschreibung_vorgang set status = 'in_bearbeitung',
                    status_geaendert_am = now(), status_geaendert_von = ${pruefer.id}
              where id = ${v.id}`;

    const positionen: readonly {
      bezeichnung: string; kategorie: string; pflicht: boolean;
      stand: 'offen' | 'geprueft' | 'nicht_zutreffend'; hinweis?: string;
    }[] = [
      { bezeichnung: 'Angebotsschreiben (Formblatt 213)', kategorie: 'Formblatt',
        pflicht: true, stand: 'geprueft' },
      { bezeichnung: 'Preisblatt Lose 1 bis 3', kategorie: 'Preis',
        pflicht: true, stand: 'geprueft' },
      { bezeichnung: 'Formblatt 124 — Eigenerklärung zur Eignung', kategorie: 'Eignung',
        pflicht: true, stand: 'offen' },
      { bezeichnung: 'Unbedenklichkeitsbescheinigung Finanzamt', kategorie: 'Eignung',
        pflicht: true, stand: 'offen' },
      { bezeichnung: 'Verzeichnis der Nachunternehmerleistungen', kategorie: 'Eignung',
        pflicht: false, stand: 'nicht_zutreffend',
        hinweis: 'Alle Leistungen werden mit eigenem Personal erbracht.' },
      { bezeichnung: 'Referenzen vergleichbarer Objekte', kategorie: 'Eignung',
        pflicht: true, stand: 'geprueft' },
    ];

    /*
     * **Erst leeren, dann fuellen.** `on conflict` geht hier nicht: der
     * Eindeutigkeitsschluessel der Positionen ist `deferrable` (damit sich
     * Zeilen innerhalb einer Transaktion umsortieren lassen), und Postgres
     * nimmt einen aufgeschobenen Schluessel nicht als Schiedsrichter. Fuer
     * einen Seed ist das ohnehin das ehrlichere Vorgehen: die Demomappe ist
     * danach genau die hier beschriebene und keine Mischung aus zwei Laeufen.
     */
    await tx`delete from vergabemappe_position where vergabemappe_id = ${m.id}`;

    let nummer = 0;
    for (const p of positionen) {
      nummer += 1;
      /*
       * `geprueft` verlangt eine beigelegte Datei — im Seed gibt es keine
       * hochgeladenen Dokumente, also entsteht je geprueefter Zeile eine
       * Dokumentzeile. Sie ist als Demo erkennbar: kein Speicherpfad, der auf
       * eine Datei zeigt, die es nicht gibt.
       */
      let dokument: string | null = null;
      if (p.stand === 'geprueft') {
        const [d] = await tx<{ id: string }[]>`
          insert into dokument
            (mandant_id, kategorie, titel, objekt_schluessel, mime_typ, mime_verifiziert,
             groesse_bytes, exif_entfernt, entstanden_am)
          values (${mandantId}, 'vertrag', ${p.bezeichnung},
                  ${`demo/vergabe/${String(nummer)}.pdf`}, 'application/pdf', true,
                  1024, true, now())
          returning id`;
        dokument = d?.id ?? null;
      }
      await tx`
        insert into vergabemappe_position
          (mandant_id, vergabemappe_id, position, bezeichnung, kategorie, pflicht, status,
           dokument_id, luecke_hinweis, geprueft_von, geprueft_am, erstellt_von_art, erstellt_von)
        values (${mandantId}, ${m.id}, ${nummer}, ${p.bezeichnung}, ${p.kategorie},
                ${p.pflicht}, ${p.stand}::mappe_position_status, ${dokument},
                ${p.hinweis ?? null},
                ${p.stand === 'geprueft' ? pruefer.id : null},
                ${p.stand === 'geprueft' ? new Date() : null},
                'mensch', ${pruefer.id})`;
    }
    return positionen.length;
  }) as Promise<number>;
}

/**
 * Die Empfänger einer Radarmeldung (RAD-08) — **ohne Punktschwelle**.
 *
 * **Warum eingetragen, aber ohne Zahl.** Der Fristenwächter (SPEC §14) läuft
 * ohne jede Einstellung: fünf Tage stehen im SPEC. Die Trefferschwelle steht
 * dort nicht, und sie zu raten hiesse, eine Entscheidung des Betriebs zu
 * erfinden (O-15) — eine zu niedrige Zahl macht Lärm, eine zu hohe Stille,
 * und beides fällt erst auf, wenn eine Vergabe verpasst ist.
 *
 * Der Seed legt deshalb genau die Lage an, die ein neuer Betrieb hat: die
 * Einsatzleitung ist eingetragen, bekommt die Fristwarnungen, und die
 * Profilseite sagt bei jedem Empfänger, dass ohne Schwelle keine
 * Treffermeldung kommt. Eine gesetzte Demoschwelle sähe aus wie eine
 * beantwortete Frage.
 */
async function seedEmpfaenger(
  sql: postgres.Sql, mandanten: ReadonlyMap<string, string>,
): Promise<number> {
  const zuordnung: readonly [string, string][] = [
    ['reinigung', 'admin.reinigung@cse-gruppe.de'],
    ['bau', 'admin.bau@cse-gruppe.de'],
    ['security', 'leitung.security@cse-gruppe.de'],
  ];
  let angelegt = 0;
  for (const [bereich, email] of zuordnung) {
    const mandantId = mandanten.get(bereich);
    if (mandantId === undefined) continue;
    const [u] = await sql<{ id: string }[]>`select id from benutzer where email = ${email}`;
    if (u === undefined) continue;
    const ergebnis = await sql<{ id: string }[]>`
      insert into radar_profil_empfaenger (mandant_id, radar_profil_id, benutzer_id, ab_punkte)
      select ${mandantId}, p.id, ${u.id}, null
        from radar_profil p
       where p.mandant_id = ${mandantId} and p.geloescht_am is null
      on conflict (radar_profil_id, benutzer_id) do nothing
      returning id`;
    angelegt += ergebnis.length;
  }
  return angelegt;
}

/**
 * **Eine Bekanntmachung wird zum Lead** (V-139, CRM-07, D-633).
 *
 * CRM-07 nennt den Vergaberadar als Leadquelle, und die Auswertung
 * beschriftete „Vergaberadar" — im Seed entstand nie ein solcher Lead, und
 * der Weg dorthin hatte keinen Knopf. Hier geht er über den ECHTEN Dienst,
 * in einer Portalsitzung der Bauleitung: dieselbe Prüfung auf `radar.lesen`,
 * dieselbe Policy auf `lead`, dieselbe Sperre gegen die zweite Übernahme.
 *
 * Der Bau, weil die Bekanntmachung „Rückbau und Innenausbau" dort hingehört.
 * Wiederholbar: steht der Lead schon, geschieht nichts.
 */
export async function seedRadarLead(
  sql: postgres.Sql<Record<string, unknown>>, mandanten: ReadonlyMap<string, string>,
): Promise<string | null> {
  const mandantId = mandanten.get('bau');
  if (mandantId === undefined) return null;
  const [a] = await sql<{ id: string }[]>`
    select id from ausschreibung where quell_id = 'demo-2026-0003' limit 1`;
  if (a === undefined) return null;
  const [schon] = await sql<{ id: string }[]>`
    select id from lead where mandant_id = ${mandantId} and ausschreibung_id = ${a.id}`;
  if (schon !== undefined) return null;
  const [wer] = await sql<{ id: string }[]>`
    select b.id from benutzer b
      join benutzer_mandant bm on bm.benutzer_id = b.id and bm.mandant_id = ${mandantId}
      join rolle r on r.id = bm.rolle_id
     where r.schluessel in ('admin', 'leitung') and b.status = 'aktiv'
       and bm.entzogen_am is null and not b.ist_dienstkonto
     order by (r.schluessel = 'leitung') desc, b.email limit 1`;
  if (wer === undefined) return null;
  const neu = await alsPortalSitzung(sql, mandantId, wer.id, (kontext) =>
    uebernimmAusschreibungAlsLead(kontext, a.id, { besitzerBenutzerId: wer.id }));
  return neu.leadnummer;
}
