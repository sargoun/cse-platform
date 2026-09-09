/**
 * PR 8 Akzeptanz (3, Laufzeitseite), (4) und (6).
 *
 * Der Typ aus `kontext/index.ts` schützt den Code, den wir schreiben. Diese
 * Datei prüft, was danach kommt: ein direkter POST, ein vergessener Aufruf,
 * ein Skript. Zwei Linien, nicht eine (AUT-05).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import { SCHREIBENDE_DIENSTE } from '../../src/server/registry/dienste.js';
import {
  KeinAktiverMandantFehler, withGroupScope, withTenant, type Sitzung,
} from '../../src/server/kontext/index.js';

let f: Fixtur;

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel],
  );
  return r!.id;
}

async function konto(email: string): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email],
  );
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`, [u!.id, email],
  );
  return u!.id;
}

async function mitglied(b: string, m: string, rolle: string): Promise<void> {
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [b, m, await rolleId(rolle)],
  );
}

function sitzung(benutzerId: string, mandantId: string | null): Sitzung {
  return {
    benutzerId, personId: null, aktiverMandantId: mandantId,
    ansicht: mandantId === null ? 'gruppe' : 'mandant',
    aal: 'aal2', portal: 'intern', sitzungId: '00000000-0000-0000-0000-000000000001',
  };
}

beforeEach(async () => {
  f = await seed();
});
afterAll(schliessen);

describe('(6) K-20 — app.portal() ist in der Gruppenansicht die Konstante `intern`', () => {
  it('gebunden beim Betreten des Scopes, nicht aus aktiver_mandant berechnet', async () => {
    const chef = await konto('gruppe-portal@cse.test');
    await mitglied(chef, f.reinigung, 'leitung');

    const portal = await sql.begin(async (tx) =>
      withGroupScope(tx as never, sitzung(chef, null), async (k) => {
        const [z] = await k.abfrage<{ p: string }>(`select app.portal() p`);
        return z!.p;
      }),
    );
    expect(portal).toBe('intern');
  });

  it('aus aktiver_mandant neu berechnet ergäbe `mitarbeiter` — und das leert die Ansicht', async () => {
    // Der fail-closed Wert. Er ist richtig, WO er gilt: ohne bekanntes Portal
    // ist die engste Annahme die sichere. In der Gruppenansicht feuert er
    // jede K-04-Mitarbeiterdecke INNERHALB der Ansicht und leert sie für genau
    // das Management, für das TEN-05 sie gebaut hat.
    const chef = await konto('fail-closed@cse.test');
    await mitglied(chef, f.reinigung, 'leitung');
    const portal = await alsApp(
      { scope: 'gruppe', mandantIds: [f.reinigung], benutzerId: chef, readonly: true },
      async (tx) => {
        const [z] = await tx.unsafe<{ p: string }[]>(`select app.portal() p`);
        return z!.p;
      },
    );
    // Die Harness bindet `portal` nicht — genau der ungebundene Fall.
    expect(portal).toBe('intern');
  });
});

describe('(3) in der Gruppenansicht führt kein Schreibpfad — auch nicht direkt', () => {
  it('withTenant verweigert eine Gruppensitzung mit KeinAktiverMandant', async () => {
    const chef = await konto('kein-mandant@cse.test');
    await expect(
      sql.begin((tx) => withTenant(tx as never, sitzung(chef, null), async () => 'nie')),
    ).rejects.toBeInstanceOf(KeinAktiverMandantFehler);
  });

  it('und die Datenbank verweigert unabhängig davon: readonly + kein aktiver Mandant', async () => {
    const chef = await konto('rls-gruppe@cse.test');
    await mitglied(chef, f.reinigung, 'leitung');

    await expect(
      sql.begin((tx) =>
        withGroupScope(tx as never, sitzung(chef, null), async (k) =>
          // Die Abfrage ist ein INSERT — der Typ hätte es verhindert, ein
          // Skript nicht. Die WITH-CHECK-Policies tragen `mandant_id =
          // app.aktiver_mandant()`, und der ist hier NULL.
          k.abfrage(
            `insert into anstellung (mandant_id, person_id, personalnummer, eintritt)
             values ($1,$2,'G-1','2026-01-01')`,
            [f.reinigung, f.jonas],
          )),
      ),
    // Die Datenbank weist es ab — und zwar BENANNT: `app.assert_genau_ein_mandant`
    // meldet `KeinAktiverMandant`, statt lautlos null Zeilen zu treffen. Beides
    // wäre sicher; nur eines sagt, warum.
    ).rejects.toThrow(/KeinAktiverMandant|row-level security/iu);
  });

  it.each(SCHREIBENDE_DIENSTE)(
    'der schreibende Dienst %s ist in der Gruppenansicht nicht erreichbar',
    async (dienst) => {
      // Das Register wird ITERIERT: ein Modul, das in Phase 5 landet und sich
      // einträgt, ist damit automatisch mitgeprüft.
      const chef = await konto(`dienst-${dienst.pfad.replace(/\W/gu, '')}@cse.test`);
      await mitglied(chef, f.reinigung, 'leitung');
      const erlaubt = await alsApp(
        { scope: 'gruppe', mandantIds: [f.reinigung], benutzerId: chef, portal: 'intern', readonly: true },
        async (tx) => {
          const [z] = await tx.unsafe<{ hat: boolean }[]>(
            `select app.hat_recht($1, null::uuid) hat`, [dienst.schreibRecht!],
          );
          return z!.hat;
        },
      );
      // In der Gruppenansicht sind nur `lesen` und `exportieren` erreichbar.
      expect(erlaubt).toBe(false);
    },
  );

  it('ein Lesepfad dagegen funktioniert — die Ansicht ist nicht kaputt, sondern lesend', async () => {
    const chef = await konto('lesen-geht@cse.test');
    await mitglied(chef, f.reinigung, 'leitung');
    await mitglied(chef, f.security, 'leitung');

    const anzahl = await sql.begin(async (tx) =>
      withGroupScope(tx as never, sitzung(chef, null), async (k) => {
        const zeilen = await k.abfrage<{ n: string }>(`select count(*) n from anstellung`);
        return Number(zeilen[0]!.n);
      }),
    );
    // Fatima in beiden plus Jonas in der Reinigung.
    expect(anzahl).toBe(3);
  });
});

describe('(4) die Zähler kommen aus LIVE-Abfragen', () => {
  it('eine Änderung ist beim nächsten Öffnen sichtbar', async () => {
    const chef = await konto('zaehler@cse.test');
    await mitglied(chef, f.reinigung, 'leitung');

    const zaehle = async (): Promise<number> => sql.begin(async (tx) =>
      withGroupScope(tx as never, sitzung(chef, null), async (k) => {
        const z = await k.abfrage<{ n: string }>(
          `select count(*) n from anstellung where mandant_id = $1`, [f.reinigung],
        );
        return Number(z[0]!.n);
      }),
    );

    const vorher = await zaehle();
    await sql.unsafe(
      `insert into anstellung (mandant_id, person_id, personalnummer, eintritt)
       values ($1,$2,'Z-1','2026-01-01')`, [f.reinigung, f.jonas],
    );
    expect(await zaehle()).toBe(vorher + 1);
  });

  it('der Zähler je Bereich hängt an gruppe.bericht.lesen — es gibt kein Modul `dashboard`', async () => {
    const chef = await konto('bericht@cse.test');
    await mitglied(chef, f.reinigung, 'leitung');

    /**
     * Der Mandant, der hier übergeben wird, ist der des ZEILE — so schreibt
     * K-03 die Gruppenpolicy: `hat_recht('gruppe.<modul>.lesen', mandant_id)`.
     * Nicht der aktive, denn in dieser Ansicht gibt es keinen.
     */
    const hat = async (recht: string): Promise<boolean> => alsApp(
      { scope: 'gruppe', mandantIds: [f.reinigung], benutzerId: chef, portal: 'intern', readonly: true },
      async (tx) => {
        const [z] = await tx.unsafe<{ h: boolean }[]>(
          `select app.hat_recht($1, $2::uuid) h`, [recht, f.reinigung],
        );
        return z!.h;
      },
    );

    // §12.1 bindet `gruppe.*.lesen` per Vorgabe nur an `super_admin`; für
    // `leitung` ist es `○` — bindbar. Die Gruppenansicht ist eine Funktion,
    // die jemand vergibt, nicht eine, die jeder Bereichsleiter mitbringt.
    expect(await hat('gruppe.bericht.lesen')).toBe(false);

    await sql.unsafe(
      `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
       select $1, b.id, $2, true from berechtigung b where b.schluessel = 'gruppe.bericht.lesen'`,
      [await rolleId('leitung'), f.reinigung],
    );
    expect(await hat('gruppe.bericht.lesen')).toBe(true);

    // `dashboard` ist kein Modul (§7.4). Der Schlüssel existiert nicht, und
    // unter K-19 heisst das: dauerhaft false, still — kein Fehler.
    expect(await hat('gruppe.dashboard.lesen')).toBe(false);
  });
});

describe('die sichtbare Menge wird ABGELEITET, nicht eingereicht', () => {
  /**
   * Der Befund, den diese Gruppe festhaelt: die Seite reichte
   * `select id from mandant` als Menge ein. Im Gruppen-Scope IST
   * `app.mandant_ids` die sichtbare Menge (`0004_rls_baseline.sql`), und
   * `t_mandant_lesen` prueft nur die Zugehoerigkeit zu ihr — kein Recht. Eine
   * `leitung` der Reinigung las damit die Namen aller vier Gesellschaften.
   */
  it('eine leitung der Reinigung sieht in der Gruppenansicht nur die Reinigung', async () => {
    const chef = await konto('nur-eigene@cse.test');
    await mitglied(chef, f.reinigung, 'leitung');

    const slugs = await sql.begin(async (tx) =>
      withGroupScope(tx as never, sitzung(chef, null), async (k) =>
        k.abfrage<{ slug: string }>(`select slug from mandant order by slug`)),
    ) as readonly { slug: string }[];

    expect(slugs.map((z) => z.slug)).toEqual(['reinigung']);
  });

  it('zwei Mitgliedschaften ergeben zwei Bereiche — und nicht mehr', async () => {
    const chef = await konto('zwei-bereiche@cse.test');
    await mitglied(chef, f.reinigung, 'leitung');
    await mitglied(chef, f.security, 'leitung');

    const ids = await sql.begin(async (tx) =>
      withGroupScope(tx as never, sitzung(chef, null), async (k) => k.mandantIds),
    ) as readonly string[];

    expect([...ids].sort()).toEqual([f.reinigung, f.security].sort());
  });

  it('ohne jede Mitgliedschaft ist die Menge leer — nicht "alle"', async () => {
    // Fail closed. Der Unterschied zaehlt: eine leere Menge zeigt nichts, eine
    // fehlende Einschraenkung zeigt alles.
    const niemand = await konto('ohne-bereich@cse.test');

    const ids = await sql.begin(async (tx) =>
      withGroupScope(tx as never, sitzung(niemand, null), async (k) => k.mandantIds),
    ) as readonly string[];

    expect(ids).toEqual([]);
  });
});

describe('§4.5 — wer die Gruppenansicht BETRETEN darf', () => {
  /**
   * Die drei Bedingungen, einzeln falsifiziert.
   *
   * Ohne diese Gruppe koennte `app.darf_gruppenansicht()` konstant `false`
   * liefern und alles bliebe gruen — die Gruppenansicht waere fuer JEDEN 404,
   * und der Test sagte nichts dazu. Jeder Fall unten fehlt genau eine
   * Bedingung.
   */
  async function darf(benutzerId: string): Promise<boolean> {
    return alsApp(
      { scope: 'mandant', benutzerId, portal: 'intern', mandantId: f.reinigung },
      async (tx) => {
        const [z] = await tx.unsafe<{ ok: boolean }[]>(
          `select app.darf_gruppenansicht() as ok`,
        );
        return z!.ok;
      },
    );
  }

  /** Bindet `gruppe.bericht.lesen` an die Rolle, in genau diesem Bereich. */
  async function gruppenrecht(rolle: string, mandantId: string): Promise<void> {
    await sql.unsafe(
      `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
       select $1, b.id, $2, true from berechtigung b
        where b.schluessel = 'gruppe.bericht.lesen'
       on conflict do nothing`,
      [await rolleId(rolle), mandantId],
    );
  }

  it('zwei interne Mitgliedschaften plus ein Gruppenrecht: ja', async () => {
    const chef = await konto('darf-gruppe@cse.test');
    await mitglied(chef, f.reinigung, 'leitung');
    await mitglied(chef, f.security, 'leitung');
    await gruppenrecht('leitung', f.reinigung);
    expect(await darf(chef)).toBe(true);
  });

  it('nur EIN Bereich: nein — DESIGN §6 Regel 1', async () => {
    const einer = await konto('ein-bereich@cse.test');
    await mitglied(einer, f.reinigung, 'leitung');
    await gruppenrecht('leitung', f.reinigung);
    expect(await darf(einer)).toBe(false);
  });

  it('zwei Bereiche, aber keine `intern`-Rolle: nein', async () => {
    // Eine Arbeiterin, die fuer zwei Gesellschaften faehrt, liest ihre beiden
    // Beschaeftigungen ueber `/portal/mein` — die Gruppenansicht ist die
    // LEITENDE Ansicht (K-18).
    const arbeiter = await konto('zwei-jobs@cse.test');
    await mitglied(arbeiter, f.reinigung, 'mitarbeiter');
    await mitglied(arbeiter, f.security, 'mitarbeiter');
    expect(await darf(arbeiter)).toBe(false);
  });

  it('zwei interne Mitgliedschaften, aber kein `gruppe.*.lesen`: nein', async () => {
    // §12.1 bindet die Gruppenrechte per Vorgabe nur an `super_admin`. Die
    // Gruppenansicht ist eine Funktion, die jemand vergibt — nicht eine, die
    // jeder Bereichsleiter mitbringt.
    const ohneRecht = await konto('kein-gruppenrecht@cse.test');
    const rolle = await sql.unsafe<{ id: string }[]>(
      `insert into rolle (schluessel, bezeichnung, geltungsbereich, portal)
       values ('leitung_ohne_gruppe','Leitung ohne Gruppenrecht','mandant','intern')
       returning id`,
    );
    for (const m of [f.reinigung, f.security]) {
      await sql.unsafe(
        `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
        [ohneRecht, m, rolle[0]!.id],
      );
    }
    expect(await darf(ohneRecht)).toBe(false);
  });
});

