/**
 * `einheitspreis_aufmass` — die Einheitspreisabrechnung nach §14 VOB/B
 * (FIN-01, BAU-01, BAU-02, FIN-07).
 *
 * Drei Zusagen, und jede hat einen Grund, der schon einmal Geld gekostet hat:
 *
 *  1. **Die Menge kommt aus dem GESPEICHERTEN Ergebnis, nicht aus einer neuen
 *     Auswertung.** `aufmass_zeile.ergebnis_skaliert` ist die ganze Zahl in
 *     fester Skala (10⁻⁴ der Einheit), die der Parser bei der Aufnahme
 *     erzeugt hat. Zur Rechnungszeit den `rechenansatz` erneut zu parsen hiesse,
 *     die Menge einer gegengezeichneten Urkunde mit einem Parserbau
 *     nachzurechnen, den es bei der Gegenzeichnung noch nicht gab — und ein
 *     geaenderter Uebermessungsschritt (O-23) veraenderte rueckwirkend, was
 *     unterschrieben wurde. Diese Datei liest `rechenansatz` ausschliesslich
 *     als TEXT und ruft keinen Parser.
 *
 *  2. **Der Rechenansatz steht auf der Zeile.** Woertlich, wie er vor Ort
 *     geschrieben wurde. Eine Einheitspreisrechnung ohne ihn ist im Streit um
 *     §14 VOB/B ein Betrag ohne Herleitung.
 *
 *  3. **Ein nicht gegengezeichnetes Aufmass wird VERWEIGERT**, nicht
 *     uebersprungen. „Gegengezeichnet" heisst: der AUFTRAGGEBER hat
 *     unterschrieben (0072, review B10). Ein Entwurf oder ein bloss vorgelegtes
 *     Blatt still zu ueberspringen ergaebe eine Rechnung, der eine Leistung
 *     fehlt, ohne dass jemand sieht, dass etwas fehlt. Die einseitige
 *     Feststellung (§14 Abs. 2 VOB/B) ist ein EIGENER Zustand und gilt nur,
 *     wenn der Vertrag sie ausdruecklich als abrechenbar fuehrt — welche
 *     Zustaende das sind, ist offen (O-04).
 *
 * // TODO(client, O-04): sind dies exakt die fuenf Abrechnungsarten?
 * Bezeichnung, Rundung und Satzbasis je Art bestaetigen. Fuer diese Art
 * konkret: welche Aufmass-Zustaende sind abrechenbar — nur gegengezeichnete,
 * oder auch einseitig festgestellte?
 */
import { type MilliMenge, milliMenge } from '../menge.js';
import { berechneNetto, type Abfrage } from '../rechnung.js';
import {
  AbrechnungFehler,
  type AbrechnungsBefund,
  type Abrechnungsart,
  type HerkunftVerweis,
  type RechnungspositionEntwurf,
  type VertragAbrechnung,
  centOderNull,
  fehler,
  leistungszeitraum,
  loeseEinheit,
  loeseSteuergruppe,
  parameterListe,
  pruefeParameter,
} from './typen.js';

/**
 * Der Zustand, den §14 VOB/B als Regelfall kennt. Er steht hier als Konstante
 * und nicht als Parameterwert: dass eine vom Auftraggeber gegengezeichnete
 * Aufmassurkunde abrechenbar ist, ist keine offene Frage.
 */
const GEGENGEZEICHNET = 'gegengezeichnet';
const EINSEITIG = 'einseitig_festgestellt';

interface AufmassKopf {
  readonly id: string;
  readonly nummer: string;
  readonly bezeichnung: string;
  readonly status: string;
  readonly storniert_am: string | null;
  /** Der Auftrag des Projekts, zu dem das Blatt gehoert — `null`, wenn keiner. */
  readonly auftrag_id: string | null;
  readonly messdatum: string;
}

interface AufmassZeile {
  readonly id: string;
  readonly aufmass_id: string;
  readonly lv_position_id: string | null;
  readonly ausserhalb_lv: boolean;
  readonly bezeichnung: string;
  readonly rechenansatz: string;
  readonly ergebnis_skaliert: string;
  readonly einheit: string;
  readonly oz: string | null;
  readonly kurztext: string | null;
  readonly lv_einheit: string | null;
  readonly einheitspreis_cent: string | null;
  readonly auftrag_leistung_id: string | null;
  readonly steuersatz_bp: number | null;
  readonly steuer_kennzeichen: string | null;
}

/**
 * **Der Auftrag hinter dem Blatt kommt mit — sonst laesst sich nicht sagen,
 * ob es dazugehoert.**
 *
 * Die Blaetter werden vom Aufrufer BENANNT (`aufmassIds`), und geprueft wurde
 * bisher nur, ob es sie in dieser Gesellschaft gibt. Die Mandantengrenze sagt
 * „dieselbe Gesellschaft", nicht „derselbe Auftrag": ein gegengezeichnetes
 * Blatt des Auftrags B liess sich damit in die Abrechnung des Auftrags A
 * geben, und die entstehenden Zeilen trugen A als Vertrag und B als
 * LV-Herkunft. Gemeldet vom Copilot-Durchgang auf PR #7.
 *
 * `aufmass.projekt_id → projekt.auftrag_id` ist die Kette, an der das haengt.
 * Ein Projekt OHNE Auftrag widerspricht nicht — abgewiesen wird nur, was
 * einen ANDEREN nennt; dieselbe Regel wie ueberall sonst in diesem Zweig.
 */
async function ladeKoepfe(db: Abfrage, ids: readonly string[]): Promise<readonly AufmassKopf[]> {
  return db.abfrage<AufmassKopf>(
    `select a.id, a.nummer, a.bezeichnung, a.status::text as status,
            a.storniert_am::text as storniert_am,
            to_char(a.messdatum, 'YYYY-MM-DD') as messdatum,
            p.auftrag_id::text as auftrag_id
       from aufmass a
       left join projekt p on p.mandant_id = a.mandant_id and p.id = a.projekt_id
      where a.id = any($1::uuid[])
      order by a.nummer`,
    [ids],
  );
}

/** Blaetter, die einen ANDEREN Auftrag nennen als die Konfiguration. */
function fremdeBlaetter(
  koepfe: readonly AufmassKopf[], auftragId: string,
): readonly AufmassKopf[] {
  return koepfe.filter((k) => k.auftrag_id !== null && k.auftrag_id !== auftragId);
}

/**
 * Die Zeilen der genannten Blaetter, samt LV-Position und deren Einheitspreis.
 *
 * `rechenansatz` wird als Text gelesen und `ergebnis_skaliert` als Zahl —
 * `rechenansatz_ast` und `parser_version` kommen bewusst NICHT mit: was diese
 * Datei nicht liest, kann sie nicht versehentlich neu auswerten.
 *
 * **Der Einheitspreis kommt aus `app.lv_preis_lesen()` und nicht aus der
 * Spalte** (K-05, `0071` §8). `lv_position.einheitspreis_cent` ist `cse_app`
 * spaltenweise ENTZOGEN — ein `select p.einheitspreis_cent` scheitert hier mit
 * „permission denied for table lv_position", und das ist die Absicht: der
 * Zugriff auf einen Kalkulationspreis prueft `bau.preis_lesen` und landet im
 * Protokoll. Ohne das Recht gibt der Leser NULL zurueck, und die Strategie
 * weist benannt ab, statt mit null Euro zu rechnen.
 */
async function ladeZeilen(db: Abfrage, ids: readonly string[]): Promise<readonly AufmassZeile[]> {
  return db.abfrage<AufmassZeile>(
    `select z.id, z.aufmass_id::text as aufmass_id,
            z.lv_position_id::text as lv_position_id, z.ausserhalb_lv,
            z.bezeichnung, z.rechenansatz, z.ergebnis_skaliert::text, z.einheit,
            p.oz, p.kurztext, p.einheit as lv_einheit,
            app.lv_preis_lesen(p.id)::text as einheitspreis_cent,
            p.auftrag_leistung_id::text as auftrag_leistung_id,
            al.steuersatz_bp, al.steuer_kennzeichen::text as steuer_kennzeichen
       from aufmass_zeile z
       left join lv_position p
         on p.mandant_id = z.mandant_id and p.id = z.lv_position_id
       left join auftrag_leistung al
         on al.mandant_id = p.mandant_id and al.id = p.auftrag_leistung_id
      where z.aufmass_id = any($1::uuid[])
      order by z.aufmass_id, z.reihenfolge`,
    [ids],
  );
}

/** Die Zustaende, die dieser Vertrag als abrechenbar fuehrt. */
function abrechenbareZustaende(konfiguration: VertragAbrechnung): readonly string[] {
  const gefuehrt = parameterListe(konfiguration, 'abrechenbare_aufmass_zustaende', 'O-04');
  const unbekannt = gefuehrt.filter((z) => z !== GEGENGEZEICHNET && z !== EINSEITIG);
  if (unbekannt.length > 0) {
    throw new AbrechnungFehler(
      `Unbekannter Aufmasszustand im Vertrag: ${unbekannt.join(', ')}.`,
      'parameter_offen',
    );
  }
  // Der Regelfall ist immer dabei — ihn abzuwaehlen hiesse, eine
  // gegengezeichnete Urkunde fuer unbeachtlich zu erklaeren.
  return gefuehrt.includes(GEGENGEZEICHNET) ? gefuehrt : [GEGENGEZEICHNET, ...gefuehrt];
}

/**
 * `10⁻⁴` → Tausendstel, EINMAL gerundet, halb auf.
 *
 * Summiert wird in der festen Skala, in der das Aufmass gefuehrt ist; erst die
 * Summe wird auf die drei Nachkommastellen projiziert, die `numeric(12,3)`
 * traegt. Je Zeile zu projizieren und dann zu summieren rundete so oft, wie das
 * Blatt Zeilen hat.
 */
function alsMenge(summeSkaliert: bigint): MilliMenge {
  const negativ = summeSkaliert < 0n;
  const abs = negativ ? -summeSkaliert : summeSkaliert;
  const gerundet = (abs * 2n + 10n) / 20n;
  return milliMenge(negativ ? -gerundet : gerundet);
}

function pruefeKopf(kopf: AufmassKopf, zulaessig: readonly string[]): void {
  if (kopf.storniert_am !== null) {
    throw new AbrechnungFehler(
      `Aufmaß ${kopf.nummer} ist storniert und wird nicht abgerechnet.`,
      'aufmass_nicht_abrechenbar',
    );
  }
  if (!zulaessig.includes(kopf.status)) {
    throw new AbrechnungFehler(
      `Aufmaß ${kopf.nummer} ist „${kopf.status}" und damit nicht abrechenbar. `
      + `Abrechenbar ist nach diesem Vertrag: ${zulaessig.join(', ')}. `
      + 'Gegengezeichnet heißt: der Auftraggeber hat unterschrieben (§14 VOB/B).',
      'aufmass_nicht_abrechenbar',
    );
  }
}

interface Gruppe {
  readonly lvPositionId: string;
  readonly zeilen: AufmassZeile[];
}

export const EINHEITSPREIS_AUFMASS: Abrechnungsart = {
  schluessel: 'einheitspreis_aufmass',
  bezeichnung: 'Einheitspreis nach Aufmaß',
  istProvisorisch: true,
  offeneParameter: [
    {
      schluessel: 'abrechenbare_aufmass_zustaende',
      frage: 'Welche Aufmaß-Zustände sind abrechenbar — nur gegengezeichnete, oder auch '
        + 'einseitig festgestellte (§14 Abs. 2 VOB/B)?',
      werte: null,
      offeneFrage: 'O-04',
    },
  ],

  async pruefe(db, eingabe): Promise<readonly AbrechnungsBefund[]> {
    const befunde = [...pruefeParameter(EINHEITSPREIS_AUFMASS, eingabe.konfiguration)];
    const ids = eingabe.aufmassIds ?? [];
    if (ids.length === 0) {
      befunde.push(fehler(
        'aufmass',
        'Es ist kein Aufmaßblatt zur Abrechnung benannt. Die Blätter werden ausdrücklich '
        + 'gewählt und nicht gesucht — ein still übersprungenes Blatt wäre eine Rechnung '
        + 'mit fehlender Leistung.',
      ));
      return befunde;
    }
    const zulaessig = eingabe.konfiguration.parameter['abrechenbare_aufmass_zustaende'] === undefined
      ? [GEGENGEZEICHNET]
      : abrechenbareZustaende(eingabe.konfiguration);
    const koepfeVorab = await ladeKoepfe(db, ids);
    for (const k of fremdeBlaetter(koepfeVorab, eingabe.konfiguration.auftragId)) {
      befunde.push(fehler(
        'aufmass.auftrag',
        `Aufmaß ${k.nummer} gehört zu einem anderen Auftrag als diese Abrechnung.`,
      ));
    }
    for (const kopf of koepfeVorab) {
      if (kopf.storniert_am !== null || !zulaessig.includes(kopf.status)) {
        befunde.push(fehler(
          'aufmass.status',
          `Aufmaß ${kopf.nummer} ist „${kopf.status}"`
          + `${kopf.storniert_am === null ? '' : ' und storniert'}`
          + ' und damit nicht abrechenbar.',
        ));
      }
    }
    return befunde;
  },

  async positionen(db, eingabe): Promise<readonly RechnungspositionEntwurf[]> {
    const { konfiguration, periode } = eingabe;
    const ids = eingabe.aufmassIds ?? [];
    if (ids.length === 0) {
      throw new AbrechnungFehler(
        'Es ist kein Aufmaßblatt zur Abrechnung benannt.',
        'nichts_abzurechnen',
      );
    }
    const zulaessig = abrechenbareZustaende(konfiguration);

    const koepfe = await ladeKoepfe(db, ids);
    const gefunden = new Set(koepfe.map((k) => k.id));
    const fehlend = ids.filter((i) => !gefunden.has(i));
    if (fehlend.length > 0) {
      throw new AbrechnungFehler(
        `Aufmaß ${fehlend.join(', ')} gibt es in dieser Gesellschaft nicht.`,
        'aufmass_nicht_abrechenbar',
      );
    }
    const fremde = fremdeBlaetter(koepfe, konfiguration.auftragId);
    if (fremde.length > 0) {
      throw new AbrechnungFehler(
        `Aufmaß ${fremde.map((k) => k.nummer).join(', ')} gehört zu einem anderen Auftrag `
        + 'als diese Abrechnung. Ein Blatt, das nicht zu diesem Auftrag gehört, wird nicht '
        + 'stillschweigend übergangen und nicht stillschweigend berechnet.',
        'aufmass_nicht_abrechenbar',
      );
    }
    for (const kopf of koepfe) pruefeKopf(kopf, zulaessig);

    const zeilen = await ladeZeilen(db, ids);
    if (zeilen.length === 0) {
      throw new AbrechnungFehler(
        'Die benannten Aufmaßblätter tragen keine Zeile.', 'nichts_abzurechnen',
      );
    }

    /**
     * Eine Zeile ausserhalb des Leistungsverzeichnisses hat keinen vereinbarten
     * Einheitspreis. Sie gehoert in einen Nachtrag (BAU-05, §2 Abs. 6 VOB/B) und
     * wird dort bepreist; hier still mit null Euro durchzulaufen waere geleistete
     * Arbeit, die niemand berechnet.
     */
    const ohneLv = zeilen.filter((z) => z.lv_position_id === null);
    if (ohneLv.length > 0) {
      throw new AbrechnungFehler(
        `${String(ohneLv.length)} Aufmaßzeile(n) liegen außerhalb des Leistungsverzeichnisses `
        + `(${ohneLv.map((z) => z.bezeichnung).join(', ')}) und haben keinen vereinbarten `
        + 'Einheitspreis. Sie werden über einen Nachtrag abgerechnet (BAU-05).',
        'ausserhalb_lv',
      );
    }

    const gruppen = new Map<string, Gruppe>();
    for (const z of zeilen) {
      const schluessel = z.lv_position_id!;
      const vorhanden = gruppen.get(schluessel) ?? { lvPositionId: schluessel, zeilen: [] };
      vorhanden.zeilen.push(z);
      gruppen.set(schluessel, vorhanden);
    }

    const nummerJeBlatt = new Map(koepfe.map((k) => [k.id, k.nummer]));
    const zeitraum = leistungszeitraum(konfiguration, periode);
    const entwuerfe: RechnungspositionEntwurf[] = [];

    for (const gruppe of gruppen.values()) {
      const erste = gruppe.zeilen[0]!;
      const preis = centOderNull(erste.einheitspreis_cent);
      if (preis === null) {
        throw new AbrechnungFehler(
          `Die LV-Position ${String(erste.oz)} („${String(erste.kurztext)}") liefert keinen `
          + 'Einheitspreis. Entweder führt sie keinen — dann hat die Aufmaßmenge keinen '
          + 'Betrag —, oder die angemeldete Person hält „bau.preis_lesen" nicht (K-05). '
          + 'Geraten wird in beiden Fällen nichts.',
          'kein_preis',
        );
      }
      const einheiten = new Set(gruppe.zeilen.map((z) => z.einheit));
      if (einheiten.size > 1) {
        throw new AbrechnungFehler(
          `Die Aufmaßzeilen zur LV-Position ${String(erste.oz)} tragen verschiedene `
          + `Einheiten (${[...einheiten].join(', ')}).`,
          'unbekannte_einheit',
        );
      }
      if (erste.steuersatz_bp === null || erste.steuer_kennzeichen === null) {
        throw new AbrechnungFehler(
          `Die LV-Position ${String(erste.oz)} hängt an keiner Auftragsleistung — ohne sie `
          + 'gibt es keinen vereinbarten Steuersatz (FIN-07).',
          'mehrdeutige_steuergruppe',
        );
      }

      // Summe in der festen Skala des Aufmasses, DANN einmal projiziert.
      const summeSkaliert = gruppe.zeilen.reduce(
        (s, z) => s + BigInt(z.ergebnis_skaliert), 0n,
      );
      const menge = alsMenge(summeSkaliert);
      if (menge === 0n) {
        throw new AbrechnungFehler(
          `Die Aufmaßmenge zur LV-Position ${String(erste.oz)} ist null — eine Zeile über `
          + 'null Menge ist auf einer Rechnung nicht zulässig (§4.3).',
          'keine_menge',
        );
      }

      const einheit = await loeseEinheit(db, erste.einheit);
      const steuergruppe = await loeseSteuergruppe(
        db, erste.steuer_kennzeichen, erste.steuersatz_bp, periode.bis,
      );
      const basis = milliMenge(1000n);

      /**
       * Der Rechenansatz, woertlich und je Zeile mit seinem Blatt — das ist,
       * was §14 VOB/B als Nachweis meint. Nicht normiert, nicht neu gesetzt,
       * nicht zusammengefasst.
       */
      const ansatz = gruppe.zeilen
        .map((z) => `${String(nummerJeBlatt.get(z.aufmass_id) ?? '?')}: ${z.rechenansatz}`)
        .join(' · ');

      /**
       * Die Herkunft ist das BLATT, nicht die einzelne Messzeile — und mit dem
       * Anteil, mit dem es in diese Rechnungszeile eingeht. VOB/B §16 rechnet
       * ein Aufmass ueber mehrere Abschlagsrechnungen hinweg anteilig ab; ein
       * Verweis ohne Anteil koennte das nicht abbilden, und eine
       * Ausschliesslichkeitssperre auf dem Blatt machte die zweite Rate
       * unmoeglich (PR 49, Abnahme 5).
       */
      const anteilJeBlatt = new Map<string, bigint>();
      for (const z of gruppe.zeilen) {
        anteilJeBlatt.set(
          z.aufmass_id, (anteilJeBlatt.get(z.aufmass_id) ?? 0n) + BigInt(z.ergebnis_skaliert),
        );
      }
      const herkunft: HerkunftVerweis[] = [...anteilJeBlatt].map(([blattId, summe]) => ({
        art: 'aufmass' as const,
        id: blattId,
        anteil: alsMenge(summe),
      }));

      entwuerfe.push({
        bezeichnung: `${String(erste.oz)} ${String(erste.kurztext ?? erste.bezeichnung)}`,
        beschreibung: `Rechenansatz: ${ansatz} — provisorisch (O-04)`,
        menge,
        einheit,
        preisBasismenge: basis,
        einzelpreisCent: preis,
        nettoCent: berechneNetto(menge, basis, preis, 0),
        steuergruppe,
        abrechnungsart: EINHEITSPREIS_AUFMASS.schluessel,
        vertragAbrechnungId: konfiguration.id,
        auftragLeistungId: erste.auftrag_leistung_id,
        lvPositionId: gruppe.lvPositionId,
        leistungVon: zeitraum.von,
        leistungBis: zeitraum.bis,
        herkunft,
      });
    }

    return entwuerfe;
  },
};
