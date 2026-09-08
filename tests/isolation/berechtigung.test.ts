/**
 * PR 7 Akzeptanz (1)–(5) — die Rechtematrix, gegen eine echte Datenbank.
 *
 * Der Kern ist AUT-03: Rechte sind Datensätze, keine Konstanten. Ein Entzug
 * wirkt bei der nächsten Anfrage, in genau einem Bereich, ohne Deployment.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur, type Scope } from './harness.js';

let f: Fixtur;

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel],
  );
  return r!.id;
}

/**
 * Legt ein Konto an. `globaleRolle` ist NUR für `super_admin` — die einzige
 * Rolle mit `geltungsbereich = 'global'`. Jede andere Rolle gilt je Bereich
 * und kommt über `benutzer_mandant`; der Trigger auf `benutzer` weist alles
 * andere ab, und das ist richtig so.
 */
async function konto(
  email: string,
  opts: { globaleRolle?: 'super_admin'; faktor?: boolean } = {},
): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email],
  );
  const id = u!.id;
  if (opts.faktor === true) {
    await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [id]);
  }
  await sql.unsafe(
    `insert into benutzer (id, email, name, globale_rolle_id, status)
     values ($1,$2,$2,$3,'aktiv')`,
    [id, email, opts.globaleRolle === undefined ? null : await rolleId(opts.globaleRolle)],
  );
  return id;
}

async function mitglied(b: string, m: string, rolle: string, module?: string[]): Promise<void> {
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, module)
     values ($1,$2,$3,$4::text[])`,
    [b, m, await rolleId(rolle), module ?? null],
  );
}

/** Fragt `app.hat_recht` in der Sitzung dieses Benutzers. */
async function hatRecht(
  benutzer: string, recht: string, mandant: string | null,
  opts: { scope?: Scope; aal?: string } = {},
): Promise<boolean> {
  return alsApp(
    {
      scope: opts.scope ?? 'mandant',
      ...(mandant === null ? {} : { mandantId: mandant }),
      mandantIds: mandant === null ? [f.reinigung, f.security, f.bau, f.operations] : [],
      benutzerId: benutzer, portal: 'intern', readonly: false,
    },
    async (tx) => {
      if (opts.aal !== undefined) await tx.unsafe(`select set_config('app.aal',$1,true)`, [opts.aal]);
      const [z] = await tx.unsafe<{ hat: boolean }[]>(
        `select app.hat_recht($1, $2::uuid) hat`, [recht, mandant],
      );
      return z!.hat;
    },
  );
}

/**
 * Bindet einer Rolle ein Recht in genau einem Bereich — der `○`-Fall aus §12.
 *
 * `system.rolle_verwalten` ist für `admin` ausdrücklich nur BINDBAR, nicht
 * gebunden: den Rechte-Editor bekommt ein Bereichsadmin, wenn jemand ihn ihm
 * gibt, nicht von selbst.
 */
async function gewaehre(rolle: string, recht: string, mandant: string): Promise<void> {
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     select $1, b.id, $2, true from berechtigung b where b.schluessel = $3`,
    [await rolleId(rolle), mandant, recht],
  );
}

/** Entzieht einer Rolle ein Recht in genau einem Bereich. */
async function entziehe(rolle: string, recht: string, mandant: string): Promise<void> {
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     select $1, b.id, $2, false from berechtigung b where b.schluessel = $3`,
    [await rolleId(rolle), mandant, recht],
  );
}

beforeEach(async () => {
  f = await seed();
});
afterAll(schliessen);

describe('(1) ein Entzug wirkt in EINEM Bereich, sofort, ohne Deployment (AUT-03)', () => {
  it('finanzen.lesen der leitung in bau entziehen ändert reinigung nicht', async () => {
    const chef = await konto('chef@cse.test');
    await mitglied(chef, f.bau, 'leitung');
    await mitglied(chef, f.reinigung, 'leitung');

    // Vorher: beides erlaubt, aus der Plattform-Vorgabe von §12.
    expect(await hatRecht(chef, 'finanzen.lesen', f.bau)).toBe(true);
    expect(await hatRecht(chef, 'finanzen.lesen', f.reinigung)).toBe(true);

    await entziehe('leitung', 'finanzen.lesen', f.bau);

    // Nachher: nur in bau weg. Kein Neustart, kein Deployment — die nächste
    // Abfrage liest die Zeile.
    expect(await hatRecht(chef, 'finanzen.lesen', f.bau)).toBe(false);
    expect(await hatRecht(chef, 'finanzen.lesen', f.reinigung)).toBe(true);
  });

  it('und die Rolle in einem dritten Bereich bleibt ebenfalls unberührt', async () => {
    const chef = await konto('chef2@cse.test');
    await mitglied(chef, f.security, 'leitung');
    await entziehe('leitung', 'finanzen.lesen', f.bau);
    expect(await hatRecht(chef, 'finanzen.lesen', f.security)).toBe(true);
  });

  it('mandantenspezifisch schlägt Plattform-Vorgabe — in beide Richtungen', async () => {
    const ma = await konto('ma@cse.test');
    await mitglied(ma, f.reinigung, 'mitarbeiter');
    // `mitarbeiter` hält finanzen.lesen per Vorgabe NICHT.
    expect(await hatRecht(ma, 'finanzen.lesen', f.reinigung)).toBe(false);

    await sql.unsafe(
      `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
       select $1, b.id, $2, true from berechtigung b where b.schluessel = 'finanzen.lesen'`,
      [await rolleId('mitarbeiter'), f.reinigung],
    );
    // Eine Vorgabe muss sich je Mandant nicht nur entziehen, sondern auch
    // erweitern lassen — sonst ist `gewaehrt` als Boolean sinnlos.
    expect(await hatRecht(ma, 'finanzen.lesen', f.reinigung)).toBe(true);
    expect(await hatRecht(ma, 'finanzen.lesen', f.security)).toBe(false);
  });
});

describe('(2) Anwendung und RLS verweigern denselben Fall — beide, nicht eine (AUT-05)', () => {
  it('ohne nummernkreis.ziehen: hat_recht false UND die Policy trifft null Zeilen', async () => {
    const ma = await konto('doppelt@cse.test');
    await mitglied(ma, f.reinigung, 'mitarbeiter');

    // Linie 1 — die Anwendung fragt und bekommt nein.
    expect(await hatRecht(ma, 'system.benutzer_verwalten', f.reinigung)).toBe(false);

    // Linie 2 — die Datenbank, unabhängig davon. `benutzer_mandant` schreiben
    // verlangt system.benutzer_verwalten in der WITH CHECK.
    await expect(
      alsApp(
        { scope: 'mandant', mandantId: f.reinigung, benutzerId: ma, portal: 'intern', readonly: false },
        (tx) => tx.unsafe(
          `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id)
           values ($1,$2,(select id from rolle where schluessel='mitarbeiter' and mandant_id is null))`,
          [ma, f.reinigung],
        ),
      ),
    ).rejects.toThrow(/row-level security/iu);
  });

  it('die zweite Linie hält auch, wenn die erste vergessen wird', async () => {
    // Der Punkt von AUT-05: RLS ist keine Wiederholung, sondern die Zusage,
    // dass ein vergessener authorize()-Aufruf keine Daten preisgibt.
    const admin = await konto('adm@cse.test', { faktor: true });
    await mitglied(admin, f.reinigung, 'admin');
    await entziehe('admin', 'system.benutzer_verwalten', f.reinigung);

    await expect(
      alsApp(
        { scope: 'mandant', mandantId: f.reinigung, benutzerId: admin, portal: 'intern', readonly: false },
        async (tx) => {
          await tx.unsafe(`select set_config('app.aal','aal2',true)`);
          return tx.unsafe(
            `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id)
             values ($1,$2,(select id from rolle where schluessel='kunde' and mandant_id is null))`,
            [admin, f.security],
          );
        },
      ),
    ).rejects.toThrow(/row-level security/iu);
  });
});

describe('(3) der Umfang je Rolle folgt SPEC §3', () => {
  /**
   * Tabellengetrieben statt fünf Einzelprüfungen: die Zusage ist eine
   * Eigenschaft der MATRIX, und eine Tabelle zeigt eine Lücke, wo fünf
   * Prüfungen nur zeigen, was jemand aufzuschreiben dachte.
   */
  const faelle: readonly (readonly [rolle: string, recht: string, erwartet: boolean])[] = [
    // leitung — eigener Bereich, operativ.
    ['leitung', 'dienstplan.schreiben', true],
    ['leitung', 'zeit.lesen', true],
    ['leitung', 'system.mandant_verwalten', false],   // nur_global
    ['leitung', 'system.benutzer_verwalten', false],
    // mitarbeiter — die eigene Arbeit, kein Verwaltungsrecht.
    ['mitarbeiter', 'zeit.abwesenheit_melden', true],
    ['mitarbeiter', 'personal.entgelt_lesen', false],
    ['mitarbeiter', 'dienstplan.schreiben', false],
    ['mitarbeiter', 'finanzen.lesen', false],
    // kunde — die eigenen Vorgänge, und die sind bewusst GEBUNDEN, nicht
    // bloss bindbar: ein Kundenportal mit lauter ungebundenen Rechten ist
    // tot ausgeliefert (§12, die elf Zellen).
    ['kunde', 'angebot.lesen', true],
    ['kunde', 'finanzen.lesen', true],
    ['kunde', 'dokument.lesen', true],
    ['kunde', 'objekt.lesen', true],
    ['kunde', 'zeit.lesen', false],
    ['kunde', 'personal.lesen', false],
  ];

  it.each(faelle)('%s hält %s → %s', async (rolle, recht, erwartet) => {
    const b = await konto(`${rolle}-${recht.replace(/\W/gu, '')}@cse.test`);
    await mitglied(b, f.reinigung, rolle);
    expect(await hatRecht(b, recht, f.reinigung)).toBe(erwartet);
  });

  it('die elf Kundenrechte sind alle gebunden, nicht bloss bindbar', async () => {
    const kd = await konto('kunde-alle@cse.test');
    await mitglied(kd, f.reinigung, 'kunde');
    for (const recht of ['objekt.lesen', 'angebot.lesen', 'auftrag.lesen', 'dokument.lesen',
                         'nachweis.lesen', 'bau.lesen', 'qualitaet.lesen', 'nachricht.lesen',
                         'finanzen.lesen', 'zahlung.lesen', 'mahnung.lesen']) {
      expect(await hatRecht(kd, recht, f.reinigung), recht).toBe(true);
    }
  });

  it('eine Modulbeschränkung ist eine SCHNITTMENGE, kein Zusatz (AUT-01)', async () => {
    const b = await konto('nur-zeit@cse.test');
    await mitglied(b, f.reinigung, 'leitung', ['zeit', 'dienstplan']);
    expect(await hatRecht(b, 'zeit.lesen', f.reinigung)).toBe(true);
    // Die Rolle hätte es; die Modulliste nimmt es weg.
    expect(await hatRecht(b, 'finanzen.lesen', f.reinigung)).toBe(false);
  });

  it('in der Gruppenansicht sind nur lesen und exportieren erreichbar (Invariante 10)', async () => {
    const chef = await konto('gruppe@cse.test');
    await mitglied(chef, f.reinigung, 'leitung');
    // Ein Schreibrecht ist in der Gruppenansicht nicht erreichbar — egal, ob
    // die Rolle es hält.
    expect(await hatRecht(chef, 'dienstplan.schreiben', null, { scope: 'gruppe' })).toBe(false);
  });

  it('ein unbekannter Schlüssel ist false — still und dauerhaft (K-19/D-17)', async () => {
    const chef = await konto('unbekannt@cse.test');
    await mitglied(chef, f.reinigung, 'leitung');
    // Das Modul `rechnung` gibt es nicht; der Schlüssel heisst `finanzen.lesen`.
    expect(await hatRecht(chef, 'rechnung.lesen', f.reinigung)).toBe(false);
    expect(await hatRecht(chef, 'finanzen.tippfehler', f.reinigung)).toBe(false);
  });

  it('erfordert_2fa wirkt nur in einer aal2-Sitzung (AUT-02)', async () => {
    const admin = await konto('zweifaktor@cse.test', { faktor: true });
    await mitglied(admin, f.reinigung, 'admin');
    const [z] = await sql.unsafe<{ n: number }[]>(
      `update berechtigung set erfordert_2fa = true where schluessel = 'system.benutzer_verwalten'
       returning 1 n`,
    );
    expect(z).toBeDefined();
    expect(await hatRecht(admin, 'system.benutzer_verwalten', f.reinigung, { aal: 'aal1' })).toBe(false);
    expect(await hatRecht(admin, 'system.benutzer_verwalten', f.reinigung, { aal: 'aal2' })).toBe(true);
  });
});

describe('(4) der Editor vergibt nie mehr, als er selbst hält (SEC-A3)', () => {
  it('ein admin ohne finanzen.festschreiben kann es niemandem geben', async () => {
    const admin = await konto('editor@cse.test', { faktor: true });
    await mitglied(admin, f.reinigung, 'admin');
    // Erst den Editor überhaupt bekommen — `○` in §12, nicht `✔`.
    await gewaehre('admin', 'system.rolle_verwalten', f.reinigung);
    await entziehe('admin', 'finanzen.festschreiben', f.reinigung);

    await expect(
      alsApp(
        { scope: 'mandant', mandantId: f.reinigung, benutzerId: admin, portal: 'intern', readonly: false },
        async (tx) => {
          await tx.unsafe(`select set_config('app.aal','aal2',true)`);
          return tx.unsafe(
            `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
             select (select id from rolle where schluessel='mitarbeiter' and mandant_id is null),
                    b.id, $1, true
               from berechtigung b where b.schluessel = 'finanzen.festschreiben'`,
            [f.reinigung],
          );
        },
      ),
    ).rejects.toThrow(/hält es selbst nicht/u);
  });

  it('ein Recht, das er hält, darf er weitergeben', async () => {
    const admin = await konto('editor2@cse.test', { faktor: true });
    await mitglied(admin, f.reinigung, 'admin');
    await gewaehre('admin', 'system.rolle_verwalten', f.reinigung);

    const zeilen = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: admin, portal: 'intern', readonly: false },
      async (tx) => {
        await tx.unsafe(`select set_config('app.aal','aal2',true)`);
        return tx.unsafe<unknown[]>(
          `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
           select (select id from rolle where schluessel='mitarbeiter' and mandant_id is null),
                  b.id, $1, true
             from berechtigung b where b.schluessel = 'zeit.korrigieren' returning id`,
          [f.reinigung],
        );
      },
    );
    expect(zeilen).toHaveLength(1);
  });
});

describe('(5) der letzte super_admin kann sich nicht aussperren', () => {
  it('deaktivieren wird abgelehnt, solange er der letzte ist', async () => {
    const sa = await konto('sa1@cse.test', { globaleRolle: 'super_admin', faktor: true });
    await expect(
      sql.unsafe(`update benutzer set status = 'deaktiviert', deaktiviert_am = now() where id = $1`, [sa]),
    ).rejects.toThrow(/letzte super_admin/u);
  });

  it('die globale Rolle wegzunehmen ebenso — es ist derselbe Ausfall', async () => {
    const sa = await konto('sa2@cse.test', { globaleRolle: 'super_admin', faktor: true });
    await expect(
      sql.unsafe(`update benutzer set globale_rolle_id = null where id = $1`, [sa]),
    ).rejects.toThrow(/letzte super_admin/u);
  });

  it('mit einem zweiten super_admin geht beides', async () => {
    const a = await konto('sa3@cse.test', { globaleRolle: 'super_admin', faktor: true });
    await konto('sa4@cse.test', { globaleRolle: 'super_admin', faktor: true });
    await sql.unsafe(`update benutzer set status='deaktiviert', deaktiviert_am=now() where id=$1`, [a]);
    const [z] = await sql.unsafe<{ status: string }[]>(
      `select status from benutzer where id = $1`, [a],
    );
    expect(z!.status).toBe('deaktiviert');
  });

  it('und dem super_admin ein Recht zu entziehen wird abgelehnt', async () => {
    await expect(entziehe('super_admin', 'finanzen.lesen', f.reinigung))
      .rejects.toThrow(/kann sich Rechte nicht entziehen/u);
  });
});
