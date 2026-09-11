/**
 * Der Materialisierer: aus Serien werden Zeilen (TIM-03, §8.2).
 *
 * Die Rechnung steht nebenan in `vorkommnisse.ts` und kennt keine Datenbank.
 * Hier steht der Teil, der ohne eine nicht pruefbar waere: die Sperre, der
 * Upsert, das Stornieren verwaister Schichten und der Bericht.
 *
 * ## Vier Zusagen, und wo sie im Code stehen
 *
 * 1. **Zweimal laufen erzeugt nichts Neues.** Der Upsert trifft auf
 *    `einsatz_quelle_uk (mandant_id, quell_schluessel) where storniert_am is
 *    null`. Der Schluessel nennt die urspruengliche Identitaet des
 *    Vorkommnisses, nicht seinen aktuellen Termin — deshalb ueberlebt er auch
 *    eine Verschiebung (§8.3).
 * 2. **Die Vergangenheit wird nicht angefasst.** `where einsatz.beginn_zeitpunkt
 *    > now()`. Ein Dienstplan von gestern ist ein Beleg, kein Entwurf.
 * 3. **Was schon gearbeitet wurde, erst recht nicht.** Sobald ein
 *    `zeiteintrag` an der Schicht haengt, bleibt sie, wie sie ist — auch wenn
 *    die Serie sich geaendert hat. Gefragt wird ueber
 *    `app.einsatz_hat_zeiterfassung`, weil `zeiteintrag` erst in PR 34
 *    entsteht: die Bedingung solange wegzulassen waere ein Schutz, der
 *    verschwindet, ohne dass es jemand sieht.
 * 4. **Nichts wird verschluckt.** Was (2) und (3) uebersprungen haben, steht
 *    im Bericht und in `planungsserie.letzte_meldung` (§8.4). Eine still
 *    nicht angewandte Serienaenderung ist ein Plan, der aussieht wie bestellt.
 *
 * ## Und was hier NICHT passiert
 *
 * Geloescht wird nichts (Invariante 8). Eine Schicht, deren Vorkommnis es
 * nicht mehr gibt, wird storniert und traegt den Grund.
 */
import {
  planeVorkommnisse, type Ausnahme, type Bedarfstraeger, type GeplanterEinsatz,
} from './vorkommnisse.js';
import { tagePlus } from '@/lib/datum/kalendertag';

export interface Abfrage {
  unsafe(sql: string, werte?: readonly unknown[]): Promise<readonly unknown[]>;
}

/** Eine Serie mit allem, was ihre Materialisierung braucht. */
export interface SerienZeile extends Bedarfstraeger {
  readonly mandantId: string;
  readonly objektId: string;
  /**
   * `null`, wenn am Objekt kein Kunde haengt. `einsatz.kunde_id` ist NOT NULL
   * (denormalisiert fuer die Kundendecke, §1.8), also ist so eine Serie nicht
   * materialisierbar — und das wird GEMELDET statt geworfen: eine Serie ohne
   * Kunden darf nicht den Lauf aller anderen abbrechen.
   */
  readonly kundeId: string | null;
  readonly auftragId: string | null;
  readonly auftragLeistungId: string | null;
  readonly turnusId: string | null;
  readonly postenId: string | null;
  readonly veranstaltungId: string | null;
  readonly revierId: string | null;
  readonly horizontTage: number;
  readonly feiertagBundesland: string;
  readonly feiertageUeberspringen: boolean;
}

export interface Lauflage {
  /** Der Tag, ab dem materialisiert wird — **Berliner** Kalendertag, vom Server. */
  readonly heute: string;
  readonly laufId: string | null;
}

export interface SerienBericht {
  readonly planungsserieId: string;
  readonly erzeugt: number;
  readonly aktualisiert: number;
  readonly storniert: number;
  readonly uebersprungen: readonly { readonly quellSchluessel: string; readonly grund: string }[];
  readonly generiertBis: string;
}

interface EinsatzZeile {
  id: string;
  quell_schluessel: string;
  neu: boolean;
}

/** Der Tag „heute" nach der **Berliner** Wanduhr, aus der Serveruhr (Invariante 5). */
export async function berlinHeute(db: Abfrage): Promise<string> {
  const [z] = (await db.unsafe(
    `select to_char((now() at time zone 'Europe/Berlin')::date, 'YYYY-MM-DD') as tag`,
  )) as { tag: string }[];
  return z!.tag;
}

/**
 * Der letzte Tag des Horizonts — `heute + tage - 1`, nicht `heute + tage`.
 *
 * `horizont_tage` ist eine ANZAHL von Tagen, und das Fenster schliesst beide
 * Enden ein. Mit `heute + 56` waeren es 57 Tage, und eine woechentliche Serie
 * ergaebe neun statt der acht Wochen, die TIM-03 nennt — jede Nacht eine
 * Schicht zu viel am Rand, die am naechsten Tag wieder verschwaende.
 */
function horizontEnde(heute: string, tage: number): string {
  return tagePlus(heute, Math.max(0, tage - 1));
}

/**
 * Materialisiert genau eine Serie.
 *
 * Die Sperre ist eine `pg_advisory_xact_lock` auf den Serienschluessel: zwei
 * gleichzeitige Laeufe — der naechtliche und ein manuell angestossener —
 * duerfen nicht beide dieselbe Nacht anlegen. Sie faellt mit der Transaktion,
 * also gibt es keinen Weg, sie zu vergessen.
 */
export async function materialisiereSerie(
  db: Abfrage, serie: SerienZeile, ausnahmen: readonly Ausnahme[], lage: Lauflage,
): Promise<SerienBericht> {
  if (serie.kundeId === null) {
    throw new Error(
      `Serie ${serie.planungsserieId}: Objekt ${serie.objektId} hat keinen Kunden. ` +
        '`einsatz.kunde_id` ist NOT NULL — die Serie ist nicht materialisierbar.',
    );
  }
  await db.unsafe(
    `select pg_advisory_xact_lock(hashtext($1))`,
    [`einsatz_generator:${serie.planungsserieId}`],
  );

  const bis = horizontEnde(lage.heute, serie.horizontTage);
  const feiertage = await ladeFeiertage(db, serie.feiertagBundesland, lage.heute, bis);
  const { einsaetze, uebersprungen } = planeVorkommnisse(
    serie,
    ausnahmen,
    // Die Feiertagsregel des Traegers entscheidet, ob die Tage ueberhaupt
    // wirken; wo sie nicht wirkt, wird die Karte leer uebergeben, damit
    // `feiertag_id` nicht faelschlich gesetzt wird.
    serie.feiertageUeberspringen || serie.feiertagsregel === 'unveraendert'
      ? feiertage.namen
      : new Map<string, string>(),
    { vonDatum: lage.heute, bisDatum: bis },
  );

  let erzeugt = 0;
  let aktualisiert = 0;
  const geschrieben: string[] = [];
  const nichtAngewandt: { quellSchluessel: string; grund: string }[] =
    uebersprungen.map((u) => ({ quellSchluessel: u.quellSchluessel, grund: u.grund }));

  for (const e of einsaetze) {
    const zeilen = (await db.unsafe(
      upsertText(),
      werte(serie, e, feiertage.ids, lage.laufId),
    )) as EinsatzZeile[];
    if (zeilen.length === 0) {
      // Der `where`-Wachtposten hat zugeschlagen: die Schicht liegt in der
      // Vergangenheit oder ist schon gearbeitet. Das ist kein Fehler — aber
      // es steht im Bericht, sonst laeuft der Plan still aus dem Muster.
      nichtAngewandt.push({ quellSchluessel: e.quellSchluessel, grund: 'vergangen_oder_gearbeitet' });
      continue;
    }
    geschrieben.push(e.quellSchluessel);
    if (zeilen[0]!.neu) erzeugt += 1;
    else aktualisiert += 1;
  }

  const storniert = await storniereVerwaiste(db, serie, geschrieben, lage);
  await schreibeSerienstand(db, serie, bis, lage, {
    erzeugt, aktualisiert, storniert, uebersprungen: nichtAngewandt,
  });

  return {
    planungsserieId: serie.planungsserieId,
    erzeugt, aktualisiert, storniert,
    uebersprungen: nichtAngewandt,
    generiertBis: bis,
  };
}

interface Feiertagsfenster {
  readonly namen: ReadonlyMap<string, string>;
  readonly ids: ReadonlyMap<string, string>;
}

async function ladeFeiertage(
  db: Abfrage, bundesland: string, von: string, bis: string,
): Promise<Feiertagsfenster> {
  const zeilen = (await db.unsafe(
    `select id, to_char(datum,'YYYY-MM-DD') as datum, bezeichnung
       from feiertag
      where bundesland = $1 and gesetzlich and datum between $2::date and $3::date`,
    [bundesland, von, bis],
  )) as { id: string; datum: string; bezeichnung: string }[];
  const namen = new Map<string, string>();
  const ids = new Map<string, string>();
  for (const z of zeilen) {
    namen.set(z.datum, z.bezeichnung);
    ids.set(z.datum, z.id);
  }
  return { namen, ids };
}

/**
 * Der Upsert (§8.2 Schritt 7).
 *
 * Die Instants kommen aus `app.loese_ortszeit` — IN DER ANWEISUNG, nicht aus
 * dem Node-Prozess (§7.2). Das Ende bekommt seinen eigenen Aufruf: es ist ein
 * eigener Wanduhr-Anker und nicht der Anfang plus eine Dauer, sonst waere die
 * Schicht in der Umstellungsnacht eine Stunde zu lang.
 *
 * `zeitanomalie` kommt vom ANFANG. Nur der ist der Anker, den die Serie nennt;
 * ein Ende in der Luecke ist eine Folge, kein eigener Befund.
 */
function upsertText(): string {
  return `
    with anfang as (select * from app.loese_ortszeit($12::date, $13::time, $14)),
         ende   as (select * from app.loese_ortszeit(
                      ($12::date + case when $16 then 1 else 0 end), $15::time, $14))
    insert into einsatz (
      mandant_id, planungsserie_id, quelle, turnus_id, posten_id, veranstaltung_id,
      revier_id, objekt_id, kunde_id, auftrag_id, auftrag_leistung_id,
      quell_schluessel, plan_datum, beginn_zeitpunkt, ende_zeitpunkt, zeitzone,
      beginn_lokal, ende_lokal, endet_am_folgetag, zeitanomalie,
      soll_besetzung, min_besetzung, feiertag_id, generator_lauf_id,
      erstellt_von_art, status
    )
    select $1, $2, $3::einsatz_quelle, $4, $5, $6,
           $7, $8, $9, $10, $11,
           $17, $12::date, anfang.zeitpunkt, ende.zeitpunkt, $14,
           $13::time, $15::time, $16, anfang.anomalie,
           $18, $19, $20, $21,
           'system', 'geplant'
      from anfang, ende
    on conflict (mandant_id, quell_schluessel) where storniert_am is null
    do update set
        plan_datum        = excluded.plan_datum,
        beginn_zeitpunkt  = excluded.beginn_zeitpunkt,
        ende_zeitpunkt    = excluded.ende_zeitpunkt,
        beginn_lokal      = excluded.beginn_lokal,
        ende_lokal        = excluded.ende_lokal,
        endet_am_folgetag = excluded.endet_am_folgetag,
        zeitanomalie      = excluded.zeitanomalie,
        soll_besetzung    = excluded.soll_besetzung,
        min_besetzung     = excluded.min_besetzung,
        feiertag_id       = excluded.feiertag_id,
        generator_lauf_id = excluded.generator_lauf_id
      where einsatz.beginn_zeitpunkt > now()
        and not app.einsatz_hat_zeiterfassung(einsatz.id)
    returning id, quell_schluessel, (xmax = 0) as neu`;
}

function werte(
  serie: SerienZeile, e: GeplanterEinsatz, feiertagIds: ReadonlyMap<string, string>,
  laufId: string | null,
): readonly unknown[] {
  return [
    serie.mandantId, serie.planungsserieId, serie.quelle,
    serie.turnusId, serie.postenId, serie.veranstaltungId,
    serie.revierId, serie.objektId, serie.kundeId, serie.auftragId, serie.auftragLeistungId,
    e.planDatum, e.beginnLokal, serie.zeitzone, e.endeLokal, e.endetAmFolgetag,
    e.quellSchluessel, e.sollBesetzung, e.minBesetzung,
    e.feiertagDatum === null ? null : (feiertagIds.get(e.feiertagDatum) ?? null),
    laufId,
  ];
}

/**
 * Schichten, deren Vorkommnis es nicht mehr gibt.
 *
 * Storniert, nicht geloescht (Invariante 8) — und nur in der Zukunft und nur
 * ohne Zeiteintrag, aus denselben Gruenden wie oben. Der Grund steht in der
 * Zeile, damit im Dienstplan nicht einfach eine Schicht fehlt.
 */
async function storniereVerwaiste(
  db: Abfrage, serie: SerienZeile, behalten: readonly string[], lage: Lauflage,
): Promise<number> {
  const zeilen = (await db.unsafe(
    `update einsatz e
        set status        = 'storniert',
            storniert_am  = now(),
            storno_grund  = 'serie_geaendert',
            generator_lauf_id = $3
      where e.planungsserie_id = $1
        and e.storniert_am is null
        and e.beginn_zeitpunkt > now()
        and not (e.quell_schluessel = any($2::text[]))
        and not app.einsatz_hat_zeiterfassung(e.id)
      returning e.id`,
    [serie.planungsserieId, behalten, lage.laufId],
  )) as { id: string }[];
  return zeilen.length;
}

async function schreibeSerienstand(
  db: Abfrage, serie: SerienZeile, bis: string, lage: Lauflage,
  meldung: Record<string, unknown>,
): Promise<void> {
  await db.unsafe(
    `update planungsserie
        set generiert_bis         = $2::date,
            letzte_generierung_am = now(),
            letzter_job_lauf_id   = $3,
            letzte_meldung        = $4::jsonb
      where id = $1`,
    // Das OBJEKT, nicht sein JSON-Text: `JSON.stringify` in einem
    // `::jsonb`-Parameter legt eine JSON-Zeichenkette in die Spalte, und jeder
    // spaetere `->>`-Zugriff greift ins Leere (siehe `arbzg/detektor.ts`).
    [serie.planungsserieId, bis, lage.laufId, meldung],
  );
}

/**
 * Die faelligen Serien eines Mandanten — aus `app.planungsbedarf` (§8.1).
 *
 * Die Funktion liefert den Bedarf ueber ALLE Traeger in einer Abfrage. Was
 * sie nicht liefert, weil es nicht zum Traeger gehoert, sondern zum
 * Ausfuehrungsprotokoll, kommt aus `planungsserie` daneben: Horizont,
 * Bundesland und die Feiertagsentscheidung, die dort bei der Anlage
 * festgeschrieben wurde (§8.5) — eine spaetere Stammdatenpflege soll die
 * Historie nicht umdatieren.
 */
export async function ladeSerien(
  db: Abfrage, mandantId: string, von: string, bis: string,
): Promise<readonly SerienZeile[]> {
  const zeilen = (await db.unsafe(
    `select b.planungsserie_id, b.quelle::text as quelle, b.carrier_id,
            b.objekt_id, b.revier_id, b.posten_id, b.veranstaltung_id,
            b.auftrag_leistung_id, b.rrule,
            to_char(b.dtstart_lokal, 'YYYY-MM-DD') as dtstart_datum,
            extract(hour   from b.dtstart_lokal)::int as dtstart_stunde,
            extract(minute from b.dtstart_lokal)::int as dtstart_minute,
            b.zeitzone, b.dauer_minuten, b.soll_besetzung, b.min_besetzung,
            b.feiertagsregel::text as feiertagsregel,
            to_char(b.gueltig_ab, 'YYYY-MM-DD') as gueltig_ab,
            to_char(b.gueltig_bis, 'YYYY-MM-DD') as gueltig_bis,
            ps.mandant_id, ps.horizont_tage, ps.feiertag_bundesland,
            ps.feiertage_ueberspringen, ps.turnus_id,
            o.kunde_id
       from app.planungsbedarf($1, $2::date, $3::date) b
       join planungsserie ps on ps.id = b.planungsserie_id
       join objekt o         on o.mandant_id = ps.mandant_id and o.id = b.objekt_id
      order by b.planungsserie_id`,
    [mandantId, von, bis],
  )) as Record<string, unknown>[];

  return zeilen.map((z) => ({
    planungsserieId: z['planungsserie_id'] as string,
    quelle: z['quelle'] as SerienZeile['quelle'],
    mandantId: z['mandant_id'] as string,
    objektId: z['objekt_id'] as string,
    kundeId: z['kunde_id'] as string,
    auftragId: null,
    auftragLeistungId: (z['auftrag_leistung_id'] as string | null),
    turnusId: (z['turnus_id'] as string | null),
    postenId: (z['posten_id'] as string | null),
    veranstaltungId: (z['veranstaltung_id'] as string | null),
    revierId: (z['revier_id'] as string | null),
    rrule: (z['rrule'] as string | null),
    dtstartLokal: {
      datum: z['dtstart_datum'] as string,
      stunde: z['dtstart_stunde'] as number,
      minute: z['dtstart_minute'] as number,
    },
    zeitzone: z['zeitzone'] as string,
    dauerMinuten: Number(z['dauer_minuten']),
    sollBesetzung: Number(z['soll_besetzung']),
    minBesetzung: Number(z['min_besetzung']),
    feiertagsregel: z['feiertagsregel'] as SerienZeile['feiertagsregel'],
    gueltigAb: z['gueltig_ab'] as string,
    gueltigBis: (z['gueltig_bis'] as string | null),
    horizontTage: Number(z['horizont_tage']),
    feiertagBundesland: z['feiertag_bundesland'] as string,
    feiertageUeberspringen: z['feiertage_ueberspringen'] === true,
  }));
}

/**
 * Die Ausnahmen einer Serie im Fenster.
 *
 * Sie kommen nach Traeger getrennt, weil sie in getrennten Tabellen liegen
 * (`turnus_ausnahme`, spaeter `posten_ausnahme`). Ein Traeger ohne
 * Ausnahmetabelle liefert eine leere Liste — nicht `null`, damit der Aufrufer
 * keinen Sonderfall braucht.
 */
export async function ladeAusnahmen(
  db: Abfrage, serie: SerienZeile, von: string, bis: string,
): Promise<readonly Ausnahme[]> {
  if (serie.turnusId === null) return [];
  const zeilen = (await db.unsafe(
    `select id, to_char(datum,'YYYY-MM-DD') as datum, art::text as art,
            to_char(ersatz_beginn_lokal, 'YYYY-MM-DD"T"HH24:MI') as ersatz_beginn_lokal,
            dauer_minuten
       from turnus_ausnahme
      where mandant_id = $1 and turnus_id = $2 and datum between $3::date and $4::date`,
    [serie.mandantId, serie.turnusId, von, bis],
  )) as Record<string, unknown>[];
  return zeilen.map((z) => ({
    id: z['id'] as string,
    datum: z['datum'] as string,
    art: z['art'] as Ausnahme['art'],
    ersatzBeginnLokal: (z['ersatz_beginn_lokal'] as string | null),
    dauerMinuten: z['dauer_minuten'] === null ? null : Number(z['dauer_minuten']),
  }));
}

/** Ein ganzer Lauf fuer einen Mandanten — alle faelligen Serien. */
export async function generiereEinsaetze(
  db: Abfrage, mandantId: string, lage: Lauflage,
): Promise<readonly SerienBericht[]> {
  // Das Fenster der SUCHE ist der groesste Horizont; jede Serie schneidet sich
  // daraus ihr eigenes. Ein Fenster je Serie waere eine Abfrage je Serie.
  const [g] = (await db.unsafe(
    `select coalesce(max(horizont_tage), 56) as tage from planungsserie
      where mandant_id = $1 and archiviert_am is null`, [mandantId],
  )) as { tage: number }[];
  const bis = horizontEnde(lage.heute, Number(g?.tage ?? 56));

  const serien = await ladeSerien(db, mandantId, lage.heute, bis);
  const berichte: SerienBericht[] = [];
  for (const serie of serien) {
    if (serie.kundeId === null) {
      berichte.push({
        planungsserieId: serie.planungsserieId,
        erzeugt: 0, aktualisiert: 0, storniert: 0,
        uebersprungen: [{ quellSchluessel: '-', grund: 'objekt_ohne_kunde' }],
        generiertBis: lage.heute,
      });
      continue;
    }
    const ausnahmen = await ladeAusnahmen(
      db, serie, lage.heute, horizontEnde(lage.heute, serie.horizontTage),
    );
    berichte.push(await materialisiereSerie(db, serie, ausnahmen, lage));
  }
  return berichte;
}
