/**
 * Die Matrix des § 7 UWG — die Tabelle aus `05-API-KARTE.md` §C.7, Zelle für
 * Zelle (CRM-08, LEG-08).
 *
 * **Was diese Datei beweist:**
 *
 *  1. Jede der zwölf Zellen der Vorschrift wird getroffen — vier Grundlagen
 *     mal drei Nachrichtenarten.
 *  2. Der Widerspruch nach Art. 21 DSGVO schlägt JEDE Grundlage und jede
 *     Nachrichtenart, auch die vertragliche Kommunikation der Einwilligung.
 *  3. Ein Werbewiderspruch sperrt Werbung und lässt Vertragliches durch.
 *  4. `bestandskunde` braucht alle vier Bedingungen des § 7 Abs. 3 UWG
 *     zugleich; fällt eine weg, fällt die Erlaubnis.
 *  5. Die Ausnahme des § 7 Abs. 3 UWG gilt nur für die ELEKTRONISCHE
 *     Postadresse — Telefon, SMS und WhatsApp trägt sie nicht.
 *  6. Eine Einwilligung gilt für die genannten Kanäle und nur für die.
 *  7. `abweichungVomTor` nennt genau die zwei Fälle, in denen das wirksame Tor
 *     mehr durchlässt als die Vorschrift — und sonst nichts.
 *  8. Jede Antwort trägt einen Grund und eine Fundstelle; kein „false" ohne
 *     Satz, denn der Satz steht auf dem Bildschirm.
 */
import { describe, expect, it } from 'vitest';
import {
  ARTEN, GRUNDLAGEN, KANAELE, abweichungVomTor, matrixAntwort,
  type Grundlage, type KontaktLage, type Nachrichtenart,
} from '../../src/server/services/crm/uwg-matrix.js';

/** Der sauberste Fall je Grundlage: kein Widerspruch, Abmeldezeile vorhanden. */
function lage(grundlage: Grundlage, teil: Partial<KontaktLage> = {}): KontaktLage {
  return {
    grundlage,
    aehnlicheLeistung: false,
    widerspruch: false,
    werbewiderspruch: false,
    einwilligungKanaele: grundlage === 'einwilligung' ? ['email'] : [],
    abmeldezeileGerendert: true,
    ...teil,
  };
}

describe('§ 7 UWG · die Matrix der API-Karte, Zelle für Zelle', () => {
  /**
   * Die Tabelle aus 05-API-KARTE.md §C.7, als Daten — `werbung` bei
   * `bestandskunde` steht auf `true`, weil hier der VOLLSTÄNDIGE Fall geprüft
   * wird (ähnliche Leistung festgestellt, Abmeldezeile vorhanden, E-Mail).
   */
  const TABELLE: readonly {
    readonly grundlage: Grundlage;
    readonly antwort: Record<Nachrichtenart, boolean>;
    readonly teil?: Partial<KontaktLage>;
  }[] = [
    {
      grundlage: 'keine',
      antwort: { antwort_auf_anfrage: false, vertragskommunikation: false, werbung: false },
    },
    {
      grundlage: 'anfrage',
      antwort: { antwort_auf_anfrage: true, vertragskommunikation: false, werbung: false },
    },
    {
      grundlage: 'bestandskunde',
      antwort: { antwort_auf_anfrage: true, vertragskommunikation: true, werbung: true },
      teil: { aehnlicheLeistung: true },
    },
    {
      grundlage: 'einwilligung',
      antwort: { antwort_auf_anfrage: true, vertragskommunikation: true, werbung: true },
    },
  ];

  for (const zeile of TABELLE) {
    for (const art of ARTEN) {
      it(`${zeile.grundlage} × ${art} → ${String(zeile.antwort[art])}`, () => {
        const antwort = matrixAntwort(lage(zeile.grundlage, zeile.teil), art, 'email');
        expect(antwort.erlaubt).toBe(zeile.antwort[art]);
      });
    }
  }

  it('deckt alle vier Grundlagen und alle drei Arten ab', () => {
    // Ohne diese Zusage könnte ein fünfter Enumwert dazukommen, ohne dass
    // eine einzige Zelle davon geprüft wäre.
    expect(GRUNDLAGEN).toHaveLength(4);
    expect(ARTEN).toHaveLength(3);
    expect(TABELLE.map((z) => z.grundlage)).toEqual([...GRUNDLAGEN]);
  });
});

describe('Art. 21 DSGVO · der Vollwiderspruch schlägt alles', () => {
  for (const grundlage of GRUNDLAGEN) {
    for (const art of ARTEN) {
      it(`${grundlage} × ${art} ist gesperrt`, () => {
        const antwort = matrixAntwort(
          lage(grundlage, { widerspruch: true, aehnlicheLeistung: true }), art, 'email');
        expect(antwort.erlaubt).toBe(false);
        expect(antwort.norm).toBe('Art. 21 DSGVO');
      });
    }
  }

  it('er wird auch nicht durch eine Einwilligung geheilt', () => {
    const antwort = matrixAntwort(
      lage('einwilligung', { widerspruch: true, einwilligungKanaele: [...KANAELE] }),
      'werbung', 'email');
    expect(antwort.erlaubt).toBe(false);
  });
});

describe('§ 7 Abs. 3 Nr. 3 UWG · der Werbewiderspruch trennt Werbung von Vertrag', () => {
  it('sperrt Werbung', () => {
    expect(matrixAntwort(
      lage('bestandskunde', { aehnlicheLeistung: true, werbewiderspruch: true }),
      'werbung', 'email').erlaubt).toBe(false);
  });

  it('lässt die Rechnung durch — das ist der ganze Unterschied zum Vollwiderspruch', () => {
    expect(matrixAntwort(
      lage('bestandskunde', { aehnlicheLeistung: true, werbewiderspruch: true }),
      'vertragskommunikation', 'email').erlaubt).toBe(true);
  });

  it('lässt die Antwort auf eine Anfrage durch', () => {
    expect(matrixAntwort(
      lage('anfrage', { werbewiderspruch: true }),
      'antwort_auf_anfrage', 'email').erlaubt).toBe(true);
  });
});

describe('§ 7 Abs. 3 UWG · vier Bedingungen, und jede einzeln geprüft', () => {
  it('ohne „ähnliche eigene Leistung" trägt die Ausnahme nicht (O-95)', () => {
    const antwort = matrixAntwort(
      lage('bestandskunde', { aehnlicheLeistung: false }), 'werbung', 'email');
    expect(antwort.erlaubt).toBe(false);
    expect(antwort.norm).toBe('§ 7 Abs. 3 Nr. 2 UWG');
    expect(antwort.grund).toContain('ÄHNLICHE');
  });

  it('ohne Abmeldehinweis entfällt sie vollständig', () => {
    const antwort = matrixAntwort(
      lage('bestandskunde', { aehnlicheLeistung: true, abmeldezeileGerendert: false }),
      'werbung', 'email');
    expect(antwort.erlaubt).toBe(false);
    expect(antwort.norm).toBe('§ 7 Abs. 3 Nr. 4 UWG');
  });

  it('gilt nur für die elektronische Postadresse — nicht Telefon, SMS, WhatsApp', () => {
    for (const kanal of ['telefon', 'sms', 'whatsapp', 'post'] as const) {
      expect(matrixAntwort(
        lage('bestandskunde', { aehnlicheLeistung: true }), 'werbung', kanal,
      ).erlaubt, `Kanal ${kanal}`).toBe(false);
    }
    expect(matrixAntwort(
      lage('bestandskunde', { aehnlicheLeistung: true }), 'werbung', 'email',
    ).erlaubt).toBe(true);
  });
});

describe('Einwilligung · sie gilt für die genannten Kanäle und nur für die', () => {
  it('der genannte Kanal ist erlaubt', () => {
    expect(matrixAntwort(
      lage('einwilligung', { einwilligungKanaele: ['email', 'telefon'] }),
      'werbung', 'telefon').erlaubt).toBe(true);
  });

  it('ein nicht genannter Kanal ist gesperrt, und der Grund nennt die genannten', () => {
    const antwort = matrixAntwort(
      lage('einwilligung', { einwilligungKanaele: ['email'] }), 'werbung', 'whatsapp');
    expect(antwort.erlaubt).toBe(false);
    expect(antwort.grund).toContain('email');
    expect(antwort.grund).toContain('whatsapp');
  });

  it('eine Einwilligung OHNE Kanal ist eine Einwilligung in nichts', () => {
    for (const kanal of KANAELE) {
      const antwort = matrixAntwort(
        lage('einwilligung', { einwilligungKanaele: [] }), 'werbung', kanal);
      expect(antwort.erlaubt, `Kanal ${kanal}`).toBe(false);
      expect(antwort.grund).toContain('Einwilligung in nichts');
    }
  });
});

describe('abweichungVomTor · genau die zwei Fälle, in denen das Tor mehr durchlässt', () => {
  it('`anfrage`: das Tor lässt Werbung durch, die Vorschrift nicht', () => {
    const satz = abweichungVomTor(lage('anfrage'));
    expect(satz).not.toBeNull();
    expect(satz).toContain('O-660');
  });

  it('`bestandskunde` ohne ähnliche Leistung: dasselbe', () => {
    const satz = abweichungVomTor(lage('bestandskunde', { aehnlicheLeistung: false }));
    expect(satz).not.toBeNull();
    expect(satz).toContain('O-95');
  });

  it('`bestandskunde` MIT ähnlicher Leistung weicht nicht ab', () => {
    expect(abweichungVomTor(lage('bestandskunde', { aehnlicheLeistung: true }))).toBeNull();
  });

  it('`einwilligung` und `keine` weichen nicht ab', () => {
    expect(abweichungVomTor(lage('einwilligung'))).toBeNull();
    expect(abweichungVomTor(lage('keine'))).toBeNull();
  });

  it('bei einem Widerspruch gibt es keine Abweichung — beide sperren', () => {
    expect(abweichungVomTor(lage('anfrage', { widerspruch: true }))).toBeNull();
    expect(abweichungVomTor(lage('bestandskunde', { werbewiderspruch: true }))).toBeNull();
  });
});

describe('jede Antwort trägt einen Satz und eine Fundstelle', () => {
  it('über alle Grundlagen, Arten und Kanäle', () => {
    for (const grundlage of GRUNDLAGEN) {
      for (const art of ARTEN) {
        for (const kanal of KANAELE) {
          const antwort = matrixAntwort(lage(grundlage), art, kanal);
          expect(antwort.grund.length, `${grundlage}/${art}/${kanal}`)
            .toBeGreaterThan(20);
          expect(antwort.norm.length).toBeGreaterThan(3);
        }
      }
    }
  });
});
