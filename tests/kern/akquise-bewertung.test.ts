import { describe, expect, it } from 'vitest';
import { bereichFuer, bewerte, type ZielDaten } from '@/server/services/akquise/bewertung';
import {
  GEWICHTE_PLATZHALTER, SKALA_MAX_PLATZHALTER,
} from '@/server/services/akquise/gewichte.platzhalter';

/**
 * Die Akquise-Bewertung — reine Rechnung, nie ein Modell (Invariante 6).
 *
 * **Warum diese Datei so genau hinsieht.** §12 der Auftragsbeschreibung nennt
 * den Lead-Score als eines der wichtigsten Merkmale: der Vertrieb plant seine
 * Woche danach. Eine Zahl, die bei derselben Firma zweimal verschieden
 * ausfällt, ist schlimmer als keine — sie sieht aus wie ein Urteil.
 *
 * Geprüft wird deshalb dreierlei: dass dieselbe Eingabe dieselbe Zahl gibt,
 * dass jedes Kriterium wirklich beiträgt (und zwar genau so viel, wie die
 * Platzhalterdatei sagt), und dass die Begründung jedes Kriterium NENNT —
 * §12 verlangt ausdrücklich einen „Reason for relevance".
 */

const LEER: ZielDaten = {
  firmenname: 'Nichtssagend GmbH', branche: null, plz: null, ort: null,
  website: null, allgemeineEmail: null, telefon: null,
};

function mit(felder: Partial<ZielDaten>): ZielDaten {
  return { ...LEER, ...felder };
}

describe('§1 dieselbe Firma, dieselbe Zahl', () => {
  it('ist deterministisch — zehnmal gerechnet, zehnmal gleich', () => {
    const daten = mit({
      firmenname: 'Berliner Hausverwaltung GmbH', branche: 'Hausverwaltung',
      plz: '10115', website: 'https://example.test',
    });
    const zahlen = new Set(Array.from({ length: 10 }, () => bewerte(daten).punktzahl));
    expect(zahlen.size).toBe(1);
  });

  it('bleibt in der Skala 0…100', () => {
    const alles = mit({
      firmenname: 'Hausverwaltung Facility Hotel GmbH', branche: 'Hausverwaltung',
      plz: '10115', website: 'x', allgemeineEmail: 'info@x.de', telefon: '030',
    });
    expect(bewerte(alles).punktzahl).toBeLessThanOrEqual(SKALA_MAX_PLATZHALTER);
    expect(bewerte(LEER).punktzahl).toBeGreaterThanOrEqual(0);
  });

  it('gibt einer Firma ohne jedes Merkmal null Punkte', () => {
    expect(bewerte(LEER).punktzahl).toBe(0);
  });
});

describe('§2 jedes Kriterium trägt genau das bei, was die Platzhalterdatei sagt', () => {
  it('die Branche', () => {
    const ohne = bewerte(LEER).punktzahl;
    const mitBranche = bewerte(mit({ branche: 'Hausverwaltung' })).punktzahl;
    expect(mitBranche - ohne).toBe(GEWICHTE_PLATZHALTER.branche);
  });

  it('die Entfernung — Berlin voll, Umland halb, Rest nichts', () => {
    const berlin = bewerte(mit({ plz: '10115' })).punktzahl;
    const umland = bewerte(mit({ plz: '15711' })).punktzahl;
    const weit = bewerte(mit({ plz: '80331' })).punktzahl;
    expect(berlin).toBe(GEWICHTE_PLATZHALTER.entfernung);
    expect(umland).toBe(Math.round(GEWICHTE_PLATZHALTER.entfernung / 2));
    expect(weit).toBe(0);
  });

  it('die Erreichbarkeit — EIN Weg genügt, drei geben nicht mehr', () => {
    /*
     * Der Punkt: „erreichbar" ist ja/nein und keine Zählung. Drei Wege sind
     * nicht dreimal so gut wie einer — die Firma ist erreichbar oder nicht.
     */
    const einer = bewerte(mit({ telefon: '030 1234' })).punktzahl;
    const drei = bewerte(mit({
      telefon: '030 1234', website: 'x', allgemeineEmail: 'info@x.de',
    })).punktzahl;
    expect(einer).toBe(GEWICHTE_PLATZHALTER.erreichbar);
    expect(drei).toBe(einer);
  });

  it('das Stichwort im NAMEN zählt zusätzlich zur Branche', () => {
    const nurBranche = bewerte(mit({ branche: 'Hausverwaltung' })).punktzahl;
    const auchImNamen = bewerte(mit({
      firmenname: 'Hausverwaltung Mitte GmbH', branche: 'Hausverwaltung',
    })).punktzahl;
    expect(auchImNamen - nurBranche).toBe(GEWICHTE_PLATZHALTER.stichwort);
  });
});

describe('§3 die Begründung nennt, was gezählt hat (§12 „Reason for relevance")', () => {
  it('nennt jedes Kriterium — auch die, die nichts beigetragen haben', () => {
    const b = bewerte(mit({ branche: 'Hotel', plz: '10115' }));
    expect(b.begruendung).toContain('Branche');
    expect(b.begruendung).toContain('Berlin');
    expect(b.begruendung).toContain('Firmennamen');
    /*
     * Auch die Null steht da. Eine Begründung, die nur die Treffer nennt,
     * lässt offen, ob das Übrige geprüft wurde oder fehlt.
     */
    expect(b.begruendung).toContain('+0');
  });

  it('sagt ausdrücklich, dass die Gewichte PLATZHALTER sind', () => {
    /*
     * Der wichtigste Satz der ganzen Datei. Wer die Zahl liest, soll wissen,
     * dass niemand sie bestätigt hat — sonst wird aus einem Gerüst ein Urteil.
     */
    expect(bewerte(LEER).begruendung).toContain('PLATZHALTER');
    expect(bewerte(LEER).begruendung).toContain('O-15');
  });

  it('nennt die Punktzahl und die Skala, nicht nur die Zahl', () => {
    const b = bewerte(mit({ plz: '10115' }));
    expect(b.begruendung).toContain(String(b.punktzahl));
    expect(b.begruendung).toContain(String(SKALA_MAX_PLATZHALTER));
  });
});

describe('§4 die Bereichszuordnung — und wo sie sich weigert', () => {
  it('ordnet eine Hausverwaltung der Reinigung zu', () => {
    expect(bereichFuer(mit({ branche: 'Hausverwaltung' })).bereich).toBe('reinigung');
  });

  it('ordnet eine Eventagentur der Security zu', () => {
    expect(bereichFuer(mit({ branche: 'Veranstaltungstechnik' })).bereich).toBe('security');
  });

  it('ordnet einen Bauträger dem Bau zu', () => {
    expect(bereichFuer(mit({ branche: 'Bauträger und Projektentwicklung' })).bereich).toBe('bau');
  });

  it('trifft auch ohne Umlaute — „Bautraeger" ist „Bauträger"', () => {
    expect(bereichFuer(mit({ branche: 'Bautraeger' })).bereich).toBe('bau');
    expect(bereichFuer(mit({ branche: 'Buerogebaeude' })).bereich).toBe('reinigung');
  });

  it('WEIGERT sich bei einem Gleichstand, statt einen zu würfeln', () => {
    /*
     * „Wohnungsbau" steht in der Reinigungs- UND in der Bauliste — eine Firma
     * mit genau diesem einen Wort passt zu beiden. Eine Zuordnung zu würfeln
     * hiesse, dem Vertrieb eine Entscheidung zu geben, die er für begründet
     * hält. `null` sagt: „entscheide du."
     */
    const { bereich, treffer } = bereichFuer(mit({ branche: 'Wohnungsbau' }));
    expect(bereich).toBeNull();
    expect(treffer.length).toBeGreaterThan(0);
  });

  it('gibt null, wenn gar nichts trifft — und das ist eine Antwort', () => {
    expect(bereichFuer(mit({ branche: 'Blumenhandel' })).bereich).toBeNull();
    expect(bewerte(mit({ branche: 'Blumenhandel' })).bedarfVermutung).toBeNull();
  });
});

describe('§5 die Bedarfsvermutung sagt, dass sie eine Vermutung ist', () => {
  it('nennt sich selbst „vermutlich" und „nicht geprüft"', () => {
    const b = bewerte(mit({ branche: 'Hausverwaltung' }));
    expect(b.bedarfVermutung).not.toBeNull();
    expect(b.bedarfVermutung!.toLowerCase()).toContain('vermutlich');
    expect(b.bedarfVermutung!.toLowerCase()).toContain('nicht geprüft');
  });

  it('nennt die Leistung, die gemeint ist — nicht nur den Bereich', () => {
    expect(bewerte(mit({ branche: 'Hausverwaltung' })).bedarfVermutung)
      .toContain('Unterhalts- oder Glasreinigung');
    expect(bewerte(mit({ branche: 'Messebau Event' })).bedarfVermutung)
      .toContain('Objektschutz');
  });
});
