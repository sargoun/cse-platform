import 'server-only';
import { cent, type Cent } from '../finanz/geld.js';
import { kontiere, type Abfrage as KontoAbfrage } from './kontierung.js';
import { sicherePeriode } from './periode.js';

/**
 * Der automatische Buchungssatz zur festgeschriebenen Ausgangsrechnung
 * (ACC-01, `05-FINANZEN.md` §9.2, §5.6 Schritt 6).
 *
 * **Die Zeilen sind EINSEITIG** (D-426): eine Zeile bewegt genau ein Konto,
 * mit `soll_haben` als Vorzeichen. Nur so hat der Ausgleichsausloeser über
 * `buchung_id` eine Aussage; die DATEV-Paarung zu Konto/Gegenkonto macht der
 * EXTF-Schreiber (PR 60).
 *
 * Eine Ausgangsrechnung ergibt damit:
 *
 *   Debitor            SOLL   Bruttobetrag
 *     je Steuergruppe:  HABEN Nettobetrag   (Erlöskonto)
 *     je Steuergruppe:  HABEN Steuerbetrag  (Umsatzsteuerkonto, wenn > 0)
 *
 * **Keine Zahl wird hier gerechnet** (Invariante 6, K-16). Netto, Steuer und
 * Brutto stehen auf `rechnung` und `rechnung_steuer`; dieser Dienst ordnet sie
 * Konten zu und prüft, dass die Summe aufgeht — er bildet sie nicht neu. Eine
 * zweite Rechnung derselben Zahl wäre eine zweite Wahrheit.
 *
 * **Und er rät kein Konto.** Fehlt die Zuordnung (O-05), entsteht die Zeile
 * trotzdem — mit `konto = NULL` und `pruefhinweis`. Sie steht dann in der
 * Arbeitsliste, sie lässt sich nicht festschreiben, und der Monat lässt sich
 * nicht schliessen. Das ist lauter als eine fehlende Zeile und billiger als
 * ein falsches Konto.
 */

export interface Abfrage extends KontoAbfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export interface BuchungErgebnis {
  readonly gebucht: boolean;
  readonly buchungId: string | null;
  readonly zeilen: number;
  /** Zeilen ohne Konto — die Arbeitsliste. */
  readonly offeneKontierungen: number;
  /** Gefüllt, wenn NICHT gebucht wurde: der Grund, im Klartext. */
  readonly grund: string | null;
}

interface KopfRoh {
  readonly id: string;
  readonly mandant_id: string;
  readonly status: string;
  readonly rechnungsart: string;
  readonly nummer: string | null;
  readonly rechnungsdatum: string | null;
  readonly kunde_id: string;
  readonly kunde_name: string | null;
  readonly brutto_cent: string;
  readonly abzug_brutto_cent: string;
  readonly einbehalt_bauabzugsteuer_cent: string;
}

interface PositionRoh {
  readonly leistungskatalog_position_id: string | null;
  readonly erloeskonto_schluessel: string | null;
  readonly steuersatz_gruppe_id: string;
  readonly netto_cent: string;
}

interface SteuerRoh {
  readonly steuersatz_gruppe_id: string;
  readonly satz_bp: number;
  readonly netto_cent: string;
  readonly steuer_cent: string;
}

/** Eine noch nicht geschriebene Zeile. */
interface Zeile {
  readonly konto: string | null;
  readonly gegenkonto: string | null;
  readonly buSchluessel: string | null;
  readonly sollHaben: 'soll' | 'haben';
  readonly betrag: Cent;
  readonly steuersatzGruppeId: string | null;
  readonly hinweis: string | null;
}

export class BuchungFehler extends Error {
  constructor(meldung: string, public readonly art: 'nicht_gefunden' | 'kein_beleg') {
    super(meldung);
    this.name = 'BuchungFehler';
  }
}

/** Höchstens 60 Zeichen — die EXTF-Breite steht schon im CHECK (§9.2). */
function buchungstext(nummer: string | null, kunde: string | null): string {
  const roh = `RE ${nummer ?? '(ohne Nummer)'}${kunde === null ? '' : ` ${kunde}`}`;
  return roh.length <= 60 ? roh : `${roh.slice(0, 59)}…`;
}

/**
 * Bucht eine **festgeschriebene** Ausgangsrechnung.
 *
 * Zweimal aufgerufen tut sie nichts: `buchungssatz` mit dieser `rechnung_id`
 * ist der Riegel. Ein zweiter Lauf über denselben Beleg wäre sonst die
 * doppelte Buchung — der Fehler, den ein Betriebsprüfer als erstes sucht.
 */
export async function bucheRechnung(
  db: Abfrage, rechnungId: string,
): Promise<BuchungErgebnis> {
  const [kopf] = await db.abfrage<KopfRoh>(
    `select r.id, r.mandant_id, r.status::text as status,
            r.rechnungsart::text as rechnungsart, r.nummer,
            r.rechnungsdatum::text as rechnungsdatum, r.kunde_id,
            k.name as kunde_name,
            r.brutto_cent::text, r.abzug_brutto_cent::text,
            r.einbehalt_bauabzugsteuer_cent::text
       from rechnung r
       left join kunde k on k.id = r.kunde_id and k.mandant_id = r.mandant_id
      where r.id = $1`,
    [rechnungId]);

  if (kopf === undefined) {
    throw new BuchungFehler(`Rechnung ${rechnungId} nicht gefunden`, 'nicht_gefunden');
  }
  if (kopf.status !== 'festgeschrieben') {
    throw new BuchungFehler(
      `Rechnung ${rechnungId} ist ${kopf.status} — gebucht wird ein festgeschriebener Beleg.`,
      'kein_beleg');
  }
  if (kopf.rechnungsdatum === null) {
    throw new BuchungFehler(
      `Rechnung ${rechnungId} hat kein Rechnungsdatum — ohne Belegdatum keine Periode.`,
      'kein_beleg');
  }

  const [schon] = await db.abfrage<{ readonly buchung_id: string }>(
    'select buchung_id from buchungssatz where mandant_id = $1 and rechnung_id = $2 limit 1',
    [kopf.mandant_id, rechnungId]);
  if (schon !== undefined) {
    return {
      gebucht: false, buchungId: schon.buchung_id, zeilen: 0, offeneKontierungen: 0,
      grund: 'schon_gebucht',
    };
  }

  /*
   * **Ein Storno bucht die Gegenbuchung, nicht sich selbst** (Abnahme 5).
   *
   * Der Befund kam aus dem eigenen Test: `storniere()` schreibt eine eigene
   * Rechnung mit NEGATIVEN Beträgen fest, diese Funktion lief mit, und der
   * Einfügeversuch scheiterte an `umsatz_cent > 0` — DATEV kennt keinen
   * negativen Umsatz, das Vorzeichen lebt in `soll_haben`. Ohne diese Weiche
   * hätte jede Stornierung an einem Constraint gehangen, den niemand mit dem
   * Storno in Verbindung gebracht hätte.
   */
  if (BigInt(kopf.brutto_cent) < 0n || kopf.rechnungsart === 'storno') {
    const [bezug] = await db.abfrage<{ readonly zu_rechnung_id: string }>(
      `select zu_rechnung_id from rechnung_beziehung
        where mandant_id = $1 and von_rechnung_id = $2 and art = 'storno' limit 1`,
      [kopf.mandant_id, rechnungId]);
    if (bezug === undefined) {
      return {
        gebucht: false, buchungId: null, zeilen: 0, offeneKontierungen: 0,
        grund: 'storno_ohne_bezug',
      };
    }
    return bucheStorno(db, rechnungId, bezug.zu_rechnung_id);
  }

  /*
   * **Der Abschlagsabzug wird NICHT gebucht** — und zwar ausdrücklich nicht.
   *
   * Ob eine Abschlagsrechnung beim Stellen als Erlös oder als erhaltene
   * Anzahlung bucht und wie die Schlussrechnung sie auflöst, ist eine Methode,
   * die der Steuerberater festlegt (§13 Abs. 1 Nr. 1a UStG lässt beides zu).
   * Eine Wahl hier wäre eine erfundene Bilanzierungsregel auf einem
   * unveränderlichen Beleg.
   * TODO(client, O-05): Werden Abschlagsrechnungen als Erlös oder als
   * erhaltene Anzahlung gebucht, und auf welchem Konto?
   */
  if (BigInt(kopf.abzug_brutto_cent) !== 0n) {
    return {
      gebucht: false, buchungId: null, zeilen: 0, offeneKontierungen: 0,
      grund: 'abschlagsabzug_offen',
    };
  }

  const periode = await sicherePeriode(db, kopf.mandant_id, kopf.rechnungsdatum);

  const gruppen = await db.abfrage<SteuerRoh>(
    `select steuersatz_gruppe_id, satz_bp, netto_cent::text, steuer_cent::text
       from rechnung_steuer
      where mandant_id = $1 and rechnung_id = $2
      order by satz_bp desc`,
    [kopf.mandant_id, rechnungId]);

  if (gruppen.length === 0) {
    throw new BuchungFehler(
      `Rechnung ${rechnungId} trägt keine Steuerzeile — eine Rechnung ohne `
      + 'Steueraufteilung lässt sich nicht kontieren (§14 Abs. 4 Nr. 8 UStG).',
      'kein_beleg');
  }

  const datum = kopf.rechnungsdatum;
  const zeilen: Zeile[] = [];

  /* 1. Der Debitor — eine Zeile, der ganze Bruttobetrag. */
  const debitor = await kontiere(db, {
    mandantId: kopf.mandant_id, typ: 'debitor_kunde', datum, kundeId: kopf.kunde_id,
  });
  const einbehalt = BigInt(kopf.einbehalt_bauabzugsteuer_cent);
  zeilen.push({
    konto: debitor.konto,
    gegenkonto: debitor.gegenkonto,
    buSchluessel: null,
    sollHaben: 'soll',
    betrag: cent(BigInt(kopf.brutto_cent)),
    steuersatzGruppeId: null,
    /*
     * §48 EStG: der Kunde zahlt weniger und führt den Einbehalt ab. Ob und
     * wie der Einbehalt beim Stellen der Rechnung gebucht wird, hängt an der
     * Einrichtung des Steuerberaters — die Zuordnung dafür gibt es
     * (`bauabzugsteuer_verbindlichkeit`), gefüllt ist sie nicht.
     * TODO(client, O-05): Wird der §48-Einbehalt schon bei der Rechnung auf
     * ein Verbindlichkeitskonto gebucht oder erst bei der Zahlung?
     */
    hinweis: debitor.pruefhinweis
      ?? (einbehalt > 0n
        ? 'Bauabzugsteuer §48 EStG einbehalten — die Buchung des Einbehalts ist offen (O-05)'
        : null),
  });

  /*
   * 2a. **Der Erlös wird JE POSITION kontiert, nicht je Steuergruppe.**
   *
   * Eine Steuergruppe fasst Positionen zusammen, die auf verschiedene
   * Erlöskonten gehören können — Reinigung und Bau stehen beide mit 19 %
   * auf derselben Rechnung. Ein Erlöskonto je Steuergruppe wäre also eine
   * Vereinfachung, die genau dort falsch wird, wo eine Gruppe mehrere
   * Gewerke abrechnet. Die Zuordnung schlüsselt deshalb auf die
   * Katalogposition oder ihren `erloeskonto_schluessel` (§9.3), und gleiche
   * Konten werden danach zu einer Zeile zusammengefasst.
   */
  const positionen = await db.abfrage<PositionRoh>(
    `select leistungskatalog_position_id, erloeskonto_schluessel,
            steuersatz_gruppe_id, coalesce(netto_cent, 0)::text as netto_cent
       from rechnungsposition
      where mandant_id = $1 and rechnung_id = $2 and netto_cent is not null
      order by position_nr`,
    [kopf.mandant_id, rechnungId]);

  const eimer = new Map<string, {
    konto: string | null; gegenkonto: string | null; bu: string | null;
    gruppe: string; hinweis: string | null; betrag: bigint;
  }>();

  for (const pos of positionen) {
    const erloes = await kontiere(db, {
      mandantId: kopf.mandant_id, typ: 'erloes_leistung', datum,
      leistungskatalogPositionId: pos.leistungskatalog_position_id,
      erloeskontoSchluessel: pos.erloeskonto_schluessel,
      steuersatzGruppeId: pos.steuersatz_gruppe_id,
    });
    const schluessel = `${erloes.konto ?? `?${erloes.pruefhinweis ?? ''}`}|${pos.steuersatz_gruppe_id}`;
    const vorher = eimer.get(schluessel);
    eimer.set(schluessel, {
      konto: erloes.konto,
      gegenkonto: erloes.gegenkonto,
      bu: erloes.buSchluessel,
      gruppe: pos.steuersatz_gruppe_id,
      hinweis: erloes.pruefhinweis,
      betrag: (vorher?.betrag ?? 0n) + BigInt(pos.netto_cent),
    });
  }

  for (const e of eimer.values()) {
    if (e.betrag === 0n) continue;
    zeilen.push({
      konto: e.konto,
      gegenkonto: e.gegenkonto,
      buSchluessel: e.bu,
      sollHaben: 'haben',
      betrag: cent(e.betrag),
      steuersatzGruppeId: e.gruppe,
      hinweis: e.hinweis,
    });
  }

  /* 2b. Je Steuergruppe die Steuer — sie steht auf dem Beleg, nicht hier. */
  for (const g of gruppen) {
    if (BigInt(g.steuer_cent) === 0n) continue;

    const steuer = await kontiere(db, {
      mandantId: kopf.mandant_id, typ: 'steuer_gruppe', datum,
      steuersatzGruppeId: g.steuersatz_gruppe_id,
    });
    zeilen.push({
      konto: steuer.konto,
      gegenkonto: steuer.gegenkonto,
      buSchluessel: steuer.buSchluessel,
      sollHaben: 'haben',
      betrag: cent(BigInt(g.steuer_cent)),
      steuersatzGruppeId: g.steuersatz_gruppe_id,
      hinweis: steuer.pruefhinweis,
    });
  }

  /*
   * **Der Ausgleich wird HIER schon geprüft, obwohl der Ausloeser ihn ohnehin
   * prüft.** Der Ausloeser meldet am Ende der Transaktion eine Differenz in
   * Cent und reisst den ganzen Beleg mit; diese Prüfung sagt, WELCHE Zahlen
   * nicht zusammenpassen, und sie sagt es, bevor etwas geschrieben ist. Die
   * Differenz kann es real geben: `brutto_cent` und die Summe der
   * Steuergruppen stammen aus demselben Beleg, aber nicht aus derselben
   * Spalte.
   */
  const soll = zeilen.filter((z) => z.sollHaben === 'soll')
    .reduce((s, z) => s + z.betrag, 0n);
  const haben = zeilen.filter((z) => z.sollHaben === 'haben')
    .reduce((s, z) => s + z.betrag, 0n);
  if (soll !== haben) {
    throw new BuchungFehler(
      `Rechnung ${kopf.nummer ?? rechnungId}: Brutto ${String(soll)} Cent, `
      + `Summe der Steuergruppen ${String(haben)} Cent — die Buchung ginge nicht auf.`,
      'kein_beleg');
  }

  const [neu] = await db.abfrage<{ readonly buchung_id: string }>(
    'select gen_random_uuid() as buchung_id');
  const buchungId = neu?.buchung_id ?? null;
  if (buchungId === null) throw new BuchungFehler('Keine buchung_id erhalten', 'kein_beleg');

  const text = buchungstext(kopf.nummer, kopf.kunde_name);
  for (const z of zeilen) {
    await db.abfrage(
      `select app.buchungssatz_schreiben($1, $2, $3::date, $4, $5::bigint,
                                         $6::soll_haben, $7, $8, $9, $10, $11, $12,
                                         'rechnung'::buchung_herkunft, $13, $14,
                                         'dienst:buchhaltung-rechnung')`,
      [kopf.mandant_id, buchungId, datum, periode.id, z.betrag.toString(), z.sollHaben,
        z.konto, z.gegenkonto, z.buSchluessel, z.steuersatzGruppeId, text,
        kopf.nummer, rechnungId, z.hinweis]);
  }

  return {
    gebucht: true,
    buchungId,
    zeilen: zeilen.length,
    offeneKontierungen: zeilen.filter((z) => z.konto === null).length,
    grund: null,
  };
}

/**
 * Die Gegenbuchung zu einem Storno (Invariante 4, Abnahme 5).
 *
 * **Gespiegelt, nicht gelöscht und nicht neu gerechnet.** Jede Zeile der
 * ursprünglichen Buchung entsteht noch einmal mit vertauschtem `soll_haben`
 * und demselben Konto; die Ursprungszeilen bekommen `storniert_durch_id`.
 * Ein Storno, der die Zahlen neu ermittelte, könnte von der Rechnung
 * abweichen, die er aufhebt — und genau das darf er nicht.
 */
export async function bucheStorno(
  db: Abfrage, stornoRechnungId: string, urspruenglicheRechnungId: string,
): Promise<BuchungErgebnis> {
  const [kopf] = await db.abfrage<KopfRoh>(
    `select r.id, r.mandant_id, r.status::text as status,
            r.rechnungsart::text as rechnungsart, r.nummer,
            r.rechnungsdatum::text as rechnungsdatum, r.kunde_id,
            k.name as kunde_name, r.brutto_cent::text, r.abzug_brutto_cent::text,
            r.einbehalt_bauabzugsteuer_cent::text
       from rechnung r
       left join kunde k on k.id = r.kunde_id and k.mandant_id = r.mandant_id
      where r.id = $1`,
    [stornoRechnungId]);

  if (kopf === undefined) {
    throw new BuchungFehler(`Storno ${stornoRechnungId} nicht gefunden`, 'nicht_gefunden');
  }
  if (kopf.rechnungsdatum === null) {
    throw new BuchungFehler('Ein Storno ohne Datum lässt sich nicht buchen.', 'kein_beleg');
  }

  const [schon] = await db.abfrage<{ readonly buchung_id: string }>(
    'select buchung_id from buchungssatz where mandant_id = $1 and rechnung_id = $2 limit 1',
    [kopf.mandant_id, stornoRechnungId]);
  if (schon !== undefined) {
    return {
      gebucht: false, buchungId: schon.buchung_id, zeilen: 0, offeneKontierungen: 0,
      grund: 'schon_gebucht',
    };
  }

  const ursprung = await db.abfrage<{
    readonly id: string; readonly umsatz_cent: string; readonly soll_haben: string;
    readonly konto: string | null; readonly gegenkonto: string | null;
    readonly bu_schluessel: string | null; readonly steuersatz_gruppe_id: string | null;
    readonly pruefhinweis: string | null;
  }>(
    `select id, umsatz_cent::text, soll_haben::text as soll_haben, konto, gegenkonto,
            bu_schluessel, steuersatz_gruppe_id, pruefhinweis
       from buchungssatz
      where mandant_id = $1 and rechnung_id = $2
      order by erstellt_am`,
    [kopf.mandant_id, urspruenglicheRechnungId]);

  if (ursprung.length === 0) {
    return {
      gebucht: false, buchungId: null, zeilen: 0, offeneKontierungen: 0,
      grund: 'ursprung_nicht_gebucht',
    };
  }

  const periode = await sicherePeriode(db, kopf.mandant_id, kopf.rechnungsdatum);
  const [neu] = await db.abfrage<{ readonly buchung_id: string }>(
    'select gen_random_uuid() as buchung_id');
  const buchungId = neu?.buchung_id ?? null;
  if (buchungId === null) throw new BuchungFehler('Keine buchung_id erhalten', 'kein_beleg');

  const text = buchungstext(kopf.nummer, kopf.kunde_name);
  for (const z of ursprung) {
    const [gegen] = await db.abfrage<{ readonly id: string }>(
      `select app.buchungssatz_schreiben($1, $2, $3::date, $4, $5::bigint,
                (case $6 when 'soll' then 'haben' else 'soll' end)::soll_haben,
                $7, $8, $9, $10, $11, $12, 'rechnung'::buchung_herkunft, $13, $14,
                'dienst:buchhaltung-storno') as id`,
      [kopf.mandant_id, buchungId, kopf.rechnungsdatum, periode.id, z.umsatz_cent,
        z.soll_haben, z.konto, z.gegenkonto, z.bu_schluessel, z.steuersatz_gruppe_id,
        text, kopf.nummer, stornoRechnungId, z.pruefhinweis]);

    if (gegen !== undefined) {
      await db.abfrage('select app.buchungssatz_storniert($1, $2, $3)',
        [kopf.mandant_id, z.id, gegen.id]);
    }
  }

  return {
    gebucht: true,
    buchungId,
    zeilen: ursprung.length,
    offeneKontierungen: ursprung.filter((z) => z.konto === null).length,
    grund: null,
  };
}

// ---------------------------------------------------------------------------
// Die Kreditorenseite (ACC-05)
// ---------------------------------------------------------------------------

interface EingangKopfRoh {
  readonly id: string;
  readonly mandant_id: string;
  readonly status: string;
  readonly interne_belegnummer: string | null;
  readonly rechnungsdatum: string | null;
  readonly lieferant_id: string | null;
  readonly lieferant_name: string | null;
  readonly beleg_id: string;
  readonly netto_cent: string | null;
  readonly steuer_cent: string | null;
  readonly brutto_cent: string | null;
}

interface EingangSteuerRoh {
  readonly steuersatz_gruppe_id: string;
  readonly satz_bp: number;
  readonly netto_cent: string;
  readonly steuer_cent: string;
}

/**
 * Der automatische Buchungssatz zur gebuchten Eingangsrechnung (ACC-05).
 *
 * **Die Spiegelung der Ausgangsseite, Zeile für Zeile:**
 *
 *   je Steuergruppe:  SOLL  Nettobetrag   (Aufwandskonto)
 *   je Steuergruppe:  SOLL  Steuerbetrag  (Vorsteuerkonto, wenn > 0)
 *     Kreditor       HABEN  Bruttobetrag
 *
 * **Ohne diese Funktion stand die Kreditorenseite ganz ausserhalb des
 * Hauptbuchs.** `eingangsrechnung.buche()` setzte den Status und liess die
 * Datenbank einen Kreditorposten eröffnen — einen Buchungssatz schrieb
 * niemand. Ein DATEV-Export hätte damit nur Ausgangsrechnungen enthalten, und
 * die Summe hätte mit keiner Bilanz übereingestimmt. Aufgefallen wäre es beim
 * Steuerberater, im Folgemonat.
 *
 * **Der Beleg reist mit** (ACC-03, GoBD). `eingangsrechnung.beleg_id` ist
 * Pflicht, also trägt jede Zeile dieser Buchung ihn — der Weg vom Konto zum
 * Dokument ist damit eine Abfrage und keine Suche.
 *
 * **Und auch hier wird kein Konto geraten.** Fehlt die Zuordnung (O-05),
 * entsteht die Zeile mit `konto = NULL` und Prüfhinweis; sie steht in der
 * Arbeitsliste und hält den Monatsabschluss auf.
 */
export async function bucheEingangsrechnung(
  db: Abfrage, eingangsrechnungId: string,
): Promise<BuchungErgebnis> {
  const [kopf] = await db.abfrage<EingangKopfRoh>(
    `select er.id, er.mandant_id, er.status::text as status, er.interne_belegnummer,
            er.rechnungsdatum::text as rechnungsdatum, er.lieferant_id,
            l.name as lieferant_name, er.beleg_id,
            er.netto_cent::text, er.steuer_cent::text, er.brutto_cent::text
       from eingangsrechnung er
       left join lieferant l on l.id = er.lieferant_id and l.mandant_id = er.mandant_id
      where er.id = $1`,
    [eingangsrechnungId]);

  if (kopf === undefined) {
    throw new BuchungFehler(
      `Eingangsrechnung ${eingangsrechnungId} nicht gefunden`, 'nicht_gefunden');
  }
  if (kopf.status !== 'gebucht') {
    throw new BuchungFehler(
      `Eingangsrechnung ${eingangsrechnungId} ist ${kopf.status} — gebucht wird eine `
      + 'gebuchte Rechnung.', 'kein_beleg');
  }
  if (kopf.rechnungsdatum === null || kopf.brutto_cent === null) {
    throw new BuchungFehler(
      `Eingangsrechnung ${eingangsrechnungId} hat kein Datum oder keinen Betrag — `
      + 'ohne beides keine Periode und keine Zeile.', 'kein_beleg');
  }

  /* Zweimal buchen ist keine zweite Buchung, sondern eine doppelte. */
  const [schon] = await db.abfrage<{ readonly buchung_id: string }>(
    `select buchung_id from buchungssatz
      where mandant_id = $1 and beleg_id = $2 and herkunft = 'eingangsrechnung'
      limit 1`,
    [kopf.mandant_id, kopf.beleg_id]);
  if (schon !== undefined) {
    return {
      gebucht: false, buchungId: schon.buchung_id, zeilen: 0, offeneKontierungen: 0,
      grund: 'schon_gebucht',
    };
  }

  const datum = kopf.rechnungsdatum;
  const periode = await sicherePeriode(db, kopf.mandant_id, datum);

  const gruppen = await db.abfrage<EingangSteuerRoh>(
    `select steuersatz_gruppe_id, satz_bp, netto_cent::text, steuer_cent::text
       from eingangsrechnung_steuer
      where mandant_id = $1 and eingangsrechnung_id = $2
      order by satz_bp desc`,
    [kopf.mandant_id, eingangsrechnungId]);

  if (gruppen.length === 0) {
    throw new BuchungFehler(
      `Eingangsrechnung ${eingangsrechnungId} trägt keine Steuerzeile — ohne `
      + 'Steueraufteilung lässt sich der Vorsteuerabzug nicht kontieren '
      + '(§15 UStG).', 'kein_beleg');
  }

  const zeilen: Zeile[] = [];

  /*
   * 1. Der Aufwand je Steuergruppe.
   *
   * **Je Gruppe und nicht je Position** — anders als auf der Ausgangsseite,
   * und das ist kein Versehen: eine Eingangsrechnung hat hier keine
   * Positionszeilen mit Katalogbezug, aus denen sich ein Konto ableiten
   * liesse. Die Aufwandskategorie steht am Beleg, sobald jemand sie setzt;
   * bis dahin bleibt das Konto offen und die Zeile in der Arbeitsliste
   * (O-05).
   */
  for (const g of gruppen) {
    if (BigInt(g.netto_cent) === 0n) continue;
    const aufwand = await kontiere(db, {
      mandantId: kopf.mandant_id, typ: 'aufwand_kategorie', datum,
      steuersatzGruppeId: g.steuersatz_gruppe_id,
    });
    zeilen.push({
      konto: aufwand.konto,
      gegenkonto: aufwand.gegenkonto,
      buSchluessel: aufwand.buSchluessel,
      sollHaben: 'soll',
      betrag: cent(BigInt(g.netto_cent)),
      steuersatzGruppeId: g.steuersatz_gruppe_id,
      hinweis: aufwand.pruefhinweis,
    });
  }

  /* 2. Die Vorsteuer je Gruppe — sie steht auf dem Beleg, nicht hier. */
  for (const g of gruppen) {
    if (BigInt(g.steuer_cent) === 0n) continue;
    const vorsteuer = await kontiere(db, {
      mandantId: kopf.mandant_id, typ: 'steuer_gruppe', datum,
      steuersatzGruppeId: g.steuersatz_gruppe_id,
    });
    zeilen.push({
      konto: vorsteuer.konto,
      gegenkonto: vorsteuer.gegenkonto,
      buSchluessel: vorsteuer.buSchluessel,
      sollHaben: 'soll',
      betrag: cent(BigInt(g.steuer_cent)),
      steuersatzGruppeId: g.steuersatz_gruppe_id,
      hinweis: vorsteuer.pruefhinweis,
    });
  }

  /* 3. Der Kreditor — eine Zeile, der ganze Bruttobetrag. */
  const kreditor = await kontiere(db, {
    mandantId: kopf.mandant_id, typ: 'kreditor_lieferant', datum,
    lieferantId: kopf.lieferant_id,
  });
  zeilen.push({
    konto: kreditor.konto,
    gegenkonto: kreditor.gegenkonto,
    buSchluessel: null,
    sollHaben: 'haben',
    betrag: cent(BigInt(kopf.brutto_cent)),
    steuersatzGruppeId: null,
    hinweis: kreditor.pruefhinweis,
  });

  const soll = zeilen.filter((z) => z.sollHaben === 'soll').reduce((s, z) => s + z.betrag, 0n);
  const haben = zeilen.filter((z) => z.sollHaben === 'haben').reduce((s, z) => s + z.betrag, 0n);
  if (soll !== haben) {
    throw new BuchungFehler(
      `Eingangsrechnung ${kopf.interne_belegnummer ?? eingangsrechnungId}: Netto plus `
      + `Steuer ergeben ${String(soll)} Cent, der Bruttobetrag ist ${String(haben)} Cent — `
      + 'die Buchung ginge nicht auf.',
      'kein_beleg');
  }

  const [neu] = await db.abfrage<{ readonly buchung_id: string }>(
    'select gen_random_uuid() as buchung_id');
  const buchungId = neu?.buchung_id ?? null;
  if (buchungId === null) throw new BuchungFehler('Keine buchung_id erhalten', 'kein_beleg');

  const text = `ER ${kopf.interne_belegnummer ?? ''} ${kopf.lieferant_name ?? ''}`.trim();
  for (const z of zeilen) {
    await db.abfrage(
      `select app.buchungssatz_schreiben($1, $2, $3::date, $4, $5::bigint,
                                         $6::soll_haben, $7, $8, $9, $10, $11, $12,
                                         'eingangsrechnung'::buchung_herkunft, $13, $14,
                                         'dienst:buchhaltung-eingangsrechnung', $15)`,
      [kopf.mandant_id, buchungId, datum, periode.id, z.betrag.toString(), z.sollHaben,
        z.konto, z.gegenkonto, z.buSchluessel, z.steuersatzGruppeId, text,
        kopf.interne_belegnummer, eingangsrechnungId, z.hinweis, kopf.beleg_id]);
  }

  return {
    gebucht: true,
    buchungId,
    zeilen: zeilen.length,
    offeneKontierungen: zeilen.filter((z) => z.konto === null).length,
    grund: null,
  };
}
