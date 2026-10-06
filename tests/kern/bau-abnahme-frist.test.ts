/**
 * Die reinen Funktionen der Abnahme (§ 12 VOB/B) — Prüfung, Schnappschuss,
 * Gewährleistungsfrist.
 *
 * **Warum die Frist hier den größten Teil einnimmt.** `FRIST_OFFEN` bleibt
 * die Fassung, die nichts rechnet, und `null` bleibt ihre Zusage. Seit D-782
 * ist `FRIST_VOREINSTELLUNG` eingesetzt (O-154): vier Jahre ab Abnahme bei
 * VOB/B (§ 13 Abs. 4 Nr. 1), fünf bei BGB (§ 634a Abs. 1 Nr. 2), nach
 * §§ 187, 188 BGB gerechnet; eine Teilabnahme setzt die Projektfrist nicht.
 * Eine Frist, die ein Jahr zu kurz notiert ist, lässt einen Anspruch
 * verjähren — deshalb stehen die Jahre hier Zeile für Zeile, mit Schaltjahr.
 */
import { describe, expect, it } from 'vitest';
import {
  ABNAHME_ARTEN, AbnahmeFehler, FRIST_OFFEN, FRIST_OFFEN_TEXT, FRIST_VOREINSTELLUNG,
  FRIST_VOREINSTELLUNG_TEXT, GEWAEHRLEISTUNG_JAHRE, fristEndeNachJahren,
  abnahmeSchnappschussHash, baueAbnahmeSchnappschuss, istAbnahmeArt, pruefeAbnahme,
  type AbnahmeEingabe,
} from '../../src/server/services/bau/abnahme.js';

const GUELTIG: AbnahmeEingabe = {
  projektId: '11111111-1111-1111-1111-111111111111',
  art: 'foermlich',
  abnahmeAm: '2026-09-10',
  leistungsumfang: null,
  abgenommen: true,
  verweigerungGrund: null,
  vorbehaltVertragsstrafe: true,
  vorbehaltMaengel: false,
  vorbehaltText: 'Vertragsstrafe bleibt vorbehalten.',
  teilnehmer: ['Frau Beyer (Bauleiterin AG)'],
  maengel: [],
};

describe('O-154 — die Voreinstellung rechnet die Gewährleistungsfrist (D-782)', () => {
  it('vier Jahre bei VOB/B, fünf bei BGB — ab dem Abnahmetag', () => {
    expect(GEWAEHRLEISTUNG_JAHRE['vob_b']).toBe(4);
    expect(GEWAEHRLEISTUNG_JAHRE['bgb']).toBe(5);
    for (const art of ['foermlich', 'fiktiv', 'konkludent'] as const) {
      expect(FRIST_VOREINSTELLUNG.fristEnde({ vertragsgrundlage: 'vob_b', abnahmeAm: '2026-09-10', art }), art)
        .toBe('2030-09-10');
      expect(FRIST_VOREINSTELLUNG.fristEnde({ vertragsgrundlage: 'bgb', abnahmeAm: '2026-09-10', art }), art)
        .toBe('2031-09-10');
    }
  });

  it('eine Teilabnahme setzt die Projektfrist nicht, ein unbekanntes Regime rechnet nichts', () => {
    expect(FRIST_VOREINSTELLUNG.fristEnde({ vertragsgrundlage: 'vob_b', abnahmeAm: '2026-09-10', art: 'teilabnahme' }))
      .toBeNull();
    expect(FRIST_VOREINSTELLUNG.fristEnde({ vertragsgrundlage: 'hgb', abnahmeAm: '2026-09-10', art: 'foermlich' }))
      .toBeNull();
    expect(FRIST_VOREINSTELLUNG.fristEnde({ vertragsgrundlage: 'vob_b', abnahmeAm: '10.09.2026', art: 'foermlich' }))
      .toBeNull();
  });

  it('§ 188 Abs. 3 BGB: fehlt der Tag im Zieljahr, endet die Frist am Monatsletzten', () => {
    expect(fristEndeNachJahren('2024-02-29', 4)).toBe('2028-02-29');
    expect(fristEndeNachJahren('2024-02-29', 5)).toBe('2029-02-28');
    expect(fristEndeNachJahren('2026-12-31', 4)).toBe('2030-12-31');
    expect(fristEndeNachJahren('2026-01-01', 5)).toBe('2031-01-01');
  });

  it('der Satz der Voreinstellung nennt beide Regime, beide Fristen und die Nummer', () => {
    expect(FRIST_VOREINSTELLUNG_TEXT).toContain('§ 13 Abs. 4');
    expect(FRIST_VOREINSTELLUNG_TEXT).toContain('§ 634a');
    expect(FRIST_VOREINSTELLUNG_TEXT).toContain('O-154');
    expect(FRIST_VOREINSTELLUNG_TEXT).toContain('Teilabnahme');
  });
});

describe('O-154 — die Fassung FRIST_OFFEN rechnet weiterhin NICHT', () => {
  it('die eingesetzte Fassung gibt für jede Art und jedes Regime `null`', () => {
    for (const art of ABNAHME_ARTEN) {
      for (const vertragsgrundlage of ['vob_b', 'bgb']) {
        expect(
          FRIST_OFFEN.fristEnde({ vertragsgrundlage, abnahmeAm: '2026-09-10', art }),
          `${vertragsgrundlage}/${art}`,
        ).toBeNull();
      }
    }
  });

  it('und der Satz, der statt eines Datums erscheint, nennt beide Fristen und die Nummer',
    () => {
      expect(FRIST_OFFEN_TEXT).toContain('§ 13 Abs. 4 VOB/B');
      expect(FRIST_OFFEN_TEXT).toContain('§ 634a BGB');
      expect(FRIST_OFFEN_TEXT).toContain('O-154');
    });
});

describe('§ 12 VOB/B — was die Prüfung abweist', () => {
  it('eine gültige Eingabe geht durch', () => {
    expect(() => { pruefeAbnahme(GUELTIG); }).not.toThrow();
  });

  it('ein Datum, das kein Kalendertag ist', () => {
    for (const abnahmeAm of ['10.09.2026', '2026-9-10', 'heute', '']) {
      expect(() => { pruefeAbnahme({ ...GUELTIG, abnahmeAm }); }, abnahmeAm)
        .toThrow(AbnahmeFehler);
    }
  });

  it('eine Teilabnahme ohne Leistungsumfang (§ 12 Abs. 2)', () => {
    expect(() => {
      pruefeAbnahme({ ...GUELTIG, art: 'teilabnahme', leistungsumfang: null });
    }).toThrow(/§ 12 Abs. 2/u);
    // Auch Leerzeichen sind kein Leistungsumfang.
    expect(() => {
      pruefeAbnahme({ ...GUELTIG, art: 'teilabnahme', leistungsumfang: '   ' });
    }).toThrow(/§ 12 Abs. 2/u);
    expect(() => {
      pruefeAbnahme({ ...GUELTIG, art: 'teilabnahme', leistungsumfang: 'Bauteil A' });
    }).not.toThrow();
  });

  it('eine Verweigerung ohne Grund (§ 12 Abs. 3)', () => {
    expect(() => {
      pruefeAbnahme({ ...GUELTIG, abgenommen: false, verweigerungGrund: null });
    }).toThrow(/§ 12 Abs. 3/u);
    expect(() => {
      pruefeAbnahme({
        ...GUELTIG, abgenommen: false, verweigerungGrund: 'Wesentliche Mängel Achse C.',
      });
    }).not.toThrow();
  });

  it('einen Vorbehalt ohne Wortlaut (§ 11 Abs. 4) — beide Vorbehalte, einzeln', () => {
    expect(() => {
      pruefeAbnahme({ ...GUELTIG, vorbehaltVertragsstrafe: true, vorbehaltText: null });
    }).toThrow(/§ 11 Abs. 4/u);
    expect(() => {
      pruefeAbnahme({
        ...GUELTIG, vorbehaltVertragsstrafe: false, vorbehaltMaengel: true,
        vorbehaltText: '  ',
      });
    }).toThrow(/§ 11 Abs. 4/u);
    // KEIN Vorbehalt braucht keinen Wortlaut — und ist selbst eine Aussage.
    expect(() => {
      pruefeAbnahme({
        ...GUELTIG, vorbehaltVertragsstrafe: false, vorbehaltMaengel: false,
        vorbehaltText: null,
      });
    }).not.toThrow();
  });

  it('einen Mangel ohne Beschreibung und eine Frist, die kein Kalendertag ist', () => {
    expect(() => {
      pruefeAbnahme({
        ...GUELTIG,
        maengel: [{ beschreibung: '   ', fristAm: null, lvPositionId: null }],
      });
    }).toThrow(/ohne Beschreibung/u);
    expect(() => {
      pruefeAbnahme({
        ...GUELTIG,
        maengel: [{ beschreibung: 'Fuge', fristAm: '01.10.2026', lvPositionId: null }],
      });
    }).toThrow(/JJJJ-MM-TT/u);
  });

  it('und jede Ausnahme trägt einen Grund und einen Status', () => {
    try {
      pruefeAbnahme({ ...GUELTIG, art: 'teilabnahme', leistungsumfang: null });
      expect.unreachable('hätte werfen müssen');
    } catch (fehler: unknown) {
      expect(fehler).toBeInstanceOf(AbnahmeFehler);
      expect((fehler as AbnahmeFehler).grund).toBe('teil_ohne_umfang');
      // 422 und nicht 409: die Eingabe ist unvollständig, nicht der Zustand.
      expect((fehler as AbnahmeFehler).status).toBe(422);
    }
  });
});

describe('die vier Arten des § 12 VOB/B', () => {
  it('sind genau diese vier — und `istAbnahmeArt` lässt keine fünfte durch', () => {
    expect([...ABNAHME_ARTEN])
      .toEqual(['foermlich', 'fiktiv', 'konkludent', 'teilabnahme']);
    for (const art of ABNAHME_ARTEN) expect(istAbnahmeArt(art)).toBe(true);
    for (const nein of ['foerml', 'FOERMLICH', '', 'abnahme', null, 42, undefined]) {
      expect(istAbnahmeArt(nein), String(nein)).toBe(false);
    }
  });
});

describe('§10.4 — der Schnappschuss', () => {
  const kopf = {
    projekt: 'Rohbau Nord', projektNummer: 'P-1', kunde: 'Bauherr Nord',
    art: 'foermlich' as const, abnahmeAm: '10.09.2026',
    leistungsumfang: null, abgenommen: true, verweigerungGrund: null,
    vorbehaltVertragsstrafe: true, vorbehaltMaengel: false,
    vorbehaltText: 'Vertragsstrafe bleibt vorbehalten.',
    teilnehmer: ['Frau Beyer', 'Herr Schulz'],
  };

  it('trägt die Vorbehalte ALS WORT — „nein" steht im Beweis, nicht in einer Auslassung',
    () => {
      const wert = baueAbnahmeSchnappschuss(
        { ...kopf, vorbehaltVertragsstrafe: false }, []) as Record<string, unknown>;
      const inneres = wert['kopf'] as Record<string, unknown>;
      expect(inneres['vorbehaltVertragsstrafe']).toBe('nein');
      expect(inneres['abgenommen']).toBe('ja');
    });

  it('enthält keine einzige Zahl — `kanonischesJson` würde sie abweisen', () => {
    const wert = baueAbnahmeSchnappschuss(kopf, [
      { reihenfolge: '1', beschreibung: 'Fuge Achse C', oz: '1.1', fristAm: '2026-10-01' },
    ]);
    const zahlen: string[] = [];
    const gehe = (x: unknown, pfad: string): void => {
      if (typeof x === 'number') { zahlen.push(pfad); return; }
      if (Array.isArray(x)) { x.forEach((y, i) => { gehe(y, `${pfad}[${String(i)}]`); }); return; }
      if (x !== null && typeof x === 'object') {
        for (const [k, v] of Object.entries(x)) gehe(v, `${pfad}.${k}`);
      }
    };
    gehe(wert, '');
    expect(zahlen).toEqual([]);
    // Und der Digest lässt sich bilden — er würde bei einer `number` werfen.
    expect(abnahmeSchnappschussHash(wert)).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('ist nachrechenbar: derselbe Inhalt, derselbe Digest', () => {
    const maengel = [
      { reihenfolge: '1', beschreibung: 'Fuge Achse C', oz: '1.1', fristAm: '2026-10-01' },
      { reihenfolge: '2', beschreibung: 'Bauschutt', oz: null, fristAm: null },
    ];
    const a = abnahmeSchnappschussHash(baueAbnahmeSchnappschuss(kopf, maengel));
    const b = abnahmeSchnappschussHash(
      baueAbnahmeSchnappschuss({ ...kopf }, maengel.map((m) => ({ ...m }))));
    expect(a).toBe(b);
  });

  it('und jede rechtlich erhebliche Änderung ändert ihn', () => {
    const grund = abnahmeSchnappschussHash(baueAbnahmeSchnappschuss(kopf, []));
    const anders = [
      { ...kopf, vorbehaltVertragsstrafe: false },
      { ...kopf, vorbehaltMaengel: true },
      { ...kopf, abgenommen: false, verweigerungGrund: 'Mängel' },
      { ...kopf, abnahmeAm: '11.09.2026' },
      { ...kopf, art: 'teilabnahme' as const, leistungsumfang: 'Bauteil A' },
      { ...kopf, teilnehmer: ['Frau Beyer'] },
      { ...kopf, vorbehaltText: 'anderer Wortlaut' },
    ];
    for (const [i, k] of anders.entries()) {
      expect(abnahmeSchnappschussHash(baueAbnahmeSchnappschuss(k, [])), String(i))
        .not.toBe(grund);
    }
    // Und ein zusätzlicher Mangel ebenso: die Liste IST Teil des Protokolls.
    expect(abnahmeSchnappschussHash(baueAbnahmeSchnappschuss(kopf, [
      { reihenfolge: '1', beschreibung: 'Fuge', oz: null, fristAm: null },
    ]))).not.toBe(grund);
  });
});
