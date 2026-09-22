import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import {
  NachweisFehler, bestaetigeNachweis, brauchtFrist, nimmNachweisAuf, widerrufeNachweis,
} from '../../src/server/services/nachweis/aufnahme.js';

/**
 * **Der Qualifikationsnachweis — aufnehmen, bestätigen, widerrufen**
 * (V-010, SEC-02, SEC-03, EMP-08, DOC-01, § 34a GewO).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `0030` baut das Register vollständig: drei Warnstufen, das Quittungsbuch,
 * die Dokumentpflicht als Auslöser, den nächtlichen Statuslauf, das
 * Einsatztor. Die Plattform konnte vor einer ablaufenden Sachkunde warnen und
 * eine Schicht ohne sie sperren — **und die Zeile, vor der sie warnt, entstand
 * nirgends ausser im Seed.**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Vier Stellen, an denen ein Nachweis teuer wird.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  §1 die Frist — gerechnet aus der Standardgültigkeit der Qualifikation,
 *     in SQL und in Kalendermonaten, nie mit `Date` in einer UTC-Sitzung;
 *  §2 die Dokumentpflicht (DOC-01) — mit einem SATZ und dem NAMEN der
 *     Qualifikation darin, nicht mit dem Text des Auslösers;
 *  §3 die Bestätigung — der Zeuge kommt aus der Sitzung, nicht aus dem
 *     Formular;
 *  §4 der Widerruf — mit Grund, nie durch Löschen (Invariante 8).
 */

let f: Fixtur;
let personal = '';
let personId = '';
let qBefristet = '';
let qUnbefristet = '';
let qMitDokument = '';
let dokumentId = '';

const zufall = (): string => Math.random().toString(36).slice(2, 10);

async function konto(email: string, mandant: string, rolle: string): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1, $2, $2, 'aktiv')`,
    [u!.id, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1, $2, (select id from rolle
                       where schluessel = $3 and mandant_id is null), true)`,
    [u!.id, mandant, rolle]);
  return u!.id;
}

async function qualifikation(
  schluessel: string, o: { laeuftAb: boolean; monate: number | null; dokument: boolean },
): Promise<string> {
  const [q] = await sql.unsafe<{ id: string }[]>(
    `insert into qualifikation
       (mandant_id, schluessel, bezeichnung, laeuft_ab,
        standard_gueltigkeit_monate, erfordert_dokument)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [f.reinigung, schluessel, `Probe ${schluessel}`, o.laeuftAb, o.monate, o.dokument]);
  return q!.id;
}

beforeAll(async () => {
  f = await seed();
  personal = await konto('nachw-personal@test.invalid', f.reinigung, 'leitung');
  for (const r of ['personal.nachweis_lesen', 'personal.nachweis_verwalten',
    'personal.lesen']) {
    await sql.unsafe(
      `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
       values ((select id from rolle where schluessel = 'leitung' and mandant_id is null),
               (select id from berechtigung where schluessel = $1), $2, true)
       on conflict (rolle_id, berechtigung_id, mandant_id)
         do update set gewaehrt = true`,
      [r, f.reinigung]);
  }

  /* Der Mensch mit einer Beschäftigung in der Reinigung — `f.jonas`. */
  personId = f.jonas;

  qBefristet = await qualifikation(`sachkunde-${zufall()}`,
    { laeuftAb: true, monate: 24, dokument: false });
  qUnbefristet = await qualifikation(`unbefristet-${zufall()}`,
    { laeuftAb: false, monate: null, dokument: false });
  qMitDokument = await qualifikation(`mit-urkunde-${zufall()}`,
    { laeuftAb: false, monate: null, dokument: true });

  const schluessel = `mandant/${f.reinigung}/nachweis/${zufall()}.pdf`;
  const [d] = await sql.unsafe<{ id: string }[]>(
    `insert into dokument (mandant_id, kategorie, titel, objekt_schluessel, mime_typ,
                           mime_verifiziert, groesse_bytes, entstanden_am, exif_entfernt)
     values ($1,'mitarbeiter','Sachkundeurkunde',$2,'application/pdf',true,2048,
             current_date,true)
     returning id`, [f.reinigung, schluessel]);
  dokumentId = d!.id;
});
afterAll(schliessen);

function imKontext<T>(fn: (k: {
  abfrage<R>(sql: string, werte?: readonly unknown[]): Promise<readonly R[]>;
}) => Promise<T>): Promise<T> {
  return alsApp(
    {
      scope: 'mandant' as const, mandantId: f.reinigung, benutzerId: personal,
      portal: 'intern' as const, readonly: false,
    },
    async (tx: postgres.TransactionSql) => fn({
      abfrage: async <R,>(anweisung: string, werte?: readonly unknown[]) =>
        (await tx.unsafe(anweisung, (werte ?? []) as never[])) as unknown as readonly R[],
    }),
  ) as Promise<T>;
}

async function zeile(id: string): Promise<{
  bis: string | null; von: string | null; status: string;
  geprueft: string | null; widerruf: string | null; mandant: string;
}> {
  const [z] = await sql.unsafe<{
    bis: string | null; von: string | null; status: string;
    geprueft: string | null; widerruf: string | null; mandant: string;
  }[]>(
    `select gueltig_bis::text as bis, geprueft_von::text as von, status::text as status,
            geprueft_am::text as geprueft, widerruf_grund as widerruf,
            erfasst_von_mandant_id::text as mandant
       from nachweis where id = $1`, [id]);
  return z!;
}

describe('§1 die Frist kommt aus der Qualifikation, nicht aus dem Formular', () => {
  it('ohne Enddatum rechnet die Standardgültigkeit — in Kalendermonaten', async () => {
    const id = await imKontext((k) => nimmNachweisAuf(k, {
      personId, qualifikationId: qBefristet, gueltigAb: '2026-02-29'.replace('29', '28'),
    }));
    /* 2026-02-28 + 24 Monate = 2028-02-28. */
    expect((await zeile(id)).bis).toBe('2028-02-28');
  });

  it('ein genanntes Enddatum gewinnt', async () => {
    const id = await imKontext((k) => nimmNachweisAuf(k, {
      personId, qualifikationId: qBefristet, gueltigAb: '2026-03-01',
      gueltigBis: '2026-12-31',
    }));
    expect((await zeile(id)).bis).toBe('2026-12-31');
  });

  /**
   * **Leer heisst hier unbefristet und nicht vergessen.** Eine Qualifikation
   * ohne Ablauf bekommt kein gerechnetes Datum — ein erfundenes Ende machte
   * aus einer dauerhaften Befähigung eine, die eines Tages lautlos sperrt.
   */
  it('was nicht abläuft, bekommt kein Enddatum', async () => {
    const id = await imKontext((k) => nimmNachweisAuf(k, {
      personId, qualifikationId: qUnbefristet, gueltigAb: '2026-03-02',
    }));
    expect((await zeile(id)).bis).toBeNull();
  });

  it('`brauchtFrist` entscheidet ohne Datenbank', () => {
    expect(brauchtFrist({ laeuft_ab: true, standard_gueltigkeit_monate: 24 }, null)).toBe(true);
    expect(brauchtFrist({ laeuft_ab: true, standard_gueltigkeit_monate: 24 }, '')).toBe(true);
    /* Ein genanntes Datum gewinnt immer. */
    expect(brauchtFrist({ laeuft_ab: true, standard_gueltigkeit_monate: 24 }, '2030-01-01'))
      .toBe(false);
    /* Ohne Ablauf oder ohne Standardwert wird nichts gerechnet. */
    expect(brauchtFrist({ laeuft_ab: false, standard_gueltigkeit_monate: 24 }, null)).toBe(false);
    expect(brauchtFrist({ laeuft_ab: true, standard_gueltigkeit_monate: null }, null)).toBe(false);
  });

  it('die erfassende Gesellschaft steht auf der Zeile', async () => {
    const id = await imKontext((k) => nimmNachweisAuf(k, {
      personId, qualifikationId: qUnbefristet, gueltigAb: '2026-03-03',
    }));
    expect((await zeile(id)).mandant).toBe(f.reinigung);
  });
});

describe('§2 was die Datenbank abweist, sagt ein Satz', () => {
  it('ohne Urkunde bleibt eine Qualifikation mit Dokumentpflicht aus (DOC-01)', async () => {
    await expect(imKontext((k) => nimmNachweisAuf(k, {
      personId, qualifikationId: qMitDokument, gueltigAb: '2026-04-01',
    }))).rejects.toThrow(/DOC-01/u);
  });

  it('mit Urkunde geht sie durch', async () => {
    const id = await imKontext((k) => nimmNachweisAuf(k, {
      personId, qualifikationId: qMitDokument, gueltigAb: '2026-04-02',
      dokumentId,
    }));
    expect((await zeile(id)).status).toBe('gueltig');
  });

  it('derselbe Mensch, dieselbe Qualifikation, derselbe Beginn — nur einmal', async () => {
    const eingabe = {
      personId, qualifikationId: qUnbefristet, gueltigAb: '2026-05-05',
    };
    await imKontext((k) => nimmNachweisAuf(k, eingabe));
    await expect(imKontext((k) => nimmNachweisAuf(k, eingabe)))
      .rejects.toBeInstanceOf(NachweisFehler);
  });

  it('ein Ende vor dem Beginn wird abgewiesen', async () => {
    await expect(imKontext((k) => nimmNachweisAuf(k, {
      personId, qualifikationId: qUnbefristet, gueltigAb: '2026-06-01',
      gueltigBis: '2026-05-01',
    }))).rejects.toBeInstanceOf(NachweisFehler);
  });
});

describe('§3 die Bestätigung kommt aus der Sitzung', () => {
  it('`geprueft_von` setzt die Datenbank, nicht das Formular', async () => {
    const id = await imKontext((k) => nimmNachweisAuf(k, {
      personId, qualifikationId: qUnbefristet, gueltigAb: '2026-07-01',
    }));
    await imKontext((k) => bestaetigeNachweis(k, id));
    const z = await zeile(id);
    expect(z.von).toBe(personal);
    expect(z.geprueft).not.toBeNull();
  });

  it('zweimal bestätigen ergibt keine zweite Bestätigung', async () => {
    const id = await imKontext((k) => nimmNachweisAuf(k, {
      personId, qualifikationId: qUnbefristet, gueltigAb: '2026-07-02',
    }));
    await imKontext((k) => bestaetigeNachweis(k, id));
    await expect(imKontext((k) => bestaetigeNachweis(k, id)))
      .rejects.toBeInstanceOf(NachweisFehler);
  });
});

describe('§4 der Widerruf — mit Grund, nie durch Löschen', () => {
  it('der Grund steht auf der Zeile, der Status wechselt', async () => {
    const id = await imKontext((k) => nimmNachweisAuf(k, {
      personId, qualifikationId: qUnbefristet, gueltigAb: '2026-08-01',
    }));
    await imKontext((k) => widerrufeNachweis(k, id, 'Urkunde gefälscht'));
    const z = await zeile(id);
    expect(z.status).toBe('widerrufen');
    expect(z.widerruf).toBe('Urkunde gefälscht');
  });

  it('ohne Grund geschieht nichts', async () => {
    const id = await imKontext((k) => nimmNachweisAuf(k, {
      personId, qualifikationId: qUnbefristet, gueltigAb: '2026-08-02',
    }));
    await expect(imKontext((k) => widerrufeNachweis(k, id, 'x')))
      .rejects.toThrow(/Grund/u);
    expect((await zeile(id)).status).not.toBe('widerrufen');
  });

  it('zweimal widerrufen ergibt keinen zweiten Widerruf', async () => {
    const id = await imKontext((k) => nimmNachweisAuf(k, {
      personId, qualifikationId: qUnbefristet, gueltigAb: '2026-08-03',
    }));
    await imKontext((k) => widerrufeNachweis(k, id, 'Erster Grund'));
    await expect(imKontext((k) => widerrufeNachweis(k, id, 'Zweiter Grund')))
      .rejects.toBeInstanceOf(NachweisFehler);
  });

  /**
   * **Ein widerrufener Nachweis lässt sich nicht mehr bestätigen.** Die
   * Reihenfolge ist keine Kosmetik: eine Bestätigung nach dem Widerruf
   * behauptete, jemand habe eine Urkunde gesehen, die als ungültig gilt.
   */
  it('ein widerrufener Nachweis wird nicht mehr bestätigt', async () => {
    const id = await imKontext((k) => nimmNachweisAuf(k, {
      personId, qualifikationId: qUnbefristet, gueltigAb: '2026-08-04',
    }));
    await imKontext((k) => widerrufeNachweis(k, id, 'Zurückgezogen'));
    await expect(imKontext((k) => bestaetigeNachweis(k, id)))
      .rejects.toBeInstanceOf(NachweisFehler);
  });
});
