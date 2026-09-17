/**
 * `mandant_identitaet` gegen die echte Datenbank (TEN-07, PUB-09, LEG-07,
 * DESIGN §1/§9/§11, 0200).
 *
 * Fuenf Dinge, die nur hier zu pruefen sind:
 *
 *  - **Lesen ohne Fachrecht, Schreiben nur mit `system.identitaet_verwalten`.**
 *    Die Identitaet steht in jeder Kopfzeile und in jedem Switcher; ein
 *    Fachrecht auf dem Lesepfad machte die Marke unsichtbar, nicht sicherer.
 *    Schreiben ist etwas anderes: die Fusszeilen stehen auf jeder Rechnung.
 *  - **Der prinzipallose Renderpfad** (§6.1/§6.2): die oeffentliche Seite
 *    liest OHNE Benutzer und sieht genau die Zeilen mit
 *    `oeffentlich_sichtbar`. Eine angemeldete Sitzung erfuellt diese Policy
 *    nie und liest weiter ueber `sichtbare_mandanten()`.
 *  - **Der Alt-Text-CHECK.** Ein oeffentlich sichtbares Profil ohne
 *    Alternativtext ist ein Barrierefreiheitsmangel auf der Startseite — und
 *    er faellt niemandem auf, der sehen kann. Deshalb haelt ihn die
 *    Datenbank, nicht die Oberflaeche.
 *  - **Die Projektions-View gibt `email_absender`, `email_signatur` und
 *    `domain` NICHT heraus** (§6.2). Sie ist der Pfad des oeffentlichen
 *    Renderings; eine Absenderadresse dort waere eine Adresse fuer jeden.
 *  - **Kein DELETE.** Es gibt keinen Zustand „diese Gesellschaft hat kein
 *    Erscheinungsbild", nur Felder ohne Wert.
 *
 * **`seed()` legt die Zeilen NICHT an.** Die Fixtur laeuft unter
 * `session_replication_role = replica`, und in diesem Modus feuert kein
 * gewoehnlicher Ausloeser — also auch nicht
 * `kern.mandant_identitaet_anlegen`. Derselbe Umstand steht in
 * `reinigung.test.ts` fuer die Behinderungsvorlagen. Die Zeilen entstehen
 * hier deshalb von Hand; DASS der Ausloeser laeuft, prueft der Abschnitt
 * „der Ausloeser" mit einem unbekannten Slug.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';

let f: Fixtur;

const zufall = (): string => String(Math.random()).slice(2, 10);

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

/** Ein Konto mit einer Rolle im Bereich — als Eigentuemer angelegt. */
async function konto(mandant: string, rolle: string): Promise<string> {
  const email = `identitaet-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`,
    [u!.id, email] as never[]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [u!.id, mandant, await rolleId(rolle)] as never[]);
  return u!.id;
}

/** Die Identitaetszeile eines Bereichs — siehe Kopf: der Ausloeser feuert im Seed nicht. */
async function identitaet(mandant: string, token: string, o: {
  oeffentlich?: boolean; cover?: string | null; coverAlt?: string | null;
  absender?: string | null; domain?: string | null;
} = {}): Promise<void> {
  await sql.unsafe(
    `insert into mandant_identitaet
       (mandant_id, kurzname, identitaets_token, oeffentlich_sichtbar,
        cover_pfad, cover_alt, email_absender, domain)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (mandant_id) do update
        set oeffentlich_sichtbar = excluded.oeffentlich_sichtbar,
            cover_pfad = excluded.cover_pfad, cover_alt = excluded.cover_alt,
            email_absender = excluded.email_absender, domain = excluded.domain`,
    [mandant, `Kurz ${token}`, token, o.oeffentlich ?? false,
      o.cover ?? null, o.coverAlt ?? null, o.absender ?? null, o.domain ?? null] as never[]);
}

beforeEach(async () => {
  f = await seed();
  await identitaet(f.reinigung, 'area-reinigung');
  await identitaet(f.bau, 'area-bau');
});

afterAll(async () => {
  await schliessen();
});

describe('Lesen', () => {
  it('jede Rolle des Bereichs sieht die Identitaet — sie steht in jeder Kopfzeile', async () => {
    for (const rolle of ['admin', 'leitung']) {
      const benutzer = await konto(f.reinigung, rolle);
      const zeilen = await alsApp(
        { scope: 'mandant', mandantId: f.reinigung, benutzerId: benutzer, portal: 'intern' },
        (tx) => tx.unsafe(`select kurzname, identitaets_token from mandant_identitaet`),
      ) as { kurzname: string; identitaets_token: string }[];
      expect(zeilen, rolle).toHaveLength(1);
      expect(zeilen[0]?.identitaets_token, rolle).toBe('area-reinigung');
    }
  });

  it('die Identitaet eines fremden Bereichs bleibt unsichtbar (Invariante 3)', async () => {
    const benutzer = await konto(f.reinigung, 'admin');
    const zeilen = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: benutzer, portal: 'intern' },
      (tx) => tx.unsafe(`select mandant_id from mandant_identitaet where mandant_id = $1`,
        [f.bau] as never[]),
    ) as unknown[];
    expect(zeilen).toHaveLength(0);
  });
});

describe('Schreiben', () => {
  it('ohne system.identitaet_verwalten aendert sich keine Zeile', async () => {
    /*
     * `leitung` haelt das Recht nicht (0008). Das UPDATE laeuft durch, trifft
     * aber null Zeilen — genau die Lage, die Invariante 3 „still" nennt: die
     * Anwendung meldet Erfolg, wenn sie nicht vorher selbst geprueft hat.
     */
    const benutzer = await konto(f.reinigung, 'leitung');
    const ergebnis = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: benutzer,
        portal: 'intern', readonly: false },
      (tx) => tx.unsafe(
        `update mandant_identitaet set claim = 'geändert'
          where mandant_id = $1 returning mandant_id`, [f.reinigung] as never[]),
    ) as unknown[];
    expect(ergebnis).toHaveLength(0);
  });

  it('in der Gruppenansicht wird nichts geschrieben (Invariante 10)', async () => {
    const benutzer = await konto(f.reinigung, 'admin');
    const ergebnis = await alsApp(
      { scope: 'gruppe', mandantIds: [f.reinigung, f.bau], benutzerId: benutzer,
        readonly: true },
      (tx) => tx.unsafe(
        `update mandant_identitaet set claim = 'geändert' returning mandant_id`),
    ) as unknown[];
    expect(ergebnis).toHaveLength(0);
  });

  it('mandant_id und id sind fuer cse_app nicht aenderbar', async () => {
    const benutzer = await konto(f.reinigung, 'admin');
    await expect(alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: benutzer,
        portal: 'intern', readonly: false },
      (tx) => tx.unsafe(
        `update mandant_identitaet set mandant_id = $1 where mandant_id = $2`,
        [f.bau, f.reinigung] as never[]),
    )).rejects.toThrow();
  });

  it('cse_app legt keine Identitaet an — sie entsteht mit dem Bereich', async () => {
    const benutzer = await konto(f.operations, 'admin');
    await expect(alsApp(
      { scope: 'mandant', mandantId: f.operations, benutzerId: benutzer,
        portal: 'intern', readonly: false },
      (tx) => tx.unsafe(
        `insert into mandant_identitaet (mandant_id, kurzname, identitaets_token)
         values ($1, 'Zweite', 'area-operations')`, [f.operations] as never[]),
    )).rejects.toThrow();
  });
});

describe('Der prinzipallose Renderpfad (§6.2)', () => {
  it('ohne Benutzer sind genau die oeffentlich sichtbaren Zeilen lesbar', async () => {
    await identitaet(f.reinigung, 'area-reinigung', { oeffentlich: true });
    const zeilen = await alsApp(
      /* Kein `benutzerId`: `app.aktueller_benutzer()` ist dann NULL. */
      { scope: 'mandant', mandantId: f.reinigung, portal: 'intern', readonly: true },
      (tx) => tx.unsafe(`select mandant_id from mandant_identitaet`),
    ) as unknown[];
    expect(zeilen).toHaveLength(1);
  });

  it('ohne Benutzer und ohne Freigabe: nichts', async () => {
    const zeilen = await alsApp(
      { scope: 'mandant', mandantId: f.bau, portal: 'intern', readonly: true },
      (tx) => tx.unsafe(`select mandant_id from mandant_identitaet`),
    ) as unknown[];
    expect(zeilen).toHaveLength(0);
  });

  it('die Projektions-View gibt Absender, Signatur und Domain nicht heraus', async () => {
    await identitaet(f.reinigung, 'area-reinigung', {
      oeffentlich: true, absender: 'post@example.org', domain: 'beispiel.de',
    });
    const spalten = await sql.unsafe<{ column_name: string }[]>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'mandant_identitaet_oeffentlich'`);
    const namen = spalten.map((s) => s.column_name);
    expect(namen).not.toContain('email_absender');
    expect(namen).not.toContain('email_signatur');
    expect(namen).not.toContain('domain');
    expect(namen).toContain('identitaets_token');

    /* Und sie ist `security_invoker`: die Policies des Aufrufers gelten. */
    const zeilen = await alsApp(
      { scope: 'mandant', mandantId: f.bau, portal: 'intern', readonly: true },
      (tx) => tx.unsafe(`select mandant_id from mandant_identitaet_oeffentlich`),
    ) as unknown[];
    expect(zeilen).toHaveLength(0);
  });
});

describe('Der Alt-Text-CHECK (PUB-09, LEG-07)', () => {
  it('ein oeffentlich sichtbares Titelbild ohne Alternativtext wird abgewiesen', async () => {
    await expect(identitaet(f.reinigung, 'area-reinigung', {
      oeffentlich: true, cover: 'marke/cover.jpg', coverAlt: null,
    })).rejects.toThrow(/mi_alt_text/u);
  });

  it('mit Alternativtext geht es', async () => {
    await expect(identitaet(f.reinigung, 'area-reinigung', {
      oeffentlich: true, cover: 'marke/cover.jpg', coverAlt: 'Treppenhaus im Gegenlicht',
    })).resolves.toBeUndefined();
  });

  it('ein NICHT veroeffentlichtes Bild braucht ihn nicht — noch nicht', async () => {
    await expect(identitaet(f.reinigung, 'area-reinigung', {
      oeffentlich: false, cover: 'marke/cover.jpg', coverAlt: null,
    })).resolves.toBeUndefined();
  });
});

describe('Der Ausloeser und die Reihenfolge aus DESIGN §1', () => {
  it('er ist angelegt und eingeschaltet', async () => {
    const [t] = await sql.unsafe<{ tgenabled: string }[]>(
      `select tgenabled from pg_trigger
        where tgrelid = 'mandant'::regclass
          and tgname = 'trg_mandant_identitaet_anlegen'`);
    expect(t, 'trg_mandant_identitaet_anlegen fehlt').toBeDefined();
    /* `O` = feuert im Normalbetrieb. Im Seed laeuft `replica` — siehe Kopf. */
    expect(t?.tgenabled).toBe('O');
  });

  it('ein Bereich ohne Farbe in DESIGN §1 wird abgewiesen, mit Anleitung', async () => {
    /*
     * Das ist die Reihenfolge, die CLAUDE.md verlangt: zuerst ein Eintrag in
     * docs/DESIGN.md (Farbe mit geprueftem Kontrast), dann eine Migration,
     * die `mi_token` erweitert. Eine Ersatzfarbe zu waehlen — etwa
     * `area-operations` — waere genau der erfundene Gestaltungswert, den
     * dieselbe Regel verbietet: der neue Bereich saehe aus wie „Digital & KI",
     * und niemand suchte den Grund in einem Ausloeser.
     */
    await expect(sql.unsafe(
      `insert into mandant (slug, name, firma) values ($1, 'Garten', 'Garten GmbH')`,
      [`gartenbau-${zufall()}`] as never[],
    )).rejects.toThrow(/DESIGN/u);
  });
});

describe('Kein DELETE (Invariante 8)', () => {
  it('der Eigentuemer kommt nicht durch — der Ausloeser haelt', async () => {
    await expect(sql.unsafe(
      `delete from mandant_identitaet where mandant_id = $1`, [f.reinigung] as never[],
    )).rejects.toThrow();
  });

  it('cse_app hat das Recht gar nicht', async () => {
    const [g] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from information_schema.table_privileges
        where table_name = 'mandant_identitaet' and grantee = 'cse_app'
          and privilege_type in ('DELETE', 'TRUNCATE')`);
    expect(g?.n).toBe('0');
  });
});
