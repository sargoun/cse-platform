/**
 * Der Raumbuch-Import gegen eine echte Datenbank (OPS-04).
 *
 * Die Zusage, die hier haelt oder nicht haelt: **nichts beruehrt das
 * lebende Raumbuch, bevor jemand die Vorschau gesehen hat** — und ein
 * zweiter Import derselben Datei aendert nichts.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import { legeImportAn, pruefe, uebernimm }
  from '../../src/server/services/raumbuch/import.js';

let f: Fixtur;
let chef = '';
const zufall = (): string => String(Math.random()).slice(2, 10);

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function konto(): Promise<string> {
  const email = `import-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`, [u!.id, email]);
  return u!.id;
}

async function objektMitKatalog(mandant: string): Promise<string> {
  await sql.unsafe(
    `insert into belagsart (mandant_id, code, bezeichnung, leistungswert_qm_pro_stunde,
                            quelle, gueltig_ab)
     values ($1,'PVC','PVC','250.000','Platzhalter (O-17)','2026-01-01'),
            ($1,'TEPPICH','Teppich','300.000','Platzhalter (O-17)','2026-01-01')`, [mandant]);
  await sql.unsafe(
    `insert into reinigungsklasse (mandant_id, code, bezeichnung) values ($1,'RK1','Buero')`,
    [mandant]);
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, objektnummer, bezeichnung, strasse, plz, ort)
     values ($1,$2,'Buerohaus','Strasse 1','10719','Berlin') returning id`,
    [mandant, `OBJ-${zufall()}`]);
  return o!.id;
}

function kontextAus(tx: Parameters<Parameters<typeof alsApp>[1]>[0]) {
  return {
    abfrage: async <R,>(s: string, w: readonly unknown[] = []) =>
      (await tx.unsafe(s, w as never[])) as readonly R[],
  };
}

const alsChef = <T>(fn: (db: ReturnType<typeof kontextAus>) => Promise<T>): Promise<T> =>
  alsApp({ scope: 'mandant', mandantId: f.reinigung, benutzerId: chef,
           portal: 'intern', readonly: false }, async (tx) => fn(kontextAus(tx)));

const DATEI = [
  'Etage;Raumnummer;Bezeichnung;Fläche m²;Belag;Klasse',
  'UG;101;Lager;18,0;PVC;RK1',
  'EG;101;Empfang;46,75;TEPPICH;RK1',
  'EG;;Foyer;61,4;TEPPICH;RK1',
  '',
].join('\n');

beforeEach(async () => {
  f = await seed();
  chef = await konto();
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [chef, f.reinigung, await rolleId('admin')]);
});
afterAll(schliessen);

describe('(1) Die Vorschau schreibt NICHTS', () => {
  it('sie sagt, was passieren wuerde — und das Raumbuch bleibt leer', async () => {
    const o = await objektMitKatalog(f.reinigung);
    const vorschau = await alsChef((db) => pruefe(db, o, DATEI));

    expect(vorschau.gesamt).toBe(3);
    expect(vorschau.gueltig).toBe(3);
    expect(vorschau.anlegen).toBe(3);

    const [z] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from raum where objekt_id = $1`, [o]);
    expect(Number(z!.n)).toBe(0);
  });

  it('die Belagsarten werden aufgeloest, die unbekannte gemeldet', async () => {
    const o = await objektMitKatalog(f.reinigung);
    const mitUnbekannt = DATEI.replace('UG;101;Lager;18,0;PVC;RK1',
                                       'UG;101;Lager;18,0;MARMOR;RK1');
    const vorschau = await alsChef((db) => pruefe(db, o, mitUnbekannt));
    const erste = vorschau.zeilen[0]!;
    expect(erste.belagsartId).toBeNull();
    expect(erste.fehler.join(' ')).toContain('MARMOR');
    // ABER die Zeile bleibt gueltig: die Flaeche geht nicht verloren.
    expect(erste.istGueltig).toBe(true);
    expect(erste.aktion).toBe('anlegen');
  });

  it('eine Zeile ohne Flaeche ist ungueltig und wird uebersprungen', async () => {
    const o = await objektMitKatalog(f.reinigung);
    const kaputt = DATEI.replace('EG;101;Empfang;46,75;TEPPICH;RK1',
                                 'EG;101;Empfang;;TEPPICH;RK1');
    const vorschau = await alsChef((db) => pruefe(db, o, kaputt));
    expect(vorschau.fehlerhaft).toBe(1);
    expect(vorschau.zeilen[1]?.aktion).toBe('ignorieren');
  });

  it('eine doppelte Zeile INNERHALB der Datei wird erkannt', async () => {
    const o = await objektMitKatalog(f.reinigung);
    const doppelt = `${DATEI}UG;101;Lager nochmal;18,0;PVC;RK1\n`;
    const vorschau = await alsChef((db) => pruefe(db, o, doppelt));
    expect(vorschau.zeilen.at(-1)?.fehler.join(' ')).toContain('zweimal');
    expect(vorschau.zeilen.at(-1)?.istGueltig).toBe(false);
  });
});

describe('(2) Die Uebernahme — und nur sie schreibt', () => {
  it('drei Zeilen, drei Raeume, mit Herkunft', async () => {
    const o = await objektMitKatalog(f.reinigung);
    const ergebnis = await alsChef(async (db) => {
      const { importId } = await legeImportAn(db, o, 'raumbuch.csv', DATEI);
      return uebernimm(db, importId, chef);
    });
    expect(ergebnis).toMatchObject({ angelegt: 3, aktualisiert: 0, uebersprungen: 0 });

    const [z] = await sql.unsafe<{ n: string; summe: string }[]>(
      `select count(*)::text as n, sum(flaeche_qm)::text as summe
         from raum where objekt_id = $1`, [o]);
    expect(Number(z!.n)).toBe(3);
    // 18,0 + 46,75 + 61,4 = 126,15
    expect(Number(z!.summe)).toBeCloseTo(126.15, 2);

    const [h] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from raum_import_historie`);
    expect(Number(h!.n)).toBe(3);
  });

  it('die 101 im UG und die 101 im EG bleiben ZWEI Raeume', async () => {
    const o = await objektMitKatalog(f.reinigung);
    await alsChef(async (db) => {
      const { importId } = await legeImportAn(db, o, 'raumbuch.csv', DATEI);
      return uebernimm(db, importId, chef);
    });
    const zeilen = await sql.unsafe<{ etage: string; raumnummer: string | null }[]>(
      `select etage, raumnummer from raum where objekt_id = $1 and raumnummer = '101'`, [o]);
    expect(zeilen).toHaveLength(2);
    expect(zeilen.map((z) => z.etage).sort()).toEqual(['EG', 'UG']);
  });

  it('DERSELBE Import ein zweites Mal aendert nichts', async () => {
    const o = await objektMitKatalog(f.reinigung);
    await alsChef(async (db) => {
      const { importId } = await legeImportAn(db, o, 'raumbuch.csv', DATEI);
      return uebernimm(db, importId, chef);
    });
    const zweiter = await alsChef(async (db) => {
      const { importId, vorschau } = await legeImportAn(db, o, 'raumbuch.csv', DATEI);
      const e = await uebernimm(db, importId, chef);
      return { vorschau, e };
    });
    expect(zweiter.vorschau.unveraendert).toBe(3);
    expect(zweiter.e).toMatchObject({ angelegt: 0, aktualisiert: 0, unveraendert: 3 });

    const [z] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from raum where objekt_id = $1`, [o]);
    expect(Number(z!.n)).toBe(3);
  });

  it('eine geaenderte Flaeche wird als AKTUALISIEREN erkannt und geschrieben', async () => {
    const o = await objektMitKatalog(f.reinigung);
    await alsChef(async (db) => {
      const { importId } = await legeImportAn(db, o, 'raumbuch.csv', DATEI);
      return uebernimm(db, importId, chef);
    });
    const geaendert = DATEI.replace('UG;101;Lager;18,0;PVC;RK1', 'UG;101;Lager;22,5;PVC;RK1');
    const zweiter = await alsChef(async (db) => {
      const { importId, vorschau } = await legeImportAn(db, o, 'raumbuch-neu.csv', geaendert);
      const e = await uebernimm(db, importId, chef);
      return { vorschau, e };
    });
    expect(zweiter.vorschau.aktualisieren).toBe(1);
    expect(zweiter.e.aktualisiert).toBe(1);

    const [z] = await sql.unsafe<{ flaeche: string }[]>(
      `select flaeche_qm::text as flaeche from raum
        where objekt_id = $1 and etage = 'UG' and raumnummer = '101'`, [o]);
    expect(Number(z!.flaeche)).toBe(22.5);

    // Und die Historie haelt fest, was vorher stand.
    const [h] = await sql.unsafe<{ vorher: { flaeche_qm: string } }[]>(
      `select vorher from raum_import_historie where aktion = 'aktualisieren'`);
    expect(Number(h!.vorher.flaeche_qm)).toBe(18);
  });

  /**
   * `jsonb` haelt ein OBJEKT, keinen JSON-Text.
   *
   * `JSON.stringify` in einen `jsonb`-Parameter schreibt einen JSON-STRING in
   * die Spalte: `jsonb_typeof` ist dann `string`, jeder `->>`-Zugriff greift
   * ins Leere, und man sieht es der Zeile in der Anzeige nicht an. Dieser
   * Test ist die Stelle, an der es auffliegt.
   */
  it('Rohdaten und Historie stehen als OBJEKT in der Spalte, nicht als Text', async () => {
    const o = await objektMitKatalog(f.reinigung);
    await alsChef(async (db) => {
      const { importId } = await legeImportAn(db, o, 'raumbuch.csv', DATEI);
      return uebernimm(db, importId, chef);
    });
    const [z] = await sql.unsafe<{ typ: string; wert: string | null }[]>(
      `select jsonb_typeof(rohdaten) as typ, rohdaten->>'Bezeichnung' as wert
         from raumbuch_import_zeile order by zeilennummer limit 1`);
    expect(z!.typ).toBe('object');
    expect(z!.wert).toBe('Lager');

    const [h] = await sql.unsafe<{ typ: string }[]>(
      `select jsonb_typeof(nachher) as typ from raum_import_historie limit 1`);
    expect(h!.typ).toBe('object');
  });

  it('ein bereits uebernommener Import wird nicht erneut uebernommen', async () => {
    const o = await objektMitKatalog(f.reinigung);
    await expect(alsChef(async (db) => {
      const { importId } = await legeImportAn(db, o, 'raumbuch.csv', DATEI);
      await uebernimm(db, importId, chef);
      return uebernimm(db, importId, chef);
    })).rejects.toThrow(/bereits uebernommen/u);
  });

  it('und seine Auslegung ist danach unveraenderlich', async () => {
    const o = await objektMitKatalog(f.reinigung);
    const importId = await alsChef(async (db) => {
      const { importId: id } = await legeImportAn(db, o, 'raumbuch.csv', DATEI);
      await uebernimm(db, id, chef);
      return id;
    });
    await expect(sql.unsafe(
      `update raumbuch_import set spalten_zuordnung = '{}'::jsonb where id = $1`, [importId],
    )).rejects.toThrow(/unveraenderlich/u);
  });
});

describe('(3) Der Import bleibt im eigenen Bereich', () => {
  it('ein fremdes Objekt liefert eine leere Vorschau, keinen Fehler', async () => {
    const fremd = await objektMitKatalog(f.security);
    const vorschau = await alsChef((db) => pruefe(db, fremd, DATEI));
    // Die Zeilen werden gelesen, aber KEIN Bestand gefunden — alles "anlegen".
    expect(vorschau.anlegen).toBe(3);
    // Und die Uebernahme scheitert an der Policy, nicht an einer Pruefung im Code.
    await expect(alsChef(async (db) => {
      const { importId } = await legeImportAn(db, fremd, 'x.csv', DATEI);
      return uebernimm(db, importId, chef);
    })).rejects.toThrow();
  });

  it('das Kundenportal sieht keinen Import', async () => {
    const o = await objektMitKatalog(f.reinigung);
    await alsChef((db) => legeImportAn(db, o, 'raumbuch.csv', DATEI));
    const kundeKonto = await konto();
    const [k] = await sql.unsafe<{ id: string }[]>(
      `insert into kunde (mandant_id, kundennummer, name, rechtsgrundlage,
                          rechtsgrundlage_quelle, rechtsgrundlage_erfasst_am, status)
       values ($1,$2,'K','bestandskunde','V', now(), 'aktiv') returning id`,
      [f.reinigung, `K-${zufall()}`]);
    await sql.unsafe(
      `insert into kunde_zugang (mandant_id, kunde_id, benutzer_id) values ($1,$2,$3)`,
      [f.reinigung, k!.id, kundeKonto]);
    const gesehen = await alsApp(
      { scope: 'kunde', mandantId: f.reinigung, benutzerId: kundeKonto },
      async (tx) => tx.unsafe(`select id from raumbuch_import`));
    expect(gesehen).toHaveLength(0);
  });
});
