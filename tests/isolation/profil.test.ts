/**
 * PR 15 Akzeptanz (1), (2), (4).
 *
 * (2) ist die wichtigste: eine Referenz ohne Kundenfreigabe ist **nicht im
 * HTML und nicht in der API-Antwort**. Ein Kundenname auf einer Website ohne
 * dessen Zustimmung ist ein Problem, das man nicht durch Löschen ungeschehen
 * macht.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import { ReferenzAusTabelle } from '../../src/server/services/inhalt/referenz.js';
import { localBusinessJsonLd } from '../../src/server/services/inhalt/nap.js';

let f: Fixtur;
const db = { unsafe: (s: string, w?: readonly unknown[]) => sql.unsafe(s, (w ?? []) as never[]) };
const quelle = new ReferenzAusTabelle(db);

beforeEach(async () => {
  f = await seed();
  await sql.unsafe(`truncate referenz, unternehmensprofil, abschnitt, seite, medien cascade`);
});
afterAll(schliessen);

async function referenz(
  mandant: string, titel: string, freigegeben: boolean,
): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `insert into referenz (mandant_id, titel, kunde_name, freigegeben_vom_kunden,
                           freigabe_am, status)
     values ($1,$2,'Beispiel AG',$3,$4,'veroeffentlicht') returning id`,
    [mandant, titel, freigegeben, freigegeben ? new Date().toISOString() : null],
  );
  return r!.id;
}

describe('(2) eine Referenz ohne Kundenfreigabe ist ABWESEND', () => {
  it('der Dienst gibt sie nicht zurück', async () => {
    await referenz(f.reinigung, 'Mit Freigabe', true);
    await referenz(f.reinigung, 'OHNE Freigabe', false);

    const sichtbar = await quelle.fuerMandant(f.reinigung);
    expect(sichtbar.map((r) => r.titel)).toEqual(['Mit Freigabe']);
  });

  it('und die Policy hält sie auch dann fern, wenn der Code die Bedingung vergisst', async () => {
    await referenz(f.reinigung, 'OHNE Freigabe', false);
    // Zwei Linien, nicht eine: eine vergessene `where`-Bedingung im Code ist
    // der wahrscheinlichste Weg zu einem Kundennamen ohne Zustimmung.
    const roh = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, portal: 'intern', readonly: true },
      (tx) => tx.unsafe<unknown[]>(`select id from referenz`),
    );
    expect(roh).toHaveLength(0);
  });

  it('eine Freigabe ohne Datum ist gar nicht speicherbar', async () => {
    // Wer sie erteilt hat und wann, ist bei einem Kundennamen auf einer
    // Website keine Nebensache.
    await expect(
      sql.unsafe(
        `insert into referenz (mandant_id, titel, freigegeben_vom_kunden)
         values ($1,'X',true)`, [f.reinigung],
      ),
    ).rejects.toThrow(/referenz_freigabe_belegt/u);
  });

  it('die Vorgabe ist unsichtbar — eine versehentlich angelegte Zeile erscheint nicht', async () => {
    const [z] = await sql.unsafe<{ freigegeben_vom_kunden: boolean }[]>(
      `insert into referenz (mandant_id, titel) values ($1,'Versehen')
       returning freigegeben_vom_kunden`, [f.reinigung],
    );
    expect(z!.freigegeben_vom_kunden).toBe(false);
  });

  it('eine Referenz eines anderen Bereichs erscheint nicht im eigenen Profil', async () => {
    await referenz(f.security, 'Security-Referenz', true);
    expect(await quelle.fuerMandant(f.reinigung)).toHaveLength(0);
    expect(await quelle.fuerMandant(f.security)).toHaveLength(1);
  });
});

describe('(1) alle vier Profile tragen ihre eigene Identität', () => {
  it('jedes Profil gehört genau einem Bereich', async () => {
    for (const m of [f.reinigung, f.security, f.bau, f.operations]) {
      await sql.unsafe(
        `insert into unternehmensprofil (mandant_id, kurzbeschreibung, status)
         values ($1,'Kurz','veroeffentlicht')`, [m],
      );
    }
    const [z] = await sql.unsafe<{ n: string }[]>(
      `select count(*) n from unternehmensprofil`,
    );
    expect(Number(z!.n)).toBe(4);

    // Ein zweites Profil je Bereich ist nicht speicherbar.
    await expect(
      sql.unsafe(
        `insert into unternehmensprofil (mandant_id, kurzbeschreibung)
         values ($1,'Zweites')`, [f.reinigung],
      ),
    ).rejects.toThrow(/unternehmensprofil_uk|duplicate/iu);
  });

  it('SSE Security zeigt SEINE Identität, nicht eine CSE-Untermarke (D-11)', async () => {
    const [m] = await sql.unsafe<{ firma: string; name: string }[]>(
      `select firma, name from mandant where slug = 'security'`,
    );
    // D-11: SSE Security ist eine eigene Marke, kein Zusatz zu CSE.
    expect(m!.firma).toBe('Select Security Event GmbH');
    expect(m!.name).toBe('SSE Security');
    expect(m!.name.startsWith('CSE')).toBe(false);
  });
});

describe('(4) jedes Profil trägt sein eigenes LocalBusiness-JSON-LD', () => {
  it('mit der NAP DIESER Gesellschaft', async () => {
    const zeilen = await sql.unsafe<Record<string, string | null>[]>(
      `select slug, firma, strasse, plz, ort, land, telefon, email
         from mandant order by sortierung`,
    );
    const lds = zeilen.map((m) =>
      localBusinessJsonLd(m as never, `https://cse-gruppe.de/${String(m['slug'])}`));

    expect(lds).toHaveLength(4);
    // Vier eigene Eintraege, vier eigene Namen, vier eigene URLs — sonst
    // konkurrieren die Gesellschaften in der lokalen Suche miteinander.
    expect(new Set(lds.map((l) => l['name'])).size).toBe(4);
    expect(new Set(lds.map((l) => l['url'])).size).toBe(4);
    for (const l of lds) expect(l['@type']).toBe('LocalBusiness');
  });
});
