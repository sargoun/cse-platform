/**
 * Die zwei Turnusseiten zeigen nichts, was in ihrer ADRESSE stand — auch
 * nicht über einen Umweg durch einen Dienst (V-275 Nachtrag, D-773, D-769).
 *
 * **Der Befund.** (1) Die Serienliste zeigte `?uebersprungen=` als Wort:
 * `…/reinigung/turnus?angelegt=1&uebersprungen=Ihr%20Vertrag%20ist%20gek%C3%BCndigt`
 * stand als „Übersprungen: Ihr Vertrag ist gekündigt" im grünen Kasten.
 * (2) Die Vorschau auf `/turnus/neu` zeigte die Meldung des Dienstes:
 * `?vorschau=1&wochentag=<Text>` ergab „„<Text>" ist kein Wochentag (MO … SU).",
 * `?gueltig_ab=<Text>` einen Satz mit Feldnamen des Quelltexts und dem Text —
 * und ein `?gueltig_ab=` aus Buchstaben liess `tagePlus` werfen: die Seite war
 * eine Fehlerseite.
 *
 * Geprüft wird mit präparierten Adressen, durch dieselben Funktionen, die die
 * Seiten rufen — die Regel und die Vorschau sind die ECHTEN Dienste —, dazu
 * am Quelltext, dass beide Seiten nur diese Antworten zeigen.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { eigenerEintrag } from '../../src/lib/nachschlagen.js';
import { tagePlus } from '../../src/lib/datum/kalendertag.js';
import {
  TURNUS_ANLAGE_TEXTE, TURNUS_LISTE_TEXTE,
} from '../../src/lib/i18n/verwaltung/reinigung.js';
import { GENERATOR_UEBERSPRUNGEN } from '../../src/server/services/dienstplan/generator.js';
import { turnusRegel } from '../../src/server/services/dienstplan/serie.js';
import { turnusVorschau } from '../../src/server/services/reinigung/turnusvorschau.js';
import {
  anlageRueckmeldung, vorschauFehlerSatz, vorschauFenster,
} from '../../src/app/portal/[mandant]/reinigung/turnus/rueckmeldung.js';
import { pruefeSaetze, pruefeSeite, WURZEL } from './hilfen/rueckweg-betrieb.js';

/** Eine präparierte Adresse, wie Next.js sie der Seite als `searchParams` gibt. */
function adresse(suche: string): Record<string, string | string[]> {
  const aus: Record<string, string | string[]> = {};
  for (const [k, v] of new URLSearchParams(suche)) {
    const da = aus[k];
    aus[k] = da === undefined ? v : [...(Array.isArray(da) ? da : [da]), v];
  }
  return aus;
}

const FREMD = ['Ihr Vertrag ist gekündigt.', '<script>alert(1)</script>', '__proto__',
  'constructor', 'toString', 'objekt_ohne_kunde_x'];

describe('die Serienliste: ?uebersprungen= wird ein Satz, nie das Wort', () => {
  it('ohne `angelegt` kein Kasten', () => {
    expect(anlageRueckmeldung(adresse(''))).toBeNull();
    expect(anlageRueckmeldung(adresse('uebersprungen=feiertag&erzeugt=3'))).toBeNull();
  });

  it('jeder Grund des Generators wird sein Satz', () => {
    for (const grund of GENERATOR_UEBERSPRUNGEN) {
      const r = anlageRueckmeldung(adresse(`angelegt=1&erzeugt=0&uebersprungen=${grund}`));
      expect(r?.uebersprungen, grund).toBe(TURNUS_LISTE_TEXTE.de.gruende[grund]);
      expect(r?.uebersprungen, grund).not.toContain(grund);
    }
  });

  it.each(FREMD)('präpariert: uebersprungen=%s → der allgemeine Satz', (fremd) => {
    const r = anlageRueckmeldung(adresse(
      `angelegt=1&erzeugt=0&uebersprungen=${encodeURIComponent(fremd)}`));
    expect(r?.uebersprungen).toBe(TURNUS_LISTE_TEXTE.de.sonst);
    expect(r?.uebersprungen).not.toContain(fremd);
  });

  it('die Anzahl reist nur als Ziffernfolge — sonst meldet die Liste, dass sie fehlt', () => {
    expect(anlageRueckmeldung(adresse('angelegt=1&erzeugt=12'))?.erzeugt).toBe(12);
    for (const roh of ['<b>7</b>', '7 Schichten', '-1', '1e3', '0x10', '']) {
      expect(anlageRueckmeldung(adresse(`angelegt=1&erzeugt=${encodeURIComponent(roh)}`))?.erzeugt,
        roh).toBeNull();
    }
    expect(anlageRueckmeldung(adresse('angelegt=1&bestand=1'))?.bestandSchon).toBe(true);
    expect(anlageRueckmeldung(adresse('angelegt=1&bestand=ja'))?.bestandSchon).toBe(false);
  });

  it('jeder Grund hat einen Satz — ohne Schlüssel, ohne Platzhalter', () => {
    const t = TURNUS_LISTE_TEXTE.de;
    pruefeSaetze({ de: { titel: 'Übersprungen:', sonst: t.sonst, fehler: t.gruende } },
      GENERATOR_UEBERSPRUNGEN);
  });
});

describe('die Vorschau auf /turnus/neu: der Satz zum Grund, nie die Meldung', () => {
  /** Die Regel, wie die Seite sie aus der Adresse baut — und was dann dasteht. */
  function regelSatz(suche: string): string | null {
    const a = adresse(suche);
    const viele = (k: string): string[] => {
      const w = a[k];
      return w === undefined ? [] : Array.isArray(w) ? w : [w];
    };
    const einer = (k: string): string | null => viele(k)[0] ?? null;
    try {
      turnusRegel({
        frequenz: einer('frequenz') === 'monatlich' ? 'monatlich' : 'woechentlich',
        wochentage: viele('wochentag'),
        monatstage: viele('monatstag').map(Number).filter((n) => Number.isInteger(n)),
        interval: Number(einer('interval') ?? '1'),
      });
      return null;
    } catch (fehler) {
      return vorschauFehlerSatz(fehler);
    }
  }

  it('präpariert: ?wochentag=<Text> → der Satz zu `wochentag_unbekannt`, ohne den Text', () => {
    const satz = regelSatz(`vorschau=1&wochentag=${encodeURIComponent('Ihr Vertrag ist gekündigt')}`);
    expect(satz).toBe(TURNUS_ANLAGE_TEXTE.de.fehler.wochentag_unbekannt);
    expect(satz).not.toContain('gekündigt');
  });

  it('präpariert: Monatstag 99, Intervall 0, kein Wochentag — je ihr Satz', () => {
    expect(regelSatz('vorschau=1&frequenz=monatlich&monatstag=99'))
      .toBe(TURNUS_ANLAGE_TEXTE.de.fehler.monatstag_unbekannt);
    expect(regelSatz('vorschau=1&wochentag=MO&interval=0'))
      .toBe(TURNUS_ANLAGE_TEXTE.de.fehler.intervall_ungueltig);
    expect(regelSatz('vorschau=1')).toBe(TURNUS_ANLAGE_TEXTE.de.fehler.wochentag_fehlt);
    expect(regelSatz('vorschau=1&wochentag=MO&wochentag=WE')).toBeNull();
  });

  it('präpariert: ?gueltig_ab=<Text> — die Vorschau weist ab, die Seite sagt ihren Satz', () => {
    const heute = '2026-09-29';
    let satz: string | null = null;
    try {
      turnusVorschau({
        rrule: 'FREQ=WEEKLY;BYDAY=MO', dtstartLokal: { datum: 'Hallo Welt', stunde: 6, minute: 0 },
        dauerMinuten: 240, feiertagsregel: 'ausfall', gueltigAb: 'Hallo Welt', gueltigBis: null,
      }, [], new Map(), vorschauFenster('Hallo Welt', heute, 28));
    } catch (fehler) {
      /* Die Meldung des Dienstes trug beides: Feldnamen und den Text aus der Adresse. */
      expect((fehler as Error).message).toContain('Hallo Welt');
      satz = vorschauFehlerSatz(fehler);
    }
    expect(satz).toBe(TURNUS_ANLAGE_TEXTE.de.vorschauSonst);
    expect(satz).not.toMatch(/Hallo|traeger|Kalendertag:/u);
    expect(vorschauFehlerSatz('kein Fehler, nur Text')).toBe(TURNUS_ANLAGE_TEXTE.de.vorschauSonst);
  });

  it('präpariert: ein ?gueltig_ab= aus Buchstaben bringt das Fenster nicht mehr zum Absturz', () => {
    /* VORHER rechnete die Seite `tagePlus(gueltigAb)` — und das wirft. */
    expect(() => tagePlus('Hallo', 28)).toThrow();
    expect(vorschauFenster('Hallo', '2026-09-29', 28))
      .toEqual({ vonDatum: '2026-09-29', bisDatum: '2026-10-27' });
    expect(vorschauFenster('2026-02-31', '2026-01-10', 28).vonDatum).toBe('2026-01-10');
    // Review V-275: ein Beginn, dessen Fenster über 9999-12-31 hinausliefe, gilt wie ein ungültiger.
    expect(vorschauFenster('9999-12-04', '2026-09-29', 28)).toEqual({ vonDatum: '2026-09-29', bisDatum: '2026-10-27' });
    expect(vorschauFenster('9999-12-31', '2026-09-29', 28).vonDatum).toBe('2026-09-29');
    expect(vorschauFenster('9999-12-03', '2026-09-29', 28)).toEqual({ vonDatum: '9999-12-03', bisDatum: '9999-12-31' });
    expect(vorschauFenster('2026-10-05', '2026-09-29', 28))
      .toEqual({ vonDatum: '2026-10-05', bisDatum: '2026-11-02' });
    expect(vorschauFenster('2026-09-01', '2026-09-29', 28).vonDatum).toBe('2026-09-29');
  });

  it('jeder Satz der Regel steht in der Tabelle — die Vorschau braucht keinen eigenen', () => {
    expect(TURNUS_ANLAGE_TEXTE.de.vorschauSonst.trim()).not.toBe('');
    for (const g of ['wochentag_unbekannt', 'wochentag_fehlt', 'monatstag_unbekannt',
      'monatstag_fehlt', 'intervall_ungueltig'] as const) {
      expect(eigenerEintrag(TURNUS_ANLAGE_TEXTE.de.fehler, g), g).toBeTruthy();
    }
  });
});

describe('die Seiten zeigen nur diese Antworten', () => {
  const lies = (pfad: string): string => readFileSync(resolve(WURZEL, pfad), 'utf8');

  it('die Serienliste liest ihre Adresse nur über `anlageRueckmeldung`', () => {
    const pfad = 'src/app/portal/[mandant]/reinigung/turnus/page.tsx';
    pruefeSeite(pfad, ['anlageRueckmeldung(await searchParams)', 'rolle="status"']);
    expect(lies(pfad)).not.toMatch(/\['uebersprungen'\]|einzeln\('uebersprungen'\)/u);
  });

  it('/turnus/neu zeigt nie `fehler.message` — weder unter der Regel noch unter der Vorschau', () => {
    const pfad = 'src/app/portal/[mandant]/reinigung/turnus/neu/page.tsx';
    const quelle = lies(pfad);
    expect(quelle).not.toMatch(/fehler\.message|String\(fehler\)/u);
    expect(quelle.match(/vorschauFehlerSatz\(fehler\)/gu)?.length).toBe(2);
    expect(quelle).toContain('vorschauFenster(gueltigAb, heute, VORSCHAU_TAGE)');
    expect(quelle).not.toMatch(/tagePlus\(/u);
    pruefeSeite(pfad, ['eigenerEintrag(tA.fehler, fehlerAusApi) ?? tA.sonst']);
  });
});
