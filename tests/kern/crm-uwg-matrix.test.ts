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
 *  7. `abweichungenVomTor` nennt BEIDE Richtungen: wo das wirksame Tor mehr
 *     durchlässt als die Vorschrift (O-660) UND wo es STRENGER ist als die
 *     Matrix — die Ebene des Kunden, `archiviert_am`, `anonymisiert_am`. Die
 *     zweite Hälfte fehlte, und damit stand neben dem roten „Abgelehnt" des
 *     Tores ein grünes „Bereit" der angeblich schärferen Matrix, ohne einen
 *     Satz dazu.
 *  8. `abmeldezeileGerendert = null` („nicht feststellbar") verbietet, statt
 *     § 7 Abs. 3 Nr. 4 UWG für einen Versandweg zu bejahen, den es nicht gibt.
 *  9. Jede Antwort trägt einen Grund und eine Fundstelle; kein „false" ohne
 *     Satz, denn der Satz steht auf dem Bildschirm.
 */
import { describe, expect, it } from 'vitest';
import {
  ARTEN, GRUNDLAGEN, KANAELE, abweichungenVomTor, matrixAntwort,
  type Grundlage, type KontaktLage, type KundenLage, type Nachrichtenart,
} from '../../src/server/services/crm/uwg-matrix.js';

/** Eine Firma, an der nichts sperrt — die Vergleichsgrundlage. */
function firma(teil: Partial<KundenLage> = {}): KundenLage {
  return {
    grundlage: 'bestandskunde',
    widerspruch: false,
    werbewiderspruch: false,
    gesperrt: false,
    archiviert: false,
    ...teil,
  };
}

/** Der sauberste Fall je Grundlage: kein Widerspruch, Abmeldezeile vorhanden. */
function lage(grundlage: Grundlage, teil: Partial<KontaktLage> = {}): KontaktLage {
  return {
    grundlage,
    aehnlicheLeistung: false,
    widerspruch: false,
    werbewiderspruch: false,
    einwilligungKanaele: grundlage === 'einwilligung' ? ['email'] : [],
    abmeldezeileGerendert: true,
    archiviert: false,
    anonymisiert: false,
    kunde: firma(),
    ...teil,
  };
}

/** Nur die Sätze einer Richtung. */
const richtung = (l: KontaktLage, r: 'tor_strenger' | 'matrix_strenger'): string[] =>
  abweichungenVomTor(l).filter((a) => a.richtung === r).map((a) => a.text);

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

describe('abweichungenVomTor · wo die MATRIX strenger ist als das Tor', () => {
  it('`anfrage`: das Tor prüft nur, DASS eine Grundlage steht — die Matrix nicht', () => {
    const saetze = richtung(lage('anfrage'), 'matrix_strenger');
    expect(saetze.length).toBeGreaterThan(0);
    expect(saetze.join(' ')).toContain('O-660');
  });

  it('`bestandskunde` ohne ähnliche Leistung: dasselbe', () => {
    const saetze = richtung(
      lage('bestandskunde', { aehnlicheLeistung: false }), 'matrix_strenger');
    expect(saetze.join(' ')).toContain('O-95');
  });

  it('`bestandskunde` MIT ähnlicher Leistung: der KANAL bleibt eine Abweichung', () => {
    /*
     * Das Tor prüft den Kanal nur bei einer Einwilligung. Bei
     * `bestandskunde` lässt es Telefon, SMS, Post und WhatsApp mit durch,
     * während § 7 Abs. 3 UWG nur die elektronische Postadresse deckt. Der
     * frühere Stand meldete hier `null` und verschwieg genau das.
     */
    const saetze = richtung(
      lage('bestandskunde', { aehnlicheLeistung: true }), 'matrix_strenger');
    expect(saetze.join(' ')).toContain('ELEKTRONISCHE');
  });

  it('`einwilligung` und `keine` weichen in dieser Richtung nicht ab', () => {
    expect(richtung(lage('einwilligung'), 'matrix_strenger')).toHaveLength(0);
    expect(richtung(lage('keine'), 'matrix_strenger')).toHaveLength(0);
  });

  it('bei einem Widerspruch am Kontakt gibt es keine — beide sperren', () => {
    expect(richtung(lage('anfrage', { widerspruch: true }), 'matrix_strenger'))
      .toHaveLength(0);
    expect(richtung(lage('bestandskunde', { werbewiderspruch: true }), 'matrix_strenger'))
      .toHaveLength(0);
  });
});

describe('abweichungenVomTor · wo das TOR strenger ist als die Matrix', () => {
  /*
   * Die Probe des Prüfers, als Zusage: Firma ohne Grundlage, Kontakt mit
   * eigener Einwilligung. Das Tor sagt `false`, die Matrix `true` — und
   * vorher meldete `abweichungVomTor` dazu `null`.
   */
  it('Firma ohne Rechtsgrundlage: das Tor sperrt, die Matrix erlaubt', () => {
    const l = lage('einwilligung', { kunde: firma({ grundlage: 'keine' }) });
    expect(matrixAntwort(l, 'werbung', 'email').erlaubt).toBe(true);
    const saetze = richtung(l, 'tor_strenger');
    expect(saetze.length).toBe(1);
    expect(saetze[0]).toContain('KEINE');
  });

  it('Art.-21-Widerspruch an der FIRMA', () => {
    expect(richtung(lage('einwilligung', { kunde: firma({ widerspruch: true }) }),
      'tor_strenger').join(' ')).toContain('Art. 21');
  });

  it('Werbewiderspruch an der FIRMA', () => {
    expect(richtung(lage('einwilligung', { kunde: firma({ werbewiderspruch: true }) }),
      'tor_strenger')).toHaveLength(1);
  });

  it('`kunde.status = gesperrt`', () => {
    expect(richtung(lage('einwilligung', { kunde: firma({ gesperrt: true }) }),
      'tor_strenger').join(' ')).toContain('gesperrt');
  });

  it('archivierte Firma', () => {
    expect(richtung(lage('einwilligung', { kunde: firma({ archiviert: true }) }),
      'tor_strenger')).toHaveLength(1);
  });

  it('archivierter und anonymisierter KONTAKT', () => {
    expect(richtung(lage('einwilligung', { archiviert: true }), 'tor_strenger'))
      .toHaveLength(1);
    expect(richtung(lage('einwilligung', { anonymisiert: true }), 'tor_strenger'))
      .toHaveLength(1);
  });

  it('ohne Firma und ohne Sperrmerkmal gibt es nichts zu melden', () => {
    expect(richtung(lage('einwilligung', { kunde: null }), 'tor_strenger'))
      .toHaveLength(0);
    expect(richtung(lage('einwilligung'), 'tor_strenger')).toHaveLength(0);
  });

  it('jede Abweichung trägt Text und Fundstelle', () => {
    for (const a of abweichungenVomTor(lage('bestandskunde', {
      kunde: firma({ grundlage: 'keine', gesperrt: true }),
    }))) {
      expect(a.text.length).toBeGreaterThan(20);
      expect(a.norm.length).toBeGreaterThan(3);
    }
  });
});

describe('abmeldezeileGerendert = null · nicht feststellbar heisst NEIN', () => {
  it('ein Bestandskunde ohne feststellbaren Versandweg bekommt keine Werbung', () => {
    const antwort = matrixAntwort(
      lage('bestandskunde', { aehnlicheLeistung: true, abmeldezeileGerendert: null }),
      'werbung', 'email');
    expect(antwort.erlaubt).toBe(false);
    expect(antwort.grund).toContain('nicht feststellbar');
    expect(antwort.norm).toContain('Abs. 3 Nr. 4');
  });

  it('`false` und `null` sperren beide, mit UNTERSCHIEDLICHEM Grund', () => {
    const a = matrixAntwort(
      lage('bestandskunde', { aehnlicheLeistung: true, abmeldezeileGerendert: false }),
      'werbung', 'email');
    const b = matrixAntwort(
      lage('bestandskunde', { aehnlicheLeistung: true, abmeldezeileGerendert: null }),
      'werbung', 'email');
    expect(a.erlaubt).toBe(false);
    expect(b.erlaubt).toBe(false);
    expect(a.grund).not.toBe(b.grund);
  });

  it('eine Einwilligung hängt nicht am Abmeldehinweis', () => {
    expect(matrixAntwort(lage('einwilligung', { abmeldezeileGerendert: null }),
      'werbung', 'email').erlaubt).toBe(true);
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
