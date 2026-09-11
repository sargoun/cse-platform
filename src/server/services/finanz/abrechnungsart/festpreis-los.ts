/**
 * `festpreis_los` — der vereinbarte Pauschalpreis fuer ein Los (FIN-01,
 * BAU-01).
 *
 * **Der Preis steht im Vertrag und wird hier nicht hergeleitet.** Ein Los ist
 * genau das: ein Betrag fuer eine abgegrenzte Leistung. Was offen ist, ist
 * nicht der Betrag, sondern der ZEITPUNKT — ob eine Teilfertigstellung anteilig
 * abgerechnet wird oder erst die Abnahme eine Rechnung ausloest. Beides ist
 * ueblich, beides steht im Vertrag, und keines steht in der Spezifikation:
 * deshalb `teilleistung` als Parameter ohne Vorgabewert.
 *
 *   · `erst_bei_abnahme` — es wird erst gerechnet, wenn `auftrag.abnahme_am`
 *     gesetzt und im Zeitraum liegt. Ohne Abnahme kein Beleg, und der Grund
 *     steht im Fehler statt in einem leeren Ergebnis.
 *   · `anteilig` — der Fertigstellungsgrad kommt als Basispunkte MIT DEM
 *     AUFTRAG der Abrechnung herein, nicht aus einer Schaetzung. Er wird
 *     einmal auf den Festpreis angewandt (`anteilInBasisPunkten`, die eine
 *     Rundungsstelle), und die Zeile traegt den Betrag, nicht die Formel:
 *     ein Beleg ueber „0,3333 Pauschalen" ist keiner, den jemand prueft.
 *
 * **Der Abzug bereits gestellter Abschlaege gehoert NICHT hierher.** Die
 * Abschlags- und Schlussrechnung mit automatischem Abzug ist FIN-08 und kommt
 * mit PR 50; diese Strategie rechnet, was in IHREM Zeitraum faellig ist, und
 * behauptet nicht, dass es die Schlussrechnung waere.
 *
 * // TODO(client, O-04): sind dies exakt die fuenf Abrechnungsarten?
 * Bezeichnung, Rundung und Satzbasis je Art bestaetigen. Fuer diese Art
 * konkret: wird Teilfertigstellung anteilig abgerechnet oder erst bei Abnahme?
 */
import { anteilInBasisPunkten, basisPunkte, type Cent } from '../geld.js';
import { berechneNetto, type Abfrage } from '../rechnung.js';
import {
  AbrechnungFehler,
  type AbrechnungsBefund,
  type Abrechnungsart,
  type RechnungspositionEntwurf,
  type VertragAbrechnung,
  fehler,
  ganzeMenge,
  leistungszeitraum,
  parameterText,
  pruefeParameter,
  steuergruppeDesAuftrags,
} from './typen.js';

interface AuftragZeile {
  readonly bezeichnung: string;
  readonly abnahme_am: string | null;
}

async function ladeAuftrag(db: Abfrage, auftragId: string): Promise<AuftragZeile> {
  const [zeile] = await db.abfrage<AuftragZeile>(
    `select bezeichnung, to_char(abnahme_am, 'YYYY-MM-DD') as abnahme_am
       from auftrag where id = $1`,
    [auftragId],
  );
  if (zeile === undefined) {
    throw new AbrechnungFehler(`Auftrag ${auftragId} nicht gefunden.`, 'nichts_abzurechnen');
  }
  return zeile;
}

/** `3333` → `"33,33 %"` — Anzeige, aus ganzer Arithmetik. */
function prozentText(bp: number): string {
  return `${String(Math.trunc(bp / 100))},${String(Math.abs(bp % 100)).padStart(2, '0')} %`;
}

export const FESTPREIS_LOS: Abrechnungsart = {
  schluessel: 'festpreis_los',
  bezeichnung: 'Pauschalpreis-Los',
  istProvisorisch: true,
  offeneParameter: [
    {
      schluessel: 'teilleistung',
      frage: 'Wird eine Teilfertigstellung anteilig abgerechnet oder erst bei Abnahme?',
      werte: ['anteilig', 'erst_bei_abnahme'],
      offeneFrage: 'O-04',
    },
  ],

  async pruefe(db, eingabe): Promise<readonly AbrechnungsBefund[]> {
    const { konfiguration, periode } = eingabe;
    const befunde = [...pruefeParameter(FESTPREIS_LOS, konfiguration)];
    if (konfiguration.festpreisNettoCent === null) {
      befunde.push(fehler(
        'festpreis_netto_cent',
        'Der Vertrag führt keinen Festpreis — das Los hätte keinen Betrag.',
      ));
    }
    const modus = konfiguration.parameter['teilleistung'];
    if (modus === 'erst_bei_abnahme') {
      const auftrag = await ladeAuftrag(db, konfiguration.auftragId);
      if (auftrag.abnahme_am === null || auftrag.abnahme_am > periode.bis) {
        befunde.push(fehler(
          'abnahme_am',
          `Nach Vereinbarung wird erst bei Abnahme abgerechnet; für ${konfiguration.auftragId} `
          + 'ist bis zum Ende des Zeitraums keine Abnahme eingetragen.',
        ));
      }
    }
    if (modus === 'anteilig' && eingabe.fertigstellungBp === undefined) {
      befunde.push(fehler(
        'fertigstellung_bp',
        'Anteilige Abrechnung verlangt einen Fertigstellungsgrad. Er wird erfasst, '
        + 'nicht geschätzt — die Plattform leitet ihn aus nichts her.',
        'O-04',
      ));
    }
    return befunde;
  },

  async positionen(db, eingabe): Promise<readonly RechnungspositionEntwurf[]> {
    const { konfiguration, periode } = eingabe;
    const modus = parameterText(konfiguration, 'teilleistung', 'O-04');
    const festpreis: Cent | null = konfiguration.festpreisNettoCent;
    if (festpreis === null) {
      throw new AbrechnungFehler(
        'Der Vertrag führt keinen Festpreis (vertrag_abrechnung.festpreis_netto_cent).',
        'kein_preis',
      );
    }

    const auftrag = await ladeAuftrag(db, konfiguration.auftragId);
    const zeitraum = leistungszeitraum(konfiguration, periode);
    const steuergruppe = await steuergruppeDesAuftrags(
      db, konfiguration.auftragId, periode.bis,
    );

    const betrag = modus === 'anteilig'
      ? anteiligerBetrag(festpreis, eingabe.fertigstellungBp)
      : vollerBetragNachAbnahme(festpreis, auftrag, periode.bis, konfiguration);

    const menge = ganzeMenge(1);
    const basis = ganzeMenge(1);
    return [{
      bezeichnung: auftrag.bezeichnung,
      beschreibung: modus === 'anteilig'
        ? `Teilleistung ${prozentText(eingabe.fertigstellungBp ?? 0)} des vereinbarten `
          + 'Pauschalpreises — provisorisch (O-04)'
        : `Pauschalpreis nach Abnahme vom ${String(auftrag.abnahme_am)} `
          + '— provisorisch (O-04)',
      menge,
      einheit: 'psch',
      preisBasismenge: basis,
      einzelpreisCent: betrag,
      nettoCent: berechneNetto(menge, basis, betrag, 0),
      steuergruppe,
      abrechnungsart: FESTPREIS_LOS.schluessel,
      vertragAbrechnungId: konfiguration.id,
      auftragLeistungId: konfiguration.auftragLeistungId,
      lvPositionId: null,
      leistungVon: zeitraum.von,
      leistungBis: zeitraum.bis,
      herkunft: [{ art: 'vertrag_abrechnung', id: konfiguration.id, anteil: null }],
    }];
  },
};

/**
 * Der Anteil am Festpreis — EINE Rundung, in `geld.ts`, halb auf.
 *
 * Der Grad kommt herein und wird nicht gebildet: ihn aus erfassten Stunden, aus
 * dem Bautagebuch oder aus einem Aufmass zu schaetzen waere eine erfundene
 * Fertigstellung, und sie stuende auf einem unveraenderlichen Beleg.
 */
function anteiligerBetrag(festpreis: Cent, bp: number | undefined): Cent {
  if (bp === undefined) {
    throw new AbrechnungFehler(
      'Anteilige Abrechnung verlangt einen Fertigstellungsgrad in Basispunkten.',
      'parameter_offen',
    );
  }
  if (!Number.isInteger(bp) || bp <= 0 || bp > 10_000) {
    throw new AbrechnungFehler(
      `Der Fertigstellungsgrad ${String(bp)} liegt nicht zwischen 1 und 10000 Basispunkten.`,
      'keine_menge',
    );
  }
  return anteilInBasisPunkten(festpreis, basisPunkte(bp));
}

function vollerBetragNachAbnahme(
  festpreis: Cent, auftrag: AuftragZeile, bis: string, konfiguration: VertragAbrechnung,
): Cent {
  if (auftrag.abnahme_am === null || auftrag.abnahme_am > bis) {
    throw new AbrechnungFehler(
      `Nach Vereinbarung (teilleistung = erst_bei_abnahme) wird erst nach der Abnahme `
      + `abgerechnet; für Auftrag ${konfiguration.auftragId} ist bis ${bis} keine `
      + 'eingetragen.',
      'nichts_abzurechnen',
    );
  }
  return festpreis;
}
