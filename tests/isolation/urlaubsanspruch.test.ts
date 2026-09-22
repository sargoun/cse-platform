import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, alsRolle, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import { mengeAusEingabe } from '../../src/server/services/finanz/menge.js';
import {
  eroeffneUrlaubskonto, leseUrlaubskonten, setzeAnspruch,
  UrlaubsjahrAbgeschlossenFehler,
} from '../../src/server/services/zeit/urlaubskonto.js';

/**
 * **Der Urlaubsanspruch liess sich nirgends eintragen** (V-117, V-118).
 *
 * `eroeffneUrlaubskonto` hatte ausser Tests keinen Aufrufer, `setzeAnspruch`
 * überhaupt keinen — gefunden von `tests/kern/dienst-verdrahtung.test.ts`,
 * der Sperrklinke gegen genau diese Bauart. Beide sind seit `0061` fertig.
 *
 * **Gemessen wird die Unterscheidung, um die es geht:** „nicht hinterlegt"
 * und „0 Tage" sind zwei verschiedene Aussagen. Die erste ist eine offene
 * Frage (O-18), die zweite eine Auskunft — und wer „Resturlaub: 0" liest,
 * plant sein Jahr danach.
 */

let f: Fixtur;
let personal = '';

async function konto(email: string, mandant: string, rolle: string): Promise<string> {
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
    [u!.id, mandant, rolle]);
  return u!.id;
}

beforeAll(async () => {
  f = await seed();
  personal = await konto('urlaub-personal@test.invalid', f.reinigung, 'leitung');
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
  benutzerId: string, fn: (k: SchreibKontext) => Promise<T>,
): Promise<T> {
  return alsApp(sitzung(benutzerId), async (tx) => {
    await tx.unsafe(`select set_config('app.aal','aal2',true)`);
    return fn(alsKontext(tx, benutzerId));
  }) as Promise<T>;
}

describe('§1 das Konto entsteht ohne erfundenen Anspruch', () => {
  it('ein frisches Konto trägt 0 Tage — und sagt, dass das „offen" heisst', async () => {
    const k = await imKontext(personal, (kk) => eroeffneUrlaubskonto(kk, {
      anstellungId: f.jonasReinigung, jahr: 2031,
    }));
    expect(k.anspruchTage).toBe(0n);
    /*
     * Die Marke, an der die ganze Anzeige hängt: `anspruchOffen` heisst
     * „nicht hinterlegt" und nicht „null Tage Urlaub" (O-18).
     */
    expect(k.anspruchOffen).toBe(true);
  });

  it('zweimal eröffnet ist einmal eröffnet', async () => {
    await imKontext(personal, (kk) => eroeffneUrlaubskonto(kk, {
      anstellungId: f.jonasReinigung, jahr: 2032,
    }));
    await imKontext(personal, (kk) => eroeffneUrlaubskonto(kk, {
      anstellungId: f.jonasReinigung, jahr: 2032,
    }));
    const [z] = await alsRolle('', (tx) => tx.unsafe(
      `select count(*)::int as anzahl from urlaubskonto
        where anstellung_id = $1 and jahr = 2032`, [f.jonasReinigung]),
    ) as unknown as { anzahl: number }[];
    expect(z!.anzahl).toBe(1);
  });
});

describe('§2 der Anspruch kommt von einem Menschen', () => {
  it('eingetragen heisst eingetragen — und der Rest rechnet sich', async () => {
    await imKontext(personal, (kk) => eroeffneUrlaubskonto(kk, {
      anstellungId: f.fatimaReinigung, jahr: 2033,
    }));
    const k = await imKontext(personal, (kk) => setzeAnspruch(kk, {
      anstellungId: f.fatimaReinigung, jahr: 2033,
      anspruchTage: mengeAusEingabe('25,5'),
      uebertragTage: mengeAusEingabe('3'),
      zusatzTage: mengeAusEingabe('5'),
    }));
    expect(k.anspruchTage).toBe(25_500n);
    expect(k.uebertragTage).toBe(3_000n);
    expect(k.zusatzTage).toBe(5_000n);
    expect(k.anspruchOffen).toBe(false);
    // Nichts genommen: der Rest ist die Summe der drei.
    expect(k.restTage).toBe(33_500n);
  });

  /**
   * **Halbe Tage bleiben halbe Tage.** Der Weg vom Formular in die Spalte
   * läuft über `mengeAusEingabe` und `numeric(12,3)` — keine Gleitkommazahl
   * dazwischen. Ein halber Tag, der als 0,4999 ankommt, ist der Streit, den
   * niemand gewinnt.
   */
  it('25,5 bleibt 25,5 — durch die Datenbank und zurück', async () => {
    await imKontext(personal, (kk) => eroeffneUrlaubskonto(kk, {
      anstellungId: f.fatimaReinigung, jahr: 2034,
    }));
    await imKontext(personal, (kk) => setzeAnspruch(kk, {
      anstellungId: f.fatimaReinigung, jahr: 2034,
      anspruchTage: mengeAusEingabe('25,5'),
    }));
    const gelesen = await imKontext(personal,
      (kk) => leseUrlaubskonten(kk, { anstellungId: f.fatimaReinigung, jahr: 2034 }));
    expect(gelesen[0]?.anspruchTage).toBe(25_500n);
  });

  it('`geaendert_von` benennt, wer es war', async () => {
    await imKontext(personal, (kk) => eroeffneUrlaubskonto(kk, {
      anstellungId: f.jonasReinigung, jahr: 2035,
    }));
    await imKontext(personal, (kk) => setzeAnspruch(kk, {
      anstellungId: f.jonasReinigung, jahr: 2035,
      anspruchTage: mengeAusEingabe('30'),
    }));
    const [z] = await alsRolle('', (tx) => tx.unsafe(
      `select geaendert_von from urlaubskonto
        where anstellung_id = $1 and jahr = 2035`, [f.jonasReinigung]),
    ) as unknown as { geaendert_von: string }[];
    expect(z!.geaendert_von).toBe(personal);
  });
});

describe('§3 ein abgeschlossenes Jahr bleibt abgeschlossen', () => {
  it('der Anspruch lässt sich danach nicht mehr ändern', async () => {
    await imKontext(personal, (kk) => eroeffneUrlaubskonto(kk, {
      anstellungId: f.jonasReinigung, jahr: 2036,
    }));
    await alsRolle('', (tx) => tx.unsafe(
      `update urlaubskonto set abgeschlossen_am = now()
        where anstellung_id = $1 and jahr = 2036`, [f.jonasReinigung]));

    await expect(imKontext(personal, (kk) => setzeAnspruch(kk, {
      anstellungId: f.jonasReinigung, jahr: 2036,
      anspruchTage: mengeAusEingabe('30'),
    }))).rejects.toThrow(UrlaubsjahrAbgeschlossenFehler);
  });
});
