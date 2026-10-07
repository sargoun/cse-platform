/**
 * Der Widerruf einer Kundenfreigabe stellt die Aufgabe „Referenz
 * herausnehmen" — gegen echte Policies, Rechte und Auslöser (V-287, O-735,
 * D-780, D-841, `drizzle/0528`).
 *
 * **Der Befund.** `widerrufeKundenfreigabe` stempelte den Auftrag und
 * protokollierte den Grund; eine schon veröffentlichte Referenz aus diesem
 * Auftrag blieb auf der Website, bis jemand daran dachte. Die Voreinstellung
 * zu O-735 verlangt die Herausnahme binnen fünf Arbeitstagen — ohne Aufgabe
 * erinnerte niemand daran.
 *
 * **Die Sätze, die diese Datei beweist — jeder fällt ohne die Umsetzung:**
 *
 *  1. Je veröffentlichter Referenz aus dem Auftrag entsteht EINE Aufgabe:
 *     offen, Priorität hoch, Frist fünf Berliner Arbeitstage nach dem
 *     Widerruf, Bezug auf die Referenz, Quelle Ereignis, gestellt von dem
 *     Menschen, der widerrufen hat. Das Protokoll nennt sie.
 *  2. Ein Entwurf, eine Referenz ohne eigene Freigabe, eine gelöschte und
 *     die Referenz eines anderen Auftrags bekommen keine.
 *  3. Wer widerruft, braucht kein Aufgabenrecht: ohne `aufgabe.schreiben`
 *     und `aufgabe.lesen` entsteht die Aufgabe trotzdem, und er sieht sie
 *     (er hat sie gestellt).
 *  4. Ein zweiter Widerruf, während die erste Aufgabe offen ist, stellt
 *     keine zweite; ist sie erledigt, entsteht eine neue.
 *  5. Die Funktion `app.referenz_herausnahme_aufgabe` lässt nur zu, wofür
 *     sie da ist: kein alter Widerruf, keine fremde Gesellschaft, kein
 *     Entwurf, kein Konto ohne Freigaberecht, keine Gruppenansicht, keine
 *     Frist in der Vergangenheit oder jenseits eines Monats, kein leerer
 *     Text.
 *  6. Die Detailseite der Aufgabe führt auf das Blatt der Referenz — nur
 *     mit `referenz.lesen`; ohne bleibt der Bezug ein Wort.
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import {
  HERAUSNAHME_QUELLE, HERAUSNAHME_WERKTAGE, erfasseKundenfreigabe, herausnahmeFrist,
  ladeHerausnahmeAufgaben, widerrufeKundenfreigabe,
} from '../../src/server/services/auftrag/kundenfreigabe.js';
import { loeseBezugAuf } from '../../src/server/services/kern/aufgabe.js';

let f: Fixtur;
const zufall = (): string => Math.random().toString(36).slice(2, 10);

function alsKontext(
  tx: postgres.TransactionSql, mandant: string, benutzer: string,
): SchreibKontext {
  const abfrage = async <T,>(
    anweisung: string, werte?: readonly unknown[],
  ): Promise<readonly T[]> =>
    (await tx.unsafe(anweisung, (werte ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId: benutzer,
    aktiverMandantId: mandant, mandantIds: [mandant], abfrage, schreibe: abfrage,
  };
}

async function als<T>(
  mandant: string, benutzer: string, fn: (k: SchreibKontext, tx: postgres.TransactionSql) => Promise<T>,
  readonly = false,
): Promise<T> {
  return alsApp(
    { scope: 'mandant', mandantId: mandant, mandantIds: [mandant], benutzerId: benutzer,
      readonly, portal: 'intern' },
    async (tx) => fn(alsKontext(tx, mandant, benutzer), tx));
}

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function entziehe(rolle: string, recht: string, mandant: string): Promise<void> {
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     select $1, b.id, $2, false from berechtigung b where b.schluessel = $3`,
    [await rolleId(rolle), mandant, recht]);
}

async function konto(mandantId: string, rolle = 'admin'): Promise<string> {
  const email = `herausnahme-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1, $2, 'Website-Pflege', 'aktiv')`,
    [u!.id, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1, $2, (select id from rolle where schluessel = $3 and mandant_id is null), true)`,
    [u!.id, mandantId, rolle]);
  return u!.id;
}

interface Auftrag { readonly id: string; readonly nummer: string; readonly kunde: string;
  readonly ansprechpartner: string; readonly dokument: string }

/**
 * Ein abgeschlossener Auftrag mit geltender Kundenfreigabe — als Eigentümer
 * mit abgeschalteten Auslösern: die Fixtur stellt einen Zustand her (der Weg
 * dorthin steht in `referenz-anlegen.test.ts`).
 */
async function auftrag(mandant: string, verantwortlich: string): Promise<Auftrag> {
  return sql.begin(async (tx) => {
    await tx.unsafe(`set local session_replication_role = replica`);
    const [k] = await tx.unsafe<{ id: string }[]>(
      `insert into kunde (mandant_id, kundennummer, name) values ($1, $2, 'Ärztehaus Süd')
       returning id`, [mandant, `K-${zufall()}`]);
    const [ap] = await tx.unsafe<{ id: string }[]>(
      `insert into ansprechpartner (mandant_id, kunde_id, vorname, nachname)
       values ($1, $2, 'Kim', 'Weber') returning id`, [mandant, k!.id]);
    const [d] = await tx.unsafe<{ id: string }[]>(
      `insert into dokument
         (mandant_id, kategorie, titel, kunde_id, bucket, objekt_schluessel, mime_typ,
          mime_verifiziert, groesse_bytes, exif_entfernt, entstanden_am)
       values ($1, 'kunde', 'Zustimmung Referenz', $2, 'dokumente', $3,
               'application/pdf', true, 1024, true, current_date)
       returning id`, [mandant, k!.id, `t/${zufall()}.pdf`]);
    const nummer = `AU-${zufall()}`;
    const [a] = await tx.unsafe<{ id: string }[]>(
      `insert into auftrag (mandant_id, auftragsnummer, kunde_id, art, bezeichnung,
                            verantwortlich_benutzer_id, start_datum, status,
                            abgeschlossen_am, freigegeben_vom_kunden, freigabe_am,
                            freigabe_text, freigabe_durch_ansprechpartner_id,
                            freigabe_dokument_id)
       values ($1, $2, $3, 'rahmenvertrag', 'Grundreinigung Ärztehaus Süd', $4,
               '2025-01-06', 'abgeschlossen', now(), true, now() - interval '30 days',
               'Sie dürfen uns als Referenz nennen.', $5, $6)
       returning id`, [mandant, nummer, k!.id, verantwortlich, ap!.id, d!.id]);
    return { id: a!.id, nummer, kunde: k!.id, ansprechpartner: ap!.id, dokument: d!.id };
  }) as Promise<Auftrag>;
}

interface ReferenzZustand {
  readonly status?: 'entwurf' | 'veroeffentlicht';
  readonly freigegeben?: boolean;
  readonly geloescht?: boolean;
}

/** Eine Referenz aus dem Auftrag, im gewünschten Zustand (als Eigentümer). */
async function referenz(
  mandant: string, auftragId: string, titel: string, zustand: ReferenzZustand = {},
): Promise<string> {
  const freigegeben = zustand.freigegeben ?? true;
  const [r] = await sql.unsafe<{ id: string }[]>(
    `insert into referenz (mandant_id, auftrag_id, titel, slug, kunde_name, status,
                           freigegeben_vom_kunden, freigabe_am, freigabe_beleg, geloescht_am)
     values ($1, $2, $3, $4, 'Praxisgemeinschaft Süd', $5::seite_status, $6,
             case when $6 then now() - interval '20 days' end,
             case when $6 then 'Kundenfreigabe am Auftrag' end,
             case when $7 then now() end)
     returning id`,
    [mandant, auftragId, titel, `ref-${zufall()}`, zustand.status ?? 'veroeffentlicht',
     freigegeben, zustand.geloescht ?? false] as never[]);
  return r!.id;
}

interface AufgabeZeile {
  id: string; mandant_id: string; titel: string; beschreibung: string; status: string;
  prioritaet: string; faellig_datum: string; bezug_typ: string; bezug_id: string;
  quelle: string; quelle_job: string; erstellt_von: string; zugewiesen_an: string | null;
  auftrag_id: string | null;
}

async function aufgabenZu(referenzId: string): Promise<AufgabeZeile[]> {
  return sql.unsafe<AufgabeZeile[]>(
    `select id, mandant_id, titel, beschreibung, status::text as status,
            prioritaet::text as prioritaet, faellig_datum::text as faellig_datum,
            bezug_typ::text as bezug_typ, bezug_id, quelle::text as quelle, quelle_job,
            erstellt_von, zugewiesen_an, auftrag_id
       from aufgabe where bezug_id = $1 order by erstellt_am, id`, [referenzId]);
}

async function berlinHeute(): Promise<string> {
  const [z] = await sql.unsafe<{ heute: string }[]>(`select app.berlin_heute()::text as heute`);
  return z!.heute;
}

async function sqlFehler(p: Promise<unknown>): Promise<{ code: string; message: string }> {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e, 'erwartet: ein Datenbankfehler').not.toBeNull();
  return e as { code: string; message: string };
}

beforeEach(async () => { f = await seed(); });
afterAll(schliessen);

describe('(1) je veröffentlichter Referenz entsteht eine Aufgabe', () => {
  it('offen, hoch, fünf Arbeitstage, Bezug Referenz, Quelle Ereignis — und im Protokoll',
    async () => {
      const admin = await konto(f.reinigung);
      const a = await auftrag(f.reinigung, admin);
      const r = await referenz(f.reinigung, a.id, 'Grundreinigung Ärztehaus Süd');

      const ergebnis = await als(f.reinigung, admin,
        (k) => widerrufeKundenfreigabe(k, a.id, 'Kunde hat schriftlich widerrufen'));

      const heute = await berlinHeute();
      const frist = herausnahmeFrist(heute);
      expect(HERAUSNAHME_WERKTAGE).toBe(5);
      expect(ergebnis.herausnahme).toHaveLength(1);
      expect(ergebnis.herausnahme[0]).toMatchObject({
        referenzId: r, referenz: 'Grundreinigung Ärztehaus Süd', faelligAm: frist,
      });
      expect(ergebnis.herausnahme[0]!.aufgabeId).not.toBeNull();

      const [z, ...mehr] = await aufgabenZu(r);
      expect(mehr).toHaveLength(0);
      expect(z).toMatchObject({
        id: ergebnis.herausnahme[0]!.aufgabeId, mandant_id: f.reinigung,
        titel: 'Referenz herausnehmen: Grundreinigung Ärztehaus Süd',
        status: 'offen', prioritaet: 'hoch', faellig_datum: frist,
        bezug_typ: 'referenz', quelle: 'ereignis', quelle_job: HERAUSNAHME_QUELLE,
        erstellt_von: admin, zugewiesen_an: null,
      });
      expect(z!.beschreibung).toContain(a.nummer);
      expect(z!.beschreibung).toContain('Voreinstellung O-735');
      // Die Frist liegt nach heute und an einem Werktag (Mo–Fr).
      expect(frist > heute).toBe(true);
      expect([0, 6]).not.toContain(new Date(`${frist}T00:00:00Z`).getUTCDay());

      const [p] = await sql.unsafe<{ nutzlast: { grund: string;
        herausnahme: { referenz: string; aufgabe: string | null }[] } }[]>(
        `select nachher as nutzlast from audit_log
          where aktion = 'auftrag.kundenfreigabe_widerrufen' and objekt_id = $1
          order by id desc limit 1`, [a.id]);
      expect(p?.nutzlast.grund).toBe('Kunde hat schriftlich widerrufen');
      expect(p?.nutzlast.herausnahme).toEqual([{ referenz: r, aufgabe: z!.id }]);

      // Die Seite am Auftrag sieht sie.
      const stand = await als(f.reinigung, admin, (k) => ladeHerausnahmeAufgaben(k, a.id));
      expect(stand).toEqual([{ aufgabeId: z!.id, titel: z!.titel, status: 'offen',
        faelligAm: frist }]);
    });

  it('zwei veröffentlichte Referenzen aus demselben Auftrag: zwei Aufgaben', async () => {
    const admin = await konto(f.reinigung);
    const a = await auftrag(f.reinigung, admin);
    const r1 = await referenz(f.reinigung, a.id, 'Grundreinigung Ärztehaus Süd');
    const r2 = await referenz(f.reinigung, a.id, 'Glasreinigung Ärztehaus Süd');
    const ergebnis = await als(f.reinigung, admin,
      (k) => widerrufeKundenfreigabe(k, a.id, 'Widerruf per E-Mail'));
    expect(ergebnis.herausnahme.map((h) => h.referenzId).sort()).toEqual([r1, r2].sort());
    expect(await aufgabenZu(r1)).toHaveLength(1);
    expect(await aufgabenZu(r2)).toHaveLength(1);
  });
});

describe('(2) nur was die Website zeigt, bekommt eine Aufgabe', () => {
  it('Entwurf, ohne eigene Freigabe, gelöscht, anderer Auftrag: keine', async () => {
    const admin = await konto(f.reinigung);
    const a = await auftrag(f.reinigung, admin);
    const anderer = await auftrag(f.reinigung, admin);
    const entwurf = await referenz(f.reinigung, a.id, 'Entwurf', { status: 'entwurf' });
    const ohne = await referenz(f.reinigung, a.id, 'Ohne Freigabe', { freigegeben: false });
    const weg = await referenz(f.reinigung, a.id, 'Gelöscht', { geloescht: true });
    const fremd = await referenz(f.reinigung, anderer.id, 'Anderer Auftrag');

    const ergebnis = await als(f.reinigung, admin,
      (k) => widerrufeKundenfreigabe(k, a.id, 'Widerruf'));
    expect(ergebnis.herausnahme).toEqual([]);
    for (const r of [entwurf, ohne, weg, fremd]) expect(await aufgabenZu(r)).toHaveLength(0);
  });
});

describe('(3) die Pflicht hängt nicht am Aufgabenrecht dessen, der widerruft', () => {
  it('ohne aufgabe.schreiben und aufgabe.lesen entsteht sie — und er sieht sie', async () => {
    await entziehe('admin', 'aufgabe.schreiben', f.reinigung);
    await entziehe('admin', 'aufgabe.lesen', f.reinigung);
    const admin = await konto(f.reinigung);
    const a = await auftrag(f.reinigung, admin);
    const r = await referenz(f.reinigung, a.id, 'Grundreinigung Ärztehaus Süd');

    // Die Gegenprobe: von Hand legt dieses Konto keine Aufgabe an.
    const vonHand = await sqlFehler(als(f.reinigung, admin, (_k, tx) => tx.unsafe(
      `insert into aufgabe (mandant_id, titel, erstellt_von)
       values ($1, 'Von Hand', $2)`, [f.reinigung, admin])));
    expect(vonHand.code).toBe('42501');

    const ergebnis = await als(f.reinigung, admin,
      (k) => widerrufeKundenfreigabe(k, a.id, 'Widerruf'));
    expect(ergebnis.herausnahme[0]!.aufgabeId).not.toBeNull();
    expect(await aufgabenZu(r)).toHaveLength(1);
    const stand = await als(f.reinigung, admin, (k) => ladeHerausnahmeAufgaben(k, a.id));
    expect(stand).toHaveLength(1);
  });
});

describe('(4) eine offene Aufgabe je Referenz', () => {
  it('ein zweiter Widerruf bei offener Aufgabe stellt keine zweite; nach Erledigung schon',
    async () => {
      const admin = await konto(f.reinigung);
      const a = await auftrag(f.reinigung, admin);
      const r = await referenz(f.reinigung, a.id, 'Grundreinigung Ärztehaus Süd');
      await als(f.reinigung, admin, (k) => widerrufeKundenfreigabe(k, a.id, 'Erster Widerruf'));

      // Der Kunde erteilt sie neu …
      await als(f.reinigung, admin, (k) => erfasseKundenfreigabe(k, a.id, {
        ansprechpartnerId: a.ansprechpartner, dokumentId: a.dokument,
        text: 'Sie dürfen uns wieder nennen.',
      }));
      // … und widerruft erneut, während die erste Aufgabe offen ist.
      const zweiter = await als(f.reinigung, admin,
        (k) => widerrufeKundenfreigabe(k, a.id, 'Zweiter Widerruf'));
      expect(zweiter.herausnahme).toHaveLength(1);
      expect(zweiter.herausnahme[0]!.aufgabeId).toBeNull();
      expect(await aufgabenZu(r)).toHaveLength(1);

      // Erledigt — dann stellt der nächste Widerruf eine neue.
      await sql.unsafe(
        `update aufgabe set status = 'erledigt', erledigt_am = now(), erledigt_von = $2
          where bezug_id = $1`, [r, admin]);
      await als(f.reinigung, admin, (k) => erfasseKundenfreigabe(k, a.id, {
        ansprechpartnerId: a.ansprechpartner, dokumentId: a.dokument,
        text: 'Und noch einmal erlaubt.',
      }));
      const dritter = await als(f.reinigung, admin,
        (k) => widerrufeKundenfreigabe(k, a.id, 'Dritter Widerruf'));
      expect(dritter.herausnahme[0]!.aufgabeId).not.toBeNull();
      expect((await aufgabenZu(r)).map((z) => z.status)).toEqual(['erledigt', 'offen']);
    });
});

describe('(5) die Funktion lässt nur zu, wofür sie da ist', () => {
  const TITEL = 'Referenz herausnehmen: Test';
  const TEXT = 'Beschreibung';

  async function rufe(
    mandant: string, benutzer: string, referenzId: string, faellig: string,
    vorher?: (tx: postgres.TransactionSql) => Promise<unknown>, readonly = false,
    titel = TITEL,
  ): Promise<unknown> {
    return als(mandant, benutzer, async (_k, tx) => {
      if (vorher !== undefined) await vorher(tx);
      return tx.unsafe(`select app.referenz_herausnahme_aufgabe($1, $2::date, $3, $4) as id`,
        [referenzId, faellig, titel, TEXT]);
    }, readonly);
  }

  const widerrufeIn = (auftragId: string) => (tx: postgres.TransactionSql) =>
    tx.unsafe(`update auftrag set freigabe_widerrufen_am = now() where id = $1`, [auftragId]);

  it('ohne Widerruf in DIESER Transaktion: 42501 — auch für einen alten Widerruf', async () => {
    const admin = await konto(f.reinigung);
    const a = await auftrag(f.reinigung, admin);
    const r = await referenz(f.reinigung, a.id, 'Grundreinigung');
    const frist = herausnahmeFrist(await berlinHeute());
    expect((await sqlFehler(rufe(f.reinigung, admin, r, frist))).code).toBe('42501');
    // Widerrufen in einer früheren Transaktion …
    await als(f.reinigung, admin, async (_k, tx) => widerrufeIn(a.id)(tx));
    // … öffnet den Weg später nicht.
    expect((await sqlFehler(rufe(f.reinigung, admin, r, frist))).code).toBe('42501');
    expect(await aufgabenZu(r)).toHaveLength(0);
  });

  it('ein Entwurf oder eine Referenz einer anderen Gesellschaft: 42501', async () => {
    const admin = await konto(f.reinigung);
    const imBau = await konto(f.bau);
    const a = await auftrag(f.reinigung, admin);
    const entwurf = await referenz(f.reinigung, a.id, 'Entwurf', { status: 'entwurf' });
    const b = await auftrag(f.bau, imBau);
    const fremd = await referenz(f.bau, b.id, 'Rohbau');
    const frist = herausnahmeFrist(await berlinHeute());
    expect((await sqlFehler(rufe(f.reinigung, admin, entwurf, frist, widerrufeIn(a.id))))
      .code).toBe('42501');
    // Widerrufen wird in derselben Transaktion ein EIGENER Auftrag — es fehlt
    // also nur, dass die Referenz zu dieser Gesellschaft gehört.
    expect((await sqlFehler(rufe(f.reinigung, admin, fremd, frist, widerrufeIn(a.id))))
      .code).toBe('42501');
    expect(await aufgabenZu(entwurf)).toHaveLength(0);
    expect(await aufgabenZu(fremd)).toHaveLength(0);
  });

  it('ohne referenz.kundenfreigabe_erfassen oder in der Gruppenansicht: 42501', async () => {
    const admin = await konto(f.reinigung);
    const a = await auftrag(f.reinigung, admin);
    const r = await referenz(f.reinigung, a.id, 'Grundreinigung');
    const frist = herausnahmeFrist(await berlinHeute());
    // Nur lesend (Invariante 10).
    expect((await sqlFehler(rufe(f.reinigung, admin, r, frist, undefined, true))).code)
      .toBe('42501');
    // Ein Mitarbeiterkonto hält das Freigaberecht nicht.
    const ma = await konto(f.reinigung, 'mitarbeiter');
    expect((await sqlFehler(rufe(f.reinigung, ma, r, frist))).code).toBe('42501');
    expect(await aufgabenZu(r)).toHaveLength(0);
  });

  it('eine Frist heute, gestern oder jenseits eines Monats, ein leerer Titel: 22023',
    async () => {
      const admin = await konto(f.reinigung);
      const a = await auftrag(f.reinigung, admin);
      const r = await referenz(f.reinigung, a.id, 'Grundreinigung');
      const heute = await berlinHeute();
      const [z] = await sql.unsafe<{ gestern: string; weit: string }[]>(
        `select ($1::date - 1)::text as gestern, ($1::date + 32)::text as weit`, [heute]);
      for (const frist of [heute, z!.gestern, z!.weit]) {
        expect((await sqlFehler(rufe(f.reinigung, admin, r, frist, widerrufeIn(a.id))))
          .code, frist).toBe('22023');
      }
      expect((await sqlFehler(rufe(f.reinigung, admin, r, herausnahmeFrist(heute),
        widerrufeIn(a.id), false, '   '))).code).toBe('22023');
      expect(await aufgabenZu(r)).toHaveLength(0);
    });

  it('cse_definer legt über seine Policy keine andere Art Aufgabe an', async () => {
    const [p] = await sql.unsafe<{ pruefung: string }[]>(
      `select pg_get_expr(polwithcheck, polrelid) as pruefung from pg_policy
        where polname = 'd_aufgabe_referenz_herausnahme'`);
    expect(p?.pruefung).toContain('app.aktiver_mandant()');
    expect(p?.pruefung).toContain("'ereignis:referenz_widerruf'");
    expect(p?.pruefung).toContain("'referenz'::bezug_typ");
    expect(p?.pruefung).toContain("'ereignis'::ausloeser");
    const [r] = await sql.unsafe<{ rechte: string[] }[]>(
      `select array_agg(privilege_type::text order by privilege_type) as rechte
         from information_schema.role_table_grants
        where grantee = 'cse_definer' and table_name = 'aufgabe'`);
    // Spaltenrechte zum Anlegen, kein Tabellenrecht zum Ändern oder Lesen.
    expect(r?.rechte ?? []).not.toContain('UPDATE');
    expect(r?.rechte ?? []).not.toContain('SELECT');
  });
});

describe('(6) die Detailseite der Aufgabe führt auf die Referenz', () => {
  it('mit referenz.lesen: Name und Verweis; ohne: nur die Art', async () => {
    const admin = await konto(f.reinigung);
    const a = await auftrag(f.reinigung, admin);
    const r = await referenz(f.reinigung, a.id, 'Grundreinigung Ärztehaus Süd');
    const mit = await als(f.reinigung, admin, (k) => loeseBezugAuf(k, 'referenz', r));
    expect(mit).toEqual({ typ: 'referenz', id: r, titel: 'Grundreinigung Ärztehaus Süd',
      pfad: `website/referenzen/${r}` });

    // Die Referenz ist veröffentlicht, also über t_referenz_oeffentlich lesbar —
    // ein Verweis auf das Pflegeblatt wäre für dieses Konto trotzdem falsch.
    await entziehe('admin', 'referenz.lesen', f.reinigung);
    const ohne = await als(f.reinigung, admin, (k) => loeseBezugAuf(k, 'referenz', r));
    expect(ohne).toEqual({ typ: 'referenz', id: r, titel: null, pfad: null });
  });
});
