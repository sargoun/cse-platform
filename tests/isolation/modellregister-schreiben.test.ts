import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, alsRolle, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import {
  legeModellAn, ModellFehler, modelle, setzeFreigabe,
} from '../../src/server/services/system/modellregister.js';

/**
 * **Ein Modell freigeben, ohne SQL von Hand** (V-120, D-04, §3.6).
 *
 * Der Befund kam beim Einrichten, von einem Menschen: `docs/EINRICHTEN-*.md`
 * §9 beschrieb den letzten Schritt der KI-Anbindung als handgeschriebene
 * Zeile `insert into modell_register …`, weil `0154` `cse_app` auf der
 * Tabelle nur `select` gab.
 *
 * **Gemessen wird vor allem, was NICHT geht:** eine Freigabe ohne Nachweis,
 * eine Freigabe ohne die beiden anderen Bestätigungen, ein Löschen — und ein
 * Zeuge, den jemand selbst einträgt.
 */

let f: Fixtur;
let admin = '';
let ohneRecht = '';

async function konto(email: string, rolle: string): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status)
     values ($1, $2, $2, 'aktiv')`, [u!.id, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1, $2, (select id from rolle
                       where schluessel = $3 and mandant_id is null), true)`,
    [u!.id, f.reinigung, rolle]);
  return u!.id;
}

beforeAll(async () => {
  f = await seed();
  admin = await konto('modell-admin@test.invalid', 'leitung');
  ohneRecht = await konto('modell-ohne@test.invalid', 'mitarbeiter');
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     values ((select id from rolle where schluessel = 'leitung' and mandant_id is null),
             (select id from berechtigung
               where schluessel = 'system.einstellung_verwalten'), $1, true)
     on conflict (rolle_id, berechtigung_id, mandant_id) do update set gewaehrt = true`,
    [f.reinigung]);
});
afterAll(schliessen);

function sitzung(benutzerId: string) {
  return {
    scope: 'mandant' as const, mandantId: f.reinigung, benutzerId,
    portal: 'intern' as const, readonly: false,
  };
}

function alsKontext(tx: postgres.TransactionSql, benutzerId: string): SchreibKontext {
  const abfrage = async <T,>(
    anweisung: string, werte?: readonly unknown[],
  ): Promise<readonly T[]> =>
    (await tx.unsafe(anweisung, (werte ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId,
    aktiverMandantId: f.reinigung, mandantIds: [f.reinigung],
    abfrage, schreibe: abfrage,
  };
}

async function imKontext<T>(
  benutzerId: string, fn: (k: SchreibKontext) => Promise<T>, aal = 'aal2',
): Promise<T> {
  return alsApp(sitzung(benutzerId), async (tx) => {
    await tx.unsafe(`select set_config('app.aal',$1,true)`, [aal]);
    return fn(alsKontext(tx, benutzerId));
  }) as Promise<T>;
}

const GUT = {
  anbieter: 'openai', modell: 'gpt-4o-mini', faehigkeit: 'entwurf_text',
  euVerarbeitung: true, zeroRetention: true, freigegeben: true,
  nachweisUrl: 'https://example.invalid/dpa.pdf',
};

describe('§1 die Zeile entsteht — und die Datenbank setzt den Zeugen', () => {
  it('ein freigegebenes Modell ist aufrufbar', async () => {
    await imKontext(admin, (k) => legeModellAn(k, GUT));
    const liste = await imKontext(admin, (k) => modelle(k));
    const m = liste.find((x) => x.modell === 'gpt-4o-mini');
    expect(m?.aufrufbar).toBe(true);
  });

  /**
   * **`geprueft_von` kommt NICHT aus dem Formular.** Ein Name, den jemand
   * über sich selbst eintippt, ist keine Bezeugung. Der Auslöser
   * `trg_modell_register_zeuge` (0381) setzt den, der tatsächlich schreibt.
   */
  it('der Zeuge ist der, der geschrieben hat — nicht ein Eingabefeld', async () => {
    const [z] = await alsRolle('', (tx) => tx.unsafe(
      `select geprueft_von, geprueft_am from modell_register
        where modell = 'gpt-4o-mini'`),
    ) as unknown as { geprueft_von: string; geprueft_am: Date }[];
    expect(z!.geprueft_von).toBe(admin);
    expect(z!.geprueft_am).not.toBeNull();
  });

  it('`app.modell_fuer` findet es jetzt', async () => {
    const [z] = await alsRolle('', (tx) => tx.unsafe(
      `select app.modell_fuer('entwurf_text'::ki_faehigkeit) as modell`),
    ) as unknown as { modell: string | null }[];
    expect(z!.modell).toBe('gpt-4o-mini');
  });
});

describe('§2 was NICHT geht', () => {
  it('eine Freigabe ohne die beiden anderen Bestätigungen', async () => {
    await expect(imKontext(admin, (k) => legeModellAn(k, {
      ...GUT, modell: 'halb-freigegeben', zeroRetention: false,
    }))).rejects.toMatchObject({ grund: 'freigabe_unvollstaendig' });
  });

  it('eine Freigabe ohne jeden Nachweis', async () => {
    await expect(imKontext(admin, (k) => legeModellAn(k, {
      ...GUT, modell: 'ohne-nachweis', nachweisUrl: undefined, bemerkung: undefined,
    }))).rejects.toMatchObject({ grund: 'ohne_nachweis' });
  });

  it('ein Nachweis, der keine https-Adresse ist', async () => {
    await expect(imKontext(admin, (k) => legeModellAn(k, {
      ...GUT, modell: 'schlechter-nachweis', nachweisUrl: 'siehe Ordner',
    }))).rejects.toMatchObject({ grund: 'nachweis_ungueltig' });
  });

  it('ein Anbieter, der nicht der Form entspricht', async () => {
    await expect(imKontext(admin, (k) => legeModellAn(k, {
      ...GUT, anbieter: 'OpenAI GmbH', modell: 'falscher-anbieter',
    }))).rejects.toMatchObject({ grund: 'anbieter_ungueltig' });
  });

  it('ohne `system.einstellung_verwalten` entsteht nichts', async () => {
    await expect(imKontext(ohneRecht, (k) => legeModellAn(k, {
      ...GUT, modell: 'ohne-recht',
    }))).rejects.toThrow();
  });

  /** K-15: die Zeile ist eine Rechtsaussage, kein Schalter. */
  it('ohne zweiten Faktor entsteht nichts', async () => {
    await expect(imKontext(admin, (k) => legeModellAn(k, {
      ...GUT, modell: 'ohne-aal2',
    }), 'aal1')).rejects.toThrow();
  });

  /**
   * **Gelöscht wird nicht** (Invariante 8, §3.6). Das Register ist der Beleg,
   * wer wann bezeugt hat; eine gelöschte Zeile nimmt ihn mit.
   */
  it('gelöscht wird nichts — auch nicht mit dem Recht', async () => {
    await expect(imKontext(admin, (k) => k.schreibe(
      `delete from modell_register where modell = 'gpt-4o-mini'`)))
      .rejects.toThrow();
  });
});

describe('§3 die Freigabe lässt sich zurücknehmen, die Zeile bleibt', () => {
  it('zurückgenommen heisst nicht aufrufbar — und die Zeile steht noch', async () => {
    const liste = await imKontext(admin, (k) => modelle(k));
    const m = liste.find((x) => x.modell === 'gpt-4o-mini');
    await imKontext(admin, (k) => setzeFreigabe(k, m!.id, false));

    const danach = await imKontext(admin, (k) => modelle(k));
    const n = danach.find((x) => x.modell === 'gpt-4o-mini');
    expect(n).toBeDefined();
    expect(n?.freigegeben).toBe(false);
    expect(n?.aufrufbar).toBe(false);
    // Und die Bezeugung von vorhin bleibt lesbar.
    expect(n?.geprueftVon).not.toBeNull();
  });

  it('ein ModellFehler trägt seinen Grund und seinen Status', async () => {
    const fehler = await imKontext(admin, (k) => legeModellAn(k, {
      ...GUT, modell: '', nachweisUrl: undefined, bemerkung: undefined,
    })).catch((x: unknown) => x);
    expect(fehler).toBeInstanceOf(ModellFehler);
    expect((fehler as ModellFehler).status).toBe(400);
  });
});
