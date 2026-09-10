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

  /**
   * Der bestehende Test darueber prueft ZWEI Uebernahmen NACHEINANDER — und
   * damit die Statusabfrage, nicht das Rennen. Zwei gleichzeitige Klicks
   * lesen beide denselben Status und arbeiten beide die Zeilen ab. Fuer
   * Raeume MIT Nummer faengt der natuerliche Schluessel das ab; fuer einen
   * Raum ohne Nummer gibt es keinen, und das Raumbuch haette ihn zweimal.
   */
  it('zwei GLEICHZEITIGE Uebernahmen legen den Raum nicht zweimal an', async () => {
    const o = await objektMitKatalog(f.reinigung);
    // Eine Zeile ohne Raumnummer — der Fall ohne natuerlichen Schluessel.
    const ohneNummer = 'Etage;Raumnummer;Bezeichnung;Flaeche;Belag;Klasse\n'
      + 'EG;;Flur Nord;33,5;PVC;RK1\n';
    const importId = await alsChef(async (db) => {
      const { importId: id } = await legeImportAn(db, o, 'ohne-nummer.csv', ohneNummer);
      return id;
    });

    const ergebnisse = await Promise.allSettled([
      alsChef((db) => uebernimm(db, importId, chef)),
      alsChef((db) => uebernimm(db, importId, chef)),
    ]);
    expect(ergebnisse.filter((e) => e.status === 'fulfilled')).toHaveLength(1);

    const [z] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from raum where objekt_id = $1`, [o]);
    expect(z!.n).toBe('1');
  });

  /**
   * Der `unveraendert`-Vergleich liess drei Felder aus. Die Folge war der
   * stillste denkbare Fehler: die Vorschau meldet „unveraendert“, die
   * Uebernahme ueberspringt die Zeile, der Import gilt als erfolgreich — und
   * die Aenderung aus der Datei kommt nie an.
   */
  const KOPF_MIT_SCHLUESSEL =
    'Schluessel;Etage;Raumnummer;Bezeichnung;Flaeche;Glas;Belag;Klasse';

  it.each([
    ['Glasflaeche', 'R-1;EG;201;Buero;61,4;;PVC;RK1', 'R-1;EG;201;Buero;61,4;9,5;PVC;RK1'],
    ['Etage',       'R-1;EG;201;Buero;61,4;;PVC;RK1', 'R-1;1. OG;201;Buero;61,4;;PVC;RK1'],
    ['Raumnummer',  'R-1;EG;201;Buero;61,4;;PVC;RK1', 'R-1;EG;202;Buero;61,4;;PVC;RK1'],
    ['Bezeichnung', 'R-1;EG;201;Buero;61,4;;PVC;RK1', 'R-1;EG;201;Chefbuero;61,4;;PVC;RK1'],
  ])('eine geaenderte %s gilt NICHT als unveraendert', async (_was, vorher, nachher) => {
    const o = await objektMitKatalog(f.reinigung);
    await alsChef(async (db) => {
      const { importId } = await legeImportAn(
        db, o, 'a.csv', `${KOPF_MIT_SCHLUESSEL}\n${vorher}\n`);
      return uebernimm(db, importId, chef);
    });
    const zweite = await alsChef((db) => pruefe(db, o, `${KOPF_MIT_SCHLUESSEL}\n${nachher}\n`));
    expect(zweite.zeilen[0]?.aktion).toBe('aktualisieren');
  });

  /**
   * Und die Umzugsfelder werden dann auch WIRKLICH geschrieben. Vorher
   * meldete die Vorschau „aktualisieren“, das UPDATE liess Etage und
   * Raumnummer aber aus — der Raum blieb an seinem alten Ort, und der Import
   * meldete Erfolg.
   */
  it('ein umgezogener Raum bekommt seine neue Etage und Nummer', async () => {
    const o = await objektMitKatalog(f.reinigung);
    await alsChef(async (db) => {
      const { importId } = await legeImportAn(
        db, o, 'a.csv', `${KOPF_MIT_SCHLUESSEL}\nR-7;EG;201;Buero;61,4;;PVC;RK1\n`);
      return uebernimm(db, importId, chef);
    });
    await alsChef(async (db) => {
      const { importId } = await legeImportAn(
        db, o, 'b.csv', `${KOPF_MIT_SCHLUESSEL}\nR-7;2. OG;915;Buero;61,4;;PVC;RK1\n`);
      return uebernimm(db, importId, chef);
    });
    const raeume = await sql.unsafe<{ etage: string; raumnummer: string }[]>(
      `select etage, raumnummer from raum where objekt_id = $1`, [o]);
    expect(raeume).toHaveLength(1);
    expect(raeume[0]).toMatchObject({ etage: '2. OG', raumnummer: '915' });
  });

  it('eine wirklich identische Zeile bleibt unveraendert', async () => {
    const o = await objektMitKatalog(f.reinigung);
    await alsChef(async (db) => {
      const { importId } = await legeImportAn(db, o, 'a.csv', DATEI);
      return uebernimm(db, importId, chef);
    });
    const zweite = await alsChef((db) => pruefe(db, o, DATEI));
    expect(zweite.zeilen.every((z) => z.aktion === 'unveraendert')).toBe(true);
  });

  it('der Verlauf traegt jedes Feld, das ueberschrieben wurde', async () => {
    const o = await objektMitKatalog(f.reinigung);
    await alsChef(async (db) => {
      const { importId } = await legeImportAn(
        db, o, 'a.csv',
        'Etage;Raumnummer;Bezeichnung;Flaeche;Belag;Klasse\nEG;201;Buero;61,4;PVC;RK1\n');
      return uebernimm(db, importId, chef);
    });
    await alsChef(async (db) => {
      const { importId } = await legeImportAn(
        db, o, 'b.csv',
        'Etage;Raumnummer;Bezeichnung;Flaeche;Belag;Klasse\nEG;201;Chefbuero;70,0;PVC;RK1\n');
      return uebernimm(db, importId, chef);
    });
    const [h] = await sql.unsafe<{
      vorher: Record<string, unknown>; nachher: Record<string, unknown>;
    }[]>(
      `select vorher, nachher from raum_import_historie
        where aktion = 'aktualisieren' order by erstellt_am desc limit 1`);
    // Vorher UND nachher tragen dieselben Felder — sonst laesst sich der
    // Verlauf nicht vergleichen, und dafuer gibt es ihn.
    expect(Object.keys(h!.vorher).sort()).toEqual(Object.keys(h!.nachher).sort());
    expect(h!.vorher['bezeichnung']).toBe('Buero');
    expect(h!.nachher['bezeichnung']).toBe('Chefbuero');
    expect(h!.vorher['etage']).toBe('EG');
    expect(h!.nachher['flaeche_qm']).toBe('70.000');
  });

  /**
   * Die VERALTETE Vorschau — und der Fall, den die Sperre auf dem Importkopf
   * NICHT abdeckt.
   *
   * Zwei getrennte Rufe derselben Datei erzeugen ZWEI Vorschauen. Beide sehen
   * ein leeres Raumbuch und schreiben `aktion = 'anlegen'`. Wird danach die
   * erste uebernommen und dann die zweite, legt die zweite den Raum ein
   * zweites Mal an: ihre Entscheidung stammt aus einer Welt, die es nicht
   * mehr gibt. Fuer Raeume MIT Nummer faengt `raum_natuerlich_uk` das ab —
   * fuer einen Raum ohne Nummer gab es keinen Schluessel.
   *
   * 08-PR-PLAN §288 (2) verlangt genau das Gegenteil: „Committing the same
   * file twice produces zero duplicates.“
   */
  it('zwei getrennte Vorschauen derselben Datei ergeben EINEN Raum', async () => {
    const o = await objektMitKatalog(f.reinigung);
    const ohneNummer = 'Etage;Raumnummer;Bezeichnung;Flaeche;Belag;Klasse\n'
      + 'EG;;Flur Nord;33,5;PVC;RK1\n';

    const erster = await alsChef(async (db) =>
      (await legeImportAn(db, o, 'a.csv', ohneNummer)).importId);
    const zweiter = await alsChef(async (db) =>
      (await legeImportAn(db, o, 'b.csv', ohneNummer)).importId);

    await alsChef((db) => uebernimm(db, erster, chef));
    await alsChef((db) => uebernimm(db, zweiter, chef));

    const [z] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from raum where objekt_id = $1`, [o]);
    expect(z!.n).toBe('1');
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
