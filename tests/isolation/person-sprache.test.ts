/**
 * Die eigene Portalsprache (EMP-12) — und die Spalte, die daneben liegt.
 *
 * **Der Befund.** `src/lib/i18n/texte.ts` übersetzt das Arbeiterportal
 * vollständig in vier Sprachen. Die Sprache kommt aus `person.sprache`, und
 * sie liess sich **nirgends ändern**: keine Seite, keine Route, kein Recht.
 * EMP-12 war gebaut und für niemanden erreichbar.
 *
 * **Und der Grund, aus dem das Recht spaltengenau sein MUSS.** `person` trägt
 * `telefon`, und diese Nummer IST der Anmeldeweg einer Mitarbeiterin
 * (`app.zugang_code_anfordern`, EMP-01). Ein tabellenweites `grant update`
 * liesse jede angemeldete Person ihre eigene Nummer ändern — und damit den
 * Einmalcode auf ein beliebiges Telefon umleiten. Aus „ich stelle meine
 * Sprache auf Arabisch" würde eine Kontoübernahme, in derselben Zeile.
 *
 * Der letzte Fall fährt genau das: dieselbe Sitzung, dieselbe Zeile, eine
 * andere Spalte — und die Datenbank weist ab.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur, type Sitzung } from './harness.js';
import { setzeEigeneSprache } from '../../src/server/konto/sprache.js';

let f: Fixtur;
const zufall = (): string => Math.random().toString(36).slice(2, 10);

/** Eine Mitarbeitersitzung: Personen-Scope, kein aktiver Mandant (0115). */
async function alsMensch(personId: string): Promise<Sitzung> {
  const email = `sprache-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, person_id)
     values ($1,$2,$2,'aktiv',$3)`, [u!.id, email, personId]);
  /* Kein `mandantId`: eine Mitarbeitersitzung hat per Konstruktion keinen
     aktiven Mandanten (0115). Ein Feld mit `undefined` und ein fehlendes Feld
     sind unter `exactOptionalPropertyTypes` zweierlei — also fehlt es. */
  return {
    scope: 'person', mandantIds: [],
    benutzerId: u!.id, personId, readonly: false, portal: 'mitarbeiter',
  };
}

function zugriff(tx: Parameters<Parameters<typeof alsApp>[1]>[0], personId: string | null) {
  return {
    schreibe: async <R,>(q: string, w: readonly unknown[] = []) =>
      (await tx.unsafe(q, w as never[])) as readonly R[],
    personId,
  };
}

async function spracheVon(personId: string): Promise<string> {
  const [z] = await sql.unsafe<{ sprache: string }[]>(
    `select sprache::text as sprache from person where id = $1::uuid`, [personId]);
  return z!.sprache;
}

beforeEach(async () => { f = await seed(); });
afterAll(async () => { await schliessen(); });

describe('Die eigene Sprache lässt sich setzen (EMP-12)', () => {
  it('von Deutsch auf Arabisch — und die Zeile trägt es danach', async () => {
    const sitzung = await alsMensch(f.fatima);
    expect(await spracheVon(f.fatima), 'Ausgangsstand').toBe('de');

    const gesetzt = await alsApp(sitzung, async (tx) =>
      setzeEigeneSprache(zugriff(tx, f.fatima), 'ar'));

    expect(gesetzt).toBe('ar');
    expect(await spracheVon(f.fatima)).toBe('ar');
  });

  it('alle vier gehen — eine Liste, die eine Sprache auslässt, ist keine', async () => {
    const sitzung = await alsMensch(f.fatima);
    for (const s of ['de', 'en', 'ar', 'tr']) {
      await alsApp(sitzung, async (tx) => setzeEigeneSprache(zugriff(tx, f.fatima), s));
      expect(await spracheVon(f.fatima), s).toBe(s);
    }
  });

  it('eine fünfte Sprache nicht — und zwar vor der Datenbank', async () => {
    const sitzung = await alsMensch(f.fatima);
    await expect(alsApp(sitzung, async (tx) =>
      setzeEigeneSprache(zugriff(tx, f.fatima), 'fr'))).rejects.toThrow(/Portalsprachen/u);
    expect(await spracheVon(f.fatima), 'unverändert').toBe('de');
  });

  it('die Sprache eines ANDEREN Menschen nicht — die Policy greift auf die eigene Zeile',
    async () => {
      /*
       * Fatima ist angemeldet, Jonas nicht. Der Dienst löst die Zeile über
       * `app.aktuelle_person()` auf — eine Kennung aus der Anfrage gibt es
       * gar nicht. Selbst wenn jemand sie unterschöbe, träfe das `update`
       * die Zeile nicht: `using (id = app.aktuelle_person())`.
       */
      const sitzung = await alsMensch(f.fatima);
      await alsApp(sitzung, async (tx) => setzeEigeneSprache(zugriff(tx, f.fatima), 'tr'));
      expect(await spracheVon(f.jonas), 'Jonas bleibt, wo er war').toBe('de');
    });

  it('aus einer LESENDEN Sitzung heraus geht nichts (`not app.ist_readonly()`)', async () => {
    /*
     * Jede Portalseite rendert mit `app.readonly = 'on'`. Ohne diese
     * Bedingung wäre die Sprache das einzige Feld der Plattform, das sich aus
     * einer lesenden Sitzung ändern liesse.
     */
    const sitzung = await alsMensch(f.fatima);
    await expect(alsApp({ ...sitzung, readonly: true }, async (tx) =>
      setzeEigeneSprache(zugriff(tx, f.fatima), 'ar'))).rejects.toThrow();
    expect(await spracheVon(f.fatima)).toBe('de');
  });

  it('DAS Spaltenrecht: dieselbe Zeile, aber `telefon` — abgewiesen (EMP-01)', async () => {
    /*
     * Der Fall, für den die Spaltenliste da ist. `person.telefon` ist der
     * Anmeldeweg: wer sie ändern kann, leitet den Einmalcode auf ein
     * beliebiges Telefon um. Ein tabellenweites `grant update` machte aus der
     * Sprachwahl eine Kontoübernahme.
     */
    const sitzung = await alsMensch(f.fatima);
    await expect(alsApp(sitzung, async (tx) =>
      tx.unsafe(`update person set telefon = '+49 170 0000000' where id = $1::uuid`,
        [f.fatima] as never[]),
    )).rejects.toThrow(/permission denied|Berechtigung/iu);
  });

  it('und auch der Name nicht — Stammdaten pflegt die Personalverwaltung', async () => {
    const sitzung = await alsMensch(f.fatima);
    await expect(alsApp(sitzung, async (tx) =>
      tx.unsafe(`update person set vorname = 'Anders' where id = $1::uuid`,
        [f.fatima] as never[]),
    )).rejects.toThrow(/permission denied|Berechtigung/iu);
  });
});
