/**
 * `monatspauschale` — die vertraglich vereinbarte Pauschale je Monat
 * (FIN-01, CLN-02).
 *
 * **Ein voller Monat ist eine Zeile ueber `1 Monat`.** Kein Bruchteil, keine
 * Umrechnung, kein Rundungsschritt: der vereinbarte Betrag steht auf der Zeile,
 * und wer nachrechnet, bekommt genau ihn.
 *
 * **Ein ANGEBROCHENER Monat ist die eine Stelle, an der eine Regel noetig ist,
 * die niemand bestaetigt hat.** Deshalb ist `teilmonat` ein Parameter und hat
 * keinen Vorgabewert. Die drei Lesarten stehen in O-04:
 *
 *   · `keine`        — ein angebrochener Monat kostet die volle Pauschale.
 *   · `kalendertage` — anteilig nach Kalendertagen: `15 Tage je 31 Tage`. Die
 *                      Zeile fuehrt TAGE als Menge und `preis_basismenge` als
 *                      Monatslaenge (BT-149/150), damit sie exakt ist — als
 *                      Bruchteil eines Monats waere `15/31` in drei
 *                      Nachkommastellen nicht darstellbar.
 *   · `arbeitstage`  — und hier wird NICHT gerechnet: welche Tage als
 *                      Arbeitstage dieses Vertrages gelten (Mo–Fr? Mo–Sa nach
 *                      §3 BUrlG? welche Feiertagsliste?), steht nirgends. Eine
 *                      geratene Antwort verschoebe jede Teilmonatsrechnung um
 *                      einen zweistelligen Prozentsatz, und der Beleg ist
 *                      unveraenderlich.
 *
 * // TODO(client, O-04): sind dies exakt die fuenf Abrechnungsarten?
 * Bezeichnung, Rundung und Satzbasis je Art bestaetigen. Fuer diese Art
 * konkret: anteilige Berechnung bei Teilmonaten nach Kalendertagen, nach
 * Arbeitstagen oder gar nicht — und bei Arbeitstagen, welche Tage das sind.
 */
import { type Cent } from '../geld.js';
import { berechneNetto, type Abfrage } from '../rechnung.js';
import {
  AbrechnungFehler,
  type AbrechnungsBefund,
  type Abrechnungsart,
  type Periode,
  type RechnungspositionEntwurf,
  type VertragAbrechnung,
  alsTag,
  fehler,
  ganzeMenge,
  leistungszeitraum,
  loeseSteuergruppe,
  monateDerPeriode,
  parameterText,
  pruefeParameter,
  steuergruppeDesAuftrags,
  tageImMonat,
  zerlegeTag,
} from './typen.js';

/** Wie viele Kalendertage dieser Abschnitt aus seinem Monat abdeckt. */
function abgedeckteTage(abschnitt: Periode): number {
  return zerlegeTag(abschnitt.bis).tag - zerlegeTag(abschnitt.von).tag + 1;
}

/** Deckt der Abschnitt seinen Kalendermonat vollstaendig ab? */
function istVollerMonat(abschnitt: Periode): boolean {
  const von = zerlegeTag(abschnitt.von);
  const bis = zerlegeTag(abschnitt.bis);
  return von.tag === 1 && bis.tag === tageImMonat(bis.jahr, bis.monat);
}

const MONATSNAMEN = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

function monatsName(abschnitt: Periode): string {
  const { jahr, monat } = zerlegeTag(abschnitt.von);
  return `${MONATSNAMEN[monat - 1] ?? String(monat)} ${String(jahr)}`;
}

/**
 * Die Abschnitte, fuer die die Konfiguration im Zeitraum ueberhaupt gilt.
 *
 * `gueltig_bis` ist EINSCHLIESSLICH: eine zum 15. Maerz beendete Konfiguration
 * rechnet den 1. bis 15. Maerz ab und nicht null Tage. Genau dieser Fall war es,
 * der den Abrechnungslauf in einer frueheren Fassung stillschweigend um einen
 * halben Monat betrogen hat (02-CRM §3.2, review B9).
 */
function abschnitte(
  konfiguration: VertragAbrechnung, periode: Periode,
): readonly Periode[] {
  const von = periode.von < konfiguration.gueltigAb ? konfiguration.gueltigAb : periode.von;
  const bis = konfiguration.gueltigBis !== null && konfiguration.gueltigBis < periode.bis
    ? konfiguration.gueltigBis
    : periode.bis;
  if (von > bis) return [];
  return monateDerPeriode({ von, bis });
}

export const MONATSPAUSCHALE: Abrechnungsart = {
  schluessel: 'monatspauschale',
  bezeichnung: 'Monatspauschale',
  istProvisorisch: true,
  offeneParameter: [
    {
      schluessel: 'teilmonat',
      frage: 'Wie wird ein angebrochener Monat berechnet — anteilig nach Kalendertagen, '
        + 'anteilig nach Arbeitstagen oder gar nicht?',
      werte: ['kalendertage', 'arbeitstage', 'keine'],
      offeneFrage: 'O-04',
    },
  ],

  async pruefe(db, eingabe): Promise<readonly AbrechnungsBefund[]> {
    const { konfiguration, periode } = eingabe;
    const befunde = [...pruefeParameter(MONATSPAUSCHALE, konfiguration)];
    if (konfiguration.pauschaleNettoCent === null) {
      befunde.push(fehler(
        'pauschale_netto_cent',
        'Der Vertrag führt keine Monatspauschale — die Rechnung hätte keinen Betrag.',
      ));
    }
    const teile = abschnitte(konfiguration, periode);
    if (teile.length === 0) {
      befunde.push(fehler(
        'gueltig_ab',
        `Die Abrechnungskonfiguration gilt im Zeitraum ${periode.von} bis ${periode.bis} `
        + 'an keinem Tag.',
      ));
    }
    if (konfiguration.parameter['teilmonat'] === 'arbeitstage'
        && teile.some((t) => !istVollerMonat(t))) {
      befunde.push(fehler(
        'parameter.teilmonat',
        'Unbestätigter Wert: „arbeitstage" verlangt eine Definition der Arbeitstage '
        + 'dieses Vertrages (Mo–Fr, Mo–Sa nach §3 BUrlG?) und eine Feiertagsliste. '
        + 'Beides ist offen — für einen angebrochenen Monat wird deshalb nicht '
        + 'gerechnet.',
        'O-04',
      ));
    }
    return befunde;
  },

  async positionen(db, eingabe): Promise<readonly RechnungspositionEntwurf[]> {
    const { konfiguration, periode } = eingabe;
    const modus = parameterText(konfiguration, 'teilmonat', 'O-04');
    const pauschale: Cent | null = konfiguration.pauschaleNettoCent;
    if (pauschale === null) {
      throw new AbrechnungFehler(
        'Der Vertrag führt keine Monatspauschale (vertrag_abrechnung.pauschale_netto_cent).',
        'kein_preis',
      );
    }

    const teile = abschnitte(konfiguration, periode);
    if (teile.length === 0) {
      throw new AbrechnungFehler(
        `Die Abrechnungskonfiguration gilt zwischen ${periode.von} und ${periode.bis} `
        + 'an keinem Tag.',
        'nichts_abzurechnen',
      );
    }

    const steuergruppe = konfiguration.auftragLeistungId === null
      ? await steuergruppeDesAuftrags(db, konfiguration.auftragId, periode.bis)
      : await steuergruppeDerLeistung(db, konfiguration, periode.bis);

    const entwuerfe: RechnungspositionEntwurf[] = [];
    for (const abschnitt of teile) {
      const zeitraum = leistungszeitraum(konfiguration, abschnitt);
      const voll = istVollerMonat(abschnitt);

      if (voll || modus === 'keine') {
        const menge = ganzeMenge(1);
        const basis = ganzeMenge(1);
        entwuerfe.push({
          bezeichnung: `Monatspauschale ${monatsName(abschnitt)}`,
          beschreibung: voll
            ? 'Voller Kalendermonat — provisorisch (O-04)'
            : `Angebrochener Monat, volle Pauschale nach Vereinbarung `
              + `(teilmonat = keine) — provisorisch (O-04)`,
          menge,
          einheit: 'monat',
          preisBasismenge: basis,
          einzelpreisCent: pauschale,
          nettoCent: berechneNetto(menge, basis, pauschale, 0),
          steuergruppe,
          abrechnungsart: MONATSPAUSCHALE.schluessel,
          vertragAbrechnungId: konfiguration.id,
          auftragLeistungId: konfiguration.auftragLeistungId,
          lvPositionId: null,
          leistungVon: zeitraum.von,
          leistungBis: zeitraum.bis,
          herkunft: [{ art: 'vertrag_abrechnung', id: konfiguration.id, anteil: null }],
        });
        continue;
      }

      if (modus !== 'kalendertage') {
        throw new AbrechnungFehler(
          `Ein angebrochener Monat (${abschnitt.von} bis ${abschnitt.bis}) wird nach `
          + `„${modus}" berechnet; die dafür nötige Arbeitstagsdefinition ist offen (O-04).`,
          'parameter_offen',
        );
      }

      const { jahr, monat } = zerlegeTag(abschnitt.von);
      const tage = abgedeckteTage(abschnitt);
      const menge = ganzeMenge(tage);
      const basis = ganzeMenge(tageImMonat(jahr, monat));
      entwuerfe.push({
        bezeichnung: `Monatspauschale ${monatsName(abschnitt)} (anteilig)`,
        beschreibung:
          `${String(tage)} von ${String(tageImMonat(jahr, monat))} Kalendertagen `
          + `(${alsTag(jahr, monat, zerlegeTag(abschnitt.von).tag)} bis ${abschnitt.bis}) `
          + '— provisorisch (O-04)',
        menge,
        einheit: 'tag',
        preisBasismenge: basis,
        einzelpreisCent: pauschale,
        nettoCent: berechneNetto(menge, basis, pauschale, 0),
        steuergruppe,
        abrechnungsart: MONATSPAUSCHALE.schluessel,
        vertragAbrechnungId: konfiguration.id,
        auftragLeistungId: konfiguration.auftragLeistungId,
        lvPositionId: null,
        leistungVon: zeitraum.von,
        leistungBis: zeitraum.bis,
        herkunft: [{ art: 'vertrag_abrechnung', id: konfiguration.id, anteil: menge }],
      });
    }
    return entwuerfe;
  },
};

/** Die Steuergruppe der EINEN Leistungszeile, an der die Konfiguration haengt. */
async function steuergruppeDerLeistung(
  db: Abfrage, konfiguration: VertragAbrechnung, stichtag: string,
): Promise<string> {
  const [zeile] = await db.abfrage<{ steuersatz_bp: number; steuer_kennzeichen: string }>(
    `select steuersatz_bp, steuer_kennzeichen::text as steuer_kennzeichen
       from auftrag_leistung where id = $1`,
    [konfiguration.auftragLeistungId],
  );
  if (zeile === undefined) {
    throw new AbrechnungFehler(
      `Die Leistungszeile ${String(konfiguration.auftragLeistungId)} gibt es nicht.`,
      'mehrdeutige_steuergruppe',
    );
  }
  return loeseSteuergruppe(db, zeile.steuer_kennzeichen, zeile.steuersatz_bp, stichtag);
}
