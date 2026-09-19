/**
 * `mandant_identitaet` gegen die echte Datenbank (TEN-07, TEN-08, PUB-09,
 * LEG-07, DESIGN §1/§9/§11, 0200, 0335, 0336).
 *
 * Sechs Dinge, die nur hier zu pruefen sind:
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
 *    Die TABELLE gibt sie weiterhin heraus — der interne Editor braucht sie
 *    zum Pflegen, und ein Spaltenrecht unterscheidet nicht nach Prinzipal.
 *    Der letzte Fall unten haelt genau diesen Stand fest, damit ihn niemand
 *    fuer eine Schranke haelt.
 *  - **Kein DELETE.** Es gibt keinen Zustand „diese Gesellschaft hat kein
 *    Erscheinungsbild", nur Felder ohne Wert.
 *  - **Eine fuenfte Gesellschaft ist eine Zeile** (TEN-08). Sie entsteht auch
 *    dann, wenn DESIGN §1 fuer sie noch keinen Bereichston fuehrt — dann mit
 *    `identitaets_token = NULL` als sichtbarem Platzhalter (0336, O-750).
 *    Geraten wird keine Farbe: der `CHECK` laesst weiter nur die vier Namen
 *    aus DESIGN §1 durch.
 *
 * **`seed()` legt die Zeilen NICHT an.** Die Fixtur laeuft unter
 * `session_replication_role = replica`, und in diesem Modus feuert kein
 * gewoehnlicher Ausloeser — also auch nicht
 * `kern.mandant_identitaet_anlegen`. Derselbe Umstand steht in
 * `reinigung.test.ts` fuer die Behinderungsvorlagen. Die Zeilen entstehen
 * hier deshalb von Hand; DASS der Ausloeser laeuft, prueft der letzte
 * Abschnitt mit einem unbekannten Slug — dort entsteht die Zeile, und dort
 * bleibt das Token leer.
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

  /**
   * **Welche Grenze die View ist — und welche nicht.**
   *
   * Die ZEILENgrenze haelt `mi_oeffentlich` (der Block darueber prueft sie).
   * Die SPALTENgrenze ist die View und sonst nichts: `grant select on
   * mandant_identitaet to cse_app` gilt fuer alle Spalten, weil der interne
   * Editor Absender und Signatur zum Pflegen lesen muss und ein Spaltenrecht
   * nicht nach Prinzipal unterscheidet. Dieser Test HAELT diesen Stand fest,
   * statt ihn zu behaupten: wer einen neuen prinzipallosen Lesepfad baut,
   * nimmt die View — die Tabelle haelt ihn nicht auf.
   */
  it('die Spaltengrenze ist die VIEW, nicht ein Spaltenrecht auf der Tabelle',
    async () => {
      await identitaet(f.reinigung, 'area-reinigung', {
        oeffentlich: true, absender: 'post@example.org', domain: 'beispiel.de',
      });
      const rechte = await sql.unsafe<{ column_name: string }[]>(
        `select column_name from information_schema.column_privileges
          where table_name = 'mandant_identitaet' and grantee = 'cse_app'
            and privilege_type = 'SELECT'
            and column_name in ('email_absender','email_signatur','domain')
          order by column_name`);
      /*
       * Drei Spaltenrechte, nicht null: wuerde hier eines fehlen, waere die
       * Grenze eine echte — dann gehoert dieser Test umgeschrieben und der
       * interne Lesepfad auf eine Definer-Funktion gelegt.
       */
      expect(rechte.map((r) => r.column_name))
        .toEqual(['domain', 'email_absender', 'email_signatur']);

      /* Die Zeilengrenze dagegen HAELT auch auf der Tabelle. */
      const fremd = await alsApp(
        { scope: 'mandant', mandantId: f.bau, portal: 'intern', readonly: true },
        (tx) => tx.unsafe(`select email_absender from mandant_identitaet`),
      ) as unknown[];
      expect(fremd).toHaveLength(0);
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

/**
 * **Der Ausloeser, TEN-08 und die Reihenfolge aus DESIGN §1 — alle drei.**
 *
 * Hier standen bis 0336 zwei Zusagen gegeneinander, und der Ausloeser aus
 * 0200 entschied sie in die falsche Richtung: er BRACH JEDE Mandantenanlage
 * AB, deren Slug nicht einer der vier bekannten war. Damit war eine fuenfte
 * Gesellschaft eine Codeaenderung — und TEN-08 sagt zu, dass sie eine Zeile
 * ist. `mandanten-trennung.test.ts` fuehrt diese Zusage namentlich.
 *
 * Aufgeloest wird sie nicht dadurch, dass eine Ersatzfarbe gewaehlt wird —
 * das waere der erfundene Gestaltungswert, den CLAUDE.md und DESIGN §1
 * verbieten: der neue Bereich saehe aus wie „Digital & KI", und niemand
 * suchte den Grund in einem Ausloeser. Sie wird dadurch aufgeloest, dass die
 * offene Frage als solche in der Zeile steht: `identitaets_token` ist NULL,
 * die Zeile entsteht trotzdem, und die Oberflaeche zeigt sie als Platzhalter
 * (O-750).
 *
 * Die drei Faelle unten halten alle drei Haelften fest — die Zeile entsteht,
 * die Farbe wird NICHT geraten, und die vier Namen aus DESIGN §1 stehen
 * weiter im `CHECK`.
 */
describe('Der Ausloeser, TEN-08 und die Reihenfolge aus DESIGN §1', () => {
  it('er ist angelegt und eingeschaltet', async () => {
    const [t] = await sql.unsafe<{ tgenabled: string }[]>(
      `select tgenabled from pg_trigger
        where tgrelid = 'mandant'::regclass
          and tgname = 'trg_mandant_identitaet_anlegen'`);
    expect(t, 'trg_mandant_identitaet_anlegen fehlt').toBeDefined();
    /* `O` = feuert im Normalbetrieb. Im Seed laeuft `replica` — siehe Kopf. */
    expect(t?.tgenabled).toBe('O');
  });

  it('ein Bereich ohne Farbe in DESIGN §1 entsteht — mit Zeile, ohne Token (TEN-08)',
    async () => {
      const slug = `gartenbau-${zufall()}`;
      const [m] = await sql.unsafe<{ id: string }[]>(
        `insert into mandant (slug, name, firma)
         values ($1, 'Garten', 'Garten GmbH') returning id`, [slug] as never[]);
      expect(m, 'die fuenfte Gesellschaft wurde nicht angelegt').toBeDefined();

      const [mi] = await sql.unsafe<{
        kurzname: string; identitaets_token: string | null;
        platzhalter_medien: boolean; oeffentlich_sichtbar: boolean;
      }[]>(
        `select kurzname, identitaets_token, platzhalter_medien, oeffentlich_sichtbar
           from mandant_identitaet where mandant_id = $1`, [m!.id] as never[]);

      /* Die 1:1-Zusage aus §6.2 gilt fuer JEDEN Mandanten, nicht fuer vier. */
      expect(mi, 'keine Identitaetszeile — TEN-07 liefe ohne Wert').toBeDefined();
      expect(mi?.kurzname).toBe('Garten');
      /*
       * NULL ist die offene Frage, als NULL geschrieben — und ausdruecklich
       * NICHT `area-operations` oder irgendein anderer geliehener Ton.
       */
      expect(mi?.identitaets_token).toBeNull();
      /* Sichtbar als Platzhalter, und oeffentlich bleibt sie erst einmal zu. */
      expect(mi?.platzhalter_medien).toBe(true);
      expect(mi?.oeffentlich_sichtbar).toBe(false);
    });

  it('eine ERFUNDENE Farbe kommt trotzdem nicht in die Spalte', async () => {
    /*
     * Die Reihenfolge aus CLAUDE.md steht unveraendert: zuerst ein Eintrag in
     * docs/DESIGN.md (Farbe mit geprueftem Kontrast, DESIGN §9), dann eine
     * Migration, die `mi_token` erweitert. Was 0336 aendert, ist allein, dass
     * die Gesellschaft bis dahin existieren darf.
     */
    const slug = `logistik-${zufall()}`;
    const [m] = await sql.unsafe<{ id: string }[]>(
      `insert into mandant (slug, name, firma)
       values ($1, 'Logistik', 'Logistik GmbH') returning id`, [slug] as never[]);
    await expect(sql.unsafe(
      `update mandant_identitaet set identitaets_token = $2 where mandant_id = $1`,
      [m!.id, `area-${slug}`] as never[],
    )).rejects.toThrow(/mi_token/u);
  });

  it('die vier Namen aus DESIGN §1 stehen weiter im CHECK', async () => {
    /*
     * Eine eingefrorene Liste darf WACHSEN — ein fuenfter Name kommt hinein,
     * sobald DESIGN.md ihn fuehrt. Sie darf nicht schrumpfen: faellt einer der
     * vier heraus, traegt eine bestehende Gesellschaft ihre Farbe nicht mehr.
     */
    const [c] = await sql.unsafe<{ def: string }[]>(
      `select pg_get_constraintdef(oid) as def from pg_constraint
        where conname = 'mi_token' and conrelid = 'mandant_identitaet'::regclass`);
    expect(c, 'mi_token fehlt').toBeDefined();
    for (const token of
      ['area-reinigung', 'area-security', 'area-bau', 'area-operations']) {
      expect(c?.def, token).toContain(token);
    }
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
