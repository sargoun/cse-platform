/**
 * Die Abrechnung eines Auftrags (FIN-01) — und die eine Stelle, an der die
 * fuenf Arten zusammenlaufen.
 *
 * **Der Rechnungsdienst kennt keine Abrechnungsart.** `rechnung.ts` legt
 * Entwuerfe an, rechnet Summen und schreibt fest; WELCHE Zeilen entstehen,
 * entscheidet hier eine registrierte Strategie. Deshalb kostet eine sechste
 * Art eine Klasse und eine Registerzeile und keine Aenderung an
 * `finalisiere()` — Abnahme (5).
 *
 * **Und es gibt keinen Vorgabewert.** Ein Auftrag ohne gueltige
 * `vertrag_abrechnung` laesst sich nicht berechnen: `AbrechnungFehler` mit
 * `grund = 'keine_abrechnungsart'`, und niemand faellt auf „dann eben
 * stundenbasiert" zurueck — Abnahme (4). Eine erfundene Abrechnungsart ist
 * eine Rechnung nach einer Regel, die im Vertrag nicht steht, und einen
 * Augenblick spaeter ist sie festgeschrieben, gehasht und unveraenderlich.
 */
import type { Cent } from '../geld.js';
import type { QuelleEingabe } from '../positionsquelle.js';
import { fuegePositionHinzu, type Abfrage } from '../rechnung.js';
import { EINHEITSPREIS_AUFMASS } from './einheitspreis-aufmass.js';
import { EINZELABRUF } from './einzelabruf.js';
import { FESTPREIS_LOS } from './festpreis-los.js';
import { MONATSPAUSCHALE } from './monatspauschale.js';
import { hole, istRegistriert, registriere } from './register.js';
import { tagDeutsch } from '../../../../lib/datum/kalendertag.js';
import { STUNDENBASIERT } from './stunden.js';
import {
  AbrechnungFehler,
  type AbrechnungsBefund,
  type Abrechnungsart,
  type HerkunftVerweis,
  type Periode,
  type RechnungspositionEntwurf,
  type VertragAbrechnung,
  centOderNull,
  mengeOderNull,
  pruefeParameter,
} from './typen.js';

/**
 * Die fuenf aus FIN-01, eingetragen beim Laden dieses Moduls.
 *
 * Die Liste steht hier und nicht in `register.ts`: das Register soll nichts
 * ueber die fuenf wissen muessen, sonst koennte eine sechste es nicht ohne
 * Aenderung erweitern.
 */
registriere(STUNDENBASIERT);
registriere(MONATSPAUSCHALE);
registriere(FESTPREIS_LOS);
registriere(EINHEITSPREIS_AUFMASS);
registriere(EINZELABRUF);

export { alleAbrechnungsarten, entferne, hole, istRegistriert, registriere } from './register.js';
export {
  ABRECHNUNGSARTEN, AbrechnungFehler, type AbrechnungGrund, type AbrechnungsBefund,
  type AbrechnungsEingabe, type Abrechnungsart, type AbrechnungsartSchluessel,
  type HerkunftVerweis, type OffenerParameter, type Periode,
  type RechnungspositionEntwurf, type VertragAbrechnung,
} from './typen.js';
export { EINHEITSPREIS_AUFMASS } from './einheitspreis-aufmass.js';
export { EINZELABRUF } from './einzelabruf.js';
export { FESTPREIS_LOS } from './festpreis-los.js';
export { MONATSPAUSCHALE } from './monatspauschale.js';
export { STUNDENBASIERT } from './stunden.js';

// ---------------------------------------------------------------------------
// Die Konfiguration laden
// ---------------------------------------------------------------------------

interface KonfigurationZeile {
  readonly id: string;
  readonly mandant_id: string;
  readonly auftrag_id: string;
  readonly auftrag_leistung_id: string | null;
  readonly abrechnungsart: string;
  readonly parameter: unknown;
  readonly pauschale_netto_cent: string | null;
  readonly stundensatz_cent: string | null;
  readonly festpreis_netto_cent: string | null;
  readonly mindestabnahme_stunden: string | null;
  readonly abrechnungsintervall: string;
  readonly leistungszeitraum_modus: string;
  readonly zahlungsziel_tage: number | null;
  readonly reverse_charge_13b: boolean;
  readonly unterliegt_bauabzugsteuer: boolean;
  readonly gueltig_ab: string;
  readonly gueltig_bis: string | null;
}

function alsKonfiguration(z: KonfigurationZeile): VertragAbrechnung {
  /**
   * `parameter` kommt als OBJEKT aus dem Treiber, nicht als Zeichenkette.
   * `postgres.js` gibt `jsonb` bereits geparst zurueck; ein `JSON.parse`
   * darauf waere ein Laufzeitfehler, und ein `String(...)` legte `[object
   * Object]` ab.
   */
  const parameter = typeof z.parameter === 'object' && z.parameter !== null
    ? z.parameter as Record<string, unknown>
    : {};
  return {
    id: z.id,
    mandantId: z.mandant_id,
    auftragId: z.auftrag_id,
    auftragLeistungId: z.auftrag_leistung_id,
    abrechnungsart: z.abrechnungsart,
    parameter,
    pauschaleNettoCent: centOderNull(z.pauschale_netto_cent),
    stundensatzCent: centOderNull(z.stundensatz_cent),
    festpreisNettoCent: centOderNull(z.festpreis_netto_cent),
    mindestabnahmeStunden: mengeOderNull(z.mindestabnahme_stunden),
    abrechnungsintervall: z.abrechnungsintervall,
    leistungszeitraumModus: z.leistungszeitraum_modus,
    zahlungszielTage: z.zahlungsziel_tage,
    reverseCharge13b: z.reverse_charge_13b,
    unterliegtBauabzugsteuer: z.unterliegt_bauabzugsteuer,
    gueltigAb: z.gueltig_ab,
    gueltigBis: z.gueltig_bis,
  };
}

export interface KonfigurationsSuche {
  readonly auftragId: string;
  /** Eine Konfiguration JE LEISTUNGSZEILE schlaegt die auftragsweite (O-53). */
  readonly auftragLeistungId?: string | null | undefined;
  readonly periode: Periode;
}

const KONFIGURATION_FELDER = `
  select v.id, v.mandant_id, v.auftrag_id,
         v.auftrag_leistung_id::text as auftrag_leistung_id,
         v.abrechnungsart::text as abrechnungsart, v.parameter,
         v.pauschale_netto_cent::text, v.stundensatz_cent::text,
         v.festpreis_netto_cent::text, v.mindestabnahme_stunden::text,
         v.abrechnungsintervall::text as abrechnungsintervall,
         v.leistungszeitraum_modus::text as leistungszeitraum_modus,
         v.zahlungsziel_tage, v.reverse_charge_13b, v.unterliegt_bauabzugsteuer,
         to_char(v.gueltig_ab, 'YYYY-MM-DD') as gueltig_ab,
         to_char(v.gueltig_bis, 'YYYY-MM-DD') as gueltig_bis
    from vertrag_abrechnung v`;

/*
 * **Die Vorrangordnung haengt davon ab, WONACH gefragt wurde.**
 *
 * Hier stand `order by case when v.auftrag_leistung_id is null then 1 else 0`
 * — die zeilenbezogene Konfiguration also IMMER vor der auftragsweiten. Fuer
 * eine Frage nach einer Leistungszeile ist das richtig: das Speziellere
 * schlaegt das Allgemeine. Fuer eine Frage nach dem GANZEN Auftrag ist es
 * verkehrt herum, und zwar still: gibt es beides, rechnete der Auftragslauf
 * mit dem Satz, den jemand fuer EINE Zeile zugesagt hat.
 *
 * `$2::uuid is null` dreht die Ordnung deshalb um. Die Bereichsbedingung
 * bleibt weit — ein Vertrag mit einer einzigen Leistungszeile hinterlegt
 * seine Abrechnung an dieser Zeile, und der Auftragslauf muss sie finden.
 * Was dabei NICHT stillschweigend passieren darf, steht in
 * `ladeKonfiguration`: mehrere Zeilenkonfigurationen sind fuer einen
 * Auftragslauf keine Auswahl, sondern eine Frage.
 */
const KONFIGURATION_SQL = `${KONFIGURATION_FELDER}
   where v.auftrag_id = $1
     and ($2::uuid is null
          or v.auftrag_leistung_id = $2::uuid
          or v.auftrag_leistung_id is null)
     -- BEREICHSUEBERLAPPUNG, kein Stichtag (02-CRM §3.2, review B9): eine zum
     -- 15. Maerz beendete Konfiguration muss der Maerzlauf FINDEN, sonst wird
     -- die Leistung vom 1. bis 15. Maerz nie berechnet.
     and v.gueltig_ab <= $4::date
     and (v.gueltig_bis is null or v.gueltig_bis >= $3::date)
   order by case
              when $2::uuid is null
                then case when v.auftrag_leistung_id is null then 0 else 1 end
              else case when v.auftrag_leistung_id is null then 1 else 0 end
            end,
            v.gueltig_ab desc`;

/**
 * Die Abrechnungskonfiguration, die im Zeitraum gilt — oder ein getippter
 * Fehler (Abnahme 4).
 */
export async function ladeKonfiguration(
  db: Abfrage, suche: KonfigurationsSuche,
): Promise<VertragAbrechnung> {
  const zeilen = await db.abfrage<KonfigurationZeile>(
    KONFIGURATION_SQL,
    [suche.auftragId, suche.auftragLeistungId ?? null, suche.periode.von, suche.periode.bis],
  );
  const zeile = zeilen[0];
  if (zeile === undefined) {
    throw new AbrechnungFehler(
      `Der Auftrag ${suche.auftragId} hat für ${suche.periode.von} bis `
      + `${suche.periode.bis} keine hinterlegte Abrechnungsart. Er lässt sich deshalb `
      + 'nicht berechnen — es gibt keinen Vorgabewert (FIN-01, O-04).',
      'keine_abrechnungsart',
    );
  }

  /**
   * **Ein Auftragslauf waehlt nicht zwischen Zeilenkonfigurationen.**
   *
   * Ohne auftragsweite Zeile findet der Auftragslauf die Vereinbarungen der
   * einzelnen Leistungszeilen. Bei EINER ist das die richtige Antwort — ein
   * Vertrag mit einer Zeile hinterlegt seine Abrechnung dort. Bei mehreren
   * ist es keine Antwort, sondern eine Auswahl, und getroffen haette sie
   * `order by … gueltig_ab desc`: der Auftrag waere nach dem Satz gerechnet
   * worden, der zufaellig zuletzt vereinbart wurde, und der Beleg naennte
   * diese eine Konfiguration als Herkunft — stimmig aussehend und falsch.
   *
   * Die richtige Antwort ist eine Frage: welche Zeile ist gemeint? Wer den
   * ganzen Auftrag abrechnen will, ruft je Zeile.
   */
  if ((suche.auftragLeistungId ?? null) === null && zeile.auftrag_leistung_id !== null) {
    const zeilenScharf = zeilen.filter((z) => z.auftrag_leistung_id !== null);
    if (zeilenScharf.length > 1) {
      throw new AbrechnungFehler(
        `Der Auftrag ${suche.auftragId} hat für ${suche.periode.von} bis `
        + `${suche.periode.bis} ${String(zeilenScharf.length)} Abrechnungsarten auf `
        + 'einzelnen Leistungszeilen und keine für den ganzen Auftrag. Welche gilt, '
        + 'entscheidet nicht die Reihenfolge — bitte je Leistungszeile abrechnen.',
        'keine_abrechnungsart',
      );
    }
  }

  return alsKonfiguration(zeile);
}

/**
 * ALLE Konfigurationen eines Auftrags, die juengste zuerst.
 *
 * Die Oberflaeche zeigt die Geschichte und nicht nur die geltende Zeile: ein
 * Vertrag, der zum 1. Januar von Stundenlohn auf Monatspauschale gewechselt
 * ist, hat beide — und eine Rechnung aus dem Dezember laesst sich nur mit der
 * Dezemberzeile erklaeren.
 */
export async function ladeKonfigurationen(
  db: Abfrage, auftragId: string,
): Promise<readonly VertragAbrechnung[]> {
  const zeilen = await db.abfrage<KonfigurationZeile>(
    `${KONFIGURATION_FELDER}
      where v.auftrag_id = $1
      order by v.gueltig_ab desc,
               case when v.auftrag_leistung_id is null then 0 else 1 end`,
    [auftragId],
  );
  return zeilen.map(alsKonfiguration);
}

// ---------------------------------------------------------------------------
// Die Konfiguration schreiben
// ---------------------------------------------------------------------------

export interface KonfigurationAnlegen {
  readonly auftragId: string;
  /** `null` heisst „der ganze Auftrag" (O-53). */
  readonly auftragLeistungId?: string | null;
  readonly abrechnungsart: string;
  /** Die offenen Regeln aus O-04 — ohne Geldbetrag (der steht in den Spalten). */
  readonly parameter: Readonly<Record<string, unknown>>;
  readonly pauschaleNettoCent?: Cent | null;
  readonly stundensatzCent?: Cent | null;
  readonly festpreisNettoCent?: Cent | null;
  readonly abrechnungsintervall: string;
  readonly leistungszeitraumModus: string;
  readonly zahlungszielTage?: number | null;
  readonly gueltigAb: string;
  readonly gueltigBis?: string | null;
}

/**
 * Eine Abrechnungskonfiguration anlegen — der Weg, auf dem O-04 zu einer
 * DATENAENDERUNG wird statt zu einer Codeaenderung.
 *
 * Zwei Prüfungen laufen vorher, und beide sind absichtlich hier und nicht im
 * Handler: dass es zu der genannten Art überhaupt eine Umsetzung gibt (sonst
 * entstünde eine Konfiguration, die niemand rechnen kann), und dass die
 * Parameter dieser Art gesetzt und zulässig sind. Ohne die zweite liesse sich
 * eine Konfiguration speichern, die erst am Tag der Rechnung abweist — und
 * dann steht jemand vor einem Beleg, den er heute braucht.
 *
 * Der zeitliche Überlapp prüft die DATENBANK (`va_kein_ueberlapp`, 0086): zwei
 * gleichzeitige Anlagen sähen beide keinen Konflikt, und eine Vorabprüfung
 * hier wäre genau die Lücke.
 */
export async function legeKonfigurationAn(
  db: Abfrage, eingabe: KonfigurationAnlegen,
): Promise<string> {
  const art = hole(eingabe.abrechnungsart);
  const probe: VertragAbrechnung = {
    id: '', mandantId: '', auftragId: eingabe.auftragId,
    auftragLeistungId: eingabe.auftragLeistungId ?? null,
    abrechnungsart: eingabe.abrechnungsart,
    parameter: eingabe.parameter,
    pauschaleNettoCent: eingabe.pauschaleNettoCent ?? null,
    stundensatzCent: eingabe.stundensatzCent ?? null,
    festpreisNettoCent: eingabe.festpreisNettoCent ?? null,
    mindestabnahmeStunden: null,
    abrechnungsintervall: eingabe.abrechnungsintervall,
    leistungszeitraumModus: eingabe.leistungszeitraumModus,
    zahlungszielTage: eingabe.zahlungszielTage ?? null,
    reverseCharge13b: false,
    unterliegtBauabzugsteuer: false,
    gueltigAb: eingabe.gueltigAb,
    gueltigBis: eingabe.gueltigBis ?? null,
  };
  const offen = pruefeParameter(art, probe).filter((b) => b.art === 'fehler');
  if (offen.length > 0) {
    throw new AbrechnungFehler(
      offen.map((b) => b.textDe).join(' '), 'parameter_offen',
    );
  }

  const [zeile] = await db.abfrage<{ id: string }>(
    `insert into vertrag_abrechnung
       (mandant_id, auftrag_id, auftrag_leistung_id, abrechnungsart, parameter,
        pauschale_netto_cent, stundensatz_cent, festpreis_netto_cent,
        abrechnungsintervall, leistungszeitraum_modus, zahlungsziel_tage,
        gueltig_ab, gueltig_bis, erstellt_von)
     values (app.aktiver_mandant(), $1::uuid, $2::uuid, $3::abrechnungsart,
             ($4::text)::jsonb, $5::bigint, $6::bigint, $7::bigint,
             $8::abrechnungsintervall, $9::leistungszeitraum_modus, $10,
             $11::date, $12::date, app.aktueller_benutzer())
     returning id`,
    [
      eingabe.auftragId, eingabe.auftragLeistungId ?? null, eingabe.abrechnungsart,
      JSON.stringify(eingabe.parameter),
      eingabe.pauschaleNettoCent?.toString() ?? null,
      eingabe.stundensatzCent?.toString() ?? null,
      eingabe.festpreisNettoCent?.toString() ?? null,
      eingabe.abrechnungsintervall, eingabe.leistungszeitraumModus,
      eingabe.zahlungszielTage ?? null,
      eingabe.gueltigAb, eingabe.gueltigBis ?? null,
    ],
  );
  if (zeile === undefined) {
    throw new AbrechnungFehler(
      'Die Abrechnungskonfiguration wurde nicht angelegt.', 'keine_abrechnungsart',
    );
  }
  return zeile.id;
}

/**
 * Eine laufende Konfiguration BEENDEN — nie überschreiben.
 *
 * `gueltig_bis` ist einschliesslich. Eine Konfiguration zu ändern hiesse, die
 * Grundlage einer bereits festgeschriebenen Rechnung rückwirkend zu ändern;
 * beendet und durch eine neue Zeile abgelöst bleibt jede vergangene Rechnung
 * erklärbar (FIN-06, K-12).
 */
export async function beendeKonfiguration(
  db: Abfrage, konfigurationId: string, gueltigBis: string,
): Promise<void> {
  const betroffen = await db.abfrage<{ id: string }>(
    `update vertrag_abrechnung set gueltig_bis = $2::date,
            geaendert_von = app.aktueller_benutzer()
      where id = $1 and (gueltig_bis is null or gueltig_bis > $2::date)
      returning id`,
    [konfigurationId, gueltigBis],
  );
  if (betroffen.length === 0) {
    throw new AbrechnungFehler(
      `Die Abrechnungskonfiguration ${konfigurationId} gibt es nicht, oder sie endet `
      + `bereits am oder vor dem ${gueltigBis}.`,
      'keine_abrechnungsart',
    );
  }
}

// ---------------------------------------------------------------------------
// Rechnen
// ---------------------------------------------------------------------------

export interface AbrechnungsAuftrag {
  readonly auftragId: string;
  readonly auftragLeistungId?: string | null | undefined;
  readonly periode: Periode;
  readonly aufmassIds?: readonly string[] | undefined;
  readonly fertigstellungBp?: number | undefined;
}

export interface AbrechnungsErgebnis {
  readonly konfiguration: VertragAbrechnung;
  readonly art: Abrechnungsart;
  readonly befunde: readonly AbrechnungsBefund[];
  readonly positionen: readonly RechnungspositionEntwurf[];
}

/**
 * Die Vorschau: pruefen und rechnen, ohne etwas zu schreiben.
 *
 * Die Pruefung laeuft ZUERST und blockierend. Erst rechnen und die Befunde
 * danebenstellen waere die bequeme Fassung — und die, bei der jemand die
 * Zahlen uebernimmt und die rote Zeile daneben ueberliest.
 */
export async function berechneAbrechnung(
  db: Abfrage, auftrag: AbrechnungsAuftrag,
): Promise<AbrechnungsErgebnis> {
  const konfiguration = await ladeKonfiguration(db, auftrag);
  const art = hole(konfiguration.abrechnungsart);
  return berechneMitKonfiguration(db, art, konfiguration, auftrag);
}

/**
 * Dasselbe mit einer bereits aufgeloesten Konfiguration.
 *
 * Sie steht getrennt, weil ein Testdoppel genau hier ansetzt: eine SECHSTE
 * Abrechnungsart registrieren, eine Konfiguration mit ihrem Schluessel bauen
 * und durch dieselbe Erzeugung laufen lassen — ohne eine Zeile in `rechnung.ts`
 * oder in dieser Datei zu aendern (Abnahme 5).
 */
export async function berechneMitKonfiguration(
  db: Abfrage,
  art: Abrechnungsart,
  konfiguration: VertragAbrechnung,
  auftrag: Pick<AbrechnungsAuftrag, 'periode' | 'aufmassIds' | 'fertigstellungBp'>,
): Promise<AbrechnungsErgebnis> {
  const eingabe = {
    konfiguration,
    periode: auftrag.periode,
    aufmassIds: auftrag.aufmassIds,
    fertigstellungBp: auftrag.fertigstellungBp,
  };
  const befunde = await art.pruefe(db, eingabe);
  if (befunde.some((b) => b.art === 'fehler')) {
    return { konfiguration, art, befunde, positionen: [] };
  }
  const positionen = await art.positionen(db, eingabe);
  return { konfiguration, art, befunde, positionen };
}

// ---------------------------------------------------------------------------
// Schreiben
// ---------------------------------------------------------------------------

/**
 * Die Abbildung auf das Herkunftsvokabular von FIN-07 (PR 49) — EINE Stelle.
 *
 * `vertrag_abrechnung` ist dort kein Quelltyp, und das ist richtig: eine
 * Monatspauschale hat keinen Beleg im Sinne von FIN-07, sondern eine
 * Vereinbarung. Sie wird deshalb als ausdruecklich beleglose Zeile MIT
 * Begruendung geschrieben — nicht als erfundener Verweis auf eine
 * Leistungszeile, die die Konfiguration gar nicht nennt.
 */
function alsQuellen(
  entwurf: RechnungspositionEntwurf, herkunft: readonly HerkunftVerweis[],
): readonly QuelleEingabe[] {
  return herkunft.map((h) => {
    if (h.art === 'vertrag_abrechnung') {
      /*
       * Die Notiz steht als Herkunft unter der Zeile auf dem Rechnungsblatt
       * (DSH-04) — sie nennt deshalb die Art beim Namen und den Zeitraum
       * deutsch, und keine Kennung (V-206). Welche Vereinbarung gemeint ist,
       * steht maschinenlesbar in `rechnungsposition.vertrag_abrechnung_id`.
       */
      const art = istRegistriert(entwurf.abrechnungsart)
        ? hole(entwurf.abrechnungsart).bezeichnung : entwurf.abrechnungsart;
      const von = entwurf.leistungVon === null ? '?' : tagDeutsch(entwurf.leistungVon);
      const bis = entwurf.leistungBis === null ? '?' : tagDeutsch(entwurf.leistungBis);
      return {
        typ: 'manuell' as const,
        notiz: `${art} laut Abrechnungsvereinbarung des Auftrags (${von} bis ${bis})`,
      };
    }
    return { typ: h.art, id: h.id, mengeAnteil: h.anteil };
  });
}

/**
 * Die Entwuerfe in einen Rechnungsentwurf schreiben.
 *
 * Geschrieben wird durch `fuegePositionHinzu()` und nicht durch ein eigenes
 * `INSERT`: dort wird der Nettobetrag GERECHNET (aus Menge, Basismenge und
 * Einzelpreis), dort wird die Mengeneinheit aufgeloest, und dort laufen
 * anschliessend die Steueraufschluesselung je Gruppe und die Kopfsummen. Ein
 * zweiter Schreibweg waere eine zweite Formel, und die zweite ist die, die bei
 * der naechsten Aenderung stehenbleibt (Abnahme 2).
 */
export async function bestuecke(
  db: Abfrage, rechnungId: string, positionen: readonly RechnungspositionEntwurf[],
): Promise<readonly string[]> {
  const ids: string[] = [];
  for (const p of positionen) {
    ids.push(await fuegePositionHinzu(db, {
      rechnungId,
      bezeichnung: p.bezeichnung,
      beschreibung: p.beschreibung,
      menge: p.menge,
      einheit: p.einheit,
      einzelpreisCent: p.einzelpreisCent,
      steuergruppe: p.steuergruppe,
      preisBasismenge: p.preisBasismenge,
      abrechnungsart: p.abrechnungsart,
      vertragAbrechnungId: p.vertragAbrechnungId,
      auftragLeistungId: p.auftragLeistungId,
      lvPositionId: p.lvPositionId,
      leistungVon: p.leistungVon,
      leistungBis: p.leistungBis,
      quellen: alsQuellen(p, p.herkunft),
    }));
  }
  return ids;
}

/**
 * Der ganze Weg: Konfiguration aufloesen, pruefen, rechnen, schreiben.
 *
 * Der Rechnungsentwurf MUSS schon bestehen — angelegt wird er von
 * `legeEntwurfAn()`, mit Kunde, Objekt und Zahlungsziel. Ihn hier nebenbei
 * anzulegen verstreute die Entstehung eines Belegs auf zwei Dienste.
 */
export async function bestueckeAusAbrechnungsart(
  db: Abfrage, rechnungId: string, auftrag: AbrechnungsAuftrag,
): Promise<AbrechnungsErgebnis & { readonly positionIds: readonly string[] }> {
  /**
   * **Die Rechnung und der Auftrag kamen unabhaengig herein.**
   *
   * Beide Kennungen wurden fuer sich geprueft — die Fremdschluessel halten
   * die Mandantengrenze, und die sagt „dieselbe Gesellschaft", nicht
   * „derselbe Auftrag". Damit liessen sich die berechneten Zeilen des
   * Auftrags A in eine Rechnung schreiben, die Auftrag B traegt: jede Zeile
   * fuer sich stimmig, die Herkunft unter jeder Position korrekt auf A
   * zeigend, und der Beleg einen Augenblick spaeter festgeschrieben und
   * unveraenderlich.
   *
   * Abgewiesen wird nur, was einen ANDEREN Auftrag nennt. Eine Rechnung ohne
   * Auftrag widerspricht nicht — den Fall gibt es ausdruecklich (eine
   * Einmalleistung ohne Auftragsbezug), und ihn zu verbieten waere eine
   * erfundene Regel. Dieselbe Regel wie bei `fuegeZeitPositionHinzu` und bei
   * den fuenf Fremdbezuegen aus der Nachtrunde von PR #5.
   */
  const [beleg] = await db.abfrage<{ auftrag_id: string | null }>(
    `select auftrag_id::text as auftrag_id from rechnung where id = $1::uuid`,
    [rechnungId],
  );
  if (beleg === undefined) {
    throw new AbrechnungFehler(
      `Rechnung ${rechnungId} nicht gefunden.`, 'auftrag_passt_nicht',
    );
  }
  if (beleg.auftrag_id !== null && beleg.auftrag_id !== auftrag.auftragId) {
    throw new AbrechnungFehler(
      'Diese Rechnung gehoert zu einem anderen Auftrag als der Vorgang, der sie '
      + 'bestuecken soll.',
      'auftrag_passt_nicht',
    );
  }

  const ergebnis = await berechneAbrechnung(db, auftrag);
  if (ergebnis.positionen.length === 0) {
    return { ...ergebnis, positionIds: [] };
  }
  const positionIds = await bestuecke(db, rechnungId, ergebnis.positionen);
  return { ...ergebnis, positionIds };
}
