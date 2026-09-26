/**
 * Fotos am Wachbucheintrag (V-181, D-675; SEC-05 „with server time and
 * photos") — an echtem Postgres.
 *
 * **Der Befund.** `0070` hat `wachbuch_eintrag` eigens im Register
 * `einsatz_medien_bezug` eingetragen, damit SEC-05s „mit Fotos" baubar wird —
 * und kein Weg schrieb je ein Medium mit diesem Bezug. Lesen konnte es nur,
 * wer das Zeitrecht hielt; die Leitstelle sah weder die Fotos einer Seite noch
 * die Aufnahmen der Schicht.
 *
 * Geprueft wird:
 *  1. die Leitstelle schreibt Seite und Foto in EINER Transaktion — die Zeile
 *     traegt den Bezug auf die Seite, keinen Kunden, und die Datei liegt;
 *  2. an eine Seite aus einer FRUEHEREN Transaktion haengt niemand ein Foto
 *     — auch nicht die Leitung, die `zeit.schreiben` haelt und ueber
 *     `t_mandant` (0041) sonst jeden Bezug schreiben duerfte
 *     (`p_wachbuch_medien_mit_seite`, `app.wachbuch_seite_eben_geschrieben`,
 *     0467);
 *  3. ohne verbundenen Speicher entsteht nichts — auch die Seite nicht;
 *  4. lesen darf, wer das Buch lesen darf — ohne Zeitrecht; wer beides nicht
 *     haelt, sieht nichts;
 *  5. die Wache im Mitarbeiterportal (M1) haengt ihr Foto an die eigene Seite
 *     und sieht es im eigenen Portal (`t_person`);
 *  6. auch per UPDATE wechselt ein Foto seine Seite nicht — kein Schichtfoto
 *     wird an eine alte Seite gehaengt, kein Seitenfoto auf eine andere
 *     geschoben, von keiner Rolle (0469, V-184, D-678); was nicht der Bezug
 *     ist, bleibt aenderbar;
 *  7. die Aufnahmen der Schicht, die die Wache im Portal gemacht hat, sieht
 *     die Verwaltung auf Schichtblatt und Wachbuchblatt (`listeSchichtMedien`
 *     im internen Scope, `t_mandant` mit `zeit.lesen`) — und wer nur das Buch
 *     lesen darf, sieht sie nicht (V-181, Audit-Befund 31).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import { schreibeEintrag } from '../../src/server/services/security/wachbuch.js';
import {
  legeSchichtMediumAb, legeWachbuchFotosAb, signierteAdressen, type MedienAblage,
} from '../../src/server/services/zeit/medien.js';
import {
  listeSchichtMedien, listeWachbuchMedien,
} from '../../src/server/services/mitarbeiter/medien.js';
import {
  LokalerSpeicher, NichtVerbundenFehler, type Speicher,
} from '../../src/server/storage/adapter.js';
import { pngMitAlpha } from '../kern/hilfen/bild.js';

let f: Fixtur;
let leitung = '';
let objektId = '';

const zufall = (): string => String(Math.random()).slice(2, 10);

/** Ein kleines, ECHTES PNG — aus seinen Bausteinen gebaut, mit CRC (V-132). */
const PNG = pngMitAlpha(4, 4);

const NICHT_VERBUNDEN: Speicher = {
  verbunden: false,
  lege: () => Promise.reject(new NichtVerbundenFehler('Der Medienspeicher')),
  hole: () => Promise.reject(new NichtVerbundenFehler('Der Medienspeicher')),
  entferne: () => Promise.reject(new NichtVerbundenFehler('Der Medienspeicher')),
  signierteUrl: () => Promise.reject(new NichtVerbundenFehler('Der Medienspeicher')),
};

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

/** Eine Rolle DIESER Gesellschaft mit genau diesen Rechten. */
async function rolleMit(rechte: readonly string[]): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `insert into rolle (mandant_id, schluessel, bezeichnung, geltungsbereich, portal)
     values ($1, $2, $2, 'mandant', 'intern') returning id`,
    [f.security, `wb_foto_${zufall()}`]);
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     select $1, b.id, $2, true from berechtigung b where b.schluessel = any($3::text[])`,
    [r!.id, f.security, [...rechte]]);
  return r!.id;
}

async function konto(personId: string | null, rolle: string): Promise<string> {
  const email = `wb-foto-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, person_id)
     values ($1,$2,$2,'aktiv',$3)`, [u!.id, email, personId]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [u!.id, f.security, rolle]);
  return u!.id;
}

async function objekt(): Promise<string> {
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name) values ($1,$2,'Wachkunde')
     returning id`, [f.security, `K-${zufall()}`]);
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
     values ($1,$2,$3,'Werkstor','Teststr. 1','10115','Berlin') returning id`,
    [f.security, k!.id, `O-${zufall()}`]);
  return o!.id;
}

function als<T>(
  benutzer: string, personId: string | null, fn: (k: SchreibKontext) => Promise<T>,
  portal: 'intern' | 'mitarbeiter' = 'intern',
): Promise<T> {
  return alsApp(
    {
      scope: 'mandant', mandantId: f.security, benutzerId: benutzer,
      ...(personId === null ? {} : { personId }), portal, readonly: false,
    },
    async (tx) => {
      const abfrage = async <R,>(s: string, w: readonly unknown[] = []) =>
        (await tx.unsafe(s, w as never[])) as readonly R[];
      return fn({
        scope: 'mandant', portal, benutzerId: benutzer,
        aktiverMandantId: f.security, mandantIds: [f.security],
        abfrage, schreibe: abfrage,
      });
    },
  );
}

const seite = (k: SchreibKontext, betreff: string): Promise<string> => schreibeEintrag(k, {
  objektId, art: 'vorkommnis', betreff, eintragstext: 'Schranke beschädigt vorgefunden.',
});

/**
 * Eine laufende Schicht an diesem Objekt, darauf eine Wache (Rolle
 * `mitarbeiter`) mit eigener Beschaeftigung — der Mensch, der im Portal
 * schreibt und aufnimmt.
 */
async function schichtMitWache(): Promise<{
  readonly einsatz: string; readonly mensch: string; readonly wache: string;
}> {
  const [k] = await sql.unsafe<{ kunde_id: string }[]>(
    `select kunde_id from objekt where id = $1`, [objektId]);
  const [e] = await sql.unsafe<{ id: string }[]>(
    `insert into einsatz (mandant_id, quell_schluessel, plan_datum,
                          beginn_zeitpunkt, ende_zeitpunkt, beginn_lokal, ende_lokal,
                          objekt_id, kunde_id, endet_am_folgetag, erstellt_von_art)
     select $1, $2, (now() at time zone 'Europe/Berlin')::date,
            now() - interval '1 hour', now() + interval '4 hours',
            ((now() - interval '1 hour') at time zone 'Europe/Berlin')::time,
            ((now() + interval '4 hours') at time zone 'Europe/Berlin')::time,
            $3, $4,
            ((now() + interval '4 hours') at time zone 'Europe/Berlin')::date
              > ((now() - interval '1 hour') at time zone 'Europe/Berlin')::date,
            'system'
     returning id`, [f.security, `E-${zufall()}`, objektId, k!.kunde_id]);
  const [mensch] = await sql.unsafe<{ id: string }[]>(
    `insert into person (vorname, nachname) values ('Nadia','Kowalski') returning id`);
  const [beschaeftigung] = await sql.unsafe<{ id: string }[]>(
    `insert into anstellung (mandant_id, person_id, personalnummer, eintritt,
                             stundensatz_intern)
     values ($1,$2,$3,'2024-01-01',1780) returning id`,
    [f.security, mensch!.id, `S-${zufall()}`]);
  await sql.unsafe(
    `insert into einsatz_zuordnung (mandant_id, einsatz_id, anstellung_id, person_id,
                                    erstellt_von_art)
     values ($1,$2,$3,$4,'system')`, [f.security, e!.id, beschaeftigung!.id, mensch!.id]);
  const wache = await konto(mensch!.id, await rolleId('mitarbeiter'));
  return { einsatz: e!.id, mensch: mensch!.id, wache };
}

/** Eine abgelegte Schichtaufnahme — die Datei selbst braucht die Zeile nicht. */
const ABLAGE: Omit<MedienAblage, 'pfad'> = {
  art: 'foto', bucket: 'einsatz-medien', mimeTyp: 'image/png', groesseBytes: PNG.length,
  sha256: 'a'.repeat(64), exifEntfernt: true, aufgenommenAmGeraet: null,
  beschreibung: 'Schranke von aussen',
};

beforeEach(async () => {
  f = await seed();
  /* Leitung MIT Person: Fatima, beschaeftigt in der Security (Urheber). */
  leitung = await konto(f.fatima, await rolleId('leitung'));
  objektId = await objekt();
});
afterAll(schliessen);

describe('(1) Seite und Foto entstehen in EINER Transaktion', () => {
  it('die Zeile traegt den Bezug auf die Seite, keinen Kunden — und die Datei liegt', async () => {
    const speicher = new LokalerSpeicher();
    const { eintragId, fotos } = await als(leitung, f.fatima, async (k) => {
      const id = await seite(k, 'Schranke');
      return {
        eintragId: id,
        fotos: await legeWachbuchFotosAb(k, {
          eintragId: id, dateien: [{ daten: PNG, behaupteterTyp: 'image/png' }],
        }, speicher),
      };
    });
    expect(fotos).toHaveLength(1);
    const [m] = await sql.unsafe<{
      bezug_tabelle: string; bezug_id: string; kunde_id: string | null; mime_typ: string;
      exif_entfernt: boolean; erstellt_von_person_id: string; pfad: string;
    }[]>(
      `select bezug_tabelle, bezug_id, kunde_id, mime_typ, exif_entfernt,
              erstellt_von_person_id, pfad
         from einsatz_medien where id = $1`, [fotos[0]!]);
    expect(m).toMatchObject({
      bezug_tabelle: 'wachbuch_eintrag', bezug_id: eintragId, kunde_id: null,
      mime_typ: 'image/png', exif_entfernt: true, erstellt_von_person_id: f.fatima,
    });
    /* Die Datei liegt unter dem Pfad der Zeile — erst die Zeile, dann der Speicher. */
    await expect(speicher.hole('einsatz-medien', m!.pfad)).resolves.toBeInstanceOf(Uint8Array);
  });
});

describe('(2) ein Foto kommt mit der Seite — nie danach', () => {
  it('an eine Seite aus einer frueheren Transaktion haengt niemand ein Foto', async () => {
    const alt = await als(leitung, f.fatima, (k) => seite(k, 'Alte Seite'));
    const fehler = await als(leitung, f.fatima, (k) => legeWachbuchFotosAb(k, {
      eintragId: alt, dateien: [{ daten: PNG, behaupteterTyp: 'image/png' }],
    }, new LokalerSpeicher())).then(() => null, (x: unknown) => x);
    expect(String((fehler as Error | null)?.message ?? '')).toMatch(/row-level security/iu);
    const [n] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from einsatz_medien where bezug_id = $1`, [alt]);
    expect(n!.n).toBe(0);
  });
});

describe('(3) ohne verbundenen Speicher entsteht nichts', () => {
  it('NichtVerbundenFehler — und die Seite rollt mit zurueck', async () => {
    const fehler = await als(leitung, f.fatima, async (k) => {
      const id = await seite(k, 'Mit Foto, ohne Speicher');
      return legeWachbuchFotosAb(k, {
        eintragId: id, dateien: [{ daten: PNG, behaupteterTyp: 'image/png' }],
      }, NICHT_VERBUNDEN);
    }).then(() => null, (x: unknown) => x);
    expect(fehler).toBeInstanceOf(NichtVerbundenFehler);
    const [n] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from wachbuch_eintrag where objekt_id = $1`, [objektId]);
    expect(n!.n).toBe(0);
  });

  it('ohne Datei ist ein nicht verbundener Speicher kein Hindernis', async () => {
    const id = await als(leitung, f.fatima, async (k) => {
      const eintrag = await seite(k, 'Ohne Foto');
      await legeWachbuchFotosAb(k, { eintragId: eintrag, dateien: [] }, NICHT_VERBUNDEN);
      return eintrag;
    });
    const [n] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from wachbuch_eintrag where id = $1`, [id]);
    expect(n!.n).toBe(1);
  });
});

describe('(4) lesen darf, wer das Buch lesen darf', () => {
  it('mit wachbuch.lesen und OHNE zeit.lesen: das Foto steht an der Seite', async () => {
    const speicher = new LokalerSpeicher();
    const eintragId = await als(leitung, f.fatima, async (k) => {
      const id = await seite(k, 'Für die Leitstelle');
      await legeWachbuchFotosAb(k, {
        eintragId: id, dateien: [{ daten: PNG, behaupteterTyp: 'image/png' }],
      }, speicher);
      return id;
    });

    const leser = await konto(null, await rolleMit(['wachbuch.lesen']));
    const gesehen = await als(leser, null, async (k) => {
      const karte = await listeWachbuchMedien(k, [eintragId]);
      const medien = karte.get(eintragId) ?? [];
      return { medien, adressen: await signierteAdressen(k, medien, speicher, 1_800_000_000) };
    });
    expect(gesehen.medien).toHaveLength(1);
    expect(gesehen.adressen[0]?.adresse).not.toBeNull();

    /* Ohne Speicher: die Zeile bleibt sichtbar, eine Adresse gibt es nicht. */
    const ohne = await als(leser, null, async (k) => signierteAdressen(
      k, (await listeWachbuchMedien(k, [eintragId])).get(eintragId) ?? [],
      NICHT_VERBUNDEN, 1_800_000_000));
    expect(ohne[0]?.adresse).toBeNull();

    const fremd = await konto(null, await rolleMit(['security.lesen']));
    const nichts = await als(fremd, null, (k) => listeWachbuchMedien(k, [eintragId]));
    expect(nichts.get(eintragId) ?? []).toHaveLength(0);
  });
});

describe('(5) die Wache im Mitarbeiterportal — M1-Scope', () => {
  it('haengt ihr Foto an die eigene Seite und sieht es im eigenen Portal', async () => {
    const [k] = await sql.unsafe<{ kunde_id: string }[]>(
      `select kunde_id from objekt where id = $1`, [objektId]);
    const [e] = await sql.unsafe<{ id: string }[]>(
      `insert into einsatz (mandant_id, quell_schluessel, plan_datum,
                            beginn_zeitpunkt, ende_zeitpunkt, beginn_lokal, ende_lokal,
                            objekt_id, kunde_id, endet_am_folgetag, erstellt_von_art)
       select $1, $2, (now() at time zone 'Europe/Berlin')::date,
              now() - interval '1 hour', now() + interval '4 hours',
              ((now() - interval '1 hour') at time zone 'Europe/Berlin')::time,
              ((now() + interval '4 hours') at time zone 'Europe/Berlin')::time,
              $3, $4,
              ((now() + interval '4 hours') at time zone 'Europe/Berlin')::date
                > ((now() - interval '1 hour') at time zone 'Europe/Berlin')::date,
              'system'
       returning id`, [f.security, `E-${zufall()}`, objektId, k!.kunde_id]);
    const [mensch] = await sql.unsafe<{ id: string }[]>(
      `insert into person (vorname, nachname) values ('Nadia','Kowalski') returning id`);
    const [beschaeftigung] = await sql.unsafe<{ id: string }[]>(
      `insert into anstellung (mandant_id, person_id, personalnummer, eintritt,
                               stundensatz_intern)
       values ($1,$2,$3,'2024-01-01',1780) returning id`,
      [f.security, mensch!.id, `S-${zufall()}`]);
    await sql.unsafe(
      `insert into einsatz_zuordnung (mandant_id, einsatz_id, anstellung_id, person_id,
                                      erstellt_von_art)
       values ($1,$2,$3,$4,'system')`, [f.security, e!.id, beschaeftigung!.id, mensch!.id]);
    const wache = await konto(mensch!.id, await rolleId('mitarbeiter'));

    const eintragId = await als(wache, mensch!.id, async (kx) => {
      const id = await schreibeEintrag(kx, {
        objektId, einsatzId: e!.id, art: 'vorkommnis',
        betreff: 'Tor offen', eintragstext: 'Nebentor offen vorgefunden, geschlossen.',
      });
      await legeWachbuchFotosAb(kx, {
        eintragId: id, dateien: [{ daten: PNG, behaupteterTyp: 'image/png' }],
      }, new LokalerSpeicher());
      return id;
    }, 'mitarbeiter');

    const eigene = await alsApp(
      { scope: 'person', personId: mensch!.id, benutzerId: wache },
      async (tx) => {
        const abfrage = async <R,>(s: string, w: readonly unknown[] = []) =>
          (await tx.unsafe(s, w as never[])) as readonly R[];
        return listeWachbuchMedien({
          scope: 'person', portal: 'mitarbeiter', benutzerId: wache,
          aktiverMandantId: null, mandantIds: [], abfrage,
        }, [eintragId]);
      });
    expect(eigene.get(eintragId) ?? []).toHaveLength(1);
  });
});

describe('(6) auch per UPDATE wechselt ein Foto seine Seite nicht (0469, V-184)', () => {
  /** Der Wurf aus `kern.einsatz_medien_bezug_fest` — oder null, wenn es durchging. */
  async function umhaengen(
    fn: () => Promise<unknown>,
  ): Promise<string | null> {
    return fn().then(() => null, (x: unknown) => String((x as Error).message));
  }

  it('kein Schichtfoto an eine alte Seite, kein Seitenfoto auf eine andere', async () => {
    const { einsatz, mensch, wache } = await schichtMitWache();
    const schichtfoto = await als(wache, mensch, (k) => legeSchichtMediumAb(k, {
      einsatzId: einsatz, ablage: { ...ABLAGE, pfad: `${f.security}/${crypto.randomUUID()}` },
    }), 'mitarbeiter');
    const alt = await als(leitung, f.fatima, (k) => seite(k, 'Seite A'));
    const { andere, seitenfoto } = await als(leitung, f.fatima, async (k) => {
      const id = await seite(k, 'Seite B');
      const [foto] = await legeWachbuchFotosAb(k, {
        eintragId: id, dateien: [{ daten: PNG, behaupteterTyp: 'image/png' }],
      }, new LokalerSpeicher());
      return { andere: id, seitenfoto: foto! };
    });

    /* Die Leitung haelt zeit.schreiben — t_mandant (0041) liesse das UPDATE durch. */
    const alsLeitung = (satz: string, werte: readonly unknown[]) =>
      umhaengen(() => als(leitung, f.fatima, (k) => k.schreibe(satz, werte)));
    expect(await alsLeitung(
      `update einsatz_medien set bezug_tabelle = 'wachbuch_eintrag', bezug_id = $2
        where id = $1`, [schichtfoto, alt])).toMatch(/wechselt seinen Bezug nicht/u);
    expect(await alsLeitung(
      `update einsatz_medien set bezug_id = $2 where id = $1`, [seitenfoto, alt]))
      .toMatch(/wechselt seinen Bezug nicht/u);
    /* Auch nicht zurueck an die Schicht, und auch nicht als Eigentuemer. */
    expect(await alsLeitung(
      `update einsatz_medien set bezug_tabelle = 'einsatz', bezug_id = $2 where id = $1`,
      [seitenfoto, einsatz])).toMatch(/wechselt seinen Bezug nicht/u);
    expect(await umhaengen(() => sql.unsafe(
      `update einsatz_medien set bezug_id = $2 where id = $1`, [seitenfoto, alt])))
      .toMatch(/wechselt seinen Bezug nicht/u);

    const zeilen = await sql.unsafe<{ id: string; bezug_tabelle: string; bezug_id: string }[]>(
      `select id, bezug_tabelle, bezug_id from einsatz_medien where id = any($1::uuid[])`,
      [[schichtfoto, seitenfoto]]);
    expect(new Map(zeilen.map((z) => [z.id, [z.bezug_tabelle, z.bezug_id]]))).toEqual(new Map([
      [schichtfoto, ['einsatz', einsatz]],
      [seitenfoto, ['wachbuch_eintrag', andere]],
    ]));
    const [n] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from einsatz_medien where bezug_id = $1`, [alt]);
    expect(n!.n).toBe(0);
  });

  it('was nicht der Bezug ist, bleibt aenderbar — auch derselbe Bezug im SET', async () => {
    const eintrag = await als(leitung, f.fatima, async (k) => {
      const id = await seite(k, 'Mit Foto');
      await legeWachbuchFotosAb(k, {
        eintragId: id, dateien: [{ daten: PNG, behaupteterTyp: 'image/png' }],
      }, new LokalerSpeicher());
      return id;
    });
    const zeilen = await als(leitung, f.fatima, (k) => k.schreibe<{ id: string }>(
      `update einsatz_medien set beschreibung = 'Schranke, Nahaufnahme', bezug_id = bezug_id
        where bezug_id = $1 returning id`, [eintrag]));
    expect(zeilen).toHaveLength(1);
  });
});

describe('(7) die Aufnahmen der Schicht erreichen die Verwaltung (V-181)', () => {
  it('mit zeit.lesen sieht die Leitung sie — mit wachbuch.lesen allein niemand', async () => {
    const { einsatz, mensch, wache } = await schichtMitWache();
    const aufnahme = await als(wache, mensch, (k) => legeSchichtMediumAb(k, {
      einsatzId: einsatz, ablage: { ...ABLAGE, pfad: `${f.security}/${crypto.randomUUID()}` },
    }), 'mitarbeiter');

    /* Schichtblatt und Wachbuchblatt lesen im internen Scope (`t_mandant`, zeit.lesen). */
    const gesehen = await als(leitung, f.fatima, (k) => listeSchichtMedien(k, einsatz));
    expect(gesehen.map((m) => m.id)).toEqual([aufnahme]);
    expect(gesehen[0]).toMatchObject({ art: 'foto', mimeTyp: 'image/png', entfernt: false });

    const nurZeit = await konto(null, await rolleMit(['zeit.lesen']));
    expect((await als(nurZeit, null, (k) => listeSchichtMedien(k, einsatz))).map((m) => m.id))
      .toEqual([aufnahme]);

    /* Das Buch lesen heisst nicht, die Zeitdokumentation der Schicht zu lesen. */
    const nurBuch = await konto(null, await rolleMit(['wachbuch.lesen']));
    expect(await als(nurBuch, null, (k) => listeSchichtMedien(k, einsatz))).toEqual([]);
  });
});
