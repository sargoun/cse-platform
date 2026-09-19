/**
 * Der LV-Import (0212) gegen die echte Datenbank.
 *
 * Vier Dinge lassen sich nur hier prüfen:
 *
 *  1. **Der Spaltenentzug auf `einheitspreis_cent` UND `rohdaten`** (K-05,
 *     §1.9). Wäre der Preis in der Vorschau frei lesbar, wäre der Import der
 *     Umweg um den Entzug auf `lv_position` — dieselbe Zahl, dieselbe
 *     Kalkulation, eine Tabelle weiter. Und `rohdaten` trägt ihn im Klartext.
 *     Gegen eine echte Rolle, denn als Eigentümer ist jede Spalte lesbar.
 *  2. **`app.lv_import_preis_lesen`** — gibt NULL statt zu werfen, weil die
 *     Vorschau in EINER gebundenen Transaktion lädt und eine Ausnahme darin
 *     die ganze Seite abbräche.
 *  3. **Die Auslöser aus 0212**: die drei Zeitstempel beim EREIGNIS, die
 *     Unveränderlichkeit der Auslegung nach der Übernahme, und die
 *     Zwischenzeile, die kein abgeschlossener Import mehr aufnimmt.
 *  4. **Die interne Decke.** Ein Importlauf trägt die Kalkulation des
 *     Auftraggebers in Rohform; weder Kundenportal noch Mitarbeiterportal
 *     haben daran etwas zu sehen.
 *
 * Der Dienst selbst (Parser, Vergleich, Übernahme in eine neue Fassung) läuft
 * hier ebenfalls — durch `cse_app` und damit durch jede Policy.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import {
  legeLvImportAn, ladeLvImportZeilen, findeLvImport, uebernimmLvImport,
} from '../../src/server/services/bau/lv-import.js';
import { ladeLvAuswahl, ladeLvPositionen } from '../../src/server/services/bau/lv.js';
import type { LeseKontext, SchreibKontext } from '../../src/server/kontext/index.js';

let f: Fixtur;
const zufall = (): string => String(Math.random()).slice(2, 10);

/**
 * Eine SCHREIBENDE Sitzung im internen Portal.
 *
 * `readonly: false` ist Pflicht und nicht Kosmetik: die Harness setzt
 * `app.readonly` auf `on`, sobald das Feld fehlt (fail-closed), und die
 * `with check`-Bedingung jeder Mandantenpolicy verlangt `not
 * app.ist_readonly()`. Ohne diese Zeile scheitert jeder Schreibvorgang mit
 * „new row violates row-level security policy" — was wie ein Policyfehler
 * aussieht und keiner ist.
 */
const SCHREIBEND = (mandant: string, benutzer: string) => ({
  scope: 'mandant' as const, mandantId: mandant, benutzerId: benutzer,
  portal: 'intern' as const, readonly: false,
});

const CSV = [
  'OZ;Art;Kurztext;Einheit;Menge;Einheitspreis;Positionsart',
  '1;Los;Rohbau;;;;',
  '1.2;Titel;Mauerwerk;;;;',
  '1.2.9;Position;Mauerwerk 24 cm KS;m2;3,333;12,99;Normalposition',
  '1.2.10;Position;Mauerwerk 36 cm KS;m2;17,500;24,50;Normalposition',
  '1.2.100;Position;Sturz;St;0,125;0,99;Bedarfsposition',
  '1.3;Position;Ohne Einheit;;5,000;3,00;',
].join('\n');

interface Aufbau {
  readonly mandant: string;
  readonly kunde: string;
  readonly projekt: string;
  readonly benutzer: string;
}

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function konto(email: string): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`,
    [u!.id, email] as never[]);
  return u!.id;
}

async function baueProjekt(mandant: string, rolle = 'admin'): Promise<Aufbau> {
  const benutzer = await konto(`lvimport-${zufall()}@cse.test`);
  await sql.unsafe(
    /*
     * **`gueltig_ab` ausdruecklich auf GESTERN — und das ist ein Befund, keine
     * Vorsichtsmassnahme.** Der Spaltenvorgabewert ist `app.berlin_heute()`
     * (0169), `app.ist_mitglied` hat aber `p_stichtag date default
     * CURRENT_DATE`, und die Zwei-Argument-Aufrufer (0025
     * `kern.auftrag_verantwortlich_im_mandant`, 0146) nehmen genau diesen
     * Vorgabewert. Zwischen 22:00 UTC und Mitternacht ist `berlin_heute()`
     * schon morgen und `CURRENT_DATE` noch heute: eine soeben angelegte
     * Mitgliedschaft gilt dann NICHT, und das Anlegen des Auftrags scheitert
     * mit „Der Verantwortliche gehoert nicht zu dieser Gesellschaft". Diese
     * Fixtur setzt den Tag deshalb selbst; die Ursache gehoert nach 0169 und
     * steht im Ergebnisbericht.
     */
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, gueltig_ab)
     values ($1,$2,$3, current_date - 1)`,
    [benutzer, mandant, await rolleId(rolle)]);

  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name)
     values ($1,$2,'Bauherr Nord') returning id`, [mandant, `K-${zufall()}`]);
  const [a] = await sql.unsafe<{ id: string }[]>(
    `insert into auftrag (mandant_id, auftragsnummer, kunde_id, art, status, bezeichnung,
                          verantwortlich_benutzer_id, start_datum)
     values ($1,$2,$3,'projekt','aktiv','Rohbau Nord',$4,'2026-01-01') returning id`,
    [mandant, `AU-${zufall()}`, k!.id, benutzer] as never[]);
  const [p] = await sql.unsafe<{ id: string }[]>(
    `insert into projekt (mandant_id, auftrag_id, nummer, bezeichnung, kunde_id, art,
                          vertragsgrundlage, status)
     values ($1,$2,$3,'Rohbau Nord',$4,'hochbau','vob_b','in_arbeit') returning id`,
    [mandant, a!.id, `P-${zufall()}`, k!.id] as never[]);

  return { mandant, kunde: k!.id, projekt: p!.id, benutzer };
}

/**
 * Ein Kontext, der auf DERSELBEN Transaktion arbeitet wie `alsApp`.
 *
 * Die Dienste nehmen `LeseKontext`/`SchreibKontext`; die Harness gibt eine
 * `postgres.TransactionSql`. Ohne diese Brücke müsste der Test die Abfragen
 * der Dienste abschreiben — und prüfte dann eine Kopie statt der Abfrage.
 */
function kontextAus(tx: postgres.TransactionSql, bau: Aufbau): SchreibKontext {
  const fuehre = async <T>(s: string, w?: readonly unknown[]): Promise<readonly T[]> =>
    tx.unsafe(s, (w ?? []) as never[]) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId: bau.benutzer,
    aktiverMandantId: bau.mandant, mandantIds: [bau.mandant],
    abfrage: fuehre, schreibe: fuehre,
  } satisfies LeseKontext & SchreibKontext;
}

beforeEach(async () => { f = await seed(); });
afterAll(async () => { await schliessen(); });

describe('K-05: der Preis der Zwischenzeile hängt an derselben Spaltenkante', () => {
  it('`einheitspreis_cent` und `rohdaten` stehen NICHT im Grant für `cse_app`', async () => {
    const spalten = await sql.unsafe<{ column_name: string }[]>(
      `select column_name from information_schema.column_privileges
        where grantee = 'cse_app' and table_name = 'lv_import_zeile'
          and privilege_type = 'SELECT' order by 1`);
    const namen = spalten.map((s) => s.column_name);
    // Die Gegenprobe: der Grant ist da und trägt die harmlosen Spalten.
    expect(namen).toContain('oz');
    expect(namen).toContain('menge');
    expect(namen).not.toContain('einheitspreis_cent');
    expect(namen).not.toContain('rohdaten');
  });

  it('und ein direkter Zugriff scheitert hart, statt still zu maskieren', async () => {
    const bau = await baueProjekt(f.bau);
    await expect(alsApp(
      SCHREIBEND(f.bau, bau.benutzer),
      async (tx) => tx.unsafe(`select einheitspreis_cent from lv_import_zeile`),
    )).rejects.toThrow(/permission denied|einheitspreis_cent/u);
  });

  it('`app.lv_import_preis_lesen` gibt ihn heraus — und nur mit `bau.preis_lesen`',
    async () => {
      const bau = await baueProjekt(f.bau, 'admin');
      const zeilen = await alsApp(
        SCHREIBEND(f.bau, bau.benutzer),
        async (tx) => {
          const kontext = kontextAus(tx, bau);
          const { importId } = await legeLvImportAn(kontext, {
            projektId: bau.projekt, dateiname: 'lv.csv', format: 'csv_semikolon',
            bezeichnung: 'LV Rohbau', inhalt: CSV,
          });
          return ladeLvImportZeilen(kontext, importId);
        },
      );
      const preise = zeilen.map((z) => z.einheitspreis_cent);
      // 12,99 € → 1299 Cent; ganzzahlig, nie 12.99 als Gleitkommazahl.
      expect(preise).toContain('1299');
      expect(preise).toContain('2450');
    });

  it('ohne das Recht bleibt der Preis NULL — und die Zeile trotzdem lesbar', async () => {
    const admin = await baueProjekt(f.bau, 'admin');
    const importId = await alsApp(
      SCHREIBEND(f.bau, admin.benutzer),
      async (tx) => (await legeLvImportAn(kontextAus(tx, admin), {
        projektId: admin.projekt, dateiname: 'lv.csv', format: 'csv_semikolon',
        bezeichnung: 'LV Rohbau', inhalt: CSV,
      })).importId,
    );

    const ohne = await konto(`lvimport-lesen-${zufall()}@cse.test`);
    await sql.unsafe(
      /*
       * **`gueltig_ab` ausdruecklich auf GESTERN — und das ist ein Befund, keine
       * Vorsichtsmassnahme.** Der Spaltenvorgabewert ist `app.berlin_heute()`
       * (0169), `app.ist_mitglied` hat aber `p_stichtag date default
       * CURRENT_DATE`, und die Zwei-Argument-Aufrufer (0025
       * `kern.auftrag_verantwortlich_im_mandant`, 0146) nehmen genau diesen
       * Vorgabewert. Zwischen 22:00 UTC und Mitternacht ist `berlin_heute()`
       * schon morgen und `CURRENT_DATE` noch heute: eine soeben angelegte
       * Mitgliedschaft gilt dann NICHT, und das Anlegen des Auftrags scheitert
       * mit „Der Verantwortliche gehoert nicht zu dieser Gesellschaft". Diese
       * Fixtur setzt den Tag deshalb selbst; die Ursache gehoert nach 0169 und
       * steht im Ergebnisbericht.
       */
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, gueltig_ab)
       values ($1,$2,$3, current_date - 1)`,
      [ohne, f.bau, await rolleId('leitung')]);

    const zeilen = await alsApp(
      SCHREIBEND(f.bau, ohne),
      async (tx) => ladeLvImportZeilen(kontextAus(tx, { ...admin, benutzer: ohne }), importId),
    );
    expect(zeilen.length).toBeGreaterThan(0);
    expect(zeilen.every((z) => z.einheitspreis_cent === null)).toBe(true);
    // Mengen und Texte bleiben da: die Vorschau ist ohne Preise brauchbar.
    expect(zeilen.map((z) => z.oz)).toContain('1.2.9');
  });
});

describe('die Vorschau berührt nichts — und die Übernahme legt eine NEUE Fassung an', () => {
  it('nach dem Prüfen gibt es kein Leistungsverzeichnis', async () => {
    const bau = await baueProjekt(f.bau);
    const kopf = await alsApp(
      SCHREIBEND(f.bau, bau.benutzer),
      async (tx) => {
        const kontext = kontextAus(tx, bau);
        const { importId } = await legeLvImportAn(kontext, {
          projektId: bau.projekt, dateiname: 'lv.csv', format: 'csv_semikolon',
          bezeichnung: 'LV Rohbau', inhalt: CSV,
        });
        return findeLvImport(kontext, importId);
      },
    );
    expect(kopf?.status).toBe('geprueft');
    expect(kopf?.leistungsverzeichnis_id).toBeNull();
    // 6 Zeilen, 5 gültig — „1.3" ist eine Position ohne Einheit (0071).
    expect(kopf?.zeilen_gesamt).toBe(6);
    expect(kopf?.zeilen_gueltig).toBe(5);
    expect(kopf?.zeilen_fehler).toBe(1);

    const [lv] = await sql.unsafe<{ anzahl: string }[]>(
      `select count(*)::text as anzahl from leistungsverzeichnis where projekt_id = $1`,
      [bau.projekt]);
    expect(Number(lv!.anzahl)).toBe(0);
  });

  it('die Übernahme schreibt den Baum in OZ-Ordnung, mit Eltern aus der OZ', async () => {
    const bau = await baueProjekt(f.bau);
    const ergebnis = await alsApp(
      SCHREIBEND(f.bau, bau.benutzer),
      async (tx) => {
        const kontext = kontextAus(tx, bau);
        const { importId } = await legeLvImportAn(kontext, {
          projektId: bau.projekt, dateiname: 'lv.csv', format: 'csv_semikolon',
          bezeichnung: 'LV Rohbau', inhalt: CSV,
        });
        const uebernahme = await uebernimmLvImport(kontext, importId);
        return {
          uebernahme,
          positionen: await ladeLvPositionen(kontext, uebernahme.leistungsverzeichnisId),
        };
      },
    );

    expect(ergebnis.uebernahme.fassung).toBe(1);
    expect(ergebnis.uebernahme.angelegt).toBe(5);
    // `1.2.10` HINTER `1.2.9`, und `1.2.100` dahinter — aus `sortier_pfad`.
    expect(ergebnis.positionen.map((p) => p.oz))
      .toEqual(['1', '1.2', '1.2.9', '1.2.10', '1.2.100']);
    const ebenen = new Map(ergebnis.positionen.map((p) => [p.oz, p.ebene]));
    expect(ebenen.get('1')).toBe(1);
    expect(ebenen.get('1.2')).toBe(2);
    expect(ebenen.get('1.2.9')).toBe(3);
  });

  it('der Einheitspreis wandert MIT — aber nur durch den geprüften Leser', async () => {
    const bau = await baueProjekt(f.bau, 'admin');
    const ergebnis = await alsApp(
      SCHREIBEND(f.bau, bau.benutzer),
      async (tx) => {
        const kontext = kontextAus(tx, bau);
        const { importId } = await legeLvImportAn(kontext, {
          projektId: bau.projekt, dateiname: 'lv.csv', format: 'csv_semikolon',
          bezeichnung: 'LV Rohbau', inhalt: CSV,
        });
        return uebernimmLvImport(kontext, importId);
      },
    );
    expect(ergebnis.preiseUebernommen).toBe(true);
    /*
     * Als EIGENTÜMER gelesen, und zwar mit Absicht: die Frage lautet „steht
     * dort etwas?", und `cse_app` sähe die Spalte gar nicht (K-05). Dass sie
     * für die Anwendung unlesbar ist, prüft der erste Abschnitt.
     */
    const preise = await sql.unsafe<{ oz: string; preis: string | null }[]>(
      `select oz, einheitspreis_cent::text as preis from lv_position
        where leistungsverzeichnis_id = $1 and art = 'position' order by sortier_pfad`,
      [ergebnis.leistungsverzeichnisId]);
    expect(preise.map((p) => p.preis)).toEqual(['1299', '2450', '99']);
  });

  it('ohne `bau.preis_lesen` bleibt die neue Fassung OHNE Preise — nie mit geratenen',
    async () => {
      const bau = await baueProjekt(f.bau, 'leitung');
      const ergebnis = await alsApp(
        SCHREIBEND(f.bau, bau.benutzer),
        async (tx) => {
          const kontext = kontextAus(tx, bau);
          const { importId } = await legeLvImportAn(kontext, {
            projektId: bau.projekt, dateiname: 'lv.csv', format: 'csv_semikolon',
            bezeichnung: 'LV Rohbau', inhalt: CSV,
          });
          return uebernimmLvImport(kontext, importId);
        },
      );
      expect(ergebnis.preiseUebernommen).toBe(false);
      const preise = await sql.unsafe<{ preis: string | null }[]>(
        `select einheitspreis_cent::text as preis from lv_position
          where leistungsverzeichnis_id = $1 and art = 'position'`,
        [ergebnis.leistungsverzeichnisId]);
      expect(preise.every((p) => p.preis === null)).toBe(true);
      // Mengen und Texte sind trotzdem vollständig — die Fassung ist brauchbar.
      expect(preise).toHaveLength(3);
    });

  it('ein zweiter Import wird gegen die JÜNGSTE Fassung verglichen', async () => {
    const bau = await baueProjekt(f.bau);
    const zweiter = await alsApp(
      SCHREIBEND(f.bau, bau.benutzer),
      async (tx) => {
        const kontext = kontextAus(tx, bau);
        const erst = await legeLvImportAn(kontext, {
          projektId: bau.projekt, dateiname: 'lv.csv', format: 'csv_semikolon',
          bezeichnung: 'LV Rohbau', inhalt: CSV,
        });
        await uebernimmLvImport(kontext, erst.importId);

        const nochmal = await legeLvImportAn(kontext, {
          projektId: bau.projekt, dateiname: 'lv-2.csv', format: 'csv_semikolon',
          bezeichnung: 'LV Rohbau, Stand 2', inhalt: CSV.replace('17,500', '19,000'),
        });
        const zeilen = await ladeLvImportZeilen(kontext, nochmal.importId);
        const uebernahme = await uebernimmLvImport(kontext, nochmal.importId);
        return { zeilen, uebernahme };
      },
    );

    const jeOz = new Map(zweiter.zeilen.map((z) => [z.oz, z.aktion]));
    // Dieselbe Zeile: unverändert. Die geänderte Menge: aktualisieren.
    expect(jeOz.get('1.2.9')).toBe('unveraendert');
    expect(jeOz.get('1.2.10')).toBe('aktualisieren');
    // Und die neue Fassung trägt ALLE gültigen Zeilen, nicht nur die geänderte.
    expect(zweiter.uebernahme.fassung).toBe(2);
    expect(zweiter.uebernahme.angelegt).toBe(5);
  });

  it('ein nicht implementiertes Format wird abgewiesen, nicht halb gelesen', async () => {
    const bau = await baueProjekt(f.bau);
    await expect(alsApp(
      SCHREIBEND(f.bau, bau.benutzer),
      async (tx) => legeLvImportAn(kontextAus(tx, bau), {
        projektId: bau.projekt, dateiname: 'lv.x83', format: 'gaeb_da_xml',
        bezeichnung: 'LV aus GAEB', inhalt: '<GAEB/>',
      }),
    )).rejects.toThrow(/O-41|nicht gelesen/u);
  });

  it('und ein fremdes Projekt ist nicht vorhanden, nicht verboten (AUT-06)', async () => {
    const bau = await baueProjekt(f.bau);
    const fremd = await baueProjekt(f.reinigung);
    await expect(alsApp(
      SCHREIBEND(f.bau, bau.benutzer),
      async (tx) => legeLvImportAn(kontextAus(tx, bau), {
        projektId: fremd.projekt, dateiname: 'lv.csv', format: 'csv_semikolon',
        bezeichnung: 'LV', inhalt: CSV,
      }),
    )).rejects.toThrow(/Projekt nicht gefunden/u);
  });
});

describe('die Auslöser aus 0212', () => {
  async function importKopf(bau: Aufbau): Promise<string> {
    const [z] = await sql.unsafe<{ id: string }[]>(
      `insert into lv_import (mandant_id, projekt_id, dateiname, format, bezeichnung,
                              status, erstellt_von)
       values ($1,$2,'lv.csv','csv_semikolon','LV Rohbau','geprueft',$3) returning id`,
      [bau.mandant, bau.projekt, bau.benutzer] as never[]);
    return z!.id;
  }

  it('die drei Zeitstempel entstehen beim EREIGNIS, nicht beim Einfügen', async () => {
    const bau = await baueProjekt(f.bau);
    const id = await importKopf(bau);
    const [frisch] = await sql.unsafe<{ g: string | null; u: string | null; v: string | null }[]>(
      `select geprueft_am::text as g, uebernommen_am::text as u, verworfen_am::text as v
         from lv_import where id = $1`, [id]);
    expect(frisch!.g).toBeNull();
    expect(frisch!.u).toBeNull();
    expect(frisch!.v).toBeNull();

    // Ein mitgeschickter Zeitpunkt wird durch die Serverzeit ersetzt.
    await sql.unsafe(
      `update lv_import set geprueft_am = '2001-01-01T00:00:00Z' where id = $1`, [id]);
    const [danach] = await sql.unsafe<{ alt: boolean }[]>(
      `select (geprueft_am < '2010-01-01'::timestamptz) as alt from lv_import where id = $1`,
      [id]);
    expect(danach!.alt).toBe(false);
  });

  it('nach der Übernahme ist die Auslegung unveränderlich', async () => {
    const bau = await baueProjekt(f.bau);
    const id = await importKopf(bau);
    const [lv] = await sql.unsafe<{ id: string }[]>(
      `insert into leistungsverzeichnis (mandant_id, projekt_id, art, bezeichnung)
       values ($1,$2,'hauptauftrag','LV Rohbau') returning id`,
      [bau.mandant, bau.projekt] as never[]);
    await sql.unsafe(
      `update lv_import set status = 'uebernommen', uebernommen_am = now(),
                            uebernommen_von = $2, leistungsverzeichnis_id = $3
        where id = $1`, [id, bau.benutzer, lv!.id] as never[]);

    await expect(
      sql.unsafe(`update lv_import set format = 'excel' where id = $1`, [id]),
    ).rejects.toThrow(/unveraenderlich/u);
  });

  it('und ein abgeschlossener Import nimmt keine Zeile mehr auf', async () => {
    const bau = await baueProjekt(f.bau);
    const id = await importKopf(bau);
    await sql.unsafe(
      `update lv_import set status = 'verworfen', verworfen_am = now() where id = $1`, [id]);
    await expect(sql.unsafe(
      `insert into lv_import_zeile (mandant_id, import_id, zeilennummer, rohdaten, oz,
                                    art, kurztext, ist_gueltig)
       values ($1,$2,1,'{}'::jsonb,'1','los','Rohbau',true)`,
      [bau.mandant, id] as never[],
    )).rejects.toThrow(/nimmt keine Zeile mehr auf/u);
  });

  it('eine Zeile ohne Kopf in dieser Gesellschaft ist ein Fremdschlüsselfehler, kein Leck',
    async () => {
      const bau = await baueProjekt(f.bau);
      const fremd = await baueProjekt(f.reinigung);
      const id = await importKopf(fremd);
      await expect(sql.unsafe(
        `insert into lv_import_zeile (mandant_id, import_id, zeilennummer, rohdaten, oz,
                                      art, kurztext, ist_gueltig)
         values ($1,$2,1,'{}'::jsonb,'1','los','Rohbau',true)`,
        [bau.mandant, id] as never[],
      )).rejects.toThrow(/keinen LV-Import in dieser Gesellschaft/u);
    });

  it('`aktualisieren` ohne Ziel wird abgewiesen — das wäre Anlegen unter falschem Namen',
    async () => {
      const bau = await baueProjekt(f.bau);
      const id = await importKopf(bau);
      await expect(sql.unsafe(
        `insert into lv_import_zeile (mandant_id, import_id, zeilennummer, rohdaten, oz,
                                      art, kurztext, ist_gueltig, aktion)
         values ($1,$2,1,'{}'::jsonb,'1','los','Rohbau',true,'aktualisieren')`,
        [bau.mandant, id] as never[],
      )).rejects.toThrow(/lviz_aktualisieren_mit_ziel/u);
    });
});

describe('Invariante 3 und K-04 — Mandant und interne Decke', () => {
  it('ein Import der Reinigung ist für den Bau nicht vorhanden', async () => {
    const fremd = await baueProjekt(f.reinigung);
    await alsApp(
      SCHREIBEND(f.reinigung, fremd.benutzer),
      async (tx) => legeLvImportAn(kontextAus(tx, fremd), {
        projektId: fremd.projekt, dateiname: 'lv.csv', format: 'csv_semikolon',
        bezeichnung: 'LV', inhalt: CSV,
      }),
    );

    const bau = await baueProjekt(f.bau);
    const gesehen = await alsApp(
      SCHREIBEND(f.bau, bau.benutzer),
      async (tx) => tx.unsafe(`select id from lv_import`),
    ) as { id: string }[];
    expect(gesehen).toHaveLength(0);
  });

  it('und im Mitarbeiterportal ist er unsichtbar — er trägt die Kalkulation des Kunden',
    async () => {
      const bau = await baueProjekt(f.bau, 'admin');
      await alsApp(
        SCHREIBEND(f.bau, bau.benutzer),
        async (tx) => legeLvImportAn(kontextAus(tx, bau), {
          projektId: bau.projekt, dateiname: 'lv.csv', format: 'csv_semikolon',
          bezeichnung: 'LV', inhalt: CSV,
        }),
      );

      const kraft = await konto(`lvimport-kraft-${zufall()}@cse.test`);
      await sql.unsafe(
        /*
         * **`gueltig_ab` ausdruecklich auf GESTERN — und das ist ein Befund, keine
         * Vorsichtsmassnahme.** Der Spaltenvorgabewert ist `app.berlin_heute()`
         * (0169), `app.ist_mitglied` hat aber `p_stichtag date default
         * CURRENT_DATE`, und die Zwei-Argument-Aufrufer (0025
         * `kern.auftrag_verantwortlich_im_mandant`, 0146) nehmen genau diesen
         * Vorgabewert. Zwischen 22:00 UTC und Mitternacht ist `berlin_heute()`
         * schon morgen und `CURRENT_DATE` noch heute: eine soeben angelegte
         * Mitgliedschaft gilt dann NICHT, und das Anlegen des Auftrags scheitert
         * mit „Der Verantwortliche gehoert nicht zu dieser Gesellschaft". Diese
         * Fixtur setzt den Tag deshalb selbst; die Ursache gehoert nach 0169 und
         * steht im Ergebnisbericht.
         */
        `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, gueltig_ab)
         values ($1,$2,$3, current_date - 1)`,
        [kraft, f.bau, await rolleId('mitarbeiter')]);
      const gesehen = await alsApp(
        { scope: 'mandant', mandantId: f.bau, benutzerId: kraft, portal: 'mitarbeiter', readonly: false },
        async (tx) => tx.unsafe(`select id from lv_import`),
      ) as { id: string }[];
      expect(gesehen).toHaveLength(0);
    });
});

describe('Invariante 8 — der Kopf bleibt, die Zwischenzeilen dürfen weichen', () => {
  it('der Importkopf ist gegen harte Löschung gesperrt', async () => {
    const bau = await baueProjekt(f.bau);
    const [z] = await sql.unsafe<{ id: string }[]>(
      `insert into lv_import (mandant_id, projekt_id, dateiname, format, bezeichnung,
                              erstellt_von)
       values ($1,$2,'lv.csv','csv_semikolon','LV',$3) returning id`,
      [bau.mandant, bau.projekt, bau.benutzer] as never[]);
    await expect(sql.unsafe(`delete from lv_import where id = $1`, [z!.id]))
      .rejects.toThrow(/Hard delete/u);
  });

  it('die Zwischenzeilen aber nicht — `cse_job` räumt sie nach der Übernahme', async () => {
    const rechte = await sql.unsafe<{ privilege_type: string }[]>(
      `select privilege_type from information_schema.role_table_grants
        where grantee = 'cse_job' and table_name = 'lv_import_zeile'
          and privilege_type = 'DELETE'`);
    expect(rechte).toHaveLength(1);
    const policies = await sql.unsafe<{ polname: string }[]>(
      `select p.polname from pg_policy p join pg_class c on c.oid = p.polrelid
        where c.relname = 'lv_import_zeile' and p.polcmd = 'd'`);
    expect(policies.map((p) => p.polname)).toContain('t_job_raeumen');
  });
});

/**
 * Zwei Fassungen — und trotzdem EINE Auswahl.
 *
 * **Der Befund, gegen den dieser Block steht.** Die Übernahme legt eine neue
 * Fassung an und lässt die alte stehen (sie ist der Beleg dessen, was
 * ursprünglich vereinbart wurde, § 2 Abs. 6 VOB/B). `ladeLvAuswahl` filterte
 * aber nur auf `projekt_id` und `archiviert_am is null` — also stand nach dem
 * ersten Import JEDE Ordnungszahl zweimal in der Auswahl der
 * Aufmasserfassung und der Mängelliste, angezeigt als `{oz} · {kurztext}` und
 * damit nicht unterscheidbar.
 *
 * Das ist kein Anzeigefehler: `findeLvPosition` summiert `menge_aufgemessen`
 * je `lv_position_id`. Wer die alte Zeile traf, liess die Position der
 * aktuellen Fassung auf 0 stehen — die Mehrmengenwarnung nach § 2 Abs. 3
 * VOB/B (BAU-05) feuerte nie, und die Menge hing am Einheitspreis einer
 * überholten Fassung.
 */
describe('nach der Übernahme steht keine OZ zweimal in der Auswahl', () => {
  const CSV_FASSUNG_2 = [
    'OZ;Art;Kurztext;Einheit;Menge;Einheitspreis;Positionsart',
    '1;Los;Rohbau;;;;',
    '1.2;Titel;Mauerwerk;;;;',
    '1.2.9;Position;Mauerwerk 24 cm KS;m2;4,000;12,99;Normalposition',
    '1.2.10;Position;Mauerwerk 36 cm KS;m2;17,500;24,50;Normalposition',
  ].join('\n');

  it('zwei Übernahmen, zwei Fassungen — und jede Ordnungszahl genau einmal', async () => {
    const bau = await baueProjekt(f.bau);
    const ergebnis = await alsApp(
      SCHREIBEND(f.bau, bau.benutzer),
      async (tx) => {
        const kontext = kontextAus(tx, bau);
        const erste = await legeLvImportAn(kontext, {
          projektId: bau.projekt, dateiname: 'lv-1.csv', format: 'csv_semikolon',
          bezeichnung: 'LV Rohbau', inhalt: CSV,
        });
        const f1 = await uebernimmLvImport(kontext, erste.importId);
        const zweite = await legeLvImportAn(kontext, {
          projektId: bau.projekt, dateiname: 'lv-2.csv', format: 'csv_semikolon',
          bezeichnung: 'LV Rohbau, Fassung 2', inhalt: CSV_FASSUNG_2,
        });
        const f2 = await uebernimmLvImport(kontext, zweite.importId);
        return { f1, f2, auswahl: await ladeLvAuswahl(kontext, bau.projekt) };
      },
    );

    expect(ergebnis.f1.fassung).toBe(1);
    expect(ergebnis.f2.fassung).toBe(2);

    const ozs = ergebnis.auswahl.map((z) => z.oz);
    expect(new Set(ozs).size, `doppelte OZ in der Auswahl: ${ozs.join(', ')}`)
      .toBe(ozs.length);
    // Und es ist die JÜNGSTE Fassung, nicht irgendeine.
    expect(ergebnis.auswahl.every((z) => z.fassung === 2)).toBe(true);
    expect(ergebnis.auswahl.every((z) => z.verzeichnis_art === 'hauptauftrag')).toBe(true);
    // Nur Positionen — ein Titel ist keine Buchungsstelle.
    expect(ozs.sort()).toEqual(['1.2.10', '1.2.9']);
  });

  it('die alte Fassung bleibt lesbar — sie ist der Beleg, nicht die Buchungsstelle',
    async () => {
      const bau = await baueProjekt(f.bau);
      const stand = await alsApp(
        SCHREIBEND(f.bau, bau.benutzer),
        async (tx) => {
          const kontext = kontextAus(tx, bau);
          const erste = await legeLvImportAn(kontext, {
            projektId: bau.projekt, dateiname: 'lv-1.csv', format: 'csv_semikolon',
            bezeichnung: 'LV Rohbau', inhalt: CSV,
          });
          const f1 = await uebernimmLvImport(kontext, erste.importId);
          const zweite = await legeLvImportAn(kontext, {
            projektId: bau.projekt, dateiname: 'lv-2.csv', format: 'csv_semikolon',
            bezeichnung: 'LV Rohbau, Fassung 2', inhalt: CSV_FASSUNG_2,
          });
          await uebernimmLvImport(kontext, zweite.importId);
          return ladeLvPositionen(kontext, f1.leistungsverzeichnisId);
        },
      );
      // Fassung 1 steht vollständig da — mit der Menge, die damals vereinbart war.
      expect(stand.map((z) => z.oz)).toEqual(['1', '1.2', '1.2.9', '1.2.10', '1.2.100']);
      expect(stand.find((z) => z.oz === '1.2.9')?.mengeVertrag).toBe('3.333');
    });

  it('und die Vorschau der zweiten Datei benennt, was in ihr FEHLT', async () => {
    /*
     * Die neue Fassung entsteht ausschliesslich aus den Zeilen der Datei:
     * `1.2.100` steht in Fassung 1 und nicht in dieser Datei, ist also
     * gestrichen. Vorher sagte das niemand — und der Begleittext behauptete
     * das Gegenteil. Ob eine Teildatei fortschreibt oder ersetzt, ist offen
     * (O-633); genannt werden muss es so oder so.
     */
    const bau = await baueProjekt(f.bau);
    const kopf = await alsApp(
      SCHREIBEND(f.bau, bau.benutzer),
      async (tx) => {
        const kontext = kontextAus(tx, bau);
        const erste = await legeLvImportAn(kontext, {
          projektId: bau.projekt, dateiname: 'lv-1.csv', format: 'csv_semikolon',
          bezeichnung: 'LV Rohbau', inhalt: CSV,
        });
        await uebernimmLvImport(kontext, erste.importId);
        const zweite = await legeLvImportAn(kontext, {
          projektId: bau.projekt, dateiname: 'lv-2.csv', format: 'csv_semikolon',
          bezeichnung: 'LV Rohbau, Fassung 2', inhalt: CSV_FASSUNG_2,
        });
        return findeLvImport(kontext, zweite.importId);
      },
    );
    expect(kopf?.fehlende_oz).toEqual(['1.2.100']);
  });

  it('beim ERSTEN Import fehlt nichts — es gibt noch keinen Bestand', async () => {
    const bau = await baueProjekt(f.bau);
    const kopf = await alsApp(
      SCHREIBEND(f.bau, bau.benutzer),
      async (tx) => {
        const kontext = kontextAus(tx, bau);
        const erste = await legeLvImportAn(kontext, {
          projektId: bau.projekt, dateiname: 'lv-1.csv', format: 'csv_semikolon',
          bezeichnung: 'LV Rohbau', inhalt: CSV,
        });
        return findeLvImport(kontext, erste.importId);
      },
    );
    expect(kopf?.fehlende_oz).toEqual([]);
  });
});
