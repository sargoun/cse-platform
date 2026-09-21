import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import {
  aendereObjekt, archiviereObjekt, legeObjektAn, ObjektFehler,
} from '../../src/server/services/objekt/anlegen.js';

/**
 * Ein Objekt anlegen, ändern und archivieren (OPS-01, V-001, V-020).
 *
 * **Warum diese Datei überhaupt entsteht.** Bis zu ihr gab es keinen Weg, ein
 * Objekt zu erfassen: jede Zeile stammte aus dem Seed. Eine Prüfung, die nur
 * „der Insert läuft durch" sagt, wäre hier zu wenig. Drei Dinge fallen leise
 * aus, und die prüft sie:
 *
 *  1. **Die Nummer.** Sie wird in derselben Anweisung wie der `insert`
 *     gebildet. Liefen Zählen und Einfügen getrennt, bekämen zwei
 *     gleichzeitige Anlagen dieselbe Zahl — und die Prüfung dafür ist nicht
 *     „sie ist eindeutig", sondern „sie ist es auch unter Gleichzeitigkeit".
 *  2. **Die Gesellschaftsgrenze.** Ein Objekt der Reinigung darf aus der
 *     Security nicht sichtbar und nicht änderbar sein — das ist Invariante 3,
 *     und RLS ist die zweite Verteidigungslinie, nicht die einzige.
 *  3. **Das Archivieren.** Es darf ein Objekt nicht unter den Füßen einer
 *     Kraft wegziehen, die morgen früh dorthin fährt.
 */

let f: Fixtur;
let benutzer: string;

beforeAll(async () => {
  f = await seed();
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ('objektpflege@cse.test') returning id`);
  benutzer = u!.id;
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [benutzer]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, globale_rolle_id)
     values ($1, 'objektpflege@cse.test', 'Objektpflege', 'aktiv',
             (select id from rolle where schluessel = 'super_admin' and mandant_id is null))`,
    [benutzer]);
  for (const m of [f.reinigung, f.security]) {
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
       values ($1, $2, (select id from rolle where schluessel = 'admin' and mandant_id is null),
               $3)`,
      [benutzer, m, m === f.reinigung]);
  }
});
afterAll(schliessen);

type Abfrager = { unsafe(s: string, w?: readonly unknown[]): Promise<readonly unknown[]> };

function kontextAus(tx: Abfrager, mandantId: string) {
  return {
    aktiverMandantId: mandantId,
    benutzerId: benutzer,
    abfrage: async <T,>(s: string, w: readonly unknown[] = []) =>
      (await tx.unsafe(s, w)) as readonly T[],
    schreibe: async <T,>(s: string, w: readonly unknown[] = []) =>
      (await tx.unsafe(s, w)) as readonly T[],
  } as never;
}

function sitzung(mandantId = f.reinigung) {
  return { scope: 'mandant' as const, mandantId, benutzerId: benutzer,
           readonly: false, portal: 'intern' as const };
}

const GRUND = {
  bezeichnung: 'Bürohaus Testallee', strasse: 'Testallee',
  plz: '10115', ort: 'Berlin',
} as const;

describe('§1 die Objektnummer', () => {
  it('zählt aus dem Bestand dieser Gesellschaft weiter', async () => {
    const a = await alsApp(sitzung(), (tx) => legeObjektAn(kontextAus(tx, f.reinigung), {
      ...GRUND, bezeichnung: 'Erstes Haus',
    }));
    const b = await alsApp(sitzung(), (tx) => legeObjektAn(kontextAus(tx, f.reinigung), {
      ...GRUND, bezeichnung: 'Zweites Haus',
    }));
    expect(a.objektnummer).toMatch(/^OBJ-\d+$/u);
    expect(b.objektnummer).not.toBe(a.objektnummer);
    const zahl = (n: string) => Number(n.replace('OBJ-', ''));
    expect(zahl(b.objektnummer)).toBe(zahl(a.objektnummer) + 1);
  });

  it('bleibt auch unter GLEICHZEITIGKEIT eindeutig', async () => {
    /*
     * Der eigentliche Grund, warum die Nummer im `insert` gebildet wird. Zwei
     * Anlagen, die sich ueberschneiden, duerfen nicht dieselbe Zahl bekommen.
     * Faellt eine davon auf `objekt_nummer_uk`, ist das der richtige Ausgang —
     * falsch waere nur, dass BEIDE durchgehen und dieselbe Nummer tragen.
     */
    const versuche = await Promise.allSettled(
      [1, 2, 3, 4].map((i) =>
        alsApp(sitzung(), (tx) => legeObjektAn(kontextAus(tx, f.reinigung), {
          ...GRUND, bezeichnung: `Gleichzeitig ${String(i)}`,
        }))));
    const nummern = versuche
      .flatMap((v) => (v.status === 'fulfilled' ? [v.value.objektnummer] : []));
    expect(new Set(nummern).size).toBe(nummern.length);
  });

  it('nimmt eine von Hand gesetzte Nummer an', async () => {
    const eigen = `OBJ-EIGEN-${String(Math.random()).slice(2, 8)}`;
    const a = await alsApp(sitzung(), (tx) => legeObjektAn(kontextAus(tx, f.reinigung), {
      ...GRUND, bezeichnung: 'Eigene Nummer', objektnummer: eigen,
    }));
    expect(a.objektnummer).toBe(eigen);
  });
});

describe('§2 was Pflicht ist, und warum', () => {
  it('WEIST ein Objekt ohne Anschrift ab', async () => {
    /*
     * Nicht Formularstrenge: eine Schicht, die auf ein Objekt ohne Anschrift
     * eingeteilt wird, schickt jemanden an keinen Ort.
     */
    await expect(alsApp(sitzung(), (tx) => legeObjektAn(kontextAus(tx, f.reinigung), {
      ...GRUND, strasse: '  ',
    }))).rejects.toThrow(ObjektFehler);
    await expect(alsApp(sitzung(), (tx) => legeObjektAn(kontextAus(tx, f.reinigung), {
      ...GRUND, ort: '',
    }))).rejects.toThrow(ObjektFehler);
  });

  it('WEIST eine deutsche PLZ ab, die keine fünf Ziffern hat', async () => {
    await expect(alsApp(sitzung(), (tx) => legeObjektAn(kontextAus(tx, f.reinigung), {
      ...GRUND, plz: '1011',
    }))).rejects.toThrow(/fünf Ziffern/u);
  });

  it('lässt eine ausländische PLZ in Ruhe — sie trägt Buchstaben', async () => {
    const a = await alsApp(sitzung(), (tx) => legeObjektAn(kontextAus(tx, f.reinigung), {
      ...GRUND, bezeichnung: 'Amsterdam', plz: '1012 AB', ort: 'Amsterdam', land: 'nl',
    }));
    expect(a.id).toBeTruthy();
  });

  it('nimmt ein Objekt OHNE Kunden an — ein Objekt ist ein ORT', async () => {
    const a = await alsApp(sitzung(), (tx) => legeObjektAn(kontextAus(tx, f.reinigung), {
      ...GRUND, bezeichnung: 'Veranstaltungsort ohne Kundenstamm',
    }));
    const [z] = await sql.unsafe<{ kunde_id: string | null }[]>(
      `select kunde_id from objekt where id = $1`, [a.id]);
    expect(z!.kunde_id).toBeNull();
  });

  it('WEIST eine Etagenangabe ab, die keine Zahl ist', async () => {
    await expect(alsApp(sitzung(), (tx) => legeObjektAn(kontextAus(tx, f.reinigung), {
      ...GRUND, etagenAnzahl: 'drei',
    }))).rejects.toThrow(ObjektFehler);
  });
});

describe('§3 die Gesellschaftsgrenze (Invariante 3)', () => {
  it('ein Objekt der Reinigung ist aus der Security nicht änderbar', async () => {
    const a = await alsApp(sitzung(), (tx) => legeObjektAn(kontextAus(tx, f.reinigung), {
      ...GRUND, bezeichnung: 'Nur für die Reinigung',
    }));
    await expect(alsApp(sitzung(f.security), (tx) =>
      aendereObjekt(kontextAus(tx, f.security), {
        ...GRUND, id: a.id, bezeichnung: 'Übernommen',
      }))).rejects.toThrow(ObjektFehler);

    const [z] = await sql.unsafe<{ bezeichnung: string }[]>(
      `select bezeichnung from objekt where id = $1`, [a.id]);
    expect(z!.bezeichnung).toBe('Nur für die Reinigung');
  });

  it('das angelegte Objekt trägt den AKTIVEN Mandanten, nicht den aus der Eingabe',
    async () => {
      const a = await alsApp(sitzung(f.security), (tx) =>
        legeObjektAn(kontextAus(tx, f.security), {
          ...GRUND, bezeichnung: 'Security-Objekt',
        }));
      const [z] = await sql.unsafe<{ mandant_id: string }[]>(
        `select mandant_id from objekt where id = $1`, [a.id]);
      expect(z!.mandant_id).toBe(f.security);
    });
});

describe('§4 ändern', () => {
  it('ändert die Anschrift und lässt die Nummer stehen', async () => {
    const a = await alsApp(sitzung(), (tx) => legeObjektAn(kontextAus(tx, f.reinigung), {
      ...GRUND, bezeichnung: 'Vorher',
    }));
    await alsApp(sitzung(), (tx) => aendereObjekt(kontextAus(tx, f.reinigung), {
      ...GRUND, id: a.id, bezeichnung: 'Nachher', strasse: 'Neue Strasse',
    }));
    const [z] = await sql.unsafe<{ bezeichnung: string; strasse: string; objektnummer: string }[]>(
      `select bezeichnung, strasse, objektnummer from objekt where id = $1`, [a.id]);
    expect(z!.bezeichnung).toBe('Nachher');
    expect(z!.strasse).toBe('Neue Strasse');
    expect(z!.objektnummer).toBe(a.objektnummer);
  });

  it('WEIST eine unbekannte Kennung ab statt still nichts zu tun', async () => {
    await expect(alsApp(sitzung(), (tx) => aendereObjekt(kontextAus(tx, f.reinigung), {
      ...GRUND, id: '00000000-0000-0000-0000-000000000000',
    }))).rejects.toThrow(ObjektFehler);
  });
});

describe('§5 archivieren', () => {
  it('archiviert, statt zu löschen — die Zeile bleibt', async () => {
    const a = await alsApp(sitzung(), (tx) => legeObjektAn(kontextAus(tx, f.reinigung), {
      ...GRUND, bezeichnung: 'Zum Archivieren',
    }));
    await alsApp(sitzung(), (tx) => archiviereObjekt(kontextAus(tx, f.reinigung), a.id));
    const [z] = await sql.unsafe<{ archiviert_am: Date | null }[]>(
      `select archiviert_am from objekt where id = $1`, [a.id]);
    expect(z!.archiviert_am).not.toBeNull();
  });

  it('gibt die Nummer wieder frei — der Index ist teilweise', async () => {
    const eigen = `OBJ-FREI-${String(Math.random()).slice(2, 8)}`;
    const a = await alsApp(sitzung(), (tx) => legeObjektAn(kontextAus(tx, f.reinigung), {
      ...GRUND, bezeichnung: 'Verkauft', objektnummer: eigen,
    }));
    await alsApp(sitzung(), (tx) => archiviereObjekt(kontextAus(tx, f.reinigung), a.id));
    const b = await alsApp(sitzung(), (tx) => legeObjektAn(kontextAus(tx, f.reinigung), {
      ...GRUND, bezeichnung: 'Nachfolger', objektnummer: eigen,
    }));
    expect(b.objektnummer).toBe(eigen);
    expect(b.id).not.toBe(a.id);
  });

  it('WEIST das Archivieren ab, solange Einsätze in der Zukunft stehen', async () => {
    /*
     * Der Grund steht im Dienst: sonst verschwaende der Ort unter den Fuessen
     * einer Kraft, die morgen frueh dorthin faehrt.
     */
    const a = await alsApp(sitzung(), (tx) => legeObjektAn(kontextAus(tx, f.reinigung), {
      ...GRUND, bezeichnung: 'Mit Einsatz',
    }));
    /*
     * Die Schicht braucht einen Kunden: ein Ausloeser auf `einsatz` besteht
     * darauf, dass entweder das Objekt oder die Schicht einen nennt. Richtig
     * so — eine Schicht, die niemandem berechnet wird, ist keine.
     */
    const [k] = await sql.unsafe<{ id: string }[]>(
      `insert into kunde (mandant_id, kundennummer, typ, name)
       values ($1, $2, 'firma', 'Auftraggeber der Schicht')
       returning id`,
      [f.reinigung, `K-${String(Math.random()).slice(2, 7)}`]);
    await sql.unsafe(
      `insert into einsatz (mandant_id, objekt_id, kunde_id, quelle, plan_datum,
                            beginn_lokal, ende_lokal,
                            beginn_zeitpunkt, ende_zeitpunkt,
                            endet_am_folgetag, status, erstellt_von_art)
       select $1, $2, $3, 'manuell', d,
              (d + time '08:00'), (d + time '16:00'),
              (d + time '08:00') at time zone 'Europe/Berlin',
              (d + time '16:00') at time zone 'Europe/Berlin',
              false, 'geplant', 'system'
         from (select (current_date + 2) as d) t`,
      [f.reinigung, a.id, k!.id]);

    await expect(alsApp(sitzung(), (tx) =>
      archiviereObjekt(kontextAus(tx, f.reinigung), a.id)))
      .rejects.toThrow(/Einsätze in der Zukunft/u);

    const [z] = await sql.unsafe<{ archiviert_am: Date | null }[]>(
      `select archiviert_am from objekt where id = $1`, [a.id]);
    expect(z!.archiviert_am).toBeNull();
  });

  it('archiviert NICHT zweimal', async () => {
    const a = await alsApp(sitzung(), (tx) => legeObjektAn(kontextAus(tx, f.reinigung), {
      ...GRUND, bezeichnung: 'Einmal reicht',
    }));
    await alsApp(sitzung(), (tx) => archiviereObjekt(kontextAus(tx, f.reinigung), a.id));
    await expect(alsApp(sitzung(), (tx) =>
      archiviereObjekt(kontextAus(tx, f.reinigung), a.id))).rejects.toThrow(ObjektFehler);
  });
});
