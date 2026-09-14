import type postgres from 'postgres';
import { bewerteLauf } from '../../services/radar/lauf.js';

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

  return {
    profile, bekanntmachungen: BEKANNTMACHUNGEN.length, bewertungen: lauf.neueZeilen,
  };
}
