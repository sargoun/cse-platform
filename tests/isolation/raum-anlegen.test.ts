import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import {
  archiviereRaum, legeRaumAn, RaumFehler, speichereRaum,
} from '../../src/server/services/raumbuch/raum.js';

/**
 * **Ein einzelner Raum — von Hand** (V-012, OPS-02, OPS-03).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `speichereRaum` ändert nur Vorhandenes, `archiviereRaum` legt still — ein
 * Raum ANGELEGT wurde ausschliesslich im CSV-/Excel-Import und im Seed. Für
 * den Anbau, das neue WC oder den Raum, den die Datei vergessen hat, musste
 * man eine Tabelle bauen, um eine Zeile zu ergänzen.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Was hier bewiesen wird.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * §1  Die Zeile entsteht mit den Werten, die getippt wurden — und `quell_
 *     schluessel` bleibt LEER, damit der nächste Import sie nicht für seine
 *     hält.
 * §2  Die deutsche Zahl wird deutsch gelesen: „12,5" ist zwölfeinhalb, nicht
 *     zwölftausendfünfhundert. Das ist der Fehler, der ein Angebot um den
 *     Faktor tausend verschöbe.
 * §3  Die Etage gehört zum Schlüssel. „101" im UG und „101" im 1. OG sind
 *     zwei Räume — fielen sie zusammen, verlöre einer seine Fläche.
 * §4  Nummer ODER Bezeichnung, und Fläche > 0 — dieselben Regeln wie beim
 *     Ändern, aus derselben Quelle.
 * §5  Ein archiviertes Objekt bekommt keine neuen Räume; die RLS allein
 *     verhinderte das nicht.
 * §6  Ohne `objekt.schreiben` entsteht nichts — auch nicht ohne Tor.
 */

let f: Fixtur;
let leitung = '';
let ohneRecht = '';
let objektId = '';
let zweitesObjekt = '';
let archiviertesObjekt = '';
let belagsartId = '';
let fremdeBelagsart = '';

const zufall = (): string => Math.random().toString(36).slice(2, 10);

async function konto(email: string, mandant: string, rolle: string): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1, $2, $2, 'aktiv')`,
    [u!.id, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1, $2, (select id from rolle
                       where schluessel = $3 and mandant_id is null), true)`,
    [u!.id, mandant, rolle]);
  return u!.id;
}

async function objekt(mandant: string, bezeichnung: string): Promise<string> {
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, strasse, hausnummer, plz, ort)
     values ($1,$2,$3,'Karl-Marx-Allee','31','10178','Berlin') returning id`,
    [mandant, `K-${zufall()}`, `Kunde ${bezeichnung}`]);
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
     values ($1,$2,$3,$4,'Teststr. 3','10115','Berlin') returning id`,
    [mandant, k!.id, `O-${zufall()}`, bezeichnung]);
  return o!.id;
}

async function belagsart(mandant: string, code: string): Promise<string> {
  const [b] = await sql.unsafe<{ id: string }[]>(
    `insert into belagsart (mandant_id, code, bezeichnung, leistungswert_qm_pro_stunde,
                            quelle, gueltig_ab)
     values ($1,$2,$3, 250, 'Testwert — keine Quelle', current_date - 30) returning id`,
    [mandant, code, `Belag ${code}`]);
  return b!.id;
}

beforeAll(async () => {
  f = await seed();
  leitung = await konto('raum-neu-leitung@test.invalid', f.reinigung, 'leitung');
  ohneRecht = await konto('raum-neu-ohne@test.invalid', f.reinigung, 'mitarbeiter');
  for (const r of ['objekt.lesen', 'objekt.schreiben']) {
    await sql.unsafe(
      `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
       values ((select id from rolle where schluessel = 'leitung' and mandant_id is null),
               (select id from berechtigung where schluessel = $1), $2, true)
       on conflict (rolle_id, berechtigung_id, mandant_id)
         do update set gewaehrt = true`,
      [r, f.reinigung]);
  }
  objektId = await objekt(f.reinigung, 'Bürohaus Nord');
  zweitesObjekt = await objekt(f.reinigung, 'Lagerhalle Süd');
  archiviertesObjekt = await objekt(f.reinigung, 'Altbau Ost');
  await sql.unsafe(`update objekt set archiviert_am = now() where id = $1`,
    [archiviertesObjekt]);
  belagsartId = await belagsart(f.reinigung, `PVC-${zufall()}`);
  fremdeBelagsart = await belagsart(f.security, `TEP-${zufall()}`);
});
afterAll(schliessen);

interface Db { abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]> }

function imKontext<T>(
  fn: (db: Db) => Promise<T>,
  o: { readonly readonly?: boolean; readonly benutzer?: string } = {},
): Promise<T> {
  const benutzer = o.benutzer ?? leitung;
  return alsApp(
    {
      scope: 'mandant' as const, mandantId: f.reinigung, benutzerId: benutzer,
      portal: 'intern' as const, readonly: o.readonly ?? false,
    },
    async (tx: postgres.TransactionSql) => fn({
      abfrage: async <R,>(s: string, w?: readonly unknown[]): Promise<readonly R[]> =>
        tx.unsafe(s, (w ?? []) as never[]) as unknown as readonly R[],
    }),
  ) as Promise<T>;
}

interface RaumZeile {
  readonly raumnummer: string | null;
  readonly bezeichnung: string | null;
  readonly etage: string | null;
  readonly nutzungsart: string | null;
  readonly flaeche_qm: string;
  readonly fenster_flaeche_qm: string | null;
  readonly belagsart_id: string | null;
  readonly reinigungsklasse_id: string | null;
  readonly quell_schluessel: string | null;
  readonly sortierung: number;
  readonly archiviert_am: Date | null;
}

async function zeile(raumId: string): Promise<RaumZeile> {
  const [z] = await imKontext((db) => db.abfrage<RaumZeile>(
    `select raumnummer, bezeichnung, etage, nutzungsart,
            flaeche_qm::text as flaeche_qm,
            fenster_flaeche_qm::text as fenster_flaeche_qm,
            belagsart_id, reinigungsklasse_id, quell_schluessel, sortierung,
            archiviert_am
       from raum where id = $1`, [raumId]));
  return z!;
}

/* ═════════════════════════════════════════════════════════════════════════
 * §1 — Die Zeile entsteht
 * ═════════════════════════════════════════════════════════════════════════ */

describe('§1 ein Raum von Hand', () => {
  it('legt die Zeile mit genau den getippten Werten an', async () => {
    const id = await imKontext((db) => legeRaumAn(db, objektId, {
      raumnummer: ' 101 ', bezeichnung: 'Besprechung', etage: 'EG',
      nutzungsart: 'Büro', flaecheQm: '24,75', fensterFlaecheQm: '6,5',
      belagsartId, sortierung: 7,
    }));
    const z = await zeile(id);
    expect(z.raumnummer).toBe('101');
    expect(z.bezeichnung).toBe('Besprechung');
    expect(z.etage).toBe('EG');
    expect(z.nutzungsart).toBe('Büro');
    expect(z.flaeche_qm).toBe('24.750');
    expect(z.fenster_flaeche_qm).toBe('6.500');
    expect(z.belagsart_id).toBe(belagsartId);
    expect(z.sortierung).toBe(7);
    expect(z.archiviert_am).toBeNull();
  });

  it('`quell_schluessel` bleibt LEER', async () => {
    /*
     * Er ist der stabile Schlüssel des IMPORTEURS. Einen zu erfinden hiesse,
     * dass der nächste Import diesen Raum für seinen hält und ihn
     * überschreibt — mit den Werten aus einer Datei, die ihn nie kannte.
     */
    const id = await imKontext((db) => legeRaumAn(db, objektId, {
      raumnummer: `H-${zufall()}`, flaecheQm: '10',
    }));
    expect((await zeile(id)).quell_schluessel).toBeNull();
  });

  it('ein Raum OHNE Nummer, nur mit Bezeichnung — Flur, Treppenhaus', async () => {
    const id = await imKontext((db) => legeRaumAn(db, objektId, {
      bezeichnung: `Flur ${zufall()}`, etage: '1', flaecheQm: '42',
    }));
    const z = await zeile(id);
    expect(z.raumnummer).toBeNull();
    expect(z.bezeichnung).toMatch(/^Flur /u);
  });

  it('der neue Raum lässt sich sofort ändern und stilllegen', async () => {
    const id = await imKontext((db) => legeRaumAn(db, zweitesObjekt, {
      raumnummer: `W-${zufall()}`, flaecheQm: '8',
    }));
    await imKontext((db) => speichereRaum(db, zweitesObjekt, id, {
      raumnummer: 'W-neu', flaecheQm: '9,5',
    }));
    expect((await zeile(id)).flaeche_qm).toBe('9.500');
    await imKontext((db) => archiviereRaum(db, zweitesObjekt, id));
    expect((await zeile(id)).archiviert_am).not.toBeNull();
  });
});

/* ═════════════════════════════════════════════════════════════════════════
 * §2 — Die deutsche Zahl
 * ═════════════════════════════════════════════════════════════════════════ */

describe('§2 die Fläche wird deutsch gelesen', () => {
  it('„12,5" ist zwölfeinhalb', async () => {
    const id = await imKontext((db) => legeRaumAn(db, objektId, {
      raumnummer: `Z-${zufall()}`, flaecheQm: '12,5',
    }));
    // Nicht 12500: der Punkt ist der Tausendertrenner, das Komma trennt die
    // Nachkommastellen. Ein Formular, das das verwechselt, verschiebt jedes
    // Angebot über dieses Gebäude um den Faktor tausend.
    expect((await zeile(id)).flaeche_qm).toBe('12.500');
  });

  it('„1.250,5" ist tausendzweihundertfünfzigeinhalb', async () => {
    const id = await imKontext((db) => legeRaumAn(db, objektId, {
      raumnummer: `Z-${zufall()}`, flaecheQm: '1.250,5',
    }));
    expect((await zeile(id)).flaeche_qm).toBe('1250.500');
  });

  it('eine unlesbare Zahl wird benannt abgewiesen', async () => {
    await expect(imKontext((db) => legeRaumAn(db, objektId, {
      raumnummer: `Z-${zufall()}`, flaecheQm: '12.5 qm',
    }))).rejects.toThrow(RaumFehler);
  });

  it('null m² ist kein Raum', async () => {
    await expect(imKontext((db) => legeRaumAn(db, objektId, {
      raumnummer: `Z-${zufall()}`, flaecheQm: '0',
    }))).rejects.toThrow(/größer als null/u);
  });

  it('ohne Fläche ebenfalls nicht', async () => {
    await expect(imKontext((db) => legeRaumAn(db, objektId, {
      raumnummer: `Z-${zufall()}`, flaecheQm: '',
    }))).rejects.toThrow(RaumFehler);
  });
});

/* ═════════════════════════════════════════════════════════════════════════
 * §3 — Die Etage gehört zum Schlüssel
 * ═════════════════════════════════════════════════════════════════════════ */

describe('§3 dieselbe Nummer auf zwei Etagen sind zwei Räume', () => {
  it('„101" im UG und „101" im 1. OG stehen nebeneinander', async () => {
    const nummer = `E-${zufall()}`;
    const unten = await imKontext((db) => legeRaumAn(db, zweitesObjekt, {
      raumnummer: nummer, etage: 'UG', flaecheQm: '20',
    }));
    const oben = await imKontext((db) => legeRaumAn(db, zweitesObjekt, {
      raumnummer: nummer, etage: '1', flaecheQm: '30',
    }));
    expect(unten).not.toBe(oben);
    expect((await zeile(unten)).flaeche_qm).toBe('20.000');
    expect((await zeile(oben)).flaeche_qm).toBe('30.000');
  });

  it('dieselbe Nummer auf DERSELBEN Etage wird abgewiesen', async () => {
    const nummer = `E-${zufall()}`;
    await imKontext((db) => legeRaumAn(db, zweitesObjekt, {
      raumnummer: nummer, etage: '2', flaecheQm: '20',
    }));
    await expect(imKontext((db) => legeRaumAn(db, zweitesObjekt, {
      raumnummer: nummer, etage: '2', flaecheQm: '25',
    }))).rejects.toThrow(/trägt schon ein Raum diese Nummer/u);
  });

  it('zweimal derselbe Flur auf einer Etage ebenso — auch anders geschrieben', async () => {
    const name = `Treppenhaus ${zufall()}`;
    await imKontext((db) => legeRaumAn(db, zweitesObjekt, {
      bezeichnung: name, etage: '3', flaecheQm: '15',
    }));
    // `raum_bezeichnung_uk` vergleicht kleingeschrieben und ohne Randleerzeichen.
    await expect(imKontext((db) => legeRaumAn(db, zweitesObjekt, {
      bezeichnung: `  ${name.toUpperCase()}  `, etage: '3', flaecheQm: '15',
    }))).rejects.toThrow(/ohne Nummer diese Bezeichnung/u);
  });

  it('nach dem Stilllegen ist die Nummer wieder frei', async () => {
    const nummer = `E-${zufall()}`;
    const alt = await imKontext((db) => legeRaumAn(db, zweitesObjekt, {
      raumnummer: nummer, etage: '4', flaecheQm: '11',
    }));
    await imKontext((db) => archiviereRaum(db, zweitesObjekt, alt));
    const neu = await imKontext((db) => legeRaumAn(db, zweitesObjekt, {
      raumnummer: nummer, etage: '4', flaecheQm: '12',
    }));
    expect(neu).not.toBe(alt);
  });
});

/* ═════════════════════════════════════════════════════════════════════════
 * §4 — Kennung und fremde Stammdaten
 * ═════════════════════════════════════════════════════════════════════════ */

describe('§4 dieselben Regeln wie beim Ändern', () => {
  it('ohne Nummer UND ohne Bezeichnung entsteht nichts', async () => {
    await expect(imKontext((db) => legeRaumAn(db, objektId, {
      etage: 'EG', flaecheQm: '9',
    }))).rejects.toThrow(/Nummer oder eine Bezeichnung/u);
  });

  it('eine Belagsart aus einer anderen Gesellschaft wird benannt abgewiesen', async () => {
    await expect(imKontext((db) => legeRaumAn(db, objektId, {
      raumnummer: `F-${zufall()}`, flaecheQm: '9', belagsartId: fremdeBelagsart,
    }))).rejects.toThrow(/gehört nicht zu dieser Gesellschaft/u);
  });

  it('ein Objekt einer anderen Gesellschaft ist von hier aus keines', async () => {
    const fremd = await objekt(f.security, 'Fremdobjekt');
    await expect(imKontext((db) => legeRaumAn(db, fremd, {
      raumnummer: `F-${zufall()}`, flaecheQm: '9',
    }))).rejects.toThrow(/gibt es in dieser Gesellschaft nicht/u);
  });
});

/* ═════════════════════════════════════════════════════════════════════════
 * §5 — Ein archiviertes Objekt
 * ═════════════════════════════════════════════════════════════════════════ */

describe('§5 ein stillgelegtes Objekt bekommt keine neuen Räume', () => {
  it('der Dienst weist ab, bevor die Zeile entsteht', async () => {
    /*
     * Die RLS verhindert das NICHT: der Fremdschlüssel auf ein archiviertes
     * Objekt besteht weiter. Der Raum wäre angelegt, in keiner Liste sichtbar
     * und in keiner Kalkulation — also unauffindbar.
     */
    await expect(imKontext((db) => legeRaumAn(db, archiviertesObjekt, {
      raumnummer: `A-${zufall()}`, flaecheQm: '9',
    }))).rejects.toThrow(/archiviert/u);
    const [n] = await imKontext((db) => db.abfrage<{ n: string }>(
      `select count(*)::text as n from raum where objekt_id = $1`, [archiviertesObjekt]));
    expect(n!.n).toBe('0');
  });
});

/* ═════════════════════════════════════════════════════════════════════════
 * §6 — Ohne Recht entsteht nichts
 * ═════════════════════════════════════════════════════════════════════════ */

describe('§6 Linie 2 hält auch ohne Linie 1', () => {
  it('ohne `objekt.schreiben` entsteht kein Raum', async () => {
    await expect(imKontext((db) => legeRaumAn(db, objektId, {
      raumnummer: `R-${zufall()}`, flaecheQm: '9',
    }), { benutzer: ohneRecht })).rejects.toThrow();
  });

  it('in der Nur-Lese-Bindung ebenfalls nicht', async () => {
    await expect(imKontext((db) => legeRaumAn(db, objektId, {
      raumnummer: `R-${zufall()}`, flaecheQm: '9',
    }), { readonly: true })).rejects.toThrow();
  });
});
