import 'server-only';
import { cent, type Cent } from './geld.js';

/**
 * Eingangsrechnungen: erfassen, prüfen, freigeben, buchen (FIN-14, ACC-03,
 * ACC-05; `05-FINANZEN.md` §8.2, PR 54.3).
 *
 * **Was dieser Dienst NICHT tut: raten.** Er liest keine PDF, er schätzt
 * keinen Betrag und er leitet kein Zahlungsziel ab. Die Extraktion (ACC-05,
 * PR 63) schlägt vor, ein Mensch übernimmt, und erst dann schreibt dieser
 * Dienst die getypten Spalten — Invariante 6, und zwar baulich: hier gibt es
 * keine Stelle, an der ein Modell einen Betrag setzen könnte.
 *
 * **Die Dublettenwarnung kommt VOR dem Speichern.** Die Datenbank hat einen
 * eindeutigen Index (`er_dublette_uk`), und der ist der Riegel. Ein Riegel
 * allein ergibt aber eine Fehlermeldung nach dem Ausfüllen eines langen
 * Formulars; die Abnahme verlangt eine WARNUNG, bevor gespeichert wird.
 * `pruefeDublette` liefert sie — und ersetzt den Riegel nicht, sie geht ihm
 * voraus.
 */

export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export type EingangsStatus =
  'eingegangen' | 'in_pruefung' | 'freigegeben' | 'gebucht' | 'abgelehnt';

export type BelegTyp =
  | 'ausgangsrechnung' | 'eingangsrechnung' | 'gutschrift' | 'kassenbeleg'
  | 'bankbeleg' | 'vertrag' | 'sonstiges';

export type BelegQuelle = 'upload' | 'email' | 'scan' | 'api';

export class EingangsrechnungFehler extends Error {
  constructor(
    nachricht: string,
    readonly grund: 'nicht_gefunden' | 'dublette' | 'unvollstaendig' | 'abgewiesen'
      | 'vier_augen',
  ) {
    super(nachricht);
    this.name = 'EingangsrechnungFehler';
  }
}

// ---------------------------------------------------------------------------
// Die Dublettenwarnung (Abnahme 3)
// ---------------------------------------------------------------------------

export interface DublettenTreffer {
  readonly id: string;
  readonly interneBelegnummer: string | null;
  readonly rechnungsdatum: string | null;
  readonly bruttoCent: Cent | null;
  readonly status: EingangsStatus;
}

export interface DublettenBefund {
  readonly istDublette: boolean;
  readonly treffer: readonly DublettenTreffer[];
  /** Der Satz, den die Oberfläche zeigt. `null`, wenn nichts gefunden wurde. */
  readonly warnung: string | null;
}

/**
 * Gibt es diese Lieferantenrechnung schon?
 *
 * Der Schlüssel ist derselbe wie der des Index: Lieferant, Rechnungsnummer
 * und JAHR. Das Jahr gehört dazu, weil ein Lieferant, der jeden Januar bei
 * `001` neu beginnt, sonst mit sich selbst kollidiert — und abgelehnte Belege
 * zählen nicht, weil eine irrtümliche Ablehnung sonst die Neuerfassung
 * blockierte.
 */
export async function pruefeDublette(
  db: Abfrage,
  eingabe: {
    readonly lieferantId: string | null;
    readonly rechnungsnummerLieferant: string | null;
    readonly rechnungsdatum: string | null;
    /** Beim Bearbeiten: die eigene Zeile ist keine Dublette ihrer selbst. */
    readonly ausserId?: string | null;
  },
): Promise<DublettenBefund> {
  if (eingabe.lieferantId === null || eingabe.rechnungsnummerLieferant === null
      || eingabe.rechnungsdatum === null) {
    return { istDublette: false, treffer: [], warnung: null };
  }

  const zeilen = await db.abfrage<{
    id: string; interne_belegnummer: string | null; rechnungsdatum: string | null;
    brutto_cent: string | null; status: EingangsStatus;
  }>(
    `select id, interne_belegnummer, to_char(rechnungsdatum, 'DD.MM.YYYY') as rechnungsdatum,
            brutto_cent::text, status::text as status
       from eingangsrechnung
      where lieferant_id = $1::uuid
        and rechnungsnummer_lieferant = $2
        and extract(year from rechnungsdatum) = extract(year from $3::date)
        and status <> 'abgelehnt'
        and ($4::uuid is null or id <> $4::uuid)
      order by erstellt_am`,
    [eingabe.lieferantId, eingabe.rechnungsnummerLieferant, eingabe.rechnungsdatum,
     eingabe.ausserId ?? null]);

  const treffer = zeilen.map((z) => ({
    id: z.id,
    interneBelegnummer: z.interne_belegnummer,
    rechnungsdatum: z.rechnungsdatum,
    bruttoCent: z.brutto_cent === null ? null : cent(BigInt(z.brutto_cent)),
    status: z.status,
  }));

  return {
    istDublette: treffer.length > 0,
    treffer,
    warnung: treffer.length === 0 ? null
      : `Rechnung ${eingabe.rechnungsnummerLieferant} dieses Lieferanten liegt `
        + `für ${eingabe.rechnungsdatum.slice(0, 4)} bereits vor`
        + (treffer[0]!.interneBelegnummer === null
          ? ' (noch ohne Belegnummer).'
          : ` als Beleg ${treffer[0]!.interneBelegnummer}.`),
  };
}

// ---------------------------------------------------------------------------
// Beleg und Erfassung
// ---------------------------------------------------------------------------

export interface BelegAnlegen {
  readonly typ: BelegTyp;
  readonly quelle: BelegQuelle;
  readonly dokumentId: string;
  readonly dokumentVersionId: string;
  readonly dateiSha256: string;
  readonly belegnummer?: string | null;
  readonly belegdatum?: string | null;
  readonly seiten?: number | null;
  readonly betragBruttoCent?: Cent | null;
}

export async function legeBelegAn(db: Abfrage, e: BelegAnlegen): Promise<string> {
  const [zeile] = await db.abfrage<{ id: string }>(
    `insert into beleg (mandant_id, belegnummer, typ, quelle, dokument_id,
                        dokument_version_id, datei_sha256, seiten, belegdatum,
                        betrag_brutto_cent, erstellt_von_art, erstellt_von)
     values (app.aktiver_mandant(), $1, $2::beleg_typ, $3::beleg_quelle, $4::uuid,
             $5::uuid, $6, $7, $8::date, $9::bigint, 'mensch', app.aktueller_benutzer())
     returning id`,
    [e.belegnummer ?? null, e.typ, e.quelle, e.dokumentId, e.dokumentVersionId,
     e.dateiSha256, e.seiten ?? null, e.belegdatum ?? null,
     e.betragBruttoCent?.toString() ?? null]);
  if (zeile === undefined) {
    throw new EingangsrechnungFehler('Der Beleg wurde nicht angelegt.', 'abgewiesen');
  }
  return zeile.id;
}

export interface EingangErfassen {
  /** ACC-03: keine Eingangsrechnung ohne ihr Dokument. */
  readonly belegId: string;
  readonly lieferantId?: string | null;
  readonly rechnungsnummerLieferant?: string | null;
  readonly selbstAbgerechnet?: boolean;
  readonly rechnungsdatum?: string | null;
  readonly leistungsdatum?: string | null;
  readonly leistungVon?: string | null;
  readonly leistungBis?: string | null;
  readonly nettoCent?: Cent | null;
  readonly steuerCent?: Cent | null;
  readonly bruttoCent?: Cent | null;
  readonly faelligAm?: string | null;
  readonly auftragId?: string | null;
  readonly projektId?: string | null;
  readonly objektId?: string | null;
  readonly kostenstelle?: string | null;
}

export async function erfasseEingangsrechnung(
  db: Abfrage, e: EingangErfassen,
): Promise<string> {
  const [zeile] = await db.abfrage<{ id: string }>(
    `insert into eingangsrechnung
       (mandant_id, beleg_id, lieferant_id, rechnungsnummer_lieferant, selbst_abgerechnet,
        rechnungsdatum, leistungsdatum, leistung_von, leistung_bis,
        netto_cent, steuer_cent, brutto_cent, faellig_am,
        auftrag_id, projekt_id, objekt_id, kostenstelle,
        erstellt_von_art, erstellt_von)
     values (app.aktiver_mandant(), $1::uuid, $2::uuid, $3, coalesce($4, false),
             $5::date, $6::date, $7::date, $8::date,
             $9::bigint, $10::bigint, $11::bigint, $12::date,
             $13::uuid, $14::uuid, $15::uuid, $16, 'mensch', app.aktueller_benutzer())
     returning id`,
    [e.belegId, e.lieferantId ?? null, e.rechnungsnummerLieferant ?? null,
     e.selbstAbgerechnet ?? false, e.rechnungsdatum ?? null, e.leistungsdatum ?? null,
     e.leistungVon ?? null, e.leistungBis ?? null,
     e.nettoCent?.toString() ?? null, e.steuerCent?.toString() ?? null,
     e.bruttoCent?.toString() ?? null, e.faelligAm ?? null,
     e.auftragId ?? null, e.projektId ?? null, e.objektId ?? null,
     e.kostenstelle ?? null]);
  if (zeile === undefined) {
    throw new EingangsrechnungFehler('Die Eingangsrechnung wurde nicht erfasst.', 'abgewiesen');
  }
  return zeile.id;
}

/**
 * Eine Steuerzeile setzen — Satz und Kategorie werden aus der Gruppe
 * EINGEFROREN, nicht verwiesen. Eine spätere Satzpflege darf einen erfassten
 * Beleg nicht rückwirkend ändern.
 */
export async function setzeSteuerzeile(
  db: Abfrage,
  e: {
    readonly eingangsrechnungId: string;
    readonly steuergruppe: string;
    readonly nettoCent: Cent;
    readonly steuerCent: Cent;
  },
): Promise<void> {
  const [gruppe] = await db.abfrage<{ id: string; satz_bp: number; kategorie: string }>(
    `select id, satz_bp, kategorie::text as kategorie from steuersatz_gruppe
      where schluessel = $1`, [e.steuergruppe]);
  if (gruppe === undefined) {
    throw new EingangsrechnungFehler(
      `Die Steuersatzgruppe ${e.steuergruppe} gibt es nicht.`, 'unvollstaendig');
  }
  await db.abfrage(
    `insert into eingangsrechnung_steuer
       (mandant_id, eingangsrechnung_id, steuersatz_gruppe_id, satz_bp, kategorie,
        netto_cent, steuer_cent, erstellt_von_art, erstellt_von)
     values (app.aktiver_mandant(), $1::uuid, $2::uuid, $3, $4::en16931_steuerkategorie,
             $5::bigint, $6::bigint, 'mensch', app.aktueller_benutzer())
     on conflict (eingangsrechnung_id, steuersatz_gruppe_id) do update
       set satz_bp = excluded.satz_bp, kategorie = excluded.kategorie,
           netto_cent = excluded.netto_cent, steuer_cent = excluded.steuer_cent`,
    [e.eingangsrechnungId, gruppe.id, gruppe.satz_bp, gruppe.kategorie,
     e.nettoCent.toString(), e.steuerCent.toString()]);
}

// ---------------------------------------------------------------------------
// Die Übergänge
// ---------------------------------------------------------------------------

/**
 * Der eine Schreibweg für einen Zustandswechsel.
 *
 * **Die beiden Zusatzspalten stehen ausgeschrieben, nicht als Map.** Ein
 * `Record<string, …>`, dessen Schlüssel in den SQL-Text wandern, ist eine
 * Einschleusungsfläche — heute ruft nur diese Datei, morgen ruft eine Route
 * mit einem Formularfeld. Zwei benannte Parameter kosten drei Zeilen und
 * lassen die Frage gar nicht erst entstehen.
 *
 * Welcher Übergang erlaubt ist, entscheidet der Auslöser aus 0123, nicht
 * dieser Dienst: ein zweiter Schreibweg käme sonst an ihm vorbei.
 */
async function setzeStatus(
  db: Abfrage, id: string, ziel: EingangsStatus,
  zusatz: {
    readonly abgelehntGrund?: string | null;
    readonly freigabeId?: string | null;
  } = {},
): Promise<void> {
  const zeilen = await db.abfrage<{ id: string }>(
    `update eingangsrechnung
        set status = $2::eingangsrechnung_status,
            abgelehnt_grund = coalesce($3, abgelehnt_grund),
            freigabe_id     = coalesce($4::uuid, freigabe_id),
            geaendert_am = now(), geaendert_von_art = 'mensch',
            geaendert_von = app.aktueller_benutzer()
      where id = $1::uuid
      returning id`,
    [id, ziel, zusatz.abgelehntGrund ?? null, zusatz.freigabeId ?? null]);
  if (zeilen.length === 0) {
    throw new EingangsrechnungFehler(
      'Die Eingangsrechnung ist nicht erreichbar.', 'nicht_gefunden');
  }
}

export async function inPruefung(db: Abfrage, id: string): Promise<void> {
  await setzeStatus(db, id, 'in_pruefung');
}

export async function lehneAb(db: Abfrage, id: string, grund: string): Promise<void> {
  if (grund.trim().length < 5) {
    throw new EingangsrechnungFehler(
      'Eine Ablehnung nennt ihren Grund — sie steht später allein da.', 'unvollstaendig');
  }
  await setzeStatus(db, id, 'abgelehnt', { abgelehntGrund: grund.trim() });
}

/**
 * Die Vier-Augen-Grenze: `null` heißt „kein Vier-Augen-Zwang".
 *
 * Sie ist EINSTELLUNG und kein `CHECK` (§8.2). Ein fest verdrahtetes
 * `freigegeben_von <> erstellt_von` erfände eine Organisationsregel und
 * sperrte in einem Rückbüro aus zwei Menschen jede Freigabe ohne Ausweg.
 *
 * // TODO(client, O-183): Ist eine Vier-Augen-Freigabe für Eingangsrechnungen
 * erforderlich, und ab welchem Betrag? Wer darf im Vertretungsfall freigeben?
 */
export async function vierAugenGrenze(db: Abfrage): Promise<Cent | null> {
  const [e] = await db.abfrage<{ grenze: string | null }>(
    `select (app.einstellung('eingang.vier_augen_ab_cent') #>> '{}') as grenze`);
  const wert = e?.grenze ?? null;
  return wert === null || !/^\d{1,18}$/u.test(wert) ? null : cent(BigInt(wert));
}

export async function freigebe(
  db: Abfrage, id: string, freigabeId: string,
): Promise<void> {
  const grenze = await vierAugenGrenze(db);
  if (grenze !== null) {
    const [z] = await db.abfrage<{ selbst: boolean; brutto: string | null }>(
      `select erstellt_von = app.aktueller_benutzer() as selbst, brutto_cent::text as brutto
         from eingangsrechnung where id = $1::uuid`, [id]);
    if (z === undefined) {
      throw new EingangsrechnungFehler(
        'Die Eingangsrechnung ist nicht erreichbar.', 'nicht_gefunden');
    }
    if (z.selbst && z.brutto !== null && BigInt(z.brutto) >= grenze) {
      throw new EingangsrechnungFehler(
        'Diese Gesellschaft verlangt ab dieser Höhe eine Freigabe durch eine zweite '
        + 'Person; wer erfasst hat, gibt nicht frei.', 'vier_augen');
    }
  }
  await setzeStatus(db, id, 'freigegeben', { freigabeId });
}

/**
 * Buchen — der unumkehrbare Schritt. Die interne Belegnummer und der
 * Kreditorposten entstehen in der Datenbank (0123); hier steht nur der Anstoß
 * und die Übersetzung der Ablehnungen.
 */
export async function buche(db: Abfrage, id: string): Promise<void> {
  await setzeStatus(db, id, 'gebucht');
}

// ---------------------------------------------------------------------------
// Lesen
// ---------------------------------------------------------------------------

export interface EingangsZeile {
  readonly id: string;
  readonly interneBelegnummer: string | null;
  readonly lieferant: string | null;
  readonly rechnungsnummerLieferant: string | null;
  readonly rechnungsdatum: string | null;
  readonly faelligAm: string | null;
  readonly bruttoCent: Cent | null;
  readonly status: EingangsStatus;
  readonly abgelehntGrund: string | null;
}

export async function eingangsrechnungen(
  db: Abfrage, filter: { readonly status?: EingangsStatus | null } = {},
): Promise<readonly EingangsZeile[]> {
  const zeilen = await db.abfrage<{
    id: string; interne_belegnummer: string | null; lieferant: string | null;
    rechnungsnummer_lieferant: string | null; rechnungsdatum: string | null;
    faellig_am: string | null; brutto_cent: string | null;
    status: EingangsStatus; abgelehnt_grund: string | null;
  }>(
    `select er.id, er.interne_belegnummer, l.name as lieferant,
            er.rechnungsnummer_lieferant,
            to_char(er.rechnungsdatum, 'DD.MM.YYYY') as rechnungsdatum,
            to_char(er.faellig_am, 'DD.MM.YYYY') as faellig_am,
            er.brutto_cent::text, er.status::text as status, er.abgelehnt_grund
       from eingangsrechnung er
       left join lieferant l on l.id = er.lieferant_id and l.mandant_id = er.mandant_id
      where ($1::text is null or er.status = $1::eingangsrechnung_status)
      order by er.eingang_am desc, er.erstellt_am desc`,
    [filter.status ?? null]);

  return zeilen.map((z) => ({
    id: z.id,
    interneBelegnummer: z.interne_belegnummer,
    lieferant: z.lieferant,
    rechnungsnummerLieferant: z.rechnungsnummer_lieferant,
    rechnungsdatum: z.rechnungsdatum,
    faelligAm: z.faellig_am,
    bruttoCent: z.brutto_cent === null ? null : cent(BigInt(z.brutto_cent)),
    status: z.status,
    abgelehntGrund: z.abgelehnt_grund,
  }));
}
