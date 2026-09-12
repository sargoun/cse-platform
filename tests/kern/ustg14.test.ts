/**
 * PR 47 — die §14-UStG-Feldliste, tabellengetrieben (FIN-04, FIN-05, FIN-13).
 *
 * **Ein Fall je Pflichtangabe des §14 Abs. 4 UStG.** Jeder Fall nimmt einen
 * vollstaendigen Beleg und entfernt GENAU EINE Angabe; erwartet wird genau ein
 * Befund, und zwar der zu diesem Feld. Das ist der Unterschied zwischen „die
 * Pruefung meldet etwas" und „die Pruefung meldet das Richtige": eine Regel,
 * die bei jedem Defekt anschlaegt, ist keine Pruefung, sondern ein Alarm.
 *
 * Und ein Gegentest haelt die Liste vollstaendig: **jede Regel in `REGELN`
 * braucht einen Fall.** Ohne ihn koennte jemand eine Regel hinzufuegen, die
 * nie jemand ausloest — gruener Lauf, ungeprueftes Feld.
 *
 * Rein, ohne Datenbank: `pruefePflichtfelder` ist eine Funktion von Daten auf
 * Daten. Was die Datenbank dazu haelt, steht in
 * `tests/isolation/rechnung-pflichtfelder.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { cent } from '../../src/server/services/finanz/geld.js';
import { milliMenge } from '../../src/server/services/finanz/menge.js';
import {
  kleinbetragLage, pruefePflichtfelder, REGELN, REGELWERK_VERSION,
  berichtAlsJson, PflichtfeldFehler,
  type PruefEingabe,
} from '../../src/server/services/finanz/ustg14.js';

/**
 * Ein Beleg, der §14 UStG erfuellt — die Ausgangslage jedes Falls.
 *
 * Brutto 1.190,00 €: deutlich ueber jeder Kleinbetragsgrenze, damit die
 * Erleichterung des §33 UStDV in den Feldfaellen KEINE Rolle spielt. Die
 * Grenze bekommt ihre eigenen Faelle weiter unten.
 */
const BASIS: PruefEingabe = {
  rechnungId: '3f1d0a2e-0000-4000-8000-000000000001',
  mandantSlug: 'reinigung',
  kundeId: '3f1d0a2e-0000-4000-8000-000000000002',
  rechnungsart: 'standard',
  rechnungsdatum: '2026-09-11',
  leistungVon: '2026-08-01',
  leistungBis: '2026-08-31',
  vereinnahmungGeplantAm: null,
  zahlungszielTage: 30,
  nettoGesamtCent: cent(100_000n),
  steuerGesamtCent: cent(19_000n),
  bruttoCent: cent(119_000n),
  leistender: {
    name: 'CSE Dienstleistungen GmbH', strasse: 'Kurfürstendamm 21',
    plz: '10719', ort: 'Berlin', land: 'DE',
    ustId: 'DE123456789', steuernummer: '30/123/45678',
  },
  empfaenger: {
    name: 'Bezirksamt Mitte', strasse: 'Karl-Marx-Allee 31',
    plz: '10178', ort: 'Berlin', land: 'DE', ustId: null, steuernummer: null,
  },
  empfaengerTyp: 'behoerde',
  positionen: [{
    nr: 1, art: 'leistung', bezeichnung: 'Unterhaltsreinigung August',
    mengeMilli: milliMenge(1_000n), einheit: 'm2', hatMasseinheit: true,
    nettoCent: cent(100_000n), steuergruppe: 'ust_19', kategorie: 'S',
    gruppeGueltigBis: null,
  }],
  steuerzeilen: [{
    steuergruppe: 'ust_19', satzBp: 1900, kategorie: 'S',
    nettoCent: cent(100_000n), steuerCent: cent(19_000n), befreiungsgrundText: null,
  }],
  kreis: {
    gesellschaftFakturiert: true, vorhanden: true,
    bezeichnung: 'Ausgangsrechnungen', istPlatzhalter: false,
    lueckenlos: true, geschlossen: false,
  },
  kleinbetragGrenze: {
    grenzeBruttoCent: cent(25_000n), fundstelle: '§33 UStDV', istPlatzhalter: false,
  },
};

interface Fall {
  /** Der `feld`-Schluessel der Regel, die anschlagen MUSS. */
  readonly feld: string;
  /** Die Pflichtangabe, wie das Gesetz sie nennt. */
  readonly angabe: string;
  readonly stufe: 'fehler' | 'warnung';
  readonly defekt: (e: PruefEingabe) => PruefEingabe;
  /** Ein Stueck des deutschen Satzes — er muss das Feld benennen. */
  readonly text: RegExp;
}

const FAELLE: readonly Fall[] = [
  {
    feld: 'leistender.name',
    angabe: 'Name des Leistenden (§14 Abs. 4 Nr. 1)',
    stufe: 'fehler',
    defekt: (e) => ({ ...e, leistender: { ...e.leistender, name: '  ' } }),
    text: /Name der ausstellenden Gesellschaft/u,
  },
  {
    feld: 'leistender.anschrift',
    angabe: 'Anschrift des Leistenden (§14 Abs. 4 Nr. 1)',
    stufe: 'fehler',
    defekt: (e) => ({ ...e, leistender: { ...e.leistender, plz: null } }),
    text: /ausstellenden Gesellschaft fehlt: PLZ/u,
  },
  {
    feld: 'leistender.steuernummer',
    angabe: 'Steuernummer oder USt-IdNr. (§14 Abs. 4 Nr. 2) — O-24',
    stufe: 'fehler',
    defekt: (e) => ({
      ...e, leistender: { ...e.leistender, ustId: null, steuernummer: '' },
    }),
    text: /weder Steuernummer noch USt-IdNr/u,
  },
  {
    feld: 'rechnungsdatum',
    angabe: 'Ausstellungsdatum (§14 Abs. 4 Nr. 3)',
    stufe: 'fehler',
    defekt: (e) => ({ ...e, rechnungsdatum: null }),
    text: /Ausstellungsdatum fehlt/u,
  },
  {
    feld: 'nummer',
    angabe: 'fortlaufende Nummer (§14 Abs. 4 Nr. 4)',
    stufe: 'fehler',
    defekt: (e) => ({ ...e, kreis: { ...e.kreis, vorhanden: false } }),
    text: /keinen offenen Rechnungsnummernkreis/u,
  },
  {
    feld: 'empfaenger.name',
    angabe: 'Name des Leistungsempfängers (§14 Abs. 4 Nr. 1)',
    stufe: 'fehler',
    defekt: (e) => ({ ...e, empfaenger: { ...e.empfaenger, name: null } }),
    text: /Name des Leistungsempfängers fehlt/u,
  },
  {
    feld: 'empfaenger.anschrift',
    angabe: 'Anschrift des Leistungsempfängers (§14 Abs. 4 Nr. 1)',
    stufe: 'fehler',
    defekt: (e) => ({ ...e, empfaenger: { ...e.empfaenger, strasse: null } }),
    text: /Leistungsempfängers fehlt: Straße/u,
  },
  {
    feld: 'positionen',
    angabe: 'Menge und Art der Leistung (§14 Abs. 4 Nr. 5)',
    stufe: 'fehler',
    defekt: (e) => ({
      ...e,
      positionen: [{ ...e.positionen[0]!, mengeMilli: null, einheit: null,
        hatMasseinheit: false }],
    }),
    text: /Position 1: es fehlt die Menge und die Mengeneinheit/u,
  },
  {
    feld: 'leistungszeitpunkt',
    angabe: 'Zeitpunkt der Leistung (§14 Abs. 4 Nr. 6, erste Alternative)',
    stufe: 'fehler',
    defekt: (e) => ({ ...e, leistungVon: null, leistungBis: null }),
    text: /Leistungszeitraum fehlt/u,
  },
  {
    feld: 'vereinnahmung',
    angabe: 'Hinweis auf die Vorauszahlung (§14 Abs. 4 Nr. 6, zweite Alternative)',
    stufe: 'fehler',
    defekt: (e) => ({
      ...e, rechnungsart: 'abschlag',
      leistungVon: null, leistungBis: null, vereinnahmungGeplantAm: null,
    }),
    text: /weder einen Leistungszeitraum noch den Zeitpunkt der Vereinnahmung/u,
  },
  {
    feld: 'steuer.netto_je_gruppe',
    angabe: 'Entgelt, nach Steuersätzen aufgeschlüsselt (§14 Abs. 4 Nr. 7)',
    stufe: 'fehler',
    defekt: (e) => ({
      ...e,
      positionen: [{ ...e.positionen[0]!, steuergruppe: 'ust_07' }],
    }),
    text: /Steuergruppe\(n\) ust_07 gibt es keine Steuerzeile/u,
  },
  {
    feld: 'steuer.satz_und_betrag',
    angabe: 'Satz und Steuerbetrag (§14 Abs. 4 Nr. 8)',
    stufe: 'fehler',
    defekt: (e) => ({
      ...e,
      steuerzeilen: [{ ...e.steuerzeilen[0]!, steuerCent: cent(18_000n) }],
    }),
    text: /Steuerbeträge ergeben 18000 Cent/u,
  },
  {
    feld: 'steuer.befreiungshinweis',
    angabe: 'Hinweis auf die Steuerbefreiung (§14 Abs. 4 Nr. 8, zweite Alternative)',
    stufe: 'fehler',
    defekt: (e) => ({
      ...e,
      steuerzeilen: [{ ...e.steuerzeilen[0]!, kategorie: 'E', befreiungsgrundText: null }],
    }),
    text: /keinen Hinweis auf die Steuerbefreiung/u,
  },
  {
    feld: 'aufbewahrungshinweis',
    angabe: 'Hinweis auf die Aufbewahrungspflicht (§14 Abs. 4 Nr. 9)',
    stufe: 'warnung',
    defekt: (e) => ({ ...e, empfaengerTyp: 'privat' }),
    text: /zweijährige Aufbewahrungspflicht/u,
  },
  {
    feld: 'zahlungsziel',
    angabe: 'Fälligkeit — §4.2, O-66',
    stufe: 'fehler',
    defekt: (e) => ({ ...e, zahlungszielTage: null }),
    text: /kein Zahlungsziel hinterlegt/u,
  },
  {
    feld: 'summen',
    angabe: 'Brutto = Entgelt + Steuer (Invariante 1)',
    stufe: 'fehler',
    defekt: (e) => ({ ...e, bruttoCent: cent(119_001n) }),
    text: /nicht die Summe aus Entgelt/u,
  },
  {
    feld: 'steuersatz.gueltigkeit',
    angabe: 'Satzänderung im Leistungszeitraum (LEG-05)',
    stufe: 'warnung',
    defekt: (e) => ({
      ...e,
      positionen: [{ ...e.positionen[0]!, gruppeGueltigBis: '2026-08-15' }],
    }),
    text: /läuft vor dem Ende des Leistungszeitraums/u,
  },
];

describe('§14 Abs. 4 UStG — ein Fall je Pflichtangabe', () => {
  it('der vollständige Beleg erzeugt keinen einzigen Befund', () => {
    const bericht = pruefePflichtfelder(BASIS);
    expect(bericht.fehler).toEqual([]);
    expect(bericht.warnungen).toEqual([]);
    expect(bericht.geprueft).toBe(true);
    expect(bericht.regelwerkVersion).toBe(REGELWERK_VERSION);
  });

  for (const fall of FAELLE) {
    it(`ohne ${fall.angabe} blockiert „${fall.feld}"`, () => {
      const bericht = pruefePflichtfelder(fall.defekt(BASIS));
      const alle = [...bericht.fehler, ...bericht.warnungen];

      /**
       * **Genau dieses eine Feld.** Ohne diese Zusage waere jeder Fall schon
       * dann gruen, wenn irgendeine Regel anschlaegt — und eine Regel, die
       * bei jedem Defekt feuert, sagt einem Menschen nichts.
       */
      expect([...new Set(alle.map((b) => b.feld))]).toEqual([fall.feld]);
      expect(alle[0]?.textDe).toMatch(fall.text);
      expect(alle[0]?.stufe).toBe(fall.stufe);
      // DSH-04: jeder Befund zeigt auf den Datensatz, an dem er zu beheben ist.
      expect(alle[0]?.link).toMatch(/^\/portal\//u);

      // Eine Warnung haelt den Beleg NICHT auf.
      expect(bericht.fehler.length > 0).toBe(fall.stufe === 'fehler');
    });
  }

  /**
   * Der Gegentest. Eine Regel ohne Fall ist eine Regel, die nie jemand
   * ausloest — und niemand merkte, wenn sie stillschweigend nichts taete.
   */
  it('jede Regel in REGELN hat einen Fall', () => {
    const gepruefte = new Set(FAELLE.map((f) => f.feld));
    const fehlend = REGELN.map((r) => r.feld).filter((f) => !gepruefte.has(f));
    expect(fehlend).toEqual([]);
  });

  /**
   * O-01 hat eine EIGENE Meldung, und sie steht wortgleich in
   * `fin.rechnung_nummer_ziehen`. „Kein Kreis" und „diese Gesellschaft
   * fakturiert gar nicht" sind zwei verschiedene Befunde, und zwei
   * verschiedene Menschen tun darauf zwei verschiedene Dinge.
   */
  it('eine Abteilung ohne eigenen Rechnungskreis bekommt die O-01-Meldung', () => {
    const bericht = pruefePflichtfelder({
      ...BASIS,
      leistender: { ...BASIS.leistender, name: 'CSE Operations' },
      kreis: { ...BASIS.kreis, vorhanden: false, gesellschaftFakturiert: false },
    });
    expect(bericht.fehler.map((b) => b.feld)).toEqual(['nummer']);
    expect(bericht.fehler[0]?.textDe)
      .toMatch(/Rechnungskreis für CSE Operations nicht freigegeben/u);
  });

  it('die Liste nennt jede Pflichtangabe des §14 Abs. 4 UStG', () => {
    const felder = new Set(REGELN.map((r) => r.feld));
    for (const pflicht of [
      'leistender.name', 'leistender.anschrift', 'empfaenger.name',
      'empfaenger.anschrift', 'leistender.steuernummer', 'rechnungsdatum', 'nummer',
      'positionen', 'leistungszeitpunkt', 'vereinnahmung', 'steuer.netto_je_gruppe',
      'steuer.satz_und_betrag', 'steuer.befreiungshinweis',
    ]) {
      expect(felder.has(pflicht)).toBe(true);
    }
  });

  it('der Bericht nennt jedes fehlende Feld AUF EINMAL, nicht das erste', () => {
    const bericht = pruefePflichtfelder({
      ...BASIS,
      rechnungsdatum: null,
      zahlungszielTage: null,
      leistender: { ...BASIS.leistender, ustId: null, steuernummer: null },
    });
    expect([...new Set(bericht.fehler.map((f) => f.feld))].sort()).toEqual(
      ['leistender.steuernummer', 'rechnungsdatum', 'zahlungsziel'],
    );
  });
});

describe('§33 UStDV — beide Seiten der Grenze (FIN-13)', () => {
  /** Ein Beleg, dem NUR die Empfängeranschrift fehlt — sonst vollständig. */
  const ohneEmpfaengeranschrift = (bruttoCent: bigint): PruefEingabe => ({
    ...BASIS,
    empfaenger: { ...BASIS.empfaenger, strasse: null, plz: null, ort: null },
    nettoGesamtCent: cent(bruttoCent),
    steuerGesamtCent: cent(0n),
    bruttoCent: cent(bruttoCent),
    positionen: [{ ...BASIS.positionen[0]!, nettoCent: cent(bruttoCent),
      steuergruppe: 'ust_0_4nr12', kategorie: 'E' }],
    steuerzeilen: [{
      steuergruppe: 'ust_0_4nr12', satzBp: 0, kategorie: 'E',
      nettoCent: cent(bruttoCent), steuerCent: cent(0n),
      befreiungsgrundText: 'Steuerfreie Vermietung nach §4 Nr. 12 UStG',
    }],
  });

  it('249,99 € — die Erleichterung greift, der Beleg ist vollständig', () => {
    const bericht = pruefePflichtfelder(ohneEmpfaengeranschrift(24_999n));
    expect(bericht.kleinbetrag.greift).toBe(true);
    expect(bericht.fehler).toEqual([]);
  });

  it('250,00 € — sie greift nicht mehr, die Empfängeranschrift fehlt', () => {
    const bericht = pruefePflichtfelder(ohneEmpfaengeranschrift(25_000n));
    expect(bericht.kleinbetrag.greift).toBe(false);
    expect(bericht.fehler.map((f) => f.feld)).toEqual(['empfaenger.anschrift']);
  });

  /**
   * Die Grenze steht in `kleinbetrag_grenze` und NICHT im Code: derselbe
   * Betrag, eine andere Zeile, ein anderes Ergebnis. Faende der Vergleich
   * gegen eine einkompilierte Zahl statt, bliebe dieser Fall rot.
   */
  it('eine andere Grenze verschiebt die Schwelle — sie kommt aus den Daten', () => {
    const bericht = pruefePflichtfelder({
      ...ohneEmpfaengeranschrift(25_000n),
      kleinbetragGrenze: {
        grenzeBruttoCent: cent(30_000n), fundstelle: '§33 UStDV', istPlatzhalter: false,
      },
    });
    expect(bericht.kleinbetrag.greift).toBe(true);
    expect(bericht.fehler).toEqual([]);
  });

  it('eine UNBESTÄTIGTE Grenze greift nie (O-175)', () => {
    const bericht = pruefePflichtfelder({
      ...ohneEmpfaengeranschrift(24_999n),
      kleinbetragGrenze: {
        grenzeBruttoCent: cent(25_000n), fundstelle: '§33 UStDV', istPlatzhalter: true,
      },
    });
    expect(bericht.kleinbetrag.greift).toBe(false);
    expect(bericht.kleinbetrag.grund).toMatch(/unbestätigter Wert \(O-175\)/u);
    expect(bericht.fehler.map((f) => f.feld)).toEqual(['empfaenger.anschrift']);
  });

  /**
   * §33 UStDV nimmt die Faelle des §13b UStG aus — eine 40-€-Rechnung mit
   * Reverse Charge traegt die Empfaengerangaben weiter.
   */
  it('bei §13b (Kategorie AE) greift sie nicht, egal wie klein der Betrag ist', () => {
    const klein = ohneEmpfaengeranschrift(4_000n);
    const bericht = pruefePflichtfelder({
      ...klein,
      positionen: [{ ...klein.positionen[0]!, steuergruppe: 'ust_0_13b_bau',
        kategorie: 'AE' }],
      steuerzeilen: [{
        steuergruppe: 'ust_0_13b_bau', satzBp: 0, kategorie: 'AE',
        nettoCent: cent(4_000n), steuerCent: cent(0n),
        befreiungsgrundText: 'Steuerschuldnerschaft des Leistungsempfängers',
      }],
    });
    expect(bericht.kleinbetrag.greift).toBe(false);
    expect(bericht.kleinbetrag.grund).toMatch(/§13b/u);
    expect(bericht.fehler.map((f) => f.feld)).toEqual(['empfaenger.anschrift']);
  });

  it('die fortlaufende Nummer entfällt NICHT — auch nicht beim Kleinbetrag', () => {
    const bericht = pruefePflichtfelder({
      ...ohneEmpfaengeranschrift(4_000n),
      kreis: { ...BASIS.kreis, vorhanden: false },
    });
    expect(bericht.kleinbetrag.greift).toBe(true);
    expect(bericht.fehler.map((f) => f.feld)).toEqual(['nummer']);
  });

  it('ohne Grenzzeile greift sie nicht und der Grund sagt es', () => {
    const lage = kleinbetragLage({ ...BASIS, kleinbetragGrenze: null });
    expect(lage.greift).toBe(false);
    expect(lage.grenzeBruttoCent).toBeNull();
    expect(lage.grund).toMatch(/keine Kleinbetragsgrenze/u);
  });
});

describe('der Befund, wie er im Snapshot liegt', () => {
  it('Cent stehen als TEXT — ein bigint überlebt JSON.stringify nicht', () => {
    const json = berichtAlsJson(pruefePflichtfelder(BASIS));
    expect(() => JSON.stringify(json)).not.toThrow();
    const klein = json['kleinbetrag'] as Record<string, unknown>;
    expect(klein['grenze_brutto_cent']).toBe('25000');
    expect(json['geprueft']).toBe(true);
    expect(json['regelwerk_version']).toBe(REGELWERK_VERSION);
  });

  it('er nennt, was er NICHT geprüft hat — sonst liest er sich vollständig', () => {
    const bericht = pruefePflichtfelder(BASIS);
    expect(bericht.nichtGeprueft.length).toBeGreaterThan(0);
    const regeln = bericht.nichtGeprueft.map((n) => n.regel).join(' ');
    expect(regeln).toMatch(/§13b/u);
    expect(regeln).toMatch(/§48 EStG/u);
    expect(regeln).toMatch(/FIN-07/u);
  });

  it('die Abweisung trägt jeden deutschen Satz, nicht nur den ersten', () => {
    const bericht = pruefePflichtfelder({
      ...BASIS, rechnungsdatum: null, zahlungszielTage: null,
    });
    const fehler = new PflichtfeldFehler(bericht);
    expect(fehler.message).toMatch(/Ausstellungsdatum fehlt/u);
    expect(fehler.message).toMatch(/kein Zahlungsziel hinterlegt/u);
    expect(fehler.grund).toBe('pflichtfelder');
  });
});
