/**
 * Die Zustellung, die es nicht gab — gegen echtes Postgres.
 *
 * Zwei Luecken, die sich gegenseitig unsichtbar gemacht haben:
 *
 *  1. Im ganzen Zweig fuehrte keine Zeile `insert into benachrichtigung` aus.
 *     `erzeuge()` baute die Meldung und gab sie zurueck; danach endete der
 *     Nachtlauf. Die Quittung in `nachweis_warnung` entstand trotzdem — und
 *     weil die verhindert, dass eine Stufe zweimal anschlaegt, war die
 *     Warnung danach fuer immer weg.
 *  2. 0011 gab `cse_job` `select, insert` auf der Tabelle und legte keine
 *     Policy dazu. Unter `force row level security` heisst keine anwendbare
 *     Policy nicht „alles erlaubt", sondern „nichts". Das Recht war da, der
 *     Weg nicht (0099).
 *
 * Weil es (1) nicht gab, konnte (2) nicht auffallen. Deshalb steht der Test
 * gegen die DATENBANK und nicht gegen eine Attrappe: in TypeScript ist jede
 * dieser beiden Aussagen unfalsifizierbar.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, alsRolle, schliessen, seed, sql, type Fixtur } from './harness.js';
import { stelleZu } from '../../src/server/benachrichtigung/ablage.js';
import { erzeuge, leereArten } from '../../src/server/benachrichtigung/registry.js';
import { registriereNachweisArten } from '../../src/server/services/nachweis/benachrichtigung.js';
import { artSchluessel } from '../../src/server/services/nachweis/benachrichtigung.js';

let f: Fixtur;
const zufall = (): string => String(Math.random()).slice(2, 10);

/** Ein Zugang ZU einer Person — der Unterschied, um den es bei D-09 geht. */
async function konto(personId: string | null): Promise<string> {
  const email = `zustellung-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, person_id)
     values ($1,$2,$2,'aktiv',$3)`, [u!.id, email, personId]);
  return u!.id;
}

function meldung(mandantId: string, nachweisId: string) {
  return erzeuge(artSchluessel(60), {
    mandantId,
    objektTyp: 'nachweis',
    objektId: nachweisId,
    daten: { bezeichnung: 'Sachkundeprüfung §34a', gueltigBis: '2026-03-03',
      stufeTage: 60, blockiertEinsatz: true },
  });
}

beforeEach(async () => {
  f = await seed();
  leereArten();
  registriereNachweisArten();
});
afterAll(schliessen);

describe('der Nachtlauf schreibt Benachrichtigungen — als `cse_job`', () => {
  it('die Zeile entsteht und traegt Empfaenger, Mandant und Ziel', async () => {
    const benutzer = await konto(f.fatima);
    const nachweisId = crypto.randomUUID();

    const bericht = await alsRolle('cse_job', async (tx) => stelleZu(
      { unsafe: (a, w) => tx.unsafe(a, (w ?? []) as never[]) },
      [{ benachrichtigung: meldung(f.security, nachweisId), personId: f.fatima,
        objektTyp: 'nachweis', objektId: nachweisId }],
    ));

    expect(bericht.zugestellt).toBe(1);
    expect(bericht.ohneEmpfaenger).toHaveLength(0);

    const [zeile] = await sql.unsafe<{
      empfaenger_id: string; mandant_id: string; ziel: string; art: string;
      objekt_id: string; sammelbar: boolean;
    }[]>(`select empfaenger_id, mandant_id, ziel, art, objekt_id, sammelbar
            from benachrichtigung where objekt_id = $1`, [nachweisId]);
    expect(zeile!.empfaenger_id).toBe(benutzer);
    expect(zeile!.mandant_id).toBe(f.security);
    expect(zeile!.ziel).toBe('/portal/mein/nachweise');
    expect(zeile!.art).toBe('nachweis.ablauf_60');
    expect(zeile!.sammelbar).toBe(false);
  });

  /**
   * Die Gegenprobe zu 0099. Ohne die Policy schluege schon der Fall darueber
   * fehl — dieser hier sagt, WARUM: `cse_app` haelt auf dieser Tabelle gar
   * kein Einfuegerecht, denn eine Benachrichtigung, die sich ein Benutzer
   * selbst schreiben kann, ist keine.
   */
  it('`cse_app` darf hier nicht einfuegen — Meldungen schreibt der Dienst', async () => {
    await konto(f.fatima);
    await expect(alsApp(
      { scope: 'mandant', mandantId: f.security, portal: 'intern', readonly: false },
      async (tx) => tx.unsafe(
        `insert into benachrichtigung
           (mandant_id, empfaenger_id, art, titel, text, ziel, objekt_typ, sammelbar)
         values ($1,$1,'x','t','t','/','nachweis',false)`, [f.security] as never[]),
    )).rejects.toThrow();
  });

  it('eine Person OHNE Zugang wird gemeldet, nicht verschluckt (D-09)', async () => {
    // Kein `konto(...)`: der Mensch existiert, sein Zugang nicht — heute der
    // Normalfall, solange PR 20 offen ist.
    const nachweisId = crypto.randomUUID();
    const bericht = await alsRolle('cse_job', async (tx) => stelleZu(
      { unsafe: (a, w) => tx.unsafe(a, (w ?? []) as never[]) },
      [{ benachrichtigung: meldung(f.security, nachweisId), personId: f.fatima,
        objektTyp: 'nachweis', objektId: nachweisId }],
    ));

    expect(bericht.zugestellt).toBe(0);
    expect(bericht.ohneEmpfaenger).toEqual([{
      personId: f.fatima,
      art: 'nachweis.ablauf_60',
      grund: 'Kein aktiver Zugang zu dieser Person (D-09) — PR 20 steht aus.',
    }]);
    const uebrig = await sql.unsafe(
      `select id from benachrichtigung where objekt_id = $1`, [nachweisId]);
    expect(uebrig).toHaveLength(0);
  });

  /**
   * **Zugestellt und trotzdem auffaellig** — und das gehoert NICHT in die
   * Liste „ohne Empfaenger".
   *
   * EMP-14 verlangt einen Zugang je Person. Sind es zwei, ist das ein
   * Datenfehler; die Meldung geht an den aelteren, reproduzierbar, und der
   * Bericht sagt es getrennt. Der erste Entwurf legte diesen Fall zu den
   * Ausfaellen — wer die Kennzahlen liest, haette Zustellungen als Ausfaelle
   * gezaehlt.
   */
  it('zwei Zugaenge zu einer Person: EINE Meldung, und der Bericht sagt es',
    async () => {
      const erster = await konto(f.fatima);
      await konto(f.fatima);
      const nachweisId = crypto.randomUUID();
      const bericht = await alsRolle('cse_job', async (tx) => stelleZu(
        { unsafe: (a, w) => tx.unsafe(a, (w ?? []) as never[]) },
        [{ benachrichtigung: meldung(f.security, nachweisId), personId: f.fatima,
          objektTyp: 'nachweis', objektId: nachweisId }],
      ));

      expect(bericht.zugestellt).toBe(1);
      expect(bericht.ohneEmpfaenger).toHaveLength(0);
      expect(bericht.mehrdeutig).toEqual([
        { personId: f.fatima, art: 'nachweis.ablauf_60', zugaenge: 2 },
      ]);

      const zeilen = await sql.unsafe<{ empfaenger_id: string }[]>(
        `select empfaenger_id from benachrichtigung where objekt_id = $1`, [nachweisId]);
      expect(zeilen).toHaveLength(1);
      expect(zeilen[0]!.empfaenger_id).toBe(erster);
    });

  it('ein GESPERRTER Zugang zaehlt nicht als Empfaenger', async () => {
    const benutzer = await konto(f.fatima);
    await sql.unsafe(`update benutzer set status = 'gesperrt' where id = $1`, [benutzer]);
    const nachweisId = crypto.randomUUID();
    const bericht = await alsRolle('cse_job', async (tx) => stelleZu(
      { unsafe: (a, w) => tx.unsafe(a, (w ?? []) as never[]) },
      [{ benachrichtigung: meldung(f.security, nachweisId), personId: f.fatima,
        objektTyp: 'nachweis', objektId: nachweisId }],
    ));
    expect(bericht.zugestellt).toBe(0);
    expect(bericht.ohneEmpfaenger[0]?.grund).toContain('Kein aktiver Zugang');
  });

  /**
   * Der Empfaenger sieht sie, ein anderer nicht — `t_benachrichtigung_eigene`
   * bindet an `app.aktueller_benutzer()`. Ohne diesen Fall koennte 0099 die
   * Tabelle versehentlich fuer alle geoeffnet haben, und der Test darueber
   * waere trotzdem gruen.
   */
  it('lesen darf sie nur, wer sie bekommen hat', async () => {
    const benutzer = await konto(f.fatima);
    const fremder = await konto(null);
    for (const b of [benutzer, fremder]) {
      await sql.unsafe(
        `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id)
         values ($1,$2,(select id from rolle where schluessel='leitung' and mandant_id is null))`,
        [b, f.security]);
    }
    const nachweisId = crypto.randomUUID();
    await alsRolle('cse_job', async (tx) => stelleZu(
      { unsafe: (a, w) => tx.unsafe(a, (w ?? []) as never[]) },
      [{ benachrichtigung: meldung(f.security, nachweisId), personId: f.fatima,
        objektTyp: 'nachweis', objektId: nachweisId }],
    ));

    const sicht = async (wer: string): Promise<number> => (await alsApp(
      { scope: 'mandant', mandantId: f.security, mandantIds: [f.security],
        benutzerId: wer, portal: 'intern' },
      async (tx) => tx.unsafe(
        `select id from benachrichtigung where objekt_id = $1`, [nachweisId] as never[]),
    )).length;

    expect(await sicht(benutzer)).toBe(1);
    expect(await sicht(fremder)).toBe(0);
  });
});
