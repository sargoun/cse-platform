import 'server-only';
import type { Cent } from './geld.js';
import type { MilliMenge } from './menge.js';
import {
  RechnungFehler, ermittleZahlungsziel, fuegePositionHinzu, istEntwurfRechnungsart,
  istVorauszahlung, pruefeAuftragZuordnung, pruefeZeitraum, schreibeSummen,
  type Abfrage, type EntwurfRechnungsart,
} from './rechnung.js';
import { QuellenFehler } from './positionsquelle.js';
import { schreibeSteuerfall } from './steuerfall.js';
import { zahlungsmittelCode } from './zahlungsmittel.js';
import {
  AbrechnungFehler, berechneAbrechnung, bestueckeAusAbrechnungsart, hole, ladeKonfiguration,
  type AbrechnungsBefund, type RechnungspositionEntwurf,
} from './abrechnungsart/index.js';

/**
 * **Der Rechnungsentwurf nach dem Anlegen** — Kopf, Zuordnung und die zwei
 * Wege, die bis V-206 fehlten (FIN-01, FIN-04, FIN-05, FIN-07, FIN-08).
 *
 * Drei Befunde derselben Maske:
 *
 *  - **V-204 (D-697).** Der Kopf eines Entwurfs liess sich nach dem Anlegen
 *    nicht mehr ändern. Ein fehlender Leistungszeitraum oder ein fehlendes
 *    Zahlungsziel sperrte ihn dauerhaft; die Vorabprüfung verwies auf ein
 *    Blatt, das die Angabe nur anzeigte. Einziger Ausweg: verwerfen und jede
 *    Position neu erfassen.
 *  - **V-205 (D-698).** Kein Entwurf liess sich einem Auftrag oder einer
 *    Rechnungsart zuordnen. Abschlags- und Schlussrechnung waren unerreichbar,
 *    FIN-18 griff nie, und die Prüfliste „Auftrag ohne Rechnung" führte jeden
 *    abgeschlossenen Auftrag für immer.
 *  - **V-206 (D-699).** Die fünf Abrechnungsarten rechneten nie — ihre
 *    Bestückung hatte keinen Aufrufer —, und Material aus einer Ausgabe hatte
 *    keinen Weg auf eine Rechnung.
 *
 * **Nur ein Entwurf ändert sich** (Invariante 4). Jede Funktion hier sperrt
 * die Zeile, fragt nach `status = 'entwurf'`, und die Policy `t_mandant`
 * (0075) verlangt dasselbe im `WITH CHECK` noch einmal. Gerechnet wird hier
 * nichts: Beträge entstehen in `fuegePositionHinzu`/`berechneNetto`, die
 * Steuer in `schreibeSummen` je Satzgruppe (Invariante 1).
 */

// ---------------------------------------------------------------------------
// Der Leistungszeitpunkt einer Maske
// ---------------------------------------------------------------------------

export interface Leistungszeitpunkt {
  readonly rechnungsart: string;
  readonly leistungVon: string | null;
  readonly leistungBis: string | null;
  readonly vereinnahmungGeplantAm: string | null;
}

/**
 * Trägt diese Angabe einen Leistungszeitpunkt nach §14 Abs. 4 Nr. 6 UStG?
 *
 * Dieselben zwei Zweige wie `rechnung_leistungszeitpunkt` (0075) und wie die
 * beiden Regeln `leistungszeitpunkt`/`vereinnahmung` in `ustg14.ts`: ein
 * vollständiger Zeitraum, oder — nur bei Abschlag und Anzahlung — der
 * Zeitpunkt der Vereinnahmung. Hier steht keine neue Regel, sondern die
 * vorhandene an der Stelle, an der der Mensch sie noch beheben kann: der Kopf
 * des Rechnungsblatts sagt damit, was fehlt, BEVOR die Festschreibung es
 * sagt. Abgewiesen wird damit nichts — ein Entwurf darf unfertig sein, und
 * sein Kopf lässt sich seit V-204 jederzeit ergänzen (D-697 Nr. 3).
 *
 * @returns `null`, wenn alles da ist — sonst der Grund.
 */
export function grundOhneLeistungszeitpunkt(
  e: Leistungszeitpunkt,
): 'leistungszeitpunkt_fehlt' | 'zeitraum_verkehrt' | null {
  const von = e.leistungVon ?? null;
  const bis = e.leistungBis ?? null;
  if (von !== null && bis !== null && bis < von) return 'zeitraum_verkehrt';
  const zeitraum = von !== null && bis !== null;
  if (zeitraum) return null;
  /* Ein halber Zeitraum ist keiner — weder für die eine noch die andere Art. */
  if (von !== null || bis !== null) return 'leistungszeitpunkt_fehlt';
  if (istVorauszahlung(e.rechnungsart) && (e.vereinnahmungGeplantAm ?? null) !== null) {
    return null;
  }
  return 'leistungszeitpunkt_fehlt';
}

// ---------------------------------------------------------------------------
// V-204 — der Kopf
// ---------------------------------------------------------------------------

/**
 * Der ganze Kopf, wie ihn die Maske schickt — vorbelegt mit dem heutigen
 * Stand. Ein leeres Feld heisst deshalb „leer", nicht „unverändert".
 */
export interface EntwurfKopf {
  readonly objektId: string | null;
  readonly auftragId: string | null;
  readonly rechnungsart: string;
  readonly leistungVon: string | null;
  readonly leistungBis: string | null;
  readonly vereinnahmungGeplantAm: string | null;
  /**
   * `null`: neu auflösen — dieselbe Kette wie beim Anlegen (§4.2): Kunde,
   * dann Einstellung der Gesellschaft. Es gibt keinen Vorgabewert (O-66).
   */
  readonly zahlungszielTage: number | null;
  readonly zahlungsmittelCode: string | null;
  readonly kopftext: string | null;
  readonly fusstext: string | null;
}

export interface KopfErgebnis {
  /** Das Zahlungsziel kam aus der Auflösung, nicht aus der Maske. */
  readonly zahlungszielAufgeloest: boolean;
  /**
   * Die abgezogenen Abschläge gehörten zur alten Zuordnung und wirken nicht
   * mehr (D-697 Nr. 4). Die Maske sagt es — sonst stünde ein anderer
   * Zahlbetrag da, ohne dass jemand weiss, warum.
   */
  readonly abzugZurueckgenommen: boolean;
}

interface KopfAlt {
  readonly status: string;
  readonly kunde_id: string;
  readonly auftrag_id: string | null;
  readonly rechnungsart: string;
}

/**
 * Ändert den Kopf eines ENTWURFS.
 *
 * Die Reihenfolge ist die Aussage:
 *
 *  1. Sperren und nach dem Zustand fragen — ein festgeschriebener Beleg ist
 *     unveränderlich, und eine Maske, die es trotzdem versucht, bekommt den
 *     benannten Grund und nicht den Auslöser der Datenbank.
 *  2. Prüfen, was sich prüfen lässt, BEVOR geschrieben wird: Art, Zeitraum,
 *     Auftrag (derselbe Kunde, nicht storniert), eine Zuordnung, an der
 *     schon Belege hängen, und die Steuersätze am neuen Stichtag.
 *  3. Schreiben, dann Summen und Steuerfall neu — beide hängen am Kopf: der
 *     Steuerfall am Stichtag und am Auftrag (FIN-09, FIN-10), der Zahlbetrag
 *     am Abzug.
 */
export async function aendereEntwurfKopf(
  db: Abfrage, rechnungId: string, kopf: EntwurfKopf,
): Promise<KopfErgebnis> {
  const [alt] = await db.abfrage<KopfAlt>(
    `select status::text as status, kunde_id::text as kunde_id,
            auftrag_id::text as auftrag_id, rechnungsart::text as rechnungsart
       from rechnung where id = $1::uuid for update`,
    [rechnungId],
  );
  if (alt === undefined) {
    throw new RechnungFehler(`Rechnung ${rechnungId} nicht gefunden`, 'nicht_gefunden');
  }
  if (alt.status !== 'entwurf') {
    throw new RechnungFehler(
      'Nur ein Entwurf ändert seinen Kopf. Ein festgeschriebener Beleg wird durch '
      + 'Storno korrigiert (Invariante 4).',
      'kein_entwurf',
    );
  }

  const art = kopf.rechnungsart;
  if (!istEntwurfRechnungsart(art)) {
    throw new RechnungFehler(
      `„${art}" ist keine Rechnungsart, die ein Entwurf tragen kann.`,
      'rechnungsart_unbekannt',
    );
  }
  const vereinnahmung = istVorauszahlung(art) ? kopf.vereinnahmungGeplantAm : null;
  /*
   * Ein verkehrter Zeitraum wird abgewiesen, ein UNVOLLSTÄNDIGER nicht: ein
   * Entwurf darf unfertig sein (D-697 Nr. 3). Was fehlt, sagt der Kopf selbst
   * (`grundOhneLeistungszeitpunkt`), und die Festschreibung weist ab.
   */
  pruefeZeitraum(kopf.leistungVon, kopf.leistungBis);

  if (kopf.auftragId !== null) await pruefeAuftragZuordnung(db, alt.kunde_id, kopf.auftragId);
  const auftragWechselt = kopf.auftragId !== alt.auftrag_id;
  if (auftragWechselt) await pruefeZuordnungFrei(db, rechnungId);

  await pruefeSaetzeAmStichtag(db, rechnungId, kopf.leistungVon, kopf.leistungBis, vereinnahmung);

  /*
   * D-697 Nr. 4: der Abzug gehört zur Zuordnung „Schlussrechnung zu Auftrag
   * X". Wechselt eines von beiden, wirkt er nicht mehr — die Zeilen bleiben
   * stehen (Invariante 8), `wirksam` fällt, und „Abschläge abziehen" stellt
   * ihn wieder her, sobald die Zuordnung wieder stimmt.
   */
  let abzugZurueckgenommen = false;
  if (alt.rechnungsart === 'schluss' && (art !== 'schluss' || auftragWechselt)) {
    const zurueck = await db.abfrage<{ id: string }>(
      `update abschlagsrechnung_bezug set wirksam = false
        where schluss_rechnung_id = $1::uuid and wirksam
        returning id`,
      [rechnungId]);
    abzugZurueckgenommen = zurueck.length > 0;
  }

  const ziel = kopf.zahlungszielTage ?? await ermittleZahlungsziel(db, alt.kunde_id);

  const geschrieben = await db.abfrage<{ id: string }>(
    `update rechnung
        set objekt_id = $2::uuid, auftrag_id = $3::uuid, rechnungsart = $4::rechnungsart,
            leistung_von = $5::date, leistung_bis = $6::date,
            vereinnahmung_geplant_am = $7::date,
            zahlungsziel_tage = $8, zahlungsmittel_code = $9,
            kopftext = $10, fusstext = $11,
            abzug_brutto_cent = case when $12::boolean then 0 else abzug_brutto_cent end,
            -- rechnung_zahlbetrag_stimmig (0075) prueft in DIESER Anweisung: der
            -- Zahlbetrag folgt dem Abzug sofort, nicht erst in schreibeSummen.
            zahlbetrag_cent = brutto_cent
                              - case when $12::boolean then 0 else abzug_brutto_cent end,
            -- Der Steuerfall wird unten neu bestimmt; bis dahin behauptet der
            -- Kopf keine Verlagerung, die am neuen Stichtag nicht mehr traegt
            -- (sonst wiese fin.reverse_charge_pruefen schon dieses UPDATE ab).
            reverse_charge = false, steuerhinweis = null,
            geaendert_von_art = 'mensch', geaendert_von = app.aktueller_benutzer()
      where id = $1::uuid and status = 'entwurf'
      returning id`,
    [rechnungId, kopf.objektId, kopf.auftragId, art,
     kopf.leistungVon, kopf.leistungBis, vereinnahmung,
     ziel, zahlungsmittelCode(kopf.zahlungsmittelCode),
     kopf.kopftext, kopf.fusstext, abzugZurueckgenommen],
  );
  if (geschrieben.length === 0) {
    throw new RechnungFehler('Der Entwurf wurde nicht geändert.', 'kein_entwurf');
  }

  await schreibeSummen(db, rechnungId);
  await schreibeSteuerfall(db, rechnungId);

  return {
    zahlungszielAufgeloest: kopf.zahlungszielTage === null && ziel !== null,
    abzugZurueckgenommen,
  };
}

/**
 * Hängt schon ein Beleg des Auftrags an diesem Entwurf?
 *
 * Eine Stunde aus der Zeiterfassung, eine Vertragszeile, ein Aufmaß, ein
 * Abruf, eine Ausgabe — jede dieser Herkünfte gehört zum Auftrag, unter dem
 * sie übernommen wurde. Wechselte er, zeigte der Beleg Herkunft aus einem
 * Vertrag, auf den die Rechnung nicht mehr verweist. Eine von Hand erfasste
 * Zeile mit Begründung hängt an keinem Auftrag und hindert nichts.
 */
async function pruefeZuordnungFrei(db: Abfrage, rechnungId: string): Promise<void> {
  const [gebunden] = await db.abfrage<{ n: string }>(
    `select (select count(*) from rechnungsposition p
              where p.rechnung_id = $1::uuid
                and (p.auftrag_leistung_id is not null or p.vertrag_abrechnung_id is not null
                     or p.lv_position_id is not null))
          + (select count(*) from rechnungsposition_quelle q
              where q.rechnung_id = $1::uuid and q.wirksam and q.quelle_typ <> 'manuell')
            as n`,
    [rechnungId]);
  if (Number(gebunden?.n ?? '0') > 0) {
    throw new RechnungFehler(
      'An diesem Entwurf hängen schon Zeilen mit Beleg aus dem bisherigen Auftrag '
      + '(Zeiterfassung, Vertragszeile, Aufmaß, Abruf oder Ausgabe). Der Auftrag lässt '
      + 'sich deshalb nicht mehr wechseln — den Entwurf verwerfen und neu anlegen.',
      'zuordnung_gebunden',
    );
  }
}

/**
 * Tragen alle Zeilen am NEUEN Stichtag noch einen gültigen Steuersatz?
 *
 * `fuegePositionHinzu` löst den Satz am Stichtag des Kopfes auf (§13 Abs. 1
 * Nr. 1 UStG: der Zeitpunkt der Leistung). Verschiebt der Kopf den Stichtag
 * über eine Satzänderung hinweg, stünde auf der Zeile ein Satz, der an diesem
 * Tag nicht galt — ausgewiesen, geschuldet (§14c UStG) und nach dem
 * Festschreiben unveränderlich. Umgeschrieben wird nichts: der Satz einer
 * Zeile ist die Angabe eines Menschen.
 */
async function pruefeSaetzeAmStichtag(
  db: Abfrage, rechnungId: string,
  von: string | null, bis: string | null, vereinnahmung: string | null,
): Promise<void> {
  const falsch = await db.abfrage<{ schluessel: string; stichtag: string }>(
    `select distinct g.schluessel, to_char(t.stichtag, 'DD.MM.YYYY') as stichtag
       from rechnungsposition p
       join steuersatz_gruppe g on g.id = p.steuersatz_gruppe_id
       cross join (select coalesce($3::date, $2::date, $4::date, app.berlin_heute())
                     as stichtag) t
      where p.rechnung_id = $1::uuid
        and not (t.stichtag >= g.gueltig_von
                 and (g.gueltig_bis is null or t.stichtag <= g.gueltig_bis))`,
    [rechnungId, von, bis, vereinnahmung]);
  const erste = falsch[0];
  if (erste !== undefined) {
    throw new RechnungFehler(
      `Die Steuergruppe „${erste.schluessel}" einer Zeile gilt am ${erste.stichtag} nicht. `
      + 'Den Zeitraum so lassen oder die Zeile über einen neuen Entwurf mit dem Satz '
      + 'dieses Tages erfassen.',
      'unbekannte_steuergruppe',
    );
  }
}

// ---------------------------------------------------------------------------
// V-206 — Übernahme nach der Abrechnungsart des Auftrags
// ---------------------------------------------------------------------------

export interface Uebernahme {
  /** Nur bei Konfigurationen JE Leistungszeile (O-53). */
  readonly auftragLeistungId?: string | null;
  /** `einheitspreis_aufmass`: die ausdrücklich gewählten Blätter. */
  readonly aufmassIds?: readonly string[];
  /** `festpreis_los`, anteilig: Fertigstellungsgrad in Basispunkten. */
  readonly fertigstellungBp?: number;
}

interface EntwurfZeitraum {
  readonly status: string;
  readonly auftrag_id: string | null;
  readonly von: string | null;
  readonly bis: string | null;
}

/**
 * Auftrag und Zeitraum eines Entwurfs — die zwei Angaben, ohne die keine
 * Abrechnungsart rechnen kann. Beide stehen im Kopf und nirgends sonst: die
 * Periode der Abrechnung IST der Leistungszeitraum des Belegs (FIN-05).
 */
async function ladeZeitraum(db: Abfrage, rechnungId: string): Promise<{
  auftragId: string; periode: { von: string; bis: string };
}> {
  const [r] = await db.abfrage<EntwurfZeitraum>(
    `select status::text as status, auftrag_id::text as auftrag_id,
            to_char(leistung_von, 'YYYY-MM-DD') as von,
            to_char(leistung_bis, 'YYYY-MM-DD') as bis
       from rechnung where id = $1::uuid`,
    [rechnungId]);
  if (r === undefined) {
    throw new RechnungFehler(`Rechnung ${rechnungId} nicht gefunden`, 'nicht_gefunden');
  }
  if (r.status !== 'entwurf') {
    throw new RechnungFehler(
      'Nur ein Entwurf nimmt Zeilen auf (Invariante 4).', 'kein_entwurf');
  }
  if (r.auftrag_id === null) {
    throw new RechnungFehler(
      'Dieser Entwurf hängt an keinem Auftrag. Welche Abrechnungsart gilt, steht am '
      + 'Auftrag — zuerst im Kopf den Auftrag zuordnen.',
      'auftrag_passt_nicht',
    );
  }
  if (r.von === null || r.bis === null) {
    throw new RechnungFehler(
      'Der Entwurf nennt keinen Leistungszeitraum. Er ist der Abrechnungszeitraum — '
      + 'zuerst im Kopf „Leistung von" und „Leistung bis" setzen.',
      'leistungszeitpunkt_fehlt',
    );
  }
  return { auftragId: r.auftrag_id, periode: { von: r.von, bis: r.bis } };
}

async function pruefeLeistungszeile(
  db: Abfrage, auftragId: string, auftragLeistungId: string | null,
): Promise<void> {
  if (auftragLeistungId === null) return;
  const [z] = await db.abfrage<{ id: string }>(
    `select id::text as id from auftrag_leistung
      where id = $1::uuid and auftrag_id = $2::uuid`,
    [auftragLeistungId, auftragId]);
  if (z === undefined) {
    throw new AbrechnungFehler(
      'Diese Leistungszeile gehört nicht zum Auftrag des Entwurfs.', 'auftrag_passt_nicht');
  }
}

export interface AbrechnungsVorschau {
  readonly auftragId: string | null;
  /** Warum nicht gerechnet wurde — `null`, wenn gerechnet wurde. */
  readonly grund: string | null;
  /** Der Satz der Abrechnungsschicht, wenn sie abgewiesen hat (deutsch). */
  readonly meldung: string | null;
  readonly art: {
    readonly schluessel: string; readonly bezeichnung: string;
    readonly istProvisorisch: boolean;
  } | null;
  readonly gueltigAb: string | null;
  readonly befunde: readonly AbrechnungsBefund[];
  readonly positionen: readonly RechnungspositionEntwurf[];
  /** Zeilen dieses Entwurfs aus derselben Vereinbarung. */
  readonly schonUebernommen: number;
}

const LEER_VORSCHAU = {
  art: null, gueltigAb: null, befunde: [], positionen: [], schonUebernommen: 0,
} as const;

/**
 * Die Vorschau für das Rechnungsblatt — rechnen, ohne zu schreiben.
 *
 * Dieselbe Funktion wie die Übernahme (`berechneAbrechnung`), damit das
 * Blatt dieselben Zeilen zeigt, die danach entstehen. Aufmaßblätter werden
 * hier NICHT gewählt: sie wählt der Mensch in der Maske, und bis dahin sagt
 * die Strategie selbst, dass keines benannt ist.
 */
export async function vorschauAbrechnungsart(
  db: Abfrage, rechnungId: string, auftragLeistungId: string | null = null,
): Promise<AbrechnungsVorschau> {
  let zeitraum: Awaited<ReturnType<typeof ladeZeitraum>>;
  try {
    zeitraum = await ladeZeitraum(db, rechnungId);
  } catch (fehler) {
    if (fehler instanceof RechnungFehler) {
      return {
        ...LEER_VORSCHAU, auftragId: null, grund: fehler.grund, meldung: fehler.message,
      };
    }
    throw fehler;
  }
  try {
    await pruefeLeistungszeile(db, zeitraum.auftragId, auftragLeistungId);
    const ergebnis = await berechneAbrechnung(db, {
      auftragId: zeitraum.auftragId, auftragLeistungId, periode: zeitraum.periode,
    });
    const [schon] = await db.abfrage<{ n: string }>(
      `select count(*)::text as n from rechnungsposition
        where rechnung_id = $1::uuid and vertrag_abrechnung_id = $2::uuid`,
      [rechnungId, ergebnis.konfiguration.id]);
    return {
      auftragId: zeitraum.auftragId,
      grund: null,
      meldung: null,
      art: {
        schluessel: ergebnis.art.schluessel, bezeichnung: ergebnis.art.bezeichnung,
        istProvisorisch: ergebnis.art.istProvisorisch,
      },
      gueltigAb: ergebnis.konfiguration.gueltigAb,
      befunde: ergebnis.befunde,
      positionen: ergebnis.positionen,
      schonUebernommen: Number(schon?.n ?? '0'),
    };
  } catch (fehler) {
    /*
     * Auch ein `RechnungFehler` gehört hierher: eine Strategie rechnet ihren
     * Betrag mit `berechneNetto`, und dessen Abweisung (etwa eine
     * Preisbasismenge von null) ist eine Auskunft für die Vorschau, keine 500.
     */
    if (fehler instanceof AbrechnungFehler || fehler instanceof RechnungFehler) {
      return {
        ...LEER_VORSCHAU, auftragId: zeitraum.auftragId, grund: fehler.grund,
        meldung: fehler.message,
      };
    }
    throw fehler;
  }
}

/**
 * **Die Zeilen nach der Abrechnungsart des Auftrags übernehmen** (FIN-01,
 * FIN-07) — der Aufrufer, den `bestueckeAusAbrechnungsart` bis V-206 nicht
 * hatte.
 *
 * Geschrieben wird allein durch `bestueckeAusAbrechnungsart` → `bestuecke` →
 * `fuegePositionHinzu`: dort entsteht der Nettobetrag, dort hängt die
 * Herkunft unter der Zeile. Hier stehen nur die zwei Fragen davor:
 *
 *  - **Welcher Zeitraum?** Der Leistungszeitraum des Entwurfs, und kein
 *    zweiter aus der Maske — eine Rechnung über August mit Zeilen aus Juli
 *    widerspräche sich selbst.
 *  - **Schon übernommen?** Ein zweiter Klick auf denselben Knopf schriebe
 *    dieselbe Pauschale ein zweites Mal. Eine Vereinbarung wird deshalb je
 *    Entwurf einmal übernommen (D-699 Nr. 3); beim Aufmaß je Blatt einmal,
 *    weil dort mehrere Blätter nacheinander kommen dürfen.
 *
 * Blockiert die Strategie mit einem Befund, entsteht keine Zeile, und der
 * Fehler nennt die Befunde — eine Übernahme, die „erfolgreich nichts"
 * schreibt, wäre die stille Fassung desselben Abbruchs.
 */
export async function uebernimmAbrechnungsart(
  db: Abfrage, rechnungId: string, eingabe: Uebernahme,
): Promise<{ readonly positionIds: readonly string[] }> {
  const { auftragId, periode } = await ladeZeitraum(db, rechnungId);
  const zeile = eingabe.auftragLeistungId ?? null;
  await pruefeLeistungszeile(db, auftragId, zeile);
  const auftrag = {
    auftragId, auftragLeistungId: zeile, periode,
    aufmassIds: eingabe.aufmassIds, fertigstellungBp: eingabe.fertigstellungBp,
  };

  const konfiguration = await ladeKonfiguration(db, auftrag);
  const art = hole(konfiguration.abrechnungsart);
  if (art.schluessel === 'einheitspreis_aufmass') {
    const doppelt = await db.abfrage<{ nummer: string }>(
      `select distinct a.nummer
         from rechnungsposition_quelle q
         join aufmass a on a.mandant_id = q.mandant_id and a.id = q.aufmass_id
        where q.rechnung_id = $1::uuid and q.wirksam and q.aufmass_id = any($2::uuid[])
        order by a.nummer`,
      [rechnungId, [...(eingabe.aufmassIds ?? [])]]);
    if (doppelt.length > 0) {
      throw new AbrechnungFehler(
        `Aufmaß ${doppelt.map((d) => d.nummer).join(', ')} steht schon auf diesem Entwurf.`,
        'schon_uebernommen');
    }
  } else {
    const [schon] = await db.abfrage<{ n: string }>(
      `select count(*)::text as n from rechnungsposition
        where rechnung_id = $1::uuid and vertrag_abrechnung_id = $2::uuid`,
      [rechnungId, konfiguration.id]);
    if (Number(schon?.n ?? '0') > 0) {
      throw new AbrechnungFehler(
        'Diese Abrechnungsvereinbarung ist auf diesem Entwurf schon übernommen. Ein zweites '
        + 'Mal schriebe dieselben Zeilen doppelt.',
        'schon_uebernommen');
    }
  }

  const ergebnis = await bestueckeAusAbrechnungsart(db, rechnungId, auftrag);
  if (ergebnis.positionIds.length === 0) {
    const blockierend = ergebnis.befunde.filter((b) => b.art === 'fehler');
    throw new AbrechnungFehler(
      blockierend.length > 0
        ? blockierend.map((b) => b.textDe).join(' ')
        : 'Im Leistungszeitraum gibt es nach dieser Abrechnungsart nichts abzurechnen.',
      blockierend.length > 0 ? 'befund_blockiert' : 'nichts_abzurechnen');
  }
  return { positionIds: ergebnis.positionIds };
}

// ---------------------------------------------------------------------------
// V-206 — Material aus einer Ausgabe
// ---------------------------------------------------------------------------

/**
 * // TODO(client, O-931): Wird Material zum Einstandspreis (Netto der
 * Ausgabe) weiterberechnet oder mit Aufschlag — und wenn mit Aufschlag, mit
 * welchem Satz, je Gesellschaft, je Kunde oder je Vertrag?
 *
 * Bis zur Antwort schlägt die Plattform KEINEN Preis vor: der Einzelpreis
 * einer Materialzeile ist die Eingabe eines Menschen, und die Maske zeigt den
 * Einstand daneben nur als Auskunft. Ein vorbelegter Einstandspreis wäre die
 * stille Antwort „ohne Aufschlag", ein vorbelegter Aufschlag eine erfundene
 * Kalkulationsregel.
 */
export const MATERIAL_PREISREGEL: { readonly art: 'offen'; readonly frage: 'O-931' } = {
  art: 'offen', frage: 'O-931',
};

export interface MaterialPositionAnlegen {
  readonly rechnungId: string;
  readonly ausgabeId: string;
  readonly bezeichnung: string;
  readonly beschreibung?: string | null;
  readonly menge: MilliMenge;
  readonly einheit: string;
  readonly einzelpreisCent: Cent;
  readonly steuergruppe: string;
}

interface AusgabeZeile {
  readonly id: string;
  readonly bezeichnung: string;
  readonly ausgabedatum: string;
  readonly netto_cent: string;
  readonly weiterberechenbar: boolean;
  readonly status: string;
  readonly auftrag_id: string | null;
  readonly kunde_id: string | null;
  readonly weiterberechnet: boolean;
}

/**
 * Die Ausgabe mit dem, woran sie hängt. Gelesen unter `eingang.lesen` (die
 * Policy auf `ausgabe`, 0180) — ohne das Recht gibt es sie hier nicht.
 */
const AUSGABE_SQL = `
  select a.id::text as id, a.bezeichnung, to_char(a.ausgabedatum, 'YYYY-MM-DD') as ausgabedatum,
         a.netto_cent::text as netto_cent, a.weiterberechenbar, a.status::text as status,
         coalesce(a.auftrag_id, p.auftrag_id)::text as auftrag_id,
         coalesce(au.kunde_id, p.kunde_id, o.kunde_id)::text as kunde_id,
         exists (select 1 from rechnungsposition_quelle q
                  where q.mandant_id = a.mandant_id and q.ausgabe_id = a.id
                    and q.quelle_typ = 'material' and q.wirksam) as weiterberechnet
    from ausgabe a
    left join projekt p on p.mandant_id = a.mandant_id and p.id = a.projekt_id
    left join auftrag au on au.mandant_id = a.mandant_id
                        and au.id = coalesce(a.auftrag_id, p.auftrag_id)
    left join objekt o on o.mandant_id = a.mandant_id and o.id = a.objekt_id`;

/** Die Zustände, in denen eine Ausgabe belegt und freigegeben ist (0180). */
const WEITERBERECHENBAR_IM_ZUSTAND = ['freigegeben', 'gebucht'] as const;

function passtZurRechnung(
  a: AusgabeZeile, r: { kunde_id: string; auftrag_id: string | null },
): boolean {
  if (r.auftrag_id !== null && a.auftrag_id !== null && a.auftrag_id !== r.auftrag_id) {
    return false;
  }
  return a.kunde_id === null || a.kunde_id === r.kunde_id;
}

export interface AusgabeAuswahl {
  readonly id: string;
  readonly bezeichnung: string;
  readonly ausgabedatum: string;
  readonly nettoCent: Cent;
}

/**
 * Die Ausgaben, die auf DIESEN Entwurf passen: weiterberechenbar, belegt und
 * freigegeben, noch auf keiner wirksamen Zeile, und keinem anderen Auftrag
 * oder Kunden zugeordnet. Dieselbe Regel wie `fuegeMaterialPositionHinzu` —
 * die Maske bietet nichts an, was der Dienst danach abweist.
 */
export async function weiterberechenbareAusgaben(
  db: Abfrage, rechnungId: string,
): Promise<readonly AusgabeAuswahl[]> {
  const [r] = await db.abfrage<{ kunde_id: string; auftrag_id: string | null }>(
    `select kunde_id::text as kunde_id, auftrag_id::text as auftrag_id
       from rechnung where id = $1::uuid`, [rechnungId]);
  if (r === undefined) return [];
  const zeilen = await db.abfrage<AusgabeZeile>(
    `${AUSGABE_SQL}
      where a.weiterberechenbar and a.status::text = any($1::text[])
      order by a.ausgabedatum desc, a.id
      limit 200`,
    [[...WEITERBERECHENBAR_IM_ZUSTAND]]);
  return zeilen
    .filter((a) => !a.weiterberechnet && passtZurRechnung(a, r))
    .map((a) => ({
      id: a.id, bezeichnung: a.bezeichnung, ausgabedatum: a.ausgabedatum,
      nettoCent: BigInt(a.netto_cent) as Cent,
    }));
}

/**
 * **Eine Materialzeile mit der Ausgabe als Beleg** (FIN-07, Quelle
 * `material`).
 *
 * Die Doppelsperre steht in der Datenbank (`quelle_ausgabe_uk`, 0107): eine
 * Ausgabe trägt höchstens EINE wirksame Materialzeile. Hier wird vorher
 * gefragt, damit der Mensch den Satz liest und nicht den Indexnamen.
 */
export async function fuegeMaterialPositionHinzu(
  db: Abfrage, eingabe: MaterialPositionAnlegen,
): Promise<string> {
  const [r] = await db.abfrage<{ status: string; kunde_id: string; auftrag_id: string | null }>(
    `select status::text as status, kunde_id::text as kunde_id, auftrag_id::text as auftrag_id
       from rechnung where id = $1::uuid`, [eingabe.rechnungId]);
  if (r === undefined) {
    throw new RechnungFehler(`Rechnung ${eingabe.rechnungId} nicht gefunden`, 'nicht_gefunden');
  }
  if (r.status !== 'entwurf') {
    throw new RechnungFehler('Nur ein Entwurf nimmt Zeilen auf (Invariante 4).', 'kein_entwurf');
  }

  const [a] = await db.abfrage<AusgabeZeile>(
    `${AUSGABE_SQL} where a.id = $1::uuid`, [eingabe.ausgabeId]);
  if (a === undefined) {
    throw new QuellenFehler(
      'Diese Ausgabe gibt es nicht — oder sie ist für Sie nicht sichtbar.', 'quelle_fehlt');
  }
  if (!a.weiterberechenbar) {
    throw new RechnungFehler(
      'Diese Ausgabe ist nicht als weiterberechenbar gekennzeichnet.', 'quelle_passt_nicht');
  }
  if (!(WEITERBERECHENBAR_IM_ZUSTAND as readonly string[]).includes(a.status)) {
    throw new RechnungFehler(
      'Weiterberechnet wird nur eine freigegebene Ausgabe mit Beleg.', 'quelle_passt_nicht');
  }
  if (a.weiterberechnet) {
    throw new QuellenFehler(
      'Diese Ausgabe ist schon auf einer Rechnungszeile weiterberechnet.', 'schon_abgerechnet');
  }
  if (!passtZurRechnung(a, r)) {
    throw new RechnungFehler(
      'Diese Ausgabe gehört zu einem anderen Auftrag oder Kunden als diese Rechnung.',
      'quelle_passt_nicht');
  }

  return fuegePositionHinzu(db, {
    rechnungId: eingabe.rechnungId,
    bezeichnung: eingabe.bezeichnung,
    beschreibung: eingabe.beschreibung ?? null,
    menge: eingabe.menge,
    einheit: eingabe.einheit,
    einzelpreisCent: eingabe.einzelpreisCent,
    steuergruppe: eingabe.steuergruppe,
    quellen: [{ typ: 'material', id: eingabe.ausgabeId }],
  });
}

// ---------------------------------------------------------------------------
// Was die Masken zur Auswahl brauchen
// ---------------------------------------------------------------------------

export interface AuftragAuswahl {
  readonly id: string;
  readonly auftragsnummer: string;
  readonly bezeichnung: string;
  readonly kundeId: string;
}

/**
 * Die Aufträge, die eine Rechnung tragen dürfen — nicht storniert, sichtbar
 * unter `auftrag.lesen`. Dieselbe Lesart wie `pruefeAuftragZuordnung`.
 */
export async function auftraegeZurAuswahl(
  db: Abfrage, kundeId: string | null = null,
): Promise<readonly AuftragAuswahl[]> {
  const zeilen = await db.abfrage<{
    id: string; auftragsnummer: string; bezeichnung: string; kunde_id: string;
  }>(
    `select id::text as id, auftragsnummer, bezeichnung, kunde_id::text as kunde_id
       from auftrag
      where status <> 'storniert' and kunde_id is not null
        and ($1::uuid is null or kunde_id = $1::uuid)
      order by auftragsnummer desc
      limit 500`,
    [kundeId]);
  return zeilen.map((z) => ({
    id: z.id, auftragsnummer: z.auftragsnummer, bezeichnung: z.bezeichnung, kundeId: z.kunde_id,
  }));
}

export interface AufmassAuswahl {
  readonly id: string;
  readonly nummer: string;
  readonly bezeichnung: string | null;
  readonly status: string;
  readonly messdatum: string | null;
}

/** Die Aufmaßblätter der Projekte dieses Auftrags, ohne stornierte. */
export async function aufmasseZumAuftrag(
  db: Abfrage, auftragId: string,
): Promise<readonly AufmassAuswahl[]> {
  return db.abfrage<AufmassAuswahl>(
    `select a.id::text as id, a.nummer, a.bezeichnung, a.status::text as status,
            to_char(a.messdatum, 'YYYY-MM-DD') as messdatum
       from aufmass a
       join projekt p on p.mandant_id = a.mandant_id and p.id = a.projekt_id
      where p.auftrag_id = $1::uuid and a.storniert_am is null
      order by a.nummer`,
    [auftragId]);
}

export type { EntwurfRechnungsart };
