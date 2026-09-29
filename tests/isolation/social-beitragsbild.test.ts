/**
 * Ein Beitrag trägt ein Bild (SOC-02, SOC-05, DOC-03, V-225, D-719) — gegen
 * echtes Postgres.
 *
 * **Der Befund.** `beitrag.medien_id` gab es seit 0163, und keine Zeile Code
 * schrieb oder las sie; für `medien` gab es keinen Annahmeweg. Geprüft wird:
 * das Bild liegt im PRIVATEN Behälter unter einem Schlüssel aus dem Inhalt,
 * bereinigt; es hängt nur an einem Entwurf und nur als Bild derselben
 * Gesellschaft; es geht mit in die Freigabe; und ausgeliefert wird es nur,
 * wenn es an einem veröffentlichten Beitrag hängt oder die Sitzung zur
 * Gesellschaft gehört.
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { LeseKontext, SchreibKontext } from '../../src/server/kontext/index.js';
import { LokalerSpeicher, type Speicher } from '../../src/server/storage/adapter.js';
import {
  eigenesBeitragsbild, legeBeitragsbildAn, oeffentlichesBeitragsbild,
} from '../../src/server/services/social/beitragsbild.js';
import { ladeBeitrag, legeVor, setzeBeitragsbild } from '../../src/server/services/social/dienst.js';
import { setzeGalerieRang } from '../../src/server/services/inhalt/redaktion.js';
import { seedBeitragsbild } from '../../src/server/db/seed/beitragsbild.js';

let f: Fixtur;
let leitung = '';
const zufall = (): string => Math.random().toString(36).slice(2, 10);
const hex = (h: string): Uint8Array => Uint8Array.from(Buffer.from(h, 'hex'));

/** 1×1 PNG. */
const PNG = hex('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489'
  + '0000000d49444154789c6378cc26fc1f0004c801fc6a07bf6c0000000049454e44ae426082');
/** 1×1 PNG mit einem tEXt-Block „GPS 52.5,13.4". */
const PNG_MIT_ORT = hex('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489'
  + '0000000d744558744750530035322e352c31332e340d3daf0f'
  + '0000000d49444154789c63606060f80f00010401005fe5c34b0000000049454e44ae426082');
const PDF = Uint8Array.from([...Buffer.from('%PDF-1.7'), ...Buffer.alloc(64)]);

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function konto(mandant: string, rolle = 'leitung'): Promise<string> {
  const email = `bild-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,'Redaktion','aktiv')`,
    [u!.id, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [u!.id, mandant, await rolleId(rolle)]);
  return u!.id;
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

function als<T>(
  fn: (k: SchreibKontext) => Promise<T>, wer = leitung, mandant = f.reinigung,
): Promise<T> {
  return alsApp({ scope: 'mandant', mandantId: mandant, benutzerId: wer,
                  portal: 'intern', readonly: false },
  (tx) => fn(kontextAus(tx, wer, mandant)));
}

/** Ohne jede Sitzung — so liest die öffentliche Gesellschaftsseite. */
async function ohneSitzung<T>(fn: (k: LeseKontext) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx.unsafe(`set local role cse_app`);
    const abfrage = async <R>(q: string, w?: readonly unknown[]): Promise<readonly R[]> =>
      tx.unsafe(q, (w ?? []) as never[]) as unknown as readonly R[];
    return fn({ scope: 'mandant', portal: 'intern', benutzerId: '', aktiverMandantId: '',
                mandantIds: [], abfrage } as unknown as LeseKontext);
  }) as Promise<T>;
}

async function entwurf(mandant = f.reinigung): Promise<string> {
  const [b] = await sql.unsafe<{ id: string }[]>(
    `insert into beitrag (mandant_id, titel, text) values ($1, $2, 'Text') returning id`,
    [mandant, `Beitrag ${zufall()}`]);
  return b!.id;
}

/** Veröffentlicht mit genehmigter Freigabe — wie die Fixtur in social.test.ts. */
async function veroeffentlicht(medienId: string): Promise<string> {
  const [fr] = await sql.unsafe<{ id: string }[]>(
    `insert into freigabe (mandant_id, aktion, status, vorgang_typ, titel, zusammenfassung, risiko,
                           vorschau_payload, payload_hash, freigegeben_von, freigegeben_am, bezug_typ)
     values ($1, 'social_veroeffentlichen', 'genehmigt', 'beitrag_veroeffentlichen', 'Probe',
             'Probe', 'mittel', '{}'::jsonb, encode(sha256('probe'::bytea), 'hex'), $2, now(),
             'beitrag') returning id`, [f.reinigung, leitung]);
  const zeilen = await (sql.begin(async (tx) => {
    await tx.unsafe(`select set_config('app.scope', 'mandant', true),
                            set_config('app.mandant_id', $1, true)`, [f.reinigung]);
    return tx.unsafe<{ id: string }[]>(
      `insert into beitrag (mandant_id, titel, text, status, freigabe_id, veroeffentlicht_am,
                            medien_id)
       values ($1, $2, 'Text', 'veroeffentlicht', $3, now(), $4) returning id`,
      [f.reinigung, `Draussen ${zufall()}`, fr!.id, medienId]);
  }) as Promise<readonly { id: string }[]>);
  return zeilen[0]!.id;
}

beforeEach(async () => {
  f = await seed();
  leitung = await konto(f.reinigung);
});
afterAll(schliessen);

describe('(1) ein Bild annehmen — privat, bereinigt, mit Alternativtext', () => {
  it('Schlüssel aus dem Inhalt, Behälter marke, die Adresse ist die Tür', async () => {
    const speicher = new LokalerSpeicher();
    const id = await als((k) => legeBeitragsbildAn(k, speicher, {
      daten: PNG, alt: 'Treppenhaus nach der Grundreinigung',
    }));
    const [m] = await sql.unsafe<{
      bucket: string; schluessel: string; pfad: string; platzhalter: boolean;
    }[]>(
      `select bucket, objekt_schluessel as schluessel, pfad, ist_platzhalter as platzhalter
         from medien where id = $1`, [id]);
    expect(m).toMatchObject({ bucket: 'marke', pfad: `/api/beitragsbild/${id}`, platzhalter: false });
    expect(m!.schluessel).toMatch(new RegExp(`^${f.reinigung}/beitrag/[0-9a-f]{64}\\.png$`, 'u'));
    expect(speicher.rohBytes('marke', m!.schluessel)).toEqual(PNG);
  });

  it('die Ortsdaten eines PNG gehen nicht mit', async () => {
    const speicher = new LokalerSpeicher();
    const id = await als((k) => legeBeitragsbildAn(k, speicher, {
      daten: PNG_MIT_ORT, alt: 'Fassade am Morgen',
    }));
    const [m] = await sql.unsafe<{ schluessel: string }[]>(
      `select objekt_schluessel as schluessel from medien where id = $1`, [id]);
    const bytes = speicher.rohBytes('marke', m!.schluessel)!;
    expect(Buffer.from(bytes).toString('latin1')).not.toContain('GPS');
  });

  it('ohne Alternativtext, mit falschem Inhalt oder ohne Speicher: nichts', async () => {
    const speicher = new LokalerSpeicher();
    await expect(als((k) => legeBeitragsbildAn(k, speicher, { daten: PNG, alt: ' ' })))
      .rejects.toMatchObject({ grund: 'alt_text_fehlt' });
    await expect(als((k) => legeBeitragsbildAn(k, speicher, { daten: PDF, alt: 'Ein PDF' })))
      .rejects.toMatchObject({ grund: 'typ' });
    const aus = { verbunden: false } as unknown as Speicher;
    await expect(als((k) => legeBeitragsbildAn(k, aus, { daten: PNG, alt: 'Ohne Speicher' })))
      .rejects.toMatchObject({ grund: 'nicht_verbunden' });
    const [n] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from medien where bucket is not null and mandant_id = $1`,
      [f.reinigung]);
    expect(n!.n).toBe(0);
  });

  it('ohne social.schreiben legt niemand ein Bild an (t_medien_beitragsbild, 0473)', async () => {
    const leser = await konto(f.reinigung, 'mitarbeiter');
    const speicher = new LokalerSpeicher();
    await expect(als((k) => legeBeitragsbildAn(k, speicher, {
      daten: PNG, alt: 'Nicht erlaubt',
    }), leser)).rejects.toThrow(/row-level security/u);
    const [n] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from medien where bucket is not null and mandant_id = $1`,
      [f.reinigung]);
    expect(n!.n, 'keine Zeile').toBe(0);
  });
});

describe('(2) das Bild hängt am Entwurf — und geht mit in die Freigabe', () => {
  it('anhängen, in die Nutzlast der Freigabe, danach nicht mehr änderbar', async () => {
    const speicher = new LokalerSpeicher();
    const b = await entwurf();
    const m = await als((k) => legeBeitragsbildAn(k, speicher, { daten: PNG, alt: 'Glasfront' }));
    await als((k) => setzeBeitragsbild(k, b, m));
    const zeile = await als((k) => ladeBeitrag(k, b));
    expect(zeile).toMatchObject({
      medienId: m, bildAdresse: `/api/beitragsbild/${m}`, bildAlt: 'Glasfront', bildPrivat: true,
      bildTyp: 'image/png',
    });

    const freigabe = await als((k) => legeVor(k, b));
    const [fr] = await sql.unsafe<{ nutzlast: Record<string, unknown> }[]>(
      `select vorschau_payload as nutzlast from freigabe where id = $1`, [freigabe]);
    expect(fr!.nutzlast['bild']).toEqual({ medien_id: m, alt: 'Glasfront' });

    await expect(als((k) => setzeBeitragsbild(k, b, null)))
      .rejects.toMatchObject({ grund: 'nicht_bearbeitbar' });
  });

  it('ohne Bild bleibt die Nutzlast, wie sie war — kein Schlüssel bild', async () => {
    const b = await entwurf();
    const freigabe = await als((k) => legeVor(k, b));
    const [fr] = await sql.unsafe<{ nutzlast: Record<string, unknown> }[]>(
      `select vorschau_payload as nutzlast from freigabe where id = $1`, [freigabe]);
    expect(Object.hasOwn(fr!.nutzlast, 'bild')).toBe(false);
  });

  it('nur ein Bild derselben Gesellschaft — im Dienst und in der Datenbank', async () => {
    const fremd = await konto(f.security);
    const fremdesBild = await als((k) => legeBeitragsbildAn(k, new LokalerSpeicher(), {
      daten: PNG, alt: 'Bild der Security',
    }), fremd, f.security);
    const b = await entwurf();
    await expect(als((k) => setzeBeitragsbild(k, b, fremdesBild)))
      .rejects.toMatchObject({ grund: 'quelle_unzulaessig' });
    await expect(sql.unsafe(`update beitrag set medien_id = $2 where id = $1`, [b, fremdesBild]))
      .rejects.toThrow(/anderen Gesellschaft/u);
  });

  it('entfernen lässt die Datei und die Zeile stehen', async () => {
    const speicher = new LokalerSpeicher();
    const b = await entwurf();
    const m = await als((k) => legeBeitragsbildAn(k, speicher, { daten: PNG, alt: 'Eingang' }));
    await als((k) => setzeBeitragsbild(k, b, m));
    await als((k) => setzeBeitragsbild(k, b, null));
    expect((await als((k) => ladeBeitrag(k, b)))!.medienId).toBeNull();
    const [n] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from medien where id = $1`, [m]);
    expect(n!.n).toBe(1);
  });
});

describe('(3) ausgeliefert wird nur, was hinaus darf', () => {
  it('am Entwurf: nur für die eigene Gesellschaft; veröffentlicht: für alle', async () => {
    const m = await als((k) => legeBeitragsbildAn(k, new LokalerSpeicher(), {
      daten: PNG, alt: 'Bürofläche',
    }));
    const b = await entwurf();
    await als((k) => setzeBeitragsbild(k, b, m));

    expect(await ohneSitzung((k) => oeffentlichesBeitragsbild(k, m))).toBeNull();
    expect(await als((k) => eigenesBeitragsbild(k, m))).toMatchObject({ bucket: 'marke' });
    const fremd = await konto(f.security);
    expect(await als((k) => eigenesBeitragsbild(k, m), fremd, f.security)).toBeNull();
    /* Dieselbe Gesellschaft, aber ohne social.lesen: kein Blick auf den Entwurf. */
    const ohneRecht = await konto(f.reinigung, 'mitarbeiter');
    expect(await als((k) => eigenesBeitragsbild(k, m), ohneRecht)).toBeNull();

    await veroeffentlicht(m);
    expect(await ohneSitzung((k) => oeffentlichesBeitragsbild(k, m)))
      .toMatchObject({ bucket: 'marke' });
  });
});

describe('(4) der Seed hängt dem Entwurf ein Bild an — über die Dienste', () => {
  it('mit Speicher hochgeladen, ohne Speicher das Galeriemotiv', async () => {
    const ids = new Map([['reinigung', f.reinigung]]);
    await sql.unsafe(
      `insert into medien (mandant_id, pfad, alt_text, ist_platzhalter, quelle, galerie_rang)
       values ($1, '/bilder/reinigung.jpg', 'Motiv der Reinigung', true, 'Test', 0)`,
      [f.reinigung]);
    const b = await entwurf();
    expect(await seedBeitragsbild(sql, ids, null, false)).toEqual({ angehaengt: 0, hochgeladen: false });

    const speicher = new LokalerSpeicher();
    expect(await seedBeitragsbild(sql, ids, speicher, true))
      .toEqual({ angehaengt: 1, hochgeladen: true });
    const zeile = await als((k) => ladeBeitrag(k, b));
    expect(zeile!.bildPrivat).toBe(true);

    const zweiter = await entwurf();
    expect(await seedBeitragsbild(sql, ids, null, true))
      .toEqual({ angehaengt: 1, hochgeladen: false });
    expect((await als((k) => ladeBeitrag(k, zweiter)))!.bildPrivat).toBe(false);
  });
});

/**
 * **Die Mandantengrenze des Bildwegs** (V-268, D-761; 0473, 0486). Die Tür
 * `/api/beitragsbild/[id]` signiert, was die `medien`-Zeile nennt. Bis 0486
 * durfte jede Sitzung mit `referenz.schreiben` in IRGENDEINER Gesellschaft
 * Zeiger, Adresse und Alternativtext jedes Beitragsbilds umschreiben — ein
 * freigegebenes Bild liess sich auf ein nie freigegebenes Objekt umlenken.
 */
describe('(5) die Mandantengrenze — fremde Gesellschaft, Gruppenansicht, Eigentümer', () => {
  const FREMDER_ORDNER = (): string => `${f.security}/beitrag/${'a'.repeat(64)}.png`;

  async function redaktion(mandant: string): Promise<string> {
    /* Eine Rolle mit genau dem Recht der Galeriepflege — sonst nichts. */
    const [r] = await sql.unsafe<{ id: string }[]>(
      `insert into rolle (mandant_id, schluessel, bezeichnung, geltungsbereich, portal)
       values ($1, $2, 'Galeriepflege', 'mandant', 'intern') returning id`,
      [mandant, `galerie_${zufall()}`]);
    await sql.unsafe(
      `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
       select $1, b.id, $2, true from berechtigung b where b.schluessel = 'referenz.schreiben'`,
      [r!.id, mandant]);
    const email = `galerie-${zufall()}@cse.test`;
    const [u] = await sql.unsafe<{ id: string }[]>(
      `insert into auth.users (email) values ($1) returning id`, [email]);
    await sql.unsafe(
      `insert into benutzer (id, email, name, status) values ($1,$2,'Galerie','aktiv')`,
      [u!.id, email]);
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
      [u!.id, mandant, r!.id]);
    return u!.id;
  }

  async function stand(id: string): Promise<{ schluessel: string; alt: string; pfad: string }> {
    const [m] = await sql.unsafe<{ schluessel: string; alt: string; pfad: string }[]>(
      `select objekt_schluessel as schluessel, alt_text as alt, pfad from medien where id = $1`,
      [id]);
    return m!;
  }

  it('SONDE: eine fremde Redaktion lenkt das Bild der Reinigung nicht um', async () => {
    const m = await als((k) => legeBeitragsbildAn(k, new LokalerSpeicher(), {
      daten: PNG, alt: 'Freigegebenes Bild',
    }));
    const vorher = await stand(m);
    const bau = await redaktion(f.bau);
    await expect(alsApp({ scope: 'mandant', mandantId: f.bau, benutzerId: bau, portal: 'intern',
                          readonly: false },
    (tx) => tx.unsafe(
      `update medien set objekt_schluessel = $2, alt_text = 'umgelenkt' where id = $1`,
      [m, `${f.reinigung}/beitrag/${'b'.repeat(64)}.png`])))
      .rejects.toThrow(/permission denied/u);
    /* Selbst die eine zugeteilte Spalte trifft keine fremde Zeile. */
    const rang = await alsApp({ scope: 'mandant', mandantId: f.bau, benutzerId: bau,
                                portal: 'intern', readonly: false },
    (tx) => tx.unsafe(`update medien set galerie_rang = 5 where id = $1 returning id`, [m]));
    expect(rang.length).toBe(0);
    expect(await stand(m)).toEqual(vorher);
  });

  it('auch die eigene Redaktion ändert nur den Rang — Zeiger und Text sind nicht zugeteilt', async () => {
    const m = await als((k) => legeBeitragsbildAn(k, new LokalerSpeicher(), {
      daten: PNG, alt: 'Eigenes Bild',
    }));
    const eigen = await redaktion(f.reinigung);
    for (const satz of [
      `update medien set objekt_schluessel = '${f.reinigung}/beitrag/${'c'.repeat(64)}.png' where id = $1`,
      `update medien set alt_text = 'anders' where id = $1`,
      `update medien set pfad = '/bilder/reinigung.jpg' where id = $1`,
      `update medien set mandant_id = '${f.security}' where id = $1`,
    ]) {
      await expect(alsApp({ scope: 'mandant', mandantId: f.reinigung, benutzerId: eigen,
                            portal: 'intern', readonly: false },
      (tx) => tx.unsafe(satz, [m]))).rejects.toThrow(/permission denied/u);
    }
    /* Der eine Weg, den es gibt, bleibt: die Galeriepflege an einem Website-Bild. */
    const [statisch] = await sql.unsafe<{ id: string }[]>(
      `insert into medien (mandant_id, pfad, alt_text, ist_platzhalter)
       values ($1, '/bilder/reinigung.jpg', 'Motiv der Reinigung', true) returning id`,
      [f.reinigung]);
    await als((k) => setzeGalerieRang(k, statisch!.id, 3), eigen);
    const [r] = await sql.unsafe<{ rang: number }[]>(
      `select galerie_rang as rang from medien where id = $1`, [statisch!.id]);
    expect(r!.rang).toBe(3);
  });

  it('angelegt wird nur im eigenen Ordner, nur mit Behälter, nur in der eigenen Gesellschaft', async () => {
    const roh = (werte: { mandant: string; schluessel: string | null }) => als(
      (k) => k.schreibe(
        `with neu as (select gen_random_uuid() as id)
         insert into medien (id, mandant_id, pfad, alt_text, ist_platzhalter, bucket,
                             objekt_schluessel)
         select neu.id, $1::uuid, '/api/beitragsbild/' || neu.id::text, 'Probe', false,
                case when $2::text is null then null else 'marke' end, $2
           from neu returning id`, [werte.mandant, werte.schluessel]));
    await expect(roh({ mandant: f.reinigung, schluessel: FREMDER_ORDNER() }))
      .rejects.toThrow(/medien_hochgeladen_eigen/u);
    await expect(roh({ mandant: f.security, schluessel: FREMDER_ORDNER() }))
      .rejects.toThrow(/row-level security/u);
    await expect(roh({ mandant: f.reinigung, schluessel: null }))
      .rejects.toThrow(/row-level security/u);
    const [n] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from medien where alt_text = 'Probe'`);
    expect(n!.n).toBe(0);
  });

  it('die Gruppenansicht legt nichts an und ändert nichts (Invariante 10)', async () => {
    const m = await als((k) => legeBeitragsbildAn(k, new LokalerSpeicher(), {
      daten: PNG, alt: 'Bild in der Gruppe',
    }));
    const [statisch] = await sql.unsafe<{ id: string }[]>(
      `insert into medien (mandant_id, pfad, alt_text, ist_platzhalter)
       values ($1, '/bilder/reinigung.jpg', 'Motiv der Reinigung', true) returning id`,
      [f.reinigung]);
    const gruppe = { scope: 'gruppe' as const, benutzerId: leitung, portal: 'intern' as const,
                     mandantIds: [f.reinigung, f.security, f.bau], readonly: true };
    await expect(alsApp(gruppe, (k) => legeBeitragsbildAn(kontextAus(k, leitung, ''),
      new LokalerSpeicher(), { daten: PNG, alt: 'Aus der Gruppe' })))
      .rejects.toThrow(/row-level security/u);
    const rang = await alsApp(gruppe, (tx) => tx.unsafe(
      `update medien set galerie_rang = 1 where id = any($1::uuid[]) returning id`,
      [[m, statisch!.id]]));
    expect(rang.length).toBe(0);
  });

  it('auch der Eigentümer lenkt ein hochgeladenes Bild nicht um (Auslöser)', async () => {
    const m = await als((k) => legeBeitragsbildAn(k, new LokalerSpeicher(), {
      daten: PNG, alt: 'Festes Bild',
    }));
    await expect(sql.unsafe(
      `update medien set objekt_schluessel = $2 where id = $1`,
      [m, `${f.reinigung}/beitrag/${'d'.repeat(64)}.png`])).rejects.toThrow(/aendern sich nicht/u);
    await expect(sql.unsafe(`update medien set alt_text = 'anders' where id = $1`, [m]))
      .rejects.toThrow(/wie es angenommen wurde/u);
  });

  it('nach dem Vorlegen wechselt das Bild eines Beitrags nicht mehr — auch nicht am Dienst vorbei', async () => {
    const speicher = new LokalerSpeicher();
    const b = await entwurf();
    const erstes = await als((k) => legeBeitragsbildAn(k, speicher, { daten: PNG, alt: 'Vorgelegt' }));
    const zweites = await als((k) => legeBeitragsbildAn(k, speicher, {
      daten: PNG_MIT_ORT, alt: 'Nie vorgelegt',
    }));
    await als((k) => setzeBeitragsbild(k, b, erstes));
    await als((k) => legeVor(k, b));
    await expect(als((k) => k.schreibe(
      `update beitrag set medien_id = $2 where id = $1`, [b, zweites])))
      .rejects.toThrow(/nur am Entwurf/u);
    await expect(sql.unsafe(`update beitrag set medien_id = $2 where id = $1`, [b, zweites]))
      .rejects.toThrow(/nur am Entwurf/u);
    expect((await als((k) => ladeBeitrag(k, b)))!.medienId).toBe(erstes);
  });

  it('ein zurückgezogener Beitrag liefert sein Bild nicht mehr aus', async () => {
    const m = await als((k) => legeBeitragsbildAn(k, new LokalerSpeicher(), {
      daten: PNG, alt: 'Zurückgezogen',
    }));
    const b = await veroeffentlicht(m);
    expect(await ohneSitzung((k) => oeffentlichesBeitragsbild(k, m))).not.toBeNull();
    await sql.unsafe(
      `update beitrag set status = 'zurueckgezogen', zurueckgezogen_am = now(),
                          zurueckgezogen_grund = 'Motiv nicht mehr aktuell' where id = $1`,
      [b]);
    expect(await ohneSitzung((k) => oeffentlichesBeitragsbild(k, m))).toBeNull();
  });
});
