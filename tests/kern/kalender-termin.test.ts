/**
 * Die Felder eines eigenen Termins und ihre Zeit — ohne Datenbank
 * (CAL-01, V-221, D-715, Invariante 2).
 *
 * Die vier Zeitfälle aus CLAUDE.md („Test before UI for money and time")
 * gelten hier sinngemäss: ein Termin über Mitternacht, einer in der Nacht der
 * Sommerzeit, einer in der Nacht der Winterzeit, und der ganztägige Tag, der
 * an einem Umstellungstag 23 oder 25 Stunden hat. Die Dauer ist in jedem Fall
 * die Differenz zweier Instants.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  EIGENE_ARTEN, TerminFehler, leseTerminZeiten, mitGespeichertenZeiten, pruefeTermin,
  teilnehmerNachAenderung, type TerminEingabe,
} from '../../src/server/services/kalender/termin.js';
import { KALENDER_TERMIN_TEXTE } from '../../src/lib/i18n/verwaltung/kalender-termin.js';

const STUNDE = 3600 * 1000;

function eingabe(ueber: Partial<TerminEingabe> = {}): TerminEingabe {
  return {
    art: 'besprechung', titel: 'Objektleitungsrunde', beschreibung: '', ort: '',
    beginn: new Date('2026-09-01T07:00:00Z'), ende: new Date('2026-09-01T08:00:00Z'),
    ganztaegig: false, teilnehmer: [], ...ueber,
  };
}

describe('die Felder', () => {
  it('nur die drei Arten, die der Kalender besitzt — nie Wiedervorlage oder Gespräch', () => {
    expect([...EIGENE_ARTEN]).toEqual(['besprechung', 'kundentermin', 'sonstiges']);
    for (const art of ['wiedervorlage', 'bewerbungsgespraech', '']) {
      expect(() => pruefeTermin(eingabe({ art })), art).toThrow(TerminFehler);
    }
  });

  it('Titel Pflicht, Ende nach Beginn, Teilnehmende nur als Kennung', () => {
    expect(() => pruefeTermin(eingabe({ titel: '   ' })))
      .toThrow(expect.objectContaining({ grund: 'titel_fehlt' }) as Error);
    expect(() => pruefeTermin(eingabe({ ende: new Date('2026-09-01T07:00:00Z') })))
      .toThrow(expect.objectContaining({ grund: 'ende_vor_beginn' }) as Error);
    expect(() => pruefeTermin(eingabe({ teilnehmer: ['keine-kennung'] })))
      .toThrow(expect.objectContaining({ grund: 'teilnehmer_unbekannt' }) as Error);
    const k = '00000000-0000-4000-8000-000000000001';
    expect(pruefeTermin(eingabe({ teilnehmer: [k, k, ' '] })).teilnehmer).toEqual([k]);
    expect(pruefeTermin(eingabe({ ort: '  ', beschreibung: '' }))).toMatchObject({
      ort: null, beschreibung: null,
    });
  });
});

describe('die Zeit — Berliner Wanduhr rein, Instants raus (Invariante 2)', () => {
  it('22:00–06:00 über Mitternacht: acht Stunden', () => {
    const z = leseTerminZeiten({
      ganztaegig: false, beginn: '2026-09-01T22:00', ende: '2026-09-02T06:00',
    });
    expect(z.beginn.toISOString()).toBe('2026-09-01T20:00:00.000Z');
    expect(z.ende.getTime() - z.beginn.getTime()).toBe(8 * STUNDE);
  });

  it('Nacht der Sommerzeit: 01:00–04:00 sind zwei Stunden, nicht drei', () => {
    const z = leseTerminZeiten({
      ganztaegig: false, beginn: '2026-03-29T01:00', ende: '2026-03-29T04:00',
    });
    expect(z.ende.getTime() - z.beginn.getTime()).toBe(2 * STUNDE);
  });

  it('Nacht der Winterzeit: 01:00–04:00 sind vier Stunden, nicht drei', () => {
    const z = leseTerminZeiten({
      ganztaegig: false, beginn: '2026-10-25T01:00', ende: '2026-10-25T04:00',
    });
    expect(z.ende.getTime() - z.beginn.getTime()).toBe(4 * STUNDE);
  });

  it('ganztägig: Berliner Mitternacht bis Mitternacht NACH dem letzten Tag', () => {
    const sommer = leseTerminZeiten({ ganztaegig: true, vonTag: '2026-03-29' });
    expect(sommer.beginn.toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect(sommer.ende.getTime() - sommer.beginn.getTime()).toBe(23 * STUNDE);
    const winter = leseTerminZeiten({ ganztaegig: true, vonTag: '2026-10-25', bisTag: '2026-10-25' });
    expect(winter.ende.getTime() - winter.beginn.getTime()).toBe(25 * STUNDE);
    const drei = leseTerminZeiten({ ganztaegig: true, vonTag: '2026-07-12', bisTag: '2026-07-14' });
    expect(drei.ende.toISOString()).toBe('2026-07-14T22:00:00.000Z');
  });

  it('einen Tag, den es nicht gibt, weist die Lesart ab — mit Grund', () => {
    expect(() => leseTerminZeiten({ ganztaegig: true, vonTag: '2026-02-30' }))
      .toThrow(expect.objectContaining({ grund: 'kein_kalendertag' }) as Error);
    expect(() => leseTerminZeiten({ ganztaegig: false, beginn: 'morgen', ende: '' }))
      .toThrow(expect.objectContaining({ grund: 'zeitpunkt_unlesbar' }) as Error);
  });
});

/**
 * **Niemand fällt still heraus** (V-267, D-760). Die Auswahl entscheidet nur
 * über die Menschen, die das Formular angeboten hat; wer nicht angeboten war,
 * bleibt, wie er war. Vorher ersetzte die Auswahl die Teilnehmenden ganz —
 * und die ändernde Person, die sich selbst nie angeboten sieht, fiel heraus.
 */
describe('die Teilnehmenden nach einer Änderung', () => {
  const A = '00000000-0000-4000-8000-00000000000a';   // führt
  const B = '00000000-0000-4000-8000-00000000000b';   // ändert, nimmt teil
  const C = '00000000-0000-4000-8000-00000000000c';
  const D = '00000000-0000-4000-8000-00000000000d';

  it('die ändernde Teilnehmerin wird nicht angeboten — und bleibt', () => {
    expect(teilnehmerNachAenderung({
      vorher: [A, B, C], angeboten: new Set([A, C, D]), auswahl: [C], fuehrend: A,
    })).toEqual([A, B, C]);
  });

  it('wer angeboten war und nicht mehr angehakt ist, fällt heraus — ausdrücklich', () => {
    expect(teilnehmerNachAenderung({
      vorher: [A, C], angeboten: new Set([C, D]), auswahl: [D], fuehrend: A,
    })).toEqual([A, D]);
  });

  it('ohne Auswahl (kein Recht, die Namen zu lesen) bleiben alle, wie sie waren', () => {
    expect(teilnehmerNachAenderung({
      vorher: [A, B, C], angeboten: new Set(), auswahl: [], fuehrend: A,
    })).toEqual([A, B, C]);
  });

  it('die führende Person steht immer darin, und nichts doppelt', () => {
    expect(teilnehmerNachAenderung({
      vorher: [B], angeboten: new Set([A, B]), auswahl: [C, C], fuehrend: A,
    })).toEqual([A, C]);
    expect(teilnehmerNachAenderung({
      vorher: [], angeboten: new Set(), auswahl: [], fuehrend: null,
    })).toEqual([]);
  });
});

/**
 * **Die Maske, die D-715 Nr. 6 zusagt** (V-267, D-760). Die Routen schickten
 * die Eingaben mit — `/kalender/[id]` belegte das Formular trotzdem immer aus
 * der Datenbank, und `/kalender/neu` verlor die Teilnehmenden.
 */
describe('nach einer Abweisung stehen die Eingaben wieder da', () => {
  it('beide Routen schicken Textfelder UND die Auswahl der Teilnehmenden mit', () => {
    for (const route of ['src/app/api/kalender/eintraege/route.ts',
      'src/app/api/kalender/eintraege/[id]/route.ts']) {
      const quelle = readFileSync(route, 'utf8');
      expect(quelle, route).toContain('maskeFelder: TERMIN_MASKE');
      expect(quelle, route).toContain('maskeListen: TERMIN_MASKE_LISTEN');
    }
    expect(readFileSync('src/app/api/kalender/eintraege/termin-rumpf.ts', 'utf8'))
      .toMatch(/TERMIN_MASKE_LISTEN = \['teilnehmer'\]/u);
  });

  it('beide Seiten lesen die Maske — /kalender/[id] ausser bei „gleichzeitig"', () => {
    const neu = readFileSync('src/app/portal/[mandant]/kalender/neu/page.tsx', 'utf8');
    expect(neu).toContain("vorbelegteListe(suche, 'teilnehmer')");
    const blatt = readFileSync('src/app/portal/[mandant]/kalender/[id]/page.tsx', 'utf8');
    expect(blatt).toMatch(/mitEingaben = fehler !== null && fehler !== 'gleichzeitig'/u);
    expect(blatt).toContain("vorbelegteListe(suche, 'teilnehmer')");
    expect(blatt).toContain('werte={werte}');
  });
});

/**
 * Der Filter heisst auf `/kalender` in jeder Sprache „Nur meine" — die Seite
 * steht auf der Ausnahmeliste und ist deutsch. Ein englischer Satz, der
 * „Only mine" nennt, verweist auf einen Knopf, den es so nicht gibt
 * (V-267, Prüfung der Gruppe kalender-dokumente).
 */
describe('die Hinweise nennen nur, was die Seite zeigt', () => {
  it('kein englischer Satz nennt einen Filter „Only mine"', () => {
    const uebersicht = readFileSync('src/app/portal/[mandant]/kalender/page.tsx', 'utf8');
    expect(uebersicht).toContain('Nur meine');
    expect(uebersicht).not.toContain('Only mine');
    for (const [schluessel, text] of Object.entries(KALENDER_TERMIN_TEXTE.en)) {
      if (typeof text === 'string') expect(text, schluessel).not.toMatch(/only mine/iu);
    }
    expect(KALENDER_TERMIN_TEXTE.en.teilnehmendeHinweis).toContain('in their own view');
  });

  it('ohne kalender.schreiben: „…, wer" + Recht + „hält." — und englisch ein ganzer Satz', () => {
    expect(KALENDER_TERMIN_TEXTE.de.ohneRechtVor).toMatch(/, wer$/u);
    expect(KALENDER_TERMIN_TEXTE.de.ohneRechtNach).toBe('hält.');
    expect(KALENDER_TERMIN_TEXTE.en.ohneRechtNach).toMatch(/^[a-z].*\.$/u);
  });
});

/**
 * Die Spur führt zur Portalwurzel (PortalRahmen) und heisst deshalb wie das
 * Modul — nicht „Zum Kalender", was ein anderes Ziel verspricht als der
 * gleichlautende Link darunter (WCAG 2.4.4; V-267, Prüfung der Gruppe
 * kalender-dokumente).
 */
describe('/kalender/neu: die Spur trägt den Modulnamen', () => {
  it('wurzelTitel ist t.modul — Kalender / Calendar; „Zum Kalender" bleibt der Link zu /kalender', () => {
    const seite = readFileSync('src/app/portal/[mandant]/kalender/neu/page.tsx', 'utf8');
    expect(seite).toContain('wurzelTitel={t.modul}');
    expect(seite).not.toContain('wurzelTitel={t.zumKalender}');
    const link = seite.slice(seite.indexOf('data-cse="zum-kalender"') - 120);
    expect(link).toMatch(/href=\{alsRoute\(`\/portal\/\$\{mandant\}\/kalender`\)\}/u);
    expect(KALENDER_TERMIN_TEXTE.de.modul).toBe('Kalender');
    expect(KALENDER_TERMIN_TEXTE.en.modul).toBe('Calendar');
  });
});

/**
 * **Eine unveränderte Zeit bleibt, wie sie gespeichert ist** (V-267, D-760
 * Nr. 10). Ein Termin in der zweiten 02:xx der Rückstellungsnacht zeigt im
 * Formular dieselbe Wanduhr wie die erste; unverändert zurückgeschickt, rückte
 * er ohne diese Regel eine Stunde vor.
 */
describe('mitGespeichertenZeiten', () => {
  const zweite = { beginn: new Date('2026-10-25T01:30:00Z'), ende: new Date('2026-10-25T02:30:00Z') };

  function aufgeloest(beginn: string, ende: string): { beginn: Date; ende: Date } {
    const z = leseTerminZeiten({ ganztaegig: false, beginn, ende });
    return { beginn: z.beginn, ende: z.ende };
  }

  it('dieselbe Wanduhr: der gespeicherte Zeitpunkt bleibt — auch in der zweiten 02:30', () => {
    const neu = aufgeloest('2026-10-25T02:30', '2026-10-25T03:30');
    expect(neu.beginn.toISOString()).toBe('2026-10-25T00:30:00.000Z');
    const t = mitGespeichertenZeiten(neu, zweite);
    expect(t.beginn).toBe(zweite.beginn);
    expect(t.ende).toBe(zweite.ende);
  });

  it('eine geänderte Zeit löst das Formular auf; die unveränderte bleibt', () => {
    const t = mitGespeichertenZeiten(aufgeloest('2026-10-25T02:30', '2026-10-25T04:00'), zweite);
    expect(t.beginn).toBe(zweite.beginn);
    expect(t.ende.toISOString()).toBe('2026-10-25T03:00:00.000Z');
  });

  it('ergäbe das kein Intervall, gilt die Auflösung des Formulars für beide', () => {
    const neu = aufgeloest('2026-10-25T02:30', '2026-10-25T02:45');
    const t = mitGespeichertenZeiten(neu, zweite);
    expect([t.beginn.toISOString(), t.ende.toISOString()])
      .toEqual(['2026-10-25T00:30:00.000Z', '2026-10-25T00:45:00.000Z']);
  });

  it('an einem gewöhnlichen Tag ändert die Regel nichts', () => {
    const vorher = { beginn: new Date('2026-09-01T07:00:00Z'), ende: new Date('2026-09-01T08:00:00Z') };
    const gleich = aufgeloest('2026-09-01T09:00', '2026-09-01T10:00');
    expect(mitGespeichertenZeiten(gleich, vorher)).toEqual({ ...gleich, ...vorher });
    const spaeter = aufgeloest('2026-09-01T11:00', '2026-09-01T12:00');
    expect(mitGespeichertenZeiten(spaeter, vorher)).toEqual(spaeter);
  });
});
