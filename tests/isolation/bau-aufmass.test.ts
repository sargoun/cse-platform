/**
 * PR 43 gegen die echte Datenbank — das Aufmass (BAU-02, BAU-03).
 *
 * Die drei Zusagen, die hier und nur hier zu pruefen sind:
 *
 *  1. **Ohne Gegenzeichnung und ohne Foto wird nichts festgeschrieben.** Das
 *     ist ein AUSLOESER, keine Formularpflicht — sonst genuegte ein
 *     zusammengebauter POST, um ein Blatt ohne Beleg in die Abrechnung zu
 *     heben.
 *  2. **Der gespeicherte Wert ist eine ganze Zahl in fester Skala**, und
 *     `menge` ist seine Projektion. Die Datenbank rechnet das nach.
 *  3. **Ein einseitiges Aufmass ist NICHT „gegengezeichnet"** (Review B10).
 *     Eine Unterschrift des Auftragnehmers darf keinen Datensatz erzeugen, der
 *     die Teilnahme des Auftraggebers behauptet.
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import {
  erfasseAufmass, gegenzeichne, hefteFotoAn, ladeVorlageStand, pruefeVorlage,
} from '../../src/server/services/bau/aufmass.js';

let f: Fixtur;
const zufall = (): string => String(Math.random()).slice(2, 10);

interface Aufbau {
  readonly mandant: string;
  readonly kunde: string;
  readonly projekt: string;
  readonly lv: string;
  readonly position: string;
  readonly benutzer: string;
  /** D-09: die Gegenzeichnung des AUFTRAGNEHMERS haengt an einer Beschaeftigung. */
  readonly anstellung: string;
}

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function konto(email: string, personId: string | null = null): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, person_id)
     values ($1,$2,$2,'aktiv',$3)`, [u!.id, email, personId] as never[]);
  return u!.id;
}

async function baueProjekt(
  mandant: string, rolle = 'leitung', konfidenz: number | null = null,
): Promise<Aufbau> {
  const benutzer = await konto(`bau-${zufall()}@cse.test`);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
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
                          vertragsgrundlage)
     values ($1,$2,$3,'Rohbau Nord',$4,'hochbau','vob_b') returning id`,
    [mandant, a!.id, `P-${zufall()}`, k!.id] as never[]);
  const [lv] = await sql.unsafe<{ id: string }[]>(
    `insert into leistungsverzeichnis (mandant_id, projekt_id, art, bezeichnung)
     values ($1,$2,'hauptauftrag','LV Rohbau') returning id`,
    [mandant, p!.id] as never[]);
  const [pos] = await sql.unsafe<{ id: string }[]>(
    `insert into lv_position (mandant_id, leistungsverzeichnis_id, projekt_id, oz, pfad,
                              sortier_pfad, ebene, art, kurztext, einheit, menge_vertrag,
                              einheitspreis_cent, konfidenz)
     values ($1,$2,$3,'01.02.0030','','',1,'position','Mauerwerk','m²',120,4599,$4::numeric)
     returning id`,
    [mandant, lv!.id, p!.id, konfidenz] as never[]);

  const [person] = await sql.unsafe<{ id: string }[]>(
    `insert into person (vorname, nachname) values ('Polier',$1) returning id`,
    [`Nr-${zufall()}`]);
  const [anst] = await sql.unsafe<{ id: string }[]>(
    `insert into anstellung (mandant_id, person_id, personalnummer, eintritt)
     values ($1,$2,$3,'2026-01-01') returning id`,
    [mandant, person!.id, `PN-${zufall()}`] as never[]);

  return {
    mandant, kunde: k!.id, projekt: p!.id, lv: lv!.id, position: pos!.id, benutzer,
    anstellung: anst!.id,
  };
}

/** Ein Blatt mit einer Zeile — der Rechenansatz aus SPEC §8. */
async function baueBlatt(
  bau: Aufbau,
  opts: { erhebungsart?: 'gemeinsam' | 'einseitig'; ankuendigung?: string | null } = {},
): Promise<{ readonly id: string; readonly zeile: string }> {
  const [blatt] = await sql.unsafe<{ id: string }[]>(
    `insert into aufmass (mandant_id, projekt_id, kunde_id, nummer, bezeichnung, messdatum,
                          erhebungsart, ankuendigung_am, leistungsverzeichnis_id)
     values ($1,$2,$3,$4,'Wand Achse C, OG1','2026-09-10',$5::aufmass_erhebungsart,
             $6::date,$7) returning id`,
    [
      bau.mandant, bau.projekt, bau.kunde, `A-${zufall()}`,
      opts.erhebungsart ?? 'gemeinsam', opts.ankuendigung ?? null, bau.lv,
    ] as never[]);
  const [zeile] = await sql.unsafe<{ id: string }[]>(
    `insert into aufmass_zeile (mandant_id, aufmass_id, projekt_id, kunde_id, lv_position_id,
                                reihenfolge, bezeichnung, rechenansatz, ergebnis_skaliert,
                                menge, einheit)
     values ($1,$2,$3,$3,$4,1,'Wand Achse C',
             '3 × (4,20 × 2,75) − 2 × (0,90 × 2,10)', 308700, 30.870, 'm²')
     returning id`,
    [bau.mandant, blatt!.id, bau.projekt, bau.position] as never[]);
  return { id: blatt!.id, zeile: zeile!.id };
}

/** Ein Messfoto — der Beleg, ohne den BAU-03 nichts durchlaesst. */
async function baueFoto(bau: Aufbau, aufmassId: string, zweck = 'nachweis'): Promise<string> {
  // Der Pfad ist eine reine UUID-Folge (`me_pfad_uuid`, 0041) und wird hier
  // gebaut statt in SQL: `$1` waere sonst einmal uuid und einmal text, und
  // Postgres leitet fuer einen Parameter genau EINEN Typ ab.
  const pfad = `${bau.mandant}/${crypto.randomUUID()}`;
  const [m] = await sql.unsafe<{ id: string }[]>(
    `insert into einsatz_medien (mandant_id, bezug_tabelle, bezug_id, art, bucket, pfad,
                                 mime_typ, groesse_bytes, sha256, erstellt_von_art)
     values ($1,'aufmass',$2,'foto','einsatz-medien',$3,
             'image/jpeg', 12345, repeat('a',64), 'system')
     returning id`,
    [bau.mandant, aufmassId, pfad] as never[]);
  const [foto] = await sql.unsafe<{ id: string }[]>(
    `insert into aufmass_foto (mandant_id, aufmass_id, kunde_id, medien_id, zweck,
                               erstellt_von_art)
     values ($1,$2,$3,$4,$5::aufmass_foto_zweck,'system') returning id`,
    [bau.mandant, aufmassId, bau.kunde, m!.id, zweck] as never[]);
  return foto!.id;
}

async function unterschrift(
  bau: Aufbau, aufmassId: string, rolle: 'auftraggeber' | 'auftragnehmer',
  anstellung: string | null = null,
): Promise<void> {
  await sql.unsafe(
    `insert into aufmass_signatur (mandant_id, aufmass_id, kunde_id, rolle, anstellung_id,
                                   unterzeichner_name, snapshot, snapshot_hash,
                                   erstellt_von_art)
     values ($1,$2,$3,$4::unterschrift_rolle,$5::uuid,'Frau Beyer','{}'::jsonb,
             repeat('b',64),'system')`,
    [bau.mandant, aufmassId, bau.kunde, rolle, anstellung] as never[]);
}

function kontextAus(
  tx: postgres.TransactionSql, mandant: string, benutzer: string,
): SchreibKontext {
  const abfrage = async <T>(
    anweisung: string, werte?: readonly unknown[],
  ): Promise<readonly T[]> =>
    (await tx.unsafe(anweisung, (werte ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId: benutzer,
    aktiverMandantId: mandant, mandantIds: [mandant],
    abfrage, schreibe: abfrage,
  };
}

beforeEach(async () => { f = await seed(); });
afterAll(async () => { await schliessen(); });

describe('(3) ohne Gegenzeichnung und ohne Foto wird nichts festgeschrieben', () => {
  it('der Uebergang aus dem Entwurf scheitert ohne Messfoto (BAU-03)', async () => {
    const bau = await baueProjekt(f.bau);
    const blatt = await baueBlatt(bau);
    await expect(
      sql.unsafe(`update aufmass set status = 'vorgelegt' where id = $1`, [blatt.id]),
    ).rejects.toThrow(/Messfoto/u);
  });

  it('ein Foto mit anderem Zweck genuegt NICHT — verlangt ist der Nachweis', async () => {
    const bau = await baueProjekt(f.bau);
    const blatt = await baueBlatt(bau);
    await baueFoto(bau, blatt.id, 'uebersicht');
    await expect(
      sql.unsafe(`update aufmass set status = 'vorgelegt' where id = $1`, [blatt.id]),
    ).rejects.toThrow(/Messfoto/u);
  });

  it('mit Messfoto geht es — und die Unterschrift des Auftraggebers friert ein', async () => {
    const bau = await baueProjekt(f.bau);
    const blatt = await baueBlatt(bau);
    await baueFoto(bau, blatt.id);
    await sql.unsafe(`update aufmass set status = 'vorgelegt' where id = $1`, [blatt.id]);
    await unterschrift(bau, blatt.id, 'auftraggeber');

    const [k] = await sql.unsafe<{ status: string; gesperrt: string | null }[]>(
      `select status::text as status, gesperrt_am::text as gesperrt from aufmass where id = $1`,
      [blatt.id]);
    expect(k!.status).toBe('gegengezeichnet');
    expect(k!.gesperrt).not.toBeNull();

    // Und der Kopfzustand ist bei den Kindern angekommen (Kundendecke!).
    const [z] = await sql.unsafe<{ kopf_status: string }[]>(
      `select kopf_status::text as kopf_status from aufmass_zeile where aufmass_id = $1`,
      [blatt.id]);
    expect(z!.kopf_status).toBe('gegengezeichnet');
  });

  it('nach der Sperre aendert sich nichts mehr — auch nicht die Zeile', async () => {
    const bau = await baueProjekt(f.bau);
    const blatt = await baueBlatt(bau);
    await baueFoto(bau, blatt.id);
    await sql.unsafe(`update aufmass set status = 'vorgelegt' where id = $1`, [blatt.id]);
    await unterschrift(bau, blatt.id, 'auftraggeber');

    await expect(
      sql.unsafe(`update aufmass set bezeichnung = 'anders' where id = $1`, [blatt.id]),
    ).rejects.toThrow(/unveraenderlich/u);
    await expect(
      sql.unsafe(`update aufmass_zeile set rechenansatz = '1' where id = $1`, [blatt.zeile]),
    ).rejects.toThrow(/unveraenderlich/u);
  });

  it('und ein Blatt wird nie geloescht (Invariante 8)', async () => {
    const bau = await baueProjekt(f.bau);
    const blatt = await baueBlatt(bau);
    await expect(
      sql.unsafe(`delete from aufmass where id = $1`, [blatt.id]),
    ).rejects.toThrow(/gesperrt|Invariante 8/u);
  });
});

describe('der Kopfzustand kommt bei den Kindern an — unter `cse_app`, nicht als Eigentuemer', () => {
  /**
   * **Dieser Fall ist der Grund, warum `kern.aufmass_kopf_denorm()` ein
   * Definer ist.** Als Eigentuemer laufen die Pruefungen oben an RLS vorbei
   * und saehen nichts; unter `cse_app` traefe ein UPDATE auf `aufmass_foto`
   * und `aufmass_signatur` keine Policy — und ein UPDATE ohne Policy aendert
   * null Zeilen und MELDET ERFOLG. Die Kinder blieben auf `entwurf`, der Kunde
   * saehe sein eigenes unterschriebenes Blatt nicht, und es gaebe keinen
   * Fehler, an dem das auffiele.
   */
  it('Zeile, Foto und Unterschrift tragen den Zustand des Kopfes', async () => {
    const bau = await baueProjekt(f.bau);
    const blatt = await baueBlatt(bau);
    await baueFoto(bau, blatt.id);

    await alsApp(
      {
        scope: 'mandant', mandantId: f.bau, benutzerId: bau.benutzer,
        portal: 'intern', readonly: false,
      },
      async (tx) => {
        await tx.unsafe(`update aufmass set status = 'vorgelegt' where id = $1`, [blatt.id]);
        await tx.unsafe(
          `insert into aufmass_signatur (mandant_id, aufmass_id, kunde_id, rolle,
                                         unterzeichner_name, snapshot, snapshot_hash,
                                         erstellt_von)
           values ($1,$2,$3,'auftraggeber','Frau Beyer','{}'::jsonb,repeat('c',64),
                   app.aktueller_benutzer())`,
          [bau.mandant, blatt.id, bau.kunde] as never[]);
      },
    );

    const [z] = await sql.unsafe<{ zeile: string; foto: string; signatur: string }[]>(
      `select (select kopf_status::text from aufmass_zeile where aufmass_id = $1) as zeile,
              (select kopf_status::text from aufmass_foto where aufmass_id = $1) as foto,
              (select kopf_status::text from aufmass_signatur where aufmass_id = $1) as signatur`,
      [blatt.id]);
    expect(z!.zeile).toBe('gegengezeichnet');
    expect(z!.foto).toBe('gegengezeichnet');
    expect(z!.signatur).toBe('gegengezeichnet');
  });
});

describe('(3) B10: eine einseitige Feststellung ist keine Gegenzeichnung', () => {
  it('die Unterschrift des Auftragnehmers macht ein gemeinsames Blatt NICHT fertig', async () => {
    const bau = await baueProjekt(f.bau);
    const blatt = await baueBlatt(bau, { erhebungsart: 'gemeinsam' });
    await baueFoto(bau, blatt.id);
    await sql.unsafe(`update aufmass set status = 'vorgelegt' where id = $1`, [blatt.id]);
    await unterschrift(bau, blatt.id, 'auftragnehmer', bau.anstellung);

    const [k] = await sql.unsafe<{ status: string }[]>(
      `select status::text as status from aufmass where id = $1`, [blatt.id]);
    // „vorgelegt", nicht „gegengezeichnet": der Auftraggeber hat nichts getan.
    expect(k!.status).toBe('vorgelegt');
  });

  it('bei angekuendigter einseitiger Feststellung entsteht der EIGENE Zustand', async () => {
    const bau = await baueProjekt(f.bau);
    const blatt = await baueBlatt(bau, { erhebungsart: 'einseitig', ankuendigung: '2026-09-01' });
    await baueFoto(bau, blatt.id);
    await sql.unsafe(`update aufmass set status = 'vorgelegt' where id = $1`, [blatt.id]);
    await unterschrift(bau, blatt.id, 'auftragnehmer', bau.anstellung);

    const [k] = await sql.unsafe<{ status: string; gesperrt: string | null }[]>(
      `select status::text as status, gesperrt_am::text as gesperrt from aufmass where id = $1`,
      [blatt.id]);
    expect(k!.status).toBe('einseitig_festgestellt');
    expect(k!.gesperrt).not.toBeNull();
  });

  it('ohne Ankuendigung bleibt es liegen — § 14 Abs. 2 VOB/B', async () => {
    const bau = await baueProjekt(f.bau);
    const blatt = await baueBlatt(bau, { erhebungsart: 'einseitig', ankuendigung: null });
    await baueFoto(bau, blatt.id);
    await sql.unsafe(`update aufmass set status = 'vorgelegt' where id = $1`, [blatt.id]);
    await unterschrift(bau, blatt.id, 'auftragnehmer', bau.anstellung);

    const [k] = await sql.unsafe<{ status: string }[]>(
      `select status::text as status from aufmass where id = $1`, [blatt.id]);
    expect(k!.status).toBe('vorgelegt');
  });
});

describe('(5) das Ergebnis ist eine ganze Zahl in fester Skala', () => {
  it('und `menge` ist seine Projektion — die Datenbank rechnet es nach', async () => {
    const bau = await baueProjekt(f.bau);
    const blatt = await baueBlatt(bau);
    const [z] = await sql.unsafe<{ skaliert: string; menge: string; rechenansatz: string }[]>(
      `select ergebnis_skaliert::text as skaliert, menge::text as menge, rechenansatz
         from aufmass_zeile where id = $1`, [blatt.zeile]);
    expect(z!.skaliert).toBe('308700');
    expect(z!.menge).toBe('30.870');
    // Die Formel steht WOERTLICH daneben (BAU-02).
    expect(z!.rechenansatz).toBe('3 × (4,20 × 2,75) − 2 × (0,90 × 2,10)');
  });

  it('eine Menge, die nicht zur ganzen Zahl passt, wird abgewiesen', async () => {
    const bau = await baueProjekt(f.bau);
    const blatt = await baueBlatt(bau);
    await expect(sql.unsafe(
      `insert into aufmass_zeile (mandant_id, aufmass_id, projekt_id, kunde_id, lv_position_id,
                                  reihenfolge, bezeichnung, rechenansatz, ergebnis_skaliert,
                                  menge, einheit)
       values ($1,$2,$3,$3,$4,2,'Falsch','1',308700, 99.999,'m²')`,
      [bau.mandant, blatt.id, bau.projekt, bau.position] as never[],
    )).rejects.toThrow(/az_menge_projektion/u);
  });

  it('und die Einheit der Zeile muss die der LV-Position sein (§1.4)', async () => {
    const bau = await baueProjekt(f.bau);
    const blatt = await baueBlatt(bau);
    await expect(sql.unsafe(
      `insert into aufmass_zeile (mandant_id, aufmass_id, projekt_id, kunde_id, lv_position_id,
                                  reihenfolge, bezeichnung, rechenansatz, ergebnis_skaliert,
                                  menge, einheit)
       values ($1,$2,$3,$3,$4,3,'Falsche Einheit','1',10000, 1.000,'m')`,
      [bau.mandant, blatt.id, bau.projekt, bau.position] as never[],
    )).rejects.toThrow(/Einheit m passt nicht/u);
  });
});

describe('K-10/APR-03: eine ungepruefte maschinelle LV-Position blockiert die Vorlage', () => {
  it('das Blatt bleibt im Entwurf, und die Meldung nennt die OZ', async () => {
    const bau = await baueProjekt(f.bau, 'leitung', 82);
    const blatt = await baueBlatt(bau);
    await baueFoto(bau, blatt.id);
    await expect(
      sql.unsafe(`update aufmass set status = 'vorgelegt' where id = $1`, [blatt.id]),
    ).rejects.toThrow(/01\.02\.0030/u);
  });

  it('nach der Bestaetigung durch einen Menschen geht es', async () => {
    const bau = await baueProjekt(f.bau, 'leitung', 82);
    const blatt = await baueBlatt(bau);
    await baueFoto(bau, blatt.id);
    await sql.unsafe(
      `update lv_position set geprueft_am = now(), geprueft_von = $2 where id = $1`,
      [bau.position, bau.benutzer]);
    await sql.unsafe(`update aufmass set status = 'vorgelegt' where id = $1`, [blatt.id]);
    const [k] = await sql.unsafe<{ status: string }[]>(
      `select status::text as status from aufmass where id = $1`, [blatt.id]);
    expect(k!.status).toBe('vorgelegt');
  });
});

describe('(1) der Dienst rechnet die Menge selbst', () => {
  it('aus der Formel entstehen 308700 — der Aufrufer liefert keine Zahl', async () => {
    const bau = await baueProjekt(f.bau);

    const angelegt = await alsApp(
      {
        scope: 'mandant', mandantId: f.bau, benutzerId: bau.benutzer,
        portal: 'intern', readonly: false,
      },
      async (tx) => erfasseAufmass(kontextAus(tx, f.bau, bau.benutzer), {
        projektId: bau.projekt,
        bezeichnung: 'Wand Achse C, OG1',
        bereich: 'OG1',
        messdatum: '2026-09-10',
        erhebungsart: 'gemeinsam',
        ankuendigungAm: null,
        zeilen: [{
          bezeichnung: 'Wand Achse C',
          rechenansatz: '3 × (4,20 × 2,75) − 2 × (0,90 × 2,10)',
          einheit: 'm²',
          lvPositionId: bau.position,
          ausserhalbLv: false,
        }],
      }),
    );

    const [z] = await sql.unsafe<{ skaliert: string; menge: string; version: string | null }[]>(
      `select ergebnis_skaliert::text as skaliert, menge::text as menge,
              parser_version as version
         from aufmass_zeile where aufmass_id = $1`, [angelegt.id]);
    expect(z!.skaliert).toBe('308700');
    expect(z!.menge).toBe('30.870');
    expect(z!.version).toBe('rechenansatz-1');
  });

  it('und die Gegenzeichnung verweigert sich, solange ein Foto fehlt', async () => {
    const bau = await baueProjekt(f.bau);
    const blatt = await baueBlatt(bau);

    const stand = await alsApp(
      { scope: 'mandant', mandantId: f.bau, benutzerId: bau.benutzer, portal: 'intern' },
      async (tx) => ladeVorlageStand(kontextAus(tx, f.bau, bau.benutzer), blatt.id),
    );
    expect(stand).not.toBeNull();
    expect(pruefeVorlage(stand!)).toContain('kein_foto');

    await expect(alsApp(
      {
        scope: 'mandant', mandantId: f.bau, benutzerId: bau.benutzer,
        portal: 'intern', readonly: false,
      },
      async (tx) => gegenzeichne(kontextAus(tx, f.bau, bau.benutzer), {
        aufmassId: blatt.id, unterzeichnerName: 'Frau Beyer',
      }),
    )).rejects.toThrow(/Messfoto/u);
  });

  it('und ein zweites Mal unterschreibt niemand — das waere ein zweiter Beleg', async () => {
    const bau = await baueProjekt(f.bau);
    const blatt = await baueBlatt(bau);
    await baueFoto(bau, blatt.id);

    const zeichnen = async (): Promise<unknown> => alsApp(
      {
        scope: 'mandant', mandantId: f.bau, benutzerId: bau.benutzer,
        portal: 'intern', readonly: false,
      },
      async (tx) => gegenzeichne(kontextAus(tx, f.bau, bau.benutzer), {
        aufmassId: blatt.id, unterzeichnerName: 'Frau Beyer',
      }),
    );

    await zeichnen();
    // Eine Auskunft, kein Datenbankfehler: die Eindeutigkeitsbedingung
    // `aufmass_signatur_uk` haelt ohnehin — aber sie spricht nicht Deutsch.
    await expect(zeichnen()).rejects.toThrow(/bereits abgeschlossen/u);
  });

  it('mit Foto schreibt sie fest — mit Schnappschuss und SHA-256', async () => {
    const bau = await baueProjekt(f.bau);
    const blatt = await baueBlatt(bau);
    await baueFoto(bau, blatt.id);

    const ergebnis = await alsApp(
      {
        scope: 'mandant', mandantId: f.bau, benutzerId: bau.benutzer,
        portal: 'intern', readonly: false,
      },
      async (tx) => gegenzeichne(kontextAus(tx, f.bau, bau.benutzer), {
        aufmassId: blatt.id,
        unterzeichnerName: 'Frau Beyer',
        unterzeichnerFunktion: 'Bauleiterin AG',
        vorbehalt: 'unter Vorbehalt der Prüfung',
      }),
    );
    expect(ergebnis.status).toBe('gegengezeichnet');
    expect(ergebnis.hash).toMatch(/^[0-9a-f]{64}$/u);

    /**
     * Der Schnappschuss traegt den RECHENANSATZ — nicht nur die Menge. Genau
     * ihn hat der Auftraggeber anerkannt, und ohne ihn liesse sich spaeter
     * nicht mehr zeigen, WORAUF sich die Unterschrift bezog (§10.4).
     */
    const [s] = await sql.unsafe<{ snapshot: { zeilen: { rechenansatz: string }[] } }[]>(
      `select snapshot from aufmass_signatur where aufmass_id = $1`, [blatt.id]);
    expect(s!.snapshot.zeilen[0]!.rechenansatz)
      .toBe('3 × (4,20 × 2,75) − 2 × (0,90 × 2,10)');
  });
});

describe('BAU-02: die Kraft vor Ort nimmt das Blatt selbst auf', () => {
  /**
   * Der Weg, den §1.7 der Rolle `mitarbeiter` zusagt: EIN Bau-Schluessel,
   * `bau.aufmass_erfassen`, und kein `bau.lesen`. Ohne die beiden
   * Erfassungs-Policies auf `projekt` und `lv_position` fände der Dienst das
   * Projekt nicht, auf dem die Kraft gerade steht — und die Meldung waere
   * „Projekt nicht gefunden", also die falsche Auskunft fuer die eine
   * Handlung, die diese Rolle besitzt.
   */
  async function eingeteilt(bau: Aufbau): Promise<{ benutzer: string; person: string }> {
    const [person] = await sql.unsafe<{ id: string; }[]>(
      `insert into person (vorname, nachname) values ('Kraft',$1) returning id`,
      [`Nr-${zufall()}`]);
    const [anst] = await sql.unsafe<{ id: string }[]>(
      `insert into anstellung (mandant_id, person_id, personalnummer, eintritt)
       values ($1,$2,$3,'2026-01-01') returning id`,
      [bau.mandant, person!.id, `PN-${zufall()}`] as never[]);
    const benutzer = await konto(`kraft-${zufall()}@cse.test`, person!.id);
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
      [benutzer, bau.mandant, await rolleId('mitarbeiter')]);

    // Eine laufende Schicht AUF DIESEM PROJEKT — daran haengt der Lesepfad.
    // Mit Objekt: `kern.einsatz_kunde_setzen()` leitet den Kunden aus dem
    // Objekt ab und weist eine Schicht ab, deren Objekt einer anderen
    // Gesellschaft gehoert — eine Fixtur ohne Objekt ist keine Schicht.
    const [o] = await sql.unsafe<{ id: string }[]>(
      `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
       values ($1,$2,$3,'Baustelle Nord','Teststr. 7','10115','Berlin') returning id`,
      [bau.mandant, bau.kunde, `O-${zufall()}`] as never[]);
    const [e] = await sql.unsafe<{ id: string }[]>(
      `insert into einsatz (mandant_id, quelle, quell_schluessel, plan_datum,
                            beginn_zeitpunkt, ende_zeitpunkt, beginn_lokal, ende_lokal,
                            endet_am_folgetag, objekt_id, kunde_id, projekt_id,
                            erstellt_von_art)
       values ($1,'manuell',$2, (now() at time zone 'Europe/Berlin')::date,
               now() - interval '1 hour', now() + interval '6 hours',
               ((now() - interval '1 hour') at time zone 'Europe/Berlin')::time,
               ((now() + interval '6 hours') at time zone 'Europe/Berlin')::time,
               false, $5, $3, $4, 'system')
       returning id`,
      [bau.mandant, `manuell:${zufall()}${zufall()}`, bau.kunde, bau.projekt, o!.id] as never[]);
    await sql.unsafe(
      `insert into einsatz_zuordnung (mandant_id, einsatz_id, anstellung_id, person_id,
                                      beginn_zeitpunkt, ende_zeitpunkt, status,
                                      erstellt_von_art)
       select $1, e.id, $2, $3, e.beginn_zeitpunkt, e.ende_zeitpunkt, 'geplant', 'system'
         from einsatz e where e.id = $4`,
      [bau.mandant, anst!.id, person!.id, e!.id] as never[]);

    return { benutzer, person: person!.id };
  }

  it('ohne bau.lesen — aber mit bau.aufmass_erfassen auf ihrem Projekt', async () => {
    const bau = await baueProjekt(f.bau);
    const kraft = await eingeteilt(bau);

    const angelegt = await alsApp(
      {
        scope: 'mandant', mandantId: f.bau, benutzerId: kraft.benutzer,
        personId: kraft.person, portal: 'mitarbeiter', readonly: false,
      },
      async (tx) => erfasseAufmass(kontextAus(tx, f.bau, kraft.benutzer), {
        projektId: bau.projekt,
        bezeichnung: 'Wand Achse D',
        bereich: null,
        messdatum: '2026-09-10',
        erhebungsart: 'gemeinsam',
        ankuendigungAm: null,
        zeilen: [{
          bezeichnung: 'Wand Achse D',
          rechenansatz: '3 × (4,20 × 2,75) − 2 × (0,90 × 2,10)',
          einheit: 'm²',
          lvPositionId: bau.position,
          ausserhalbLv: false,
        }],
      }),
    );

    const [z] = await sql.unsafe<{ skaliert: string; anstellung: string | null }[]>(
      `select z.ergebnis_skaliert::text as skaliert,
              a.aufgenommen_von_anstellung_id::text as anstellung
         from aufmass_zeile z join aufmass a on a.id = z.aufmass_id
        where z.aufmass_id = $1`, [angelegt.id]);
    expect(z!.skaliert).toBe('308700');
    // Das Blatt traegt die Beschaeftigung der Kraft — nicht bloss ein Konto.
    expect(z!.anstellung).not.toBeNull();
  });

  it('und sie haengt ihr Messfoto selbst an — sonst waere BAU-03 unerfuellbar', async () => {
    /**
     * Der Weg geht durch `einsatz_medien` (0041): privater Bucket,
     * Magic-Byte-Pruefung, EXIF entfernt. `t_mandant` verlangt dort
     * `zeit.schreiben` — ein Recht, das diese Rolle nicht hat. Ohne die
     * schmale `t_bau_medien`-Policy aus 0072 scheiterte das Anhaengen, und das
     * Blatt liesse sich nie vorlegen.
     */
    const bau = await baueProjekt(f.bau);
    const kraft = await eingeteilt(bau);
    const medienId = crypto.randomUUID();

    const angelegt = await alsApp(
      {
        scope: 'mandant', mandantId: f.bau, benutzerId: kraft.benutzer,
        personId: kraft.person, portal: 'mitarbeiter', readonly: false,
      },
      async (tx) => {
        const kontext = kontextAus(tx, f.bau, kraft.benutzer);
        const kopf = await erfasseAufmass(kontext, {
          projektId: bau.projekt,
          bezeichnung: 'Wand Achse E',
          bereich: null,
          messdatum: '2026-09-10',
          erhebungsart: 'gemeinsam',
          ankuendigungAm: null,
          zeilen: [{
            bezeichnung: 'Wand Achse E',
            rechenansatz: '4,20 × 2,75',
            einheit: 'm²',
            lvPositionId: bau.position,
            ausserhalbLv: false,
          }],
        });
        await tx.unsafe(
          `insert into einsatz_medien (id, mandant_id, bezug_tabelle, bezug_id, art, bucket,
                                       pfad, mime_typ, groesse_bytes, sha256,
                                       erstellt_von, erstellt_von_person_id)
           values ($1,$2,'aufmass',$3,'foto','einsatz-medien',$4,'image/jpeg',999,
                   repeat('d',64), app.aktueller_benutzer(), app.aktuelle_person())`,
          [medienId, f.bau, kopf.id, `${f.bau}/${medienId}`] as never[]);
        await hefteFotoAn(kontext, { aufmassId: kopf.id, medienId });
        return kopf;
      },
    );

    const [z] = await sql.unsafe<{ fotos: string }[]>(
      `select count(*)::text as fotos from aufmass_foto
        where aufmass_id = $1 and zweck = 'nachweis'`, [angelegt.id]);
    expect(Number(z!.fotos)).toBe(1);
  });

  it('aber nicht auf einem Projekt, auf dem sie nicht eingeteilt ist', async () => {
    const bau = await baueProjekt(f.bau);
    const anderes = await baueProjekt(f.bau);
    const kraft = await eingeteilt(bau);

    await expect(alsApp(
      {
        scope: 'mandant', mandantId: f.bau, benutzerId: kraft.benutzer,
        personId: kraft.person, portal: 'mitarbeiter', readonly: false,
      },
      async (tx) => erfasseAufmass(kontextAus(tx, f.bau, kraft.benutzer), {
        projektId: anderes.projekt,
        bezeichnung: 'Fremde Baustelle',
        bereich: null,
        messdatum: '2026-09-10',
        erhebungsart: 'gemeinsam',
        ankuendigungAm: null,
        zeilen: [{
          bezeichnung: 'Wand',
          rechenansatz: '1',
          einheit: 'm²',
          lvPositionId: anderes.position,
          ausserhalbLv: false,
        }],
      }),
      // AUT-06: nicht „verboten", sondern „nicht vorhanden".
    )).rejects.toThrow(/nicht gefunden/u);
  });
});

describe('Mandantentrennung und Kundendecke', () => {
  it('ein Blatt der REALTIME Service GmbH ist aus der Reinigung unsichtbar', async () => {
    const bau = await baueProjekt(f.bau);
    await baueBlatt(bau);
    const fremd = await baueProjekt(f.reinigung);

    const zeilen = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: fremd.benutzer, portal: 'intern' },
      async (tx) => tx.unsafe(`select id from aufmass`),
    ) as { id: string }[];
    expect(zeilen).toHaveLength(0);
  });

  it('und ein Entwurf erreicht das Kundenportal nicht (AUT-01)', async () => {
    const bau = await baueProjekt(f.bau);
    const blatt = await baueBlatt(bau);

    const kundenkonto = await konto(`kunde-${zufall()}@extern.test`);
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
      [kundenkonto, f.bau, await rolleId('kunde')]);
    await sql.unsafe(
      `insert into kunde_zugang (mandant_id, kunde_id, benutzer_id)
       values ($1,$2,$3)`,
      [f.bau, bau.kunde, kundenkonto] as never[]);

    const imEntwurf = await alsApp(
      {
        scope: 'kunde', mandantIds: [f.bau], benutzerId: kundenkonto, portal: 'kunde',
      },
      async (tx) => tx.unsafe(`select id from aufmass`),
    ) as { id: string }[];
    expect(imEntwurf).toHaveLength(0);

    // Erst die Feststellung macht das Blatt zu einem Dokument des Kunden.
    await baueFoto(bau, blatt.id);
    await sql.unsafe(`update aufmass set status = 'vorgelegt' where id = $1`, [blatt.id]);
    await unterschrift(bau, blatt.id, 'auftraggeber');

    const danach = await alsApp(
      {
        scope: 'kunde', mandantIds: [f.bau], benutzerId: kundenkonto, portal: 'kunde',
      },
      async (tx) => tx.unsafe(`select id from aufmass`),
    ) as { id: string }[];
    expect(danach.map((z) => z.id)).toEqual([blatt.id]);
  });
});
