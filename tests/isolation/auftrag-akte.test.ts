/**
 * Aufgaben und Dokumente am Auftrag und am Bau-Projekt — gegen echtes
 * Postgres (OPS-11, V-176, D-670, 0421, Invariante 3).
 *
 * **Die Sätze, die diese Datei beweist:**
 *
 *  1. Ein Dokument hängt an einem Auftrag DERSELBEN Gesellschaft — der
 *     Ablagedienst weist einen fremden ab (`BezugUnbekannt`), und wer am
 *     Dienst vorbeischreibt, scheitert am zusammengesetzten Fremdschlüssel
 *     (23503).
 *  2. Das Auftragsblatt liest genau die Dokumente dieses Auftrags, und ohne
 *     `dokument.lesen` keines (`t_mandant`) — die Seite sagt dann, welches
 *     Recht fehlt.
 *  3. Die Aufgaben eines Auftrags sind die mit `auftrag_id` UND die mit dem
 *     polymorphen Bezug `auftrag` — beide Wege schreiben ihn. Liste und
 *     Kopfzahl zählen dieselbe Menge.
 *  4. Das Projektblatt zeigt die Aufgaben am Projekt UND an seinem Auftrag;
 *     `vorgangImFilter` löst einen Vorgang nur auf, wenn die Sitzung ihn
 *     sieht — sonst filtert die Liste nicht.
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { LeseKontext, SchreibKontext } from '../../src/server/kontext/index.js';
import { LokalerSpeicher } from '../../src/server/storage/adapter.js';
import { BezugUnbekannt, legeAb } from '../../src/server/services/dokument/ablage.js';
import { leseDokumenteAmAuftrag } from '../../src/server/services/dokument/vorgang.js';
import {
  aufgabenAkte, listeAufgaben, vorgangImFilter, zaehleJeZustand,
} from '../../src/server/services/kern/aufgabe.js';

let f: Fixtur;
let ablage = '';      // dokument.lesen + dokument.schreiben + auftrag.lesen, Reinigung
let ohneDokument = ''; // auftrag.lesen + aufgabe.lesen, aber kein dokument.lesen
let leitungBau = '';  // die Systemrolle `leitung` im Bau
const zufall = (): string => String(Math.random()).slice(2, 10);

const PDF = (): Uint8Array =>
  Uint8Array.from([...Buffer.from('%PDF-1.7'), ...Buffer.alloc(64)]);

async function konto(praefix: string): Promise<string> {
  const email = `${praefix}-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`,
    [u!.id, email]);
  return u!.id;
}

async function rolleMit(
  mandant: string, schluessel: string, rechte: readonly string[],
): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `insert into rolle (mandant_id, schluessel, bezeichnung, geltungsbereich, portal)
     values ($1, $2, $2, 'mandant', 'intern') returning id`,
    [mandant, `${schluessel}_${zufall()}`]);
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     select $1, b.id, $2, true from berechtigung b where b.schluessel = any($3::text[])`,
    [r!.id, mandant, [...rechte]]);
  return r!.id;
}

async function mitglied(benutzer: string, mandant: string, rolle: string): Promise<void> {
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [benutzer, mandant, rolle]);
}

async function systemrolle(benutzer: string, mandant: string, rolle: string): Promise<void> {
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id)
     values ($1, $2, (select id from rolle where schluessel = $3 and mandant_id is null))`,
    [benutzer, mandant, rolle]);
}

function als<T>(
  benutzerId: string, mandantId: string, fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return alsApp(
    { scope: 'mandant', mandantId, benutzerId, portal: 'intern', readonly: false }, fn);
}

function kontextAus(
  tx: postgres.TransactionSql, benutzerId: string, mandantId: string,
): SchreibKontext {
  const fuehre = async <T>(q: string, w?: readonly unknown[]): Promise<readonly T[]> =>
    tx.unsafe(q, (w ?? []) as never[]) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId,
    aktiverMandantId: mandantId, mandantIds: [mandantId],
    abfrage: fuehre, schreibe: fuehre,
  } satisfies LeseKontext & SchreibKontext;
}

async function kunde(mandant: string): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name) values ($1, $2, 'Hausverwaltung')
     returning id`, [mandant, `K-${zufall()}`]);
  return z!.id;
}

/** Ein Auftrag von Hand — verantwortlich ist ein Mitglied DIESER Gesellschaft. */
async function auftrag(mandant: string, verantwortlich: string): Promise<string> {
  const [a] = await sql.unsafe<{ id: string }[]>(
    `insert into auftrag (mandant_id, auftragsnummer, kunde_id, art, bezeichnung,
                          verantwortlich_benutzer_id, start_datum)
     values ($1, $2, $3, 'einzelauftrag', 'Grundreinigung Treppenhaus', $4, '2026-10-01')
     returning id`, [mandant, `AU-A-${zufall()}`, await kunde(mandant), verantwortlich]);
  return a!.id;
}

/**
 * Eine Aufgabe, als Eigentümer geschrieben. Eine erledigte trägt ihren Beleg
 * (`aufgabe_erledigt_belegt`): wann und von wem.
 */
async function aufgabe(
  mandant: string, titel: string,
  z: { auftragId?: string; bezugTyp?: string; bezugId?: string; status?: string;
    faelligDatum?: string; erledigtVon?: string } = {},
): Promise<string> {
  const [a] = await sql.unsafe<{ id: string }[]>(
    `insert into aufgabe (mandant_id, titel, auftrag_id, bezug_typ, bezug_id, status,
                          faellig_datum, quelle, erledigt_am, erledigt_von)
     values ($1::uuid, $2, $3::uuid, $4::bezug_typ, $5::uuid,
             coalesce($6::aufgabe_status, 'offen'), $7::date, 'mensch',
             case when $8::uuid is null then null else now() end, $8::uuid)
     returning id`,
    [mandant, titel, z.auftragId ?? null, z.bezugTyp ?? null, z.bezugId ?? null,
     z.status ?? null, z.faelligDatum ?? null, z.erledigtVon ?? null]);
  return a!.id;
}

function eingabe(ueber: Record<string, unknown> = {}) {
  return {
    kategorie: 'vertrag',
    titel: `Auftragsbestätigung ${zufall()}`,
    beschreibung: '',
    tags: '',
    kundeId: '',
    objektId: '',
    sichtbarFuerMitarbeiter: false,
    dateiname: 'bestaetigung.pdf',
    daten: PDF(),
    behaupteterTyp: 'application/pdf',
    ...ueber,
  };
}

beforeEach(async () => {
  f = await seed();
  ablage = await konto('akte');
  ohneDokument = await konto('ohnedok');
  leitungBau = await konto('bauleitung');
  await mitglied(ablage, f.reinigung, await rolleMit(f.reinigung, 'akte',
    ['dokument.lesen', 'dokument.schreiben', 'auftrag.lesen', 'aufgabe.lesen']));
  await mitglied(ohneDokument, f.reinigung, await rolleMit(f.reinigung, 'ohnedok',
    ['auftrag.lesen', 'aufgabe.lesen']));
  await systemrolle(leitungBau, f.bau, 'leitung');
});
afterAll(schliessen);

describe('(1) ein Dokument hängt an einem Auftrag DERSELBEN Gesellschaft', () => {
  it('abgelegt mit Auftrag: die Spalte steht, und das Auftragsblatt liest es', async () => {
    const a = await auftrag(f.reinigung, ablage);
    const speicher = new LokalerSpeicher();
    const abgelegt = await als(ablage, f.reinigung, (tx) =>
      legeAb(kontextAus(tx, ablage, f.reinigung), speicher,
        eingabe({ auftragId: a, titel: 'Auftragsbestätigung Treppenhaus' })));

    const [d] = await sql.unsafe<{ auftrag_id: string | null }[]>(
      `select auftrag_id::text as auftrag_id from dokument where id = $1`,
      [abgelegt.dokumentId]);
    expect(d?.auftrag_id).toBe(a);

    const akte = await als(ablage, f.reinigung, (tx) =>
      leseDokumenteAmAuftrag(kontextAus(tx, ablage, f.reinigung), a));
    expect(akte.gesamt).toBe(1);
    expect(akte.weitere).toBe(0);
    expect(akte.zeilen[0]?.titel).toBe('Auftragsbestätigung Treppenhaus');
    expect(akte.zeilen[0]?.kategorie).toBe('vertrag');
    // Der Berliner Kalendertag, JJJJ-MM-TT — aus der Datenbank, nicht aus der Serveruhr;
    // das Blatt schreibt ihn in seiner Sprache (V-240).
    const [heute] = await sql.unsafe<{ tag: string }[]>(`select app.berlin_heute()::text as tag`);
    expect(akte.zeilen[0]?.abgelegtAm).toBe(heute!.tag);
  });

  it('ohne Auftrag abgelegt bleibt die Spalte leer — die übrigen Ablagewege unverändert', async () => {
    const speicher = new LokalerSpeicher();
    const abgelegt = await als(ablage, f.reinigung, (tx) =>
      legeAb(kontextAus(tx, ablage, f.reinigung), speicher, eingabe()));
    const [d] = await sql.unsafe<{ auftrag_id: string | null }[]>(
      `select auftrag_id from dokument where id = $1`, [abgelegt.dokumentId]);
    expect(d?.auftrag_id).toBeNull();
  });

  it('ein Auftrag einer FREMDEN Gesellschaft wird abgewiesen — und nichts entsteht', async () => {
    const fremd = await auftrag(f.bau, leitungBau);
    const speicher = new LokalerSpeicher();
    const titel = `Fremdbezug ${zufall()}`;
    await expect(als(ablage, f.reinigung, (tx) =>
      legeAb(kontextAus(tx, ablage, f.reinigung), speicher,
        eingabe({ auftragId: fremd, titel })),
    )).rejects.toThrow(BezugUnbekannt);
    const [n] = await sql.unsafe<{ n: string }[]>(
      `select count(*) n from dokument where titel = $1`, [titel]);
    expect(Number(n!.n)).toBe(0);
  });

  it('wer am Dienst vorbeischreibt, scheitert am Fremdschlüssel (0421)', async () => {
    const fremd = await auftrag(f.bau, leitungBau);
    await expect(sql.unsafe(
      `insert into dokument (mandant_id, kategorie, titel, bucket, objekt_schluessel,
                             mime_typ, mime_verifiziert, groesse_bytes, exif_entfernt,
                             entstanden_am, auftrag_id)
       values ($1, 'vertrag', 'Vorbeigeschrieben', 'dokumente', $2, 'application/pdf',
               true, 100, true, current_date, $3)`,
      [f.reinigung, `test/${zufall()}.pdf`, fremd],
    )).rejects.toMatchObject({ code: '23503' });
  });
});

describe('(2) das Auftragsblatt liest genau seine Dokumente — und nur mit Leserecht', () => {
  it('ein zweiter Auftrag sieht die Dokumente des ersten nicht', async () => {
    const a = await auftrag(f.reinigung, ablage);
    const b = await auftrag(f.reinigung, ablage);
    const speicher = new LokalerSpeicher();
    await als(ablage, f.reinigung, (tx) =>
      legeAb(kontextAus(tx, ablage, f.reinigung), speicher, eingabe({ auftragId: a })));
    const akteB = await als(ablage, f.reinigung, (tx) =>
      leseDokumenteAmAuftrag(kontextAus(tx, ablage, f.reinigung), b));
    expect(akteB).toEqual({ zeilen: [], gesamt: 0, weitere: 0 });
  });

  it('ohne `dokument.lesen` liefert die Abfrage nichts (RLS) — die Seite fragt das Recht vorher', async () => {
    const a = await auftrag(f.reinigung, ablage);
    const speicher = new LokalerSpeicher();
    await als(ablage, f.reinigung, (tx) =>
      legeAb(kontextAus(tx, ablage, f.reinigung), speicher, eingabe({ auftragId: a })));
    const akte = await als(ohneDokument, f.reinigung, (tx) =>
      leseDokumenteAmAuftrag(kontextAus(tx, ohneDokument, f.reinigung), a));
    expect(akte.gesamt).toBe(0);
  });

  it('eine verstümmelte Kennung ist eine leere Akte, kein Datenbankfehler', async () => {
    const akte = await als(ablage, f.reinigung, (tx) =>
      leseDokumenteAmAuftrag(kontextAus(tx, ablage, f.reinigung), 'AU-2026-00001'));
    expect(akte).toEqual({ zeilen: [], gesamt: 0, weitere: 0 });
  });
});

describe('(3) die Aufgaben eines Auftrags — beide Wege, eine Menge', () => {
  it('auftrag_id UND polymorpher Bezug zählen; ein anderer Auftrag nicht', async () => {
    const a = await auftrag(f.reinigung, ablage);
    const b = await auftrag(f.reinigung, ablage);
    await aufgabe(f.reinigung, 'Schlüssel übergeben', { auftragId: a, faelligDatum: '2026-01-05' });
    await aufgabe(f.reinigung, 'Leistungsnachweis gegenzeichnen lassen',
      { bezugTyp: 'auftrag', bezugId: a, status: 'in_arbeit' });
    await aufgabe(f.reinigung, 'Erstreinigung abnehmen',
      { auftragId: a, status: 'erledigt', erledigtVon: ablage });
    await aufgabe(f.reinigung, 'Anderer Auftrag', { auftragId: b });
    await aufgabe(f.reinigung, 'Ohne Bezug');

    const { offene, alle, jeZustand } = await als(ablage, f.reinigung, async (tx) => {
      const k = kontextAus(tx, ablage, f.reinigung);
      return {
        offene: await listeAufgaben(k, { auftragId: a, nurOffene: true }),
        alle: await listeAufgaben(k, { auftragId: a }),
        jeZustand: await zaehleJeZustand(k, { auftragId: a }),
      };
    });
    expect(offene.map((z) => z.titel).sort()).toEqual(
      ['Leistungsnachweis gegenzeichnen lassen', 'Schlüssel übergeben']);
    expect(alle).toHaveLength(3);
    expect(jeZustand).toEqual({ offen: 1, in_arbeit: 1, erledigt: 1 });

    const akte = aufgabenAkte(offene, jeZustand, new Date('2026-02-01T09:00:00Z'));
    expect(akte.offen).toBe(2);
    expect(akte.geschlossen).toBe(1);
    // Die Frist vom 05.01. ist am 01.02. abgelaufen; die ohne Frist nicht.
    expect(akte.ueberfaellig).toBe(1);
    expect(akte.zeilen[0]?.frist).toBe('05.01.2026');
  });

  it('eine verstümmelte Kennung wirft vor der Abfrage — kein 22P02 aus der Datenbank', async () => {
    await expect(als(ablage, f.reinigung, (tx) =>
      listeAufgaben(kontextAus(tx, ablage, f.reinigung), { auftragId: 'x' }),
    )).rejects.toThrow('Unbekannter Auftrag');
  });
});

describe('(4) das Projektblatt: Projekt UND Auftrag — und nur, was die Sitzung sieht', () => {
  it('die Aufgaben am Projekt und an seinem Auftrag stehen zusammen', async () => {
    const a = await auftrag(f.bau, leitungBau);
    const [kd] = await sql.unsafe<{ kunde_id: string }[]>(
      `select kunde_id::text as kunde_id from auftrag where id = $1`, [a]);
    const [p] = await sql.unsafe<{ id: string }[]>(
      `insert into projekt (mandant_id, auftrag_id, nummer, bezeichnung, kunde_id, art,
                            vertragsgrundlage)
       values ($1, $2, $3, 'Ausbau Dachgeschoss', $4, 'ausbau', 'vob_b') returning id`,
      [f.bau, a, `P-${zufall()}`, kd!.kunde_id]);
    await aufgabe(f.bau, 'Bautagebuch nachtragen', { bezugTyp: 'projekt', bezugId: p!.id });
    await aufgabe(f.bau, 'Abschlagsrechnung vorbereiten', { auftragId: a });
    await aufgabe(f.bau, 'Fremdes Projekt', { bezugTyp: 'projekt', bezugId: a });

    const { vorgang, zeilen } = await als(leitungBau, f.bau, async (tx) => {
      const k = kontextAus(tx, leitungBau, f.bau);
      const v = await vorgangImFilter(k, { projektId: p!.id });
      return { vorgang: v, zeilen: v === null ? [] : await listeAufgaben(k, v.filter) };
    });
    expect(vorgang?.art).toBe('projekt');
    expect(vorgang?.auftragId).toBe(a);
    expect(vorgang?.auftragTitel).toMatch(/Grundreinigung Treppenhaus$/u);
    expect(zeilen.map((z) => z.titel).sort()).toEqual(
      ['Abschlagsrechnung vorbereiten', 'Bautagebuch nachtragen']);
  });

  it('einen Auftrag einer anderen Gesellschaft löst der Filter nicht auf', async () => {
    const fremd = await auftrag(f.reinigung, ablage);
    const vorgang = await als(leitungBau, f.bau, (tx) =>
      vorgangImFilter(kontextAus(tx, leitungBau, f.bau), { auftragId: fremd }));
    expect(vorgang).toBeNull();
  });

  it('ohne `auftrag.lesen` gibt es keinen Auftrag zum Filtern — die Liste bleibt ungefiltert', async () => {
    const a = await auftrag(f.reinigung, ablage);
    const ohneAuftrag = await konto('ohneauftrag');
    await mitglied(ohneAuftrag, f.reinigung,
      await rolleMit(f.reinigung, 'nuraufgabe', ['aufgabe.lesen']));
    const vorgang = await als(ohneAuftrag, f.reinigung, (tx) =>
      vorgangImFilter(kontextAus(tx, ohneAuftrag, f.reinigung), { auftragId: a }));
    expect(vorgang).toBeNull();
  });

  it('eine verstümmelte Kennung ist kein Vorgang, und keine Abfrage castet sie', async () => {
    const vorgang = await als(ablage, f.reinigung, (tx) =>
      vorgangImFilter(kontextAus(tx, ablage, f.reinigung), { projektId: 'P-1; drop' }));
    expect(vorgang).toBeNull();
  });
});
