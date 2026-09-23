/**
 * Die Musterrechnungen, gegen die CI den KoSIT-Pruefer laufen laesst (FIN-11).
 *
 * **Warum Muster und nicht echte Belege.** Der Pruefer prueft den ERZEUGER,
 * nicht eine einzelne Rechnung. Ein Muster steht im Quelltext, aendert sich
 * nur bewusst, und wenn es faellt, hat sich `xrechnung/index.ts` geaendert —
 * nicht die Datenlage einer Testdatenbank. Mit echten Belegen waere jeder
 * rote Lauf erst einmal eine Suche danach, ob ueberhaupt etwas kaputt ist.
 *
 * **Vier Muster, und jedes deckt eine andere Regelgruppe der CIUS ab:**
 *
 *   `standard`      — 19 %, eine Zeile, SEPA-Ueberweisung. Der Grundfall.
 *   `zwei-saetze`   — 19 % und 7 % nebeneinander, mit Nachlass auf
 *                     Dokumentebene. Prueft BR-CO-13 (die Endsumme geht aus
 *                     Zeilen, Nachlaessen und Zuschlaegen hervor) und die
 *                     Aufteilung je Satz.
 *   `reverse-charge`— §13b, Kategorie `AE` mit Satz 0 und Befreiungsgrund.
 *                     Prueft BR-AE-*, die eigene Regelgruppe der Verlagerung.
 *   `schluss`       — Schlussrechnung mit abgezogenem Abschlag als
 *                     `PrepaidAmount`. Prueft, dass FIN-08 im EN-16931-Modell
 *                     ueberhaupt darstellbar ist.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cent, type Cent } from '../../../src/server/services/finanz/geld.js';
import { milliMenge } from '../../../src/server/services/finanz/menge.js';
import { baueUbl } from '../../../src/server/services/finanz/xrechnung/index.js';
import type {
  Anschrift, Position, RechnungVollstaendig, Steuerzeile,
} from '../../../src/server/services/finanz/kanonisch.js';

const c = (n: bigint): Cent => cent(n);

const anschrift = (strasse: string, plz: string, ort: string): Anschrift => ({
  zeile: `${strasse}, ${plz} ${ort}, DE`,
  strasse, zusatz: null, plz, ort, land: 'DE',
});

function zeile(
  nr: number, bezeichnung: string, netto: bigint, preis: bigint,
  gruppe: string, satzBp: number, kategorie: string,
): Position {
  return {
    nr, art: 'leistung', bezeichnung, beschreibung: null,
    menge: milliMenge(1000n), einheit: 'Monat', einheitCode: 'MON',
    preisBasismenge: milliMenge(1000n), einzelpreisCent: c(preis), rabattBp: 0,
    nettoCent: c(netto), steuersatzGruppe: gruppe, satzBp, kategorie,
    abrechnungsart: null, leistungVon: null, leistungBis: null, quellen: [],
  };
}

function steuer(
  gruppe: string, satzBp: number, kategorie: string, netto: bigint, betrag: bigint,
  grundCode: string | null = null, grundText: string | null = null,
): Steuerzeile {
  return {
    steuersatzGruppe: gruppe, kategorie, satzBp,
    nettoCent: c(netto), steuerCent: c(betrag),
    befreiungsgrundCode: grundCode, befreiungsgrundText: grundText,
  };
}

function grundfall(): RechnungVollstaendig {
  return {
    leistender: {
      id: '11111111-1111-1111-1111-111111111111',
      name: 'CSE Dienstleistungen GmbH',
      rechtsform: 'GmbH',
      anschrift: anschrift('Kurfürstendamm 21', '10719', 'Berlin'),
      kontakt: {
        name: 'Buchhaltung', telefon: '+49 30 5550100',
        email: 'rechnung@cse-gruppe.example',
      },
      steuernummer: '30/123/45678',
      ustid: 'DE123456789',
      gericht: 'Amtsgericht Charlottenburg',
      hrb: 'HRB 12345 B',
      geschaeftsfuehrer: 'Sara Gouneili',
      eadresse: 'DE123456789',
      eadresseSchema: '9930',
      /* Neu in `cse.rechnung.v3` (V-099): die Fusszeile der Gesellschaft,
         beim Festschreiben KOPIERT statt verwiesen (K-12). */
      fusszeile: 'CSE Dienstleistungen GmbH · Karl-Marx-Allee 31 · 10178 Berlin',
    },
    empfaenger: {
      id: '22222222-2222-2222-2222-222222222222',
      name: 'Bezirksamt Mitte von Berlin',
      anschrift: anschrift('Karl-Marx-Allee 31', '10178', 'Berlin'),
      ustid: null,
      leitwegId: '991-12345-67',
      kaeuferReferenz: null,
      bestellnummer: 'B-2026-4711',
      eadresse: '991-12345-67',
      eadresseSchema: '0204',
    },
    nummernkreisId: '33333333-3333-3333-3333-333333333333',
    nummer: 'RE-2026-00001',
    kettePosition: 1,
    rechnungsart: 'standard',
    rechnungsartCode: '380',
    rechnungsdatum: '2026-09-11',
    leistungVon: '2026-08-01',
    leistungBis: '2026-08-31',
    vereinnahmungGeplantAm: null,
    objekt: null,
    sprache: 'de',
    waehrung: 'EUR',
    kopftext: null,
    fusstext: null,
    steuerhinweis: null,
    hinweise: [],
    positionen: [zeile(1, 'Unterhaltsreinigung August 2026', 100_000n, 100_000n,
      'ust_19', 1900, 'S')],
    zuschlaege: [],
    steuerzeilen: [steuer('ust_19', 1900, 'S', 100_000n, 19_000n)],
    abzuege: [],
    nettoGesamtCent: c(100_000n),
    steuerGesamtCent: c(19_000n),
    bruttoCent: c(119_000n),
    abzugBruttoCent: c(0n),
    zahlbetragCent: c(119_000n),
    bauabzugsteuer: {
      pflichtig: false, satzBp: null, grundlageCent: null,
      einbehaltCent: c(0n), freistellungsbescheinigung: null,
    },
    ueberweisungsbetragCent: c(119_000n),
    zahlung: {
      bankkonto: {
        iban: 'DE02120300000000202051', bic: 'BYLADEM1001',
        kontoinhaber: 'CSE Dienstleistungen GmbH',
      },
      zahlungsmittelCode: '58',
      zahlungsbedingungText: 'Zahlbar innerhalb von 30 Tagen ohne Abzug.',
      zahlungszielTage: 30,
      faelligAm: '2026-10-11',
      skontoBp: null,
      skontoTage: null,
    },
    istKleinbetrag: false,
    kleinbetragGrenzeCent: null,
    reverseCharge: false,
    reverseChargeGrundlage: null,
    festgeschriebenAm: '2026-09-11T09:00:00.000Z',
    festgeschriebenVon: '44444444-4444-4444-4444-444444444444',
  };
}

export const MUSTER: Readonly<Record<string, () => RechnungVollstaendig>> = {
  standard: grundfall,

  'zwei-saetze': () => {
    const r = grundfall();
    return {
      ...r,
      nummer: 'RE-2026-00002',
      positionen: [
        zeile(1, 'Unterhaltsreinigung August 2026', 100_000n, 100_000n, 'ust_19', 1900, 'S'),
        zeile(2, 'Verpflegung Sicherheitsdienst', 20_000n, 20_000n, 'ust_07', 700, 'S'),
      ],
      zuschlaege: [{
        art: 'nachlass',
        bezeichnung: 'Rahmenvertragsrabatt',
        grundCode: '95',
        basisCent: c(100_000n),
        satzBp: 500,
        betragCent: c(-5_000n),
        steuersatzGruppe: 'ust_19',
        gruppeSatzBp: 1900,
        gruppeKategorie: 'S',
      }],
      steuerzeilen: [
        steuer('ust_07', 700, 'S', 20_000n, 1_400n),
        steuer('ust_19', 1900, 'S', 95_000n, 18_050n),
      ],
      nettoGesamtCent: c(115_000n),
      steuerGesamtCent: c(19_450n),
      bruttoCent: c(134_450n),
      zahlbetragCent: c(134_450n),
      ueberweisungsbetragCent: c(134_450n),
    };
  },

  'reverse-charge': () => {
    const r = grundfall();
    return {
      ...r,
      nummer: 'RE-2026-00003',
      steuerhinweis: 'Steuerschuldnerschaft des Leistungsempfängers (§13b UStG)',
      empfaenger: { ...r.empfaenger, ustid: 'DE987654321' },
      positionen: [zeile(1, 'Gebäudereinigung August 2026', 100_000n, 100_000n,
        'ust_0_13b_reinigung', 0, 'AE')],
      steuerzeilen: [steuer('ust_0_13b_reinigung', 0, 'AE', 100_000n, 0n,
        'VATEX-EU-AE', 'Steuerschuldnerschaft des Leistungsempfängers (§13b UStG)')],
      nettoGesamtCent: c(100_000n),
      steuerGesamtCent: c(0n),
      bruttoCent: c(100_000n),
      zahlbetragCent: c(100_000n),
      ueberweisungsbetragCent: c(100_000n),
      reverseCharge: true,
      reverseChargeGrundlage: 'gebaeudereinigung',
    };
  },

  schluss: () => {
    const r = grundfall();
    return {
      ...r,
      nummer: 'RE-2026-00004',
      rechnungsart: 'schluss',
      abzuege: [{
        abschlagNummer: 'AB-2026-00007',
        steuersatzGruppe: 'ust_19',
        abzugNettoCent: c(40_000n),
        abzugSteuerCent: c(7_600n),
      }],
      abzugBruttoCent: c(47_600n),
      zahlbetragCent: c(71_400n),
      ueberweisungsbetragCent: c(71_400n),
    };
  },
};

/** Schreibt alle Muster nach `ziel` und gibt die Dateinamen zurueck. */
export function schreibeMuster(ziel: string): readonly string[] {
  mkdirSync(ziel, { recursive: true });
  return Object.entries(MUSTER).map(([name, bauen]) => {
    const datei = join(ziel, `${name}.xml`);
    writeFileSync(datei, baueUbl(bauen()), 'utf8');
    return datei;
  });
}
