/**
 * Die drei Systemmeldungen, die einen ARBEITER erreichen, stehen in vier
 * Sprachen — und die übrigen bleiben deutsch (V-102, NOT-01, SPEC §10).
 *
 * **Der Befund.** `benachrichtigung` trägt GESPEICHERTEN Text: Titel und Text
 * entstehen beim Erzeugen und stehen danach fest. Sie entstanden hart
 * deutsch — auch die Ablaufwarnung eines Nachweises, die eine Sperre nach
 * § 34a GewO ankündigt. Wer sie nicht lesen kann, erscheint zur Schicht und
 * wird weggeschickt.
 *
 * **Warum das ohne Prüfstück wiederkäme.** Eine fehlende Übersetzung wirft
 * nichts und färbt nichts rot; sie sieht aus wie ein Text. Der teuerste Fall
 * ist noch leiser: ein vergessener Platzhalter. `'Belge {tage} gün içinde'`
 * ohne `{tage}` ergibt einen Satz, der gelesen werden kann und eine Zahl
 * verschweigt — und die Zahl ist hier die Frist.
 *
 * Geprüft wird deshalb in beide Richtungen: dass die vier Sprachen dieselbe
 * Form haben (§1–§3), dass die drei Arten sie wirklich benutzen (§4), dass
 * alle ANDEREN Arten unberührt deutsch bleiben (§5) — und dass eingesetzter
 * Text nicht übersetzt wird (§7).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BENACHRICHTIGUNG_TEXTE, setze, texteFuer,
} from '../../src/lib/i18n/benachrichtigung.js';
import { PORTAL_SPRACHEN } from '../../src/lib/i18n/texte.js';
import { alleArten } from '../../src/server/benachrichtigung/bootstrap.js';
import {
  findeArt, leereArten,
  type ArtDefinition, type BenachrichtigungsKontext,
} from '../../src/server/benachrichtigung/registry.js';
import { artSchluessel } from '../../src/server/services/nachweis/benachrichtigung.js';
import { ART_EINWAND_ENTSCHIEDEN } from '../../src/server/services/zeit/benachrichtigung.js';
import { ART_PLAN_VEROEFFENTLICHT }
  from '../../src/server/services/dienstplan/benachrichtigung.js';

/** Die drei Arten, die in `/portal/mein` landen — und sonst keine. */
const ARBEITERARTEN: readonly string[] = [
  artSchluessel(60), artSchluessel(30), artSchluessel(7),
  ART_EINWAND_ENTSCHIEDEN, ART_PLAN_VEROEFFENTLICHT,
];

/** Alle Blätter eines Texthaufens als `gruppe.feld` → Zeichenkette. */
function blaetter(sprache: string): ReadonlyMap<string, string> {
  const raus = new Map<string, string>();
  const wurzel = BENACHRICHTIGUNG_TEXTE[sprache as 'de'];
  for (const [gruppe, felder] of Object.entries(wurzel)) {
    for (const [feld, wert] of Object.entries(felder as Record<string, string>)) {
      raus.set(`${gruppe}.${feld}`, wert);
    }
  }
  return raus;
}

/** Die Platzhalter eines Textes, sortiert und ohne Dopplung. */
function platzhalter(text: string): readonly string[] {
  return [...new Set(text.match(/\{[a-zA-Z]+\}/gu) ?? [])].sort();
}

function kontext(mehr: Partial<BenachrichtigungsKontext> = {}): BenachrichtigungsKontext {
  return {
    mandantId: 'm1', mandantSlug: 'reinigung',
    objektTyp: 'x', objektId: 'id1', daten: {}, ...mehr,
  };
}

beforeEach(() => { leereArten(); alleArten(); });

function art(schluessel: string): ArtDefinition {
  const a = findeArt(schluessel);
  expect(a, schluessel).toBeDefined();
  return a!;
}

// ---------------------------------------------------------------------------

describe('§1 vier Sprachen, eine Form', () => {
  it('jede Portalsprache hat einen Eintrag', () => {
    expect(Object.keys(BENACHRICHTIGUNG_TEXTE).sort())
      .toEqual([...PORTAL_SPRACHEN].sort());
  });

  it('alle vier tragen dieselben Felder — kein Feld fehlt, keines ist zuviel', () => {
    const deutsch = [...blaetter('de').keys()].sort();
    for (const s of PORTAL_SPRACHEN) {
      expect([...blaetter(s).keys()].sort(), s).toEqual(deutsch);
    }
  });

  it('kein Feld ist leer — eine leere Zeile im Posteingang deutet niemand', () => {
    for (const s of PORTAL_SPRACHEN) {
      for (const [pfad, wert] of blaetter(s)) {
        expect(wert.trim(), `${s}.${pfad}`).not.toBe('');
      }
    }
  });
});

describe('§2 die Platzhalter halten über alle Sprachen', () => {
  it('jedes Feld führt in jeder Sprache DIESELBEN Platzhalter', () => {
    /*
     * Das ist der teure Fehler: ein Text, der sich lesen lässt und eine Zahl
     * verschweigt. Er wirft nichts, er faellt nicht auf, und die verschwiegene
     * Zahl ist bei `nachweisAblauf` die Frist.
     */
    for (const [pfad, deutsch] of blaetter('de')) {
      const erwartet = platzhalter(deutsch);
      for (const s of PORTAL_SPRACHEN) {
        expect(platzhalter(blaetter(s).get(pfad) ?? ''), `${s}.${pfad}`).toEqual(erwartet);
      }
    }
  });

  it('`setze` ersetzt jedes Vorkommen und lässt Unbekanntes stehen', () => {
    expect(setze('{a}-{a}-{b}', { a: '1', b: 2 })).toBe('1-1-2');
    // Stehen lassen ist Absicht: ein vergessener Platzhalter faellt so als
    // `{name}` auf, statt als fehlendes Wort.
    expect(setze('{a}-{c}', { a: '1' })).toBe('1-{c}');
  });
});

describe('§3 in keiner Sprache bleibt ein Platzhalter im fertigen Text stehen', () => {
  const VOLL: Readonly<Record<string, Record<string, unknown>>> = {
    [artSchluessel(60)]: { bezeichnung: 'Sachkunde § 34a', gueltigBis: '2026-08-01',
                           blockiertEinsatz: true },
    [artSchluessel(30)]: { bezeichnung: 'Erste Hilfe', gueltigBis: '2026-08-01',
                           blockiertEinsatz: false },
    [artSchluessel(7)]: { bezeichnung: 'Sachkunde § 34a', gueltigBis: '2026-08-01',
                          blockiertEinsatz: true },
    [ART_EINWAND_ENTSCHIEDEN]: { status: 'teilweise_anerkannt', betrifftDatum: '11.03.2026',
                                 begruendung: 'Die Pause stand so im Plan.',
                                 zeiteintragId: 'z1' },
    [ART_PLAN_VEROEFFENTLICHT]: { zeitraum: '15.05.2028 bis 21.05.2028', schichten: 4,
                                  gesellschaft: 'CSE Dienstleistungen GmbH' },
  };

  it('Titel und Text sind vollständig eingesetzt', () => {
    for (const schluessel of ARBEITERARTEN) {
      const a = art(schluessel);
      for (const s of PORTAL_SPRACHEN) {
        /* `?? {}` wegen `noUncheckedIndexedAccess`: ein Indexzugriff liefert
           hier `… | undefined`, und `exactOptionalPropertyTypes` laesst
           `undefined` fuer ein Pflichtfeld nicht durch. */
        const k = kontext({ sprache: s, daten: VOLL[schluessel] ?? {} });
        expect(a.titel(k), `${s} ${schluessel} titel`).not.toMatch(/\{[a-zA-Z]+\}/u);
        expect(a.text(k), `${s} ${schluessel} text`).not.toMatch(/\{[a-zA-Z]+\}/u);
        expect(a.titel(k).trim(), `${s} ${schluessel}`).not.toBe('');
      }
    }
  });

  it('auch mit LEEREN Daten — die Vorschau auf der Einstellungsseite ruft so', () => {
    /* `/portal/konto/benachrichtigungen` rendert den Beispieltext mit
       `daten: {}`. Ein Absturz dort wäre eine weisse Seite für eine
       Einstellung. */
    for (const schluessel of ARBEITERARTEN) {
      const a = art(schluessel);
      for (const s of PORTAL_SPRACHEN) {
        const k = kontext({ sprache: s });
        expect(() => a.text(k), `${s} ${schluessel}`).not.toThrow();
        expect(a.text(k), `${s} ${schluessel}`).not.toMatch(/\{[a-zA-Z]+\}/u);
      }
    }
  });
});

describe('§4 die drei Arten lesen die Sprache wirklich', () => {
  it('jede der fünf Arten antwortet auf ar anders als auf de', () => {
    for (const schluessel of ARBEITERARTEN) {
      const a = art(schluessel);
      const de = a.text(kontext({ sprache: 'de' }));
      const ar = a.text(kontext({ sprache: 'ar' }));
      const tr = a.text(kontext({ sprache: 'tr' }));
      const en = a.text(kontext({ sprache: 'en' }));
      expect(new Set([de, ar, tr, en]).size, schluessel).toBe(4);
    }
  });

  it('die Ablaufwarnung nennt § 34a GewO in jeder Sprache, wenn sie sperrt', () => {
    /*
     * Kein Schoenreden, und zwar in vier Sprachen: SEC-04 ist eine
     * Hartsperre. Der Paragraf bleibt stehen — er ist eine Fundstelle im
     * deutschen Recht, keine Beschriftung.
     */
    const a = art(artSchluessel(7));
    for (const s of PORTAL_SPRACHEN) {
      const sperrt = a.text(kontext({ sprache: s,
        daten: { bezeichnung: 'Sachkunde', gueltigBis: '2026-08-01',
                 blockiertEinsatz: true } }));
      const mild = a.text(kontext({ sprache: s,
        daten: { bezeichnung: 'Sachkunde', gueltigBis: '2026-08-01',
                 blockiertEinsatz: false } }));
      expect(sperrt, s).toContain('34a');
      expect(mild, s).not.toContain('34a');
    }
  });

  it('eine unbekannte oder fehlende Sprache ergibt Deutsch (fail closed)', () => {
    const deutsch = texteFuer('de');
    for (const wert of [null, undefined, '', 'xx', 'de-DE', 'DE']) {
      expect(texteFuer(wert), String(wert)).toBe(deutsch);
    }
    const a = art(ART_EINWAND_ENTSCHIEDEN);
    expect(a.text(kontext({ sprache: 'kl' }))).toBe(a.text(kontext({ sprache: 'de' })));
    expect(a.text(kontext())).toBe(a.text(kontext({ sprache: 'de' })));
  });
});

describe('§5 alle ÜBRIGEN Arten bleiben deutsch', () => {
  it('eine Meldung an die Verwaltung ändert sich mit der Sprache NICHT', () => {
    /*
     * Der Umfang der Änderung, festgenagelt. Das interne Portal ist deutsch
     * (CLAUDE.md), und seine Begriffe tragen juristische Bedeutung: eine
     * Wächtermeldung über eine unbesetzte Schicht geht an die PLANUNG.
     * Wer hier eine vierte Art dazunimmt, ohne sie oben einzutragen, merkt
     * es an dieser Zeile.
     */
    const uebrige = alleArten().filter((a) => !ARBEITERARTEN.includes(a.schluessel));
    expect(uebrige.length).toBeGreaterThan(0);
    for (const a of uebrige) {
      for (const s of PORTAL_SPRACHEN) {
        expect(a.titel(kontext({ sprache: s })), `${a.schluessel} titel ${s}`)
          .toBe(a.titel(kontext({ sprache: 'de' })));
        expect(a.text(kontext({ sprache: s })), `${a.schluessel} text ${s}`)
          .toBe(a.text(kontext({ sprache: 'de' })));
      }
    }
  });

  it('und die fünf übersetzten sind genau die mit einem Ziel in /portal/mein', () => {
    /*
     * Die Begründung der Auswahl, nicht ihre Wiederholung: übersetzt wird,
     * was einen ARBEITER erreicht — und das erkennt man am Ziel.
     */
    for (const a of alleArten()) {
      const ziel = a.ziel(kontext({ daten: {} })) ?? '';
      const arbeiter = ziel.startsWith('/portal/mein');
      expect(ARBEITERARTEN.includes(a.schluessel), `${a.schluessel} → ${ziel}`)
        .toBe(arbeiter);
    }
  });
});

describe('§6 die Zahl der Schichten trägt jede Sprache', () => {
  it('null, eine und mehrere ergeben drei verschiedene Sätze', () => {
    const a = art(ART_PLAN_VEROEFFENTLICHT);
    for (const s of PORTAL_SPRACHEN) {
      /* Ein Zeitraum OHNE Ziffern — sonst prüfte die letzte Zeile das Datum
         statt der Zahl der Schichten. */
      const satz = (n: number) => a.text(kontext({ sprache: s,
        daten: { zeitraum: 'die kommende Woche', schichten: n, gesellschaft: 'CSE' } }));
      expect(new Set([satz(0), satz(1), satz(5)]).size, s).toBe(3);
      expect(satz(5), s).toContain('5');
      // Bei null steht keine Zahl im Satz — „0 Schichten eingeteilt" war der
      // Text der früheren Fassung.
      expect(satz(0), s).not.toMatch(/[0-9]/u);
    }
  });

  it('ohne Gesellschaft steht keine leere Klammer da', () => {
    const a = art(ART_PLAN_VEROEFFENTLICHT);
    for (const s of PORTAL_SPRACHEN) {
      const ohne = a.text(kontext({ sprache: s,
        daten: { zeitraum: '15.05. bis 21.05.', schichten: 2, gesellschaft: '' } }));
      expect(ohne, s).not.toContain('()');
    }
  });
});

describe('§7 eingesetzter Text wird NICHT übersetzt', () => {
  it('Qualifikation, Begründung und Firmierung stehen wörtlich da', () => {
    const bezeichnung = 'Sachkundeprüfung § 34a GewO';
    const grund = 'Der Vorarbeiter hat die Zeit am selben Abend gegengezeichnet.';
    const firma = 'REALTIME Service GmbH';
    for (const s of PORTAL_SPRACHEN) {
      expect(art(artSchluessel(30)).text(kontext({ sprache: s,
        daten: { bezeichnung, gueltigBis: '2026-08-01', blockiertEinsatz: false } })), s)
        .toContain(bezeichnung);
      expect(art(ART_EINWAND_ENTSCHIEDEN).text(kontext({ sprache: s,
        daten: { status: 'abgelehnt', betrifftDatum: '11.03.2026', begruendung: grund } })), s)
        .toContain(grund);
      expect(art(ART_PLAN_VEROEFFENTLICHT).text(kontext({ sprache: s,
        daten: { zeitraum: '15.05. bis 21.05.', schichten: 2, gesellschaft: firma } })), s)
        .toContain(firma);
    }
  });

  it('ein Einwand OHNE Begründung sagt das, statt zu schweigen', () => {
    const a = art(ART_EINWAND_ENTSCHIEDEN);
    for (const s of PORTAL_SPRACHEN) {
      const mit = a.text(kontext({ sprache: s,
        daten: { status: 'abgelehnt', begruendung: 'Weil.' } }));
      const ohne = a.text(kontext({ sprache: s,
        daten: { status: 'abgelehnt', begruendung: '   ' } }));
      expect(mit, s).not.toBe(ohne);
      expect(ohne.trim(), s).not.toBe('');
    }
  });
});

describe('§8 der Zeitraum wird je Sprache GEFÜGT, nicht deutsch eingesetzt', () => {
  it('„bis" ist ein deutsches Wort und steht in keinem anderen Satz', () => {
    /*
     * Der Befund hinter dieser Zeile: die arabische Bekanntgabe las
     * „تم نشر جدول الدوام للفترة 15.05.2028 bis 21.05.2028" — ein deutsches
     * Wort mitten im Satz, weil `zeitraumText()` die beiden Tage schon
     * gefügt hatte. Die Tage kommen jetzt einzeln herein.
     */
    const a = art(ART_PLAN_VEROEFFENTLICHT);
    const daten = { von: '15.05.2028', bis: '21.05.2028', schichten: 3,
                    gesellschaft: 'SSE Security' };
    for (const s of PORTAL_SPRACHEN) {
      const text = a.text(kontext({ sprache: s, daten }));
      expect(text, s).toContain('15.05.2028');
      expect(text, s).toContain('21.05.2028');
      if (s !== 'de') expect(text, s).not.toContain(' bis ');
    }
    expect(a.text(kontext({ sprache: 'de', daten }))).toContain('15.05.2028 bis 21.05.2028');
  });

  it('ein EINZELNER Tag wird nicht gefügt — „X bis X" wäre falsch', () => {
    const a = art(ART_PLAN_VEROEFFENTLICHT);
    const daten = { von: '18.05.2028', bis: '18.05.2028', schichten: 1, gesellschaft: '' };
    for (const s of PORTAL_SPRACHEN) {
      const text = a.text(kontext({ sprache: s, daten }));
      expect(text.match(/18\.05\.2028/gu) ?? [], s).toHaveLength(1);
    }
  });

  it('ohne die beiden Tage gilt weiter `zeitraum` — die Vorschau ruft so', () => {
    /* Rückfall, nicht Ersatz: `/portal/konto/benachrichtigungen` rendert mit
       leeren Daten, und ältere Meldungen sind längst geschrieben. */
    const a = art(ART_PLAN_VEROEFFENTLICHT);
    expect(a.text(kontext({ sprache: 'tr', daten: { zeitraum: 'Mayıs', schichten: 2 } })))
      .toContain('Mayıs');
    expect(() => a.text(kontext({ sprache: 'ar' }))).not.toThrow();
  });
});
