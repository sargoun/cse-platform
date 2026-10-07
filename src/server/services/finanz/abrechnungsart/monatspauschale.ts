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
 *   · `arbeitstage`  — anteilig nach Arbeitstagen: `10 Arbeitstage je 21`.
 *                      Voreinstellung (V-281, O-04, O-167, D-843): Montag bis
 *                      Freitag ohne gesetzliche Feiertage in Berlin, fuer jedes
 *                      Objekt, bis ein Objekt sein Land traegt. Gezaehlt wird
 *                      mit `arbeitstageZwischen` (lib/datum/werktage.ts), die
 *                      Feiertagsliste ist ihre Eingabe. Wie bei den
 *                      Kalendertagen fuehrt die Zeile TAGE als Menge und die
 *                      Arbeitstage des Monats als `preis_basismenge`.
 *
 * // TODO(client, O-04): sind dies exakt die fuenf Abrechnungsarten?
 * Bezeichnung, Rundung und Satzbasis je Art bestaetigen. Fuer diese Art
 * konkret: anteilige Berechnung bei Teilmonaten nach Kalendertagen, nach
 * Arbeitstagen oder gar nicht — und bei Arbeitstagen, welche Tage das sind.
 */
import { type Cent } from '../geld.js';
import { berechneNetto } from '../rechnung.js';
import {
  AbrechnungFehler,
  type AbrechnungsBefund,
  type Abrechnungsart,
  type Periode,
  type RechnungspositionEntwurf,
  type VertragAbrechnung,
  alsTag,
  belegBenannt,
  fehler,
  ganzeMenge,
  ladeSignierteNachweise,
  leistungszeitraum,
  monateDerPeriode,
  parameterText,
  pruefeNachweisZeitraum,
  pruefeParameter,
  steuergruppeDerLeistung,
  steuergruppeDesAuftrags,
  tageImMonat,
  ueberschneidet,
  zerlegeTag,
} from './typen.js';
import { tagDeutsch } from '../../../../lib/datum/kalendertag.js';
import {
  arbeitstageZwischen, gesetzlicheFeiertageBerlin,
} from '../../../../lib/datum/werktage.js';

/** Wie viele Kalendertage dieser Abschnitt aus seinem Monat abdeckt. */
function abgedeckteTage(abschnitt: Periode): number {
  return zerlegeTag(abschnitt.bis).tag - zerlegeTag(abschnitt.von).tag + 1;
}

/** Der ganze Kalendermonat, in dem der Abschnitt liegt. */
function ganzerMonat(abschnitt: Periode): Periode {
  const { jahr, monat } = zerlegeTag(abschnitt.von);
  return { von: alsTag(jahr, monat, 1), bis: alsTag(jahr, monat, tageImMonat(jahr, monat)) };
}

/** Deckt der Abschnitt seinen Kalendermonat vollstaendig ab? */
function istVollerMonat(abschnitt: Periode): boolean {
  const von = zerlegeTag(abschnitt.von);
  const bis = zerlegeTag(abschnitt.bis);
  return von.tag === 1 && bis.tag === tageImMonat(bis.jahr, bis.monat);
}

/**
 * Die Arbeitstage eines angebrochenen Monats — im Abschnitt und im ganzen
 * Monat (V-281, D-843). Rein: die Feiertagsliste ist die Berliner.
 */
// TODO(client, O-167): Voreinstellung — Arbeitstage sind Montag bis Freitag ohne gesetzliche Feiertage in Berlin, für jedes Objekt; ein Objekt in einem anderen Land bekommt dessen Liste, sobald es sein Land trägt. D-781, D-843.
export function arbeitstageImAbschnitt(
  abschnitt: Periode,
): { readonly tage: number; readonly imMonat: number } {
  const monat = ganzerMonat(abschnitt);
  const feiertage = gesetzlicheFeiertageBerlin(monat.von, monat.bis);
  return {
    tage: arbeitstageZwischen(abschnitt.von, abschnitt.bis, feiertage),
    imMonat: arbeitstageZwischen(monat.von, monat.bis, feiertage),
  };
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
    /*
     * **Ein Monat wird EINMAL berechnet — über alle Belege hinweg** (V-207,
     * D-700). Die Zeile einer Pauschale hat keinen Beleg, den ein Index
     * sperren könnte; ihr Anspruch ist der Zeitraum, für den sie den Betrag
     * verlangt. Steht davon schon ein Tag auf einer lebenden Zeile derselben
     * Vereinbarung, ist das dieselbe Pauschale ein zweites Mal — abgewiesen,
     * mit dem Beleg beim Namen. Nicht still übersprungen: eine Rechnung über
     * Juli bis September mit nur zwei Monatszeilen sähe vollständig aus.
     *
     * Welcher Zeitraum das ist, sagt der eigene Parameter: eine VOLLE
     * Pauschale (voller Monat, oder `teilmonat = keine`) verlangt den ganzen
     * Monat — zwei Rechnungen über je eine Hälfte des Novembers wären sonst
     * zwei volle Novemberpauschalen. Nur anteilig — nach Kalender- oder nach
     * Arbeitstagen (V-281) — deckt die Zeile genau ihre Tage, und die zweite
     * Hälfte bleibt abrechenbar.
     *
     * Im Modus `nach_leistungsnachweis` immer der ganze Monat (D-838): die
     * Zeile trägt dort den Zeitraum ihrer Nachweise, und der kann kürzer sein
     * als die Tage, die sie berechnet — gegen ihn verglichen, bliebe ein schon
     * berechneter Tag abrechenbar.
     */
    const teilmonat = konfiguration.parameter['teilmonat'];
    const anteilig = teilmonat === 'kalendertage' || teilmonat === 'arbeitstage';
    const nachNachweis = konfiguration.leistungszeitraumModus === 'nach_leistungsnachweis';
    for (const abschnitt of teile) {
      const bereich = istVollerMonat(abschnitt) || !anteilig || nachNachweis
        ? ganzerMonat(abschnitt) : abschnitt;
      const schon = eingabe.bisher.filter((a) => ueberschneidet(a, bereich));
      if (schon.length === 0) continue;
      befunde.push(fehler(
        'leistung_von',
        `Die Monatspauschale ${monatsName(abschnitt)} (${tagDeutsch(abschnitt.von)} bis `
        + `${tagDeutsch(abschnitt.bis)}) ist schon auf ${schon.map(belegBenannt).join(', ')} `
        + 'berechnet. Ein zweites Mal wäre dieselbe Pauschale doppelt — den Leistungszeitraum '
        + 'dieses Entwurfs anpassen, oder den anderen Beleg verwerfen bzw. stornieren.',
      ));
    }
    /*
     * Nach Arbeitstagen kann ein angebrochener Monat KEINEN haben — ein
     * Vertrag, der an einem Samstag endet und am Freitag davor nichts mehr
     * deckt. Dann entsteht für ihn keine Zeile; liegt im ganzen Zeitraum kein
     * Arbeitstag, ist nichts zu berechnen, und die Prüfung sagt es vorher.
     */
    if (teilmonat === 'arbeitstage' && teile.length > 0
        && teile.every((t) => !istVollerMonat(t) && arbeitstageImAbschnitt(t).tage === 0)) {
      befunde.push(fehler(
        'parameter.teilmonat',
        `Im Zeitraum ${tagDeutsch(teile[0]!.von)} bis ${tagDeutsch(teile[teile.length - 1]!.bis)} `
        + 'liegt kein Arbeitstag (Montag bis Freitag ohne gesetzlichen Feiertag in Berlin) — '
        + 'nach „arbeitstage" ist nichts zu berechnen (Voreinstellung O-04, O-167).',
        'O-04',
      ));
    }
    befunde.push(...await pruefeNachweisZeitraum(db, konfiguration, teile));
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

    const nachweise = await ladeSignierteNachweise(db, konfiguration, periode);
    const entwuerfe: RechnungspositionEntwurf[] = [];
    for (const abschnitt of teile) {
      const zeitraum = leistungszeitraum(konfiguration, abschnitt, nachweise);
      const voll = istVollerMonat(abschnitt);

      if (voll || modus === 'keine') {
        const menge = ganzeMenge(1);
        const basis = ganzeMenge(1);
        entwuerfe.push({
          bezeichnung: `Monatspauschale ${monatsName(abschnitt)}`,
          beschreibung: voll
            ? 'Voller Kalendermonat — Voreinstellung (O-04)'
            : `Angebrochener Monat, volle Pauschale nach Vereinbarung `
              + `(teilmonat = keine) — Voreinstellung (O-04)`,
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

      if (modus === 'arbeitstage') {
        const { tage, imMonat } = arbeitstageImAbschnitt(abschnitt);
        /* Kein Arbeitstag im angebrochenen Teil: für ihn ist nichts zu berechnen. */
        if (tage === 0) continue;
        const menge = ganzeMenge(tage);
        const basis = ganzeMenge(imMonat);
        entwuerfe.push({
          bezeichnung: `Monatspauschale ${monatsName(abschnitt)} (anteilig)`,
          beschreibung:
            `${String(tage)} von ${String(imMonat)} Arbeitstagen — Montag bis Freitag ohne `
            + `gesetzliche Feiertage in Berlin (${abschnitt.von} bis ${abschnitt.bis}) `
            + '— Voreinstellung (O-04, O-167)',
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
        continue;
      }

      if (modus !== 'kalendertage') {
        throw new AbrechnungFehler(
          `Ein angebrochener Monat (${abschnitt.von} bis ${abschnitt.bis}) wird nach `
          + `„${modus}" berechnet — diese Lesart gibt es nicht; die Vereinbarung nennt `
          + '„kalendertage", „arbeitstage" oder „keine" (O-04).',
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
          + '— Voreinstellung (O-04)',
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
    if (entwuerfe.length === 0) {
      throw new AbrechnungFehler(
        `Zwischen ${periode.von} und ${periode.bis} liegt kein Arbeitstag, den die Pauschale `
        + 'deckt — nach „arbeitstage" ist nichts zu berechnen (O-04, O-167).',
        'nichts_abzurechnen',
      );
    }
    return entwuerfe;
  },
};

