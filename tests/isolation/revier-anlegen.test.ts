import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import {
  aendereRevier, archiviereRevier, legeRevierAn, RevierFehler,
} from '../../src/server/services/reinigung/revier.js';
import { legeObjektAn } from '../../src/server/services/objekt/anlegen.js';

/**
 * Ein Revier zuschneiden, ändern und archivieren (V-002, CLN-01, OPS-02).
 *
 * **Warum diese Datei entsteht.** Bis zu ihr gab es keinen Weg, eine
 * Reinigungszone zu erfassen: jede Zeile stammte aus dem Seed. Damit war der
 * gesamte Reinigungsdienstplan für neue Flächen zu — ein Turnus hängt am
 * Revier, ein Einsatz am Turnus, ein Leistungsnachweis am Einsatz. Die
 * Fehlermeldung `RaumNichtEntfernbar` verwies obendrein auf zwei Wege („neu
 * anlegen", „archivieren"), die es beide nicht gab.
 *
 * Vier Dinge fallen hier leise aus, und die prüft diese Datei:
 *
 *  1. **Die Sollzeit.** `revier_sollzeit_positiv` verlangt `> 0`. Käme die
 *     Abweisung erst aus Postgres, läse sie sich als
 *     `new row violates check constraint` — und eine Null käme als
 *     `invalid input syntax for type numeric` gar nicht erst so weit.
 *  2. **Der Berliner Geschäftstag.** `aktiv_ab` ist ein Datum, kein Zeitpunkt.
 *     Zwischen 22:00 und 24:00 UTC ist in Berlin schon der Folgetag (V-103);
 *     `current_date` legte die Zone dann auf gestern.
 *  3. **Die Gesellschaftsgrenze** (Invariante 3): ein Revier der Reinigung ist
 *     aus der Security weder änderbar noch archivierbar.
 *  4. **Das Aktivfenster beim Archivieren.** `revier_aktiv_fenster` verlangt
 *     `aktiv_bis >= aktiv_ab`. Eine Zone, die erst NÄCHSTE Woche beginnt und
 *     heute archiviert wird, verletzte das — das ist genau der Fall, den
 *     niemand von Hand durchspielt.
 */

let f: Fixtur;
let benutzer: string;
let objektReinigung: string;
let objektSecurity: string;

beforeAll(async () => {
  f = await seed();
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ('revierpflege@cse.test') returning id`);
  benutzer = u!.id;
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [benutzer]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, globale_rolle_id)
     values ($1, 'revierpflege@cse.test', 'Revierpflege', 'aktiv',
             (select id from rolle where schluessel = 'super_admin' and mandant_id is null))`,
    [benutzer]);
  for (const m of [f.reinigung, f.security]) {
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
       values ($1, $2, (select id from rolle where schluessel = 'admin' and mandant_id is null),
               $3)`,
      [benutzer, m, m === f.reinigung]);
  }

  /*
   * Ein Revier haengt zwingend an einem Objekt — je Gesellschaft eines, damit
   * §3 die Grenze an ECHTEN Zeilen pruefen kann und nicht an einer fehlenden.
   */
  objektReinigung = (await alsApp(sitzung(f.reinigung), (tx) =>
    legeObjektAn(kontextAus(tx, f.reinigung), {
      bezeichnung: 'Revierhaus Reinigung', strasse: 'Revierweg', plz: '10115', ort: 'Berlin',
    }))).id;
  objektSecurity = (await alsApp(sitzung(f.security), (tx) =>
    legeObjektAn(kontextAus(tx, f.security), {
      bezeichnung: 'Revierhaus Security', strasse: 'Revierweg', plz: '10115', ort: 'Berlin',
    }))).id;
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

const GRUND = { bezeichnung: 'Erdgeschoss Nord', sollzeitMinuten: '90' } as const;

async function anlegen(felder: Partial<Parameters<typeof legeRevierAn>[1]> = {}) {
  return alsApp(sitzung(), (tx) => legeRevierAn(kontextAus(tx, f.reinigung), {
    ...GRUND, objektId: objektReinigung, ...felder,
  }));
}

describe('§1 die Sollzeit ist die Zahl, aus der die Besetzung entsteht', () => {
  it('legt eine Zone mit positiver Sollzeit an', async () => {
    const a = await anlegen({ bezeichnung: 'Treppenhaus A–C' });
    const [z] = await sql.unsafe<{ sollzeit_minuten: string; bezeichnung: string }[]>(
      `select sollzeit_minuten, bezeichnung from revier where id = $1`, [a.id]);
    expect(z!.bezeichnung).toBe('Treppenhaus A–C');
    expect(Number(z!.sollzeit_minuten)).toBe(90);
  });

  it('WEIST eine Sollzeit von null ab — mit einem Satz, nicht mit einer Zwangsbedingung',
    async () => {
      /*
       * `revier_sollzeit_positiv` faenge das auch. Der Unterschied ist, was
       * der Mensch am Bildschirm liest: ein Satz oder
       * `new row for relation "revier" violates check constraint`.
       */
      await expect(anlegen({ sollzeitMinuten: '0' })).rejects.toThrow(RevierFehler);
      await expect(anlegen({ sollzeitMinuten: '0' })).rejects.toThrow(/grösser als null/u);
    });

  it('WEIST eine Sollzeit ab, die keine Zahl ist', async () => {
    await expect(anlegen({ sollzeitMinuten: 'neunzig' })).rejects.toThrow(RevierFehler);
    await expect(anlegen({ sollzeitMinuten: '' })).rejects.toThrow(RevierFehler);
  });

  it('nimmt das deutsche KOMMA an — `4,5` ist eine Eingabe, die vorkommt', async () => {
    const a = await anlegen({ bezeichnung: 'Halbe Minute', sollzeitMinuten: '90,5' });
    const [z] = await sql.unsafe<{ sollzeit_minuten: string }[]>(
      `select sollzeit_minuten from revier where id = $1`, [a.id]);
    expect(Number(z!.sollzeit_minuten)).toBe(90.5);
  });

  it('WEIST eine Zone ohne Bezeichnung ab', async () => {
    await expect(anlegen({ bezeichnung: '   ' })).rejects.toThrow(RevierFehler);
  });
});

describe('§2 `aktiv_ab` ist der BERLINER Geschäftstag (V-103)', () => {
  it('setzt ohne Angabe den Berliner Tag, nicht `current_date`', async () => {
    const a = await anlegen({ bezeichnung: 'Ohne Datum' });
    const [z] = await sql.unsafe<{ gleich: boolean }[]>(
      `select aktiv_ab = app.berlin_heute() as gleich from revier where id = $1`, [a.id]);
    expect(z!.gleich).toBe(true);
  });

  it('nimmt ein angegebenes Datum unverändert an', async () => {
    const a = await anlegen({ bezeichnung: 'Mit Datum', aktivAb: '2027-03-01' });
    const [z] = await sql.unsafe<{ tag: string }[]>(
      `select to_char(aktiv_ab, 'YYYY-MM-DD') as tag from revier where id = $1`, [a.id]);
    expect(z!.tag).toBe('2027-03-01');
  });
});

describe('§3 die Gesellschaftsgrenze (Invariante 3)', () => {
  it('ein Revier der Reinigung ist aus der Security nicht änderbar', async () => {
    const a = await anlegen({ bezeichnung: 'Nur für die Reinigung' });
    await expect(alsApp(sitzung(f.security), (tx) =>
      aendereRevier(kontextAus(tx, f.security), {
        id: a.id, bezeichnung: 'Übernommen', sollzeitMinuten: '30',
      }))).rejects.toThrow(RevierFehler);
    const [z] = await sql.unsafe<{ bezeichnung: string }[]>(
      `select bezeichnung from revier where id = $1`, [a.id]);
    expect(z!.bezeichnung).toBe('Nur für die Reinigung');
  });

  it('ein Revier der Reinigung ist aus der Security nicht archivierbar', async () => {
    const a = await anlegen({ bezeichnung: 'Fremdes Revier' });
    await expect(alsApp(sitzung(f.security), (tx) =>
      archiviereRevier(kontextAus(tx, f.security), a.id))).rejects.toThrow(RevierFehler);
    const [z] = await sql.unsafe<{ archiviert_am: string | null }[]>(
      `select archiviert_am from revier where id = $1`, [a.id]);
    expect(z!.archiviert_am).toBeNull();
  });

  it('die Zone trägt den AKTIVEN Mandanten, nicht den aus der Eingabe', async () => {
    const a = await alsApp(sitzung(f.security), (tx) =>
      legeRevierAn(kontextAus(tx, f.security), {
        ...GRUND, bezeichnung: 'Security-Zone', objektId: objektSecurity,
      }));
    const [z] = await sql.unsafe<{ mandant_id: string }[]>(
      `select mandant_id from revier where id = $1`, [a.id]);
    expect(z!.mandant_id).toBe(f.security);
  });

  it('WEIST ein Objekt einer FREMDEN Gesellschaft ab', async () => {
    /*
     * Die Fremdschluesselpruefung sieht das Objekt unter RLS gar nicht — der
     * Dienst faengt den Fehlschlag und sagt, was fehlt, statt einen
     * Datenbankfehler durchzureichen.
     */
    await expect(alsApp(sitzung(f.reinigung), (tx) =>
      legeRevierAn(kontextAus(tx, f.reinigung), {
        ...GRUND, bezeichnung: 'Fremdes Haus', objektId: objektSecurity,
      }))).rejects.toThrow();
  });
});

describe('§4 ändern', () => {
  it('ändert Bezeichnung und Sollzeit', async () => {
    const a = await anlegen({ bezeichnung: 'Vorher' });
    await alsApp(sitzung(), (tx) => aendereRevier(kontextAus(tx, f.reinigung), {
      id: a.id, bezeichnung: 'Nachher', sollzeitMinuten: '120', kurzzeichen: 'EG-N',
    }));
    const [z] = await sql.unsafe<
      { bezeichnung: string; sollzeit_minuten: string; kurzzeichen: string | null }[]>(
        `select bezeichnung, sollzeit_minuten, kurzzeichen from revier where id = $1`, [a.id]);
    expect(z!.bezeichnung).toBe('Nachher');
    expect(Number(z!.sollzeit_minuten)).toBe(120);
    expect(z!.kurzzeichen).toBe('EG-N');
  });

  it('lässt das OBJEKT stehen — es ist kein Feld dieses Weges', async () => {
    const a = await anlegen({ bezeichnung: 'Bleibt am Haus' });
    await alsApp(sitzung(), (tx) => aendereRevier(kontextAus(tx, f.reinigung), {
      id: a.id, bezeichnung: 'Bleibt am Haus', sollzeitMinuten: '90',
    }));
    const [z] = await sql.unsafe<{ objekt_id: string }[]>(
      `select objekt_id from revier where id = $1`, [a.id]);
    expect(z!.objekt_id).toBe(objektReinigung);
  });

  it('WEIST eine unbekannte Kennung ab statt still nichts zu tun', async () => {
    await expect(alsApp(sitzung(), (tx) => aendereRevier(kontextAus(tx, f.reinigung), {
      id: '00000000-0000-0000-0000-000000000000',
      bezeichnung: 'Gibt es nicht', sollzeitMinuten: '60',
    }))).rejects.toThrow(RevierFehler);
  });
});

describe('§5 archivieren', () => {
  it('setzt Archivstempel UND schliesst das Aktivfenster', async () => {
    const a = await anlegen({ bezeichnung: 'Wird archiviert' });
    await alsApp(sitzung(), (tx) => archiviereRevier(kontextAus(tx, f.reinigung), a.id));
    const [z] = await sql.unsafe<{ archiviert_am: string | null; bis: string | null }[]>(
      `select archiviert_am, to_char(aktiv_bis, 'YYYY-MM-DD') as bis
         from revier where id = $1`, [a.id]);
    expect(z!.archiviert_am).not.toBeNull();
    expect(z!.bis).not.toBeNull();
  });

  it('verletzt das Aktivfenster NICHT, wenn die Zone erst künftig beginnt', async () => {
    /*
     * `revier_aktiv_fenster` verlangt `aktiv_bis >= aktiv_ab`. Eine Zone, die
     * erst 2027 beginnt und heute archiviert wird, faellt ohne `greatest()`
     * genau hier durch — und zwar als Datenbankfehler mitten im Portal.
     */
    const a = await anlegen({ bezeichnung: 'Beginnt erst 2027', aktivAb: '2027-06-01' });
    await alsApp(sitzung(), (tx) => archiviereRevier(kontextAus(tx, f.reinigung), a.id));
    const [z] = await sql.unsafe<{ bis: string }[]>(
      `select to_char(aktiv_bis, 'YYYY-MM-DD') as bis from revier where id = $1`, [a.id]);
    expect(z!.bis).toBe('2027-06-01');
  });

  it('LÖSCHT nichts — an einem Revier hängen Nachweise (Invariante 8)', async () => {
    const a = await anlegen({ bezeichnung: 'Bleibt als Zeile' });
    await alsApp(sitzung(), (tx) => archiviereRevier(kontextAus(tx, f.reinigung), a.id));
    const [z] = await sql.unsafe<{ anzahl: string }[]>(
      `select count(*)::text as anzahl from revier where id = $1`, [a.id]);
    expect(z!.anzahl).toBe('1');
  });

  it('WEIST ein zweites Archivieren ab', async () => {
    const a = await anlegen({ bezeichnung: 'Nur einmal' });
    await alsApp(sitzung(), (tx) => archiviereRevier(kontextAus(tx, f.reinigung), a.id));
    await expect(alsApp(sitzung(), (tx) =>
      archiviereRevier(kontextAus(tx, f.reinigung), a.id))).rejects.toThrow(RevierFehler);
  });
});
