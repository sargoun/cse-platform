/**
 * PR 18 Akzeptanz (1) und (3) — an echten Zeilen, als `cse_app`.
 *
 * **(1) ist die eigentliche Zusage: keine toten Zahlen.** Jede Kachel wird
 * gegen eine DIREKTE Zählung geprüft und danach gegen die Liste, auf die sie
 * verlinkt. Zwei Abfragen mit einem Prädikat — wenn Kachel und Liste
 * auseinanderlaufen, zeigt die eine 14 und die andere 11, und niemand kann
 * sagen, welche lügt.
 *
 * **(3) ist die Mandantentrennung.** Der Bereichsfilter ist ein Argument, also
 * ändert er jede Zahl gleichzeitig — und er darf NIE eine fremde Zeile
 * durchlassen.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { alsApp, DB_URL, sql } from './harness.js';
import { leereKacheln, type Kachel } from '../../src/server/registry/kennzahlen.js';
import { registriereBerichtKacheln } from '../../src/server/services/bericht/kacheln.js';
import { kachelWert, kachelZeilen, dashboard } from '../../src/server/services/bericht/dashboard.js';
import { withDevAdmin, DevFlaecheAusFehler } from '../../src/server/kontext/dev.js';

const WURZEL = resolve(import.meta.dirname, '../..');
const ids = new Map<string, string>();
let alle: readonly Kachel[] = [];
/** Der Super-Admin. Ohne gebundenen Benutzer antwortet `app.hat_recht` false. */
let adminId = '';

beforeAll(async () => {
  execFileSync('bash', [join(WURZEL, 'scripts/test-db.sh'), 'up'],
    { cwd: WURZEL, encoding: 'utf8' });
  execFileSync(join(WURZEL, 'node_modules/.bin/tsx'),
    [join(WURZEL, 'src/server/db/seed/index.ts')],
    { cwd: WURZEL, encoding: 'utf8', env: { ...process.env, DATABASE_URL: DB_URL } });

  for (const m of await sql<{ id: string; slug: string }[]>`select id, slug from mandant`) {
    ids.set(m.slug, m.id);
  }
  const [admin] = await sql<{ id: string }[]>`
    select id from benutzer where email = 'admin@cse-gruppe.de'`;
  adminId = admin!.id;

  // Zwei Leads je Bereich, damit "leakt nicht" überhaupt etwas zu leaken hat.
  for (const slug of ['reinigung', 'security']) {
    const mandantId = ids.get(slug)!;
    for (const n of [1, 2]) {
      await sql`
        insert into lead (mandant_id, leadnummer, quelle, firma_name, betreff,
                          besitzer_benutzer_id, status)
        values (${mandantId}, ${`L-${slug}-${String(n)}`}, 'manuell',
                ${`Firma ${slug} ${String(n)}`}, ${`Betreff ${String(n)}`},
                ${adminId}, 'neu')`;
    }
  }

  leereKacheln();
  alle = registriereBerichtKacheln();
}, 240_000);

/** Der Kontext eines Bereichs, gelesen als `cse_app` mit vollen Rechten. */
function alsBereich<T>(slug: string, fn: (db: {
  abfrage<R>(sql: string, werte?: readonly unknown[]): Promise<readonly R[]>;
}) => Promise<T>): Promise<T> {
  const mandantId = ids.get(slug)!;
  return alsApp(
    // MIT Benutzer: `t_lead_lesen` verlangt `crm.lesen`, und ohne gebundenen
    // Benutzer antwortet `app.hat_recht` false — die Kachel zeigte dann 0,
    // und der Test bestünde aus dem falschen Grund.
    { scope: 'mandant', mandantId, benutzerId: adminId, portal: 'intern', readonly: false },
    async (tx) => fn({
      abfrage: async <R,>(s: string, w: readonly unknown[] = []) =>
        (await tx.unsafe(s, w as never[])) as readonly R[],
    }),
  );
}

describe('(1) DSH-04: jede Kachel zeigt die Zahl, die hinter ihrem Link steht', () => {
  it('es gibt überhaupt Kacheln zu prüfen', () => {
    // Ohne diese Zusage bestünde alles Folgende auf einer leeren Liste.
    expect(alle.length).toBe(7);
  });

  it.each([['reinigung'], ['security'], ['bau'], ['operations']])(
    'Bereich %s: Zahl und verlinkte Liste stimmen überein', async (slug) => {
      const mandantId = ids.get(slug!)!;
      const kontext = { mandantId, mandantIds: [mandantId] };

      await alsBereich(slug!, async (db) => {
        for (const kachel of alle) {
          const wert = await kachelWert(db, kachel, kontext);
          const zeilen = await kachelZeilen(db, kachel, kontext);
          // DAS ist die Zusage: keine toten Zahlen. Läuft es auseinander,
          // zeigt die Kachel 14 und die Liste 11 — und niemand kann sagen,
          // welche der beiden lügt.
          expect(zeilen.length, `${slug!} → ${kachel.schluessel}`).toBe(wert);
        }
      });
    },
  );

  it('die Zahl stimmt mit einer DIREKTEN Zählung überein', async () => {
    const mandantId = ids.get('reinigung')!;
    const kontext = { mandantId, mandantIds: [mandantId] };
    const neue = alle.find((k) => k.schluessel === 'neue_leads')!;

    const [direkt] = await sql<{ n: number }[]>`
      select count(*)::int as n from lead
       where mandant_id = ${mandantId} and status = 'neu' and archiviert_am is null`;

    const ueberKachel = await alsBereich('reinigung',
      (db) => kachelWert(db, neue, kontext));
    expect(ueberKachel).toBe(direkt!.n);
    expect(ueberKachel).toBeGreaterThan(0);
  });
});

describe('(3) der Bereichsfilter ändert jede Zahl und leakt nie', () => {
  it('reinigung sieht seine zwei Leads, nicht die von security', async () => {
    const mandantId = ids.get('reinigung')!;
    const kontext = { mandantId, mandantIds: [mandantId] };
    const neue = alle.find((k) => k.schluessel === 'neue_leads')!;

    const zeilen = await alsBereich('reinigung',
      (db) => kachelZeilen(db, neue, kontext));
    const firmen = zeilen.map((z) => String(z['firma_name']));
    expect(firmen.length).toBe(2);
    // Keine einzige fremde Zeile — nicht "gefiltert", sondern nicht vorhanden.
    expect(firmen.every((f) => f.includes('reinigung'))).toBe(true);
  });

  it('ein fremder Mandant im Filter bringt trotzdem NICHTS durch (RLS)', async () => {
    /**
     * Der Filter ist ein Argument, und ein Argument kann jemand verstellen.
     * Deshalb ist er die ZWEITE Linie: RLS ist die erste. Hier wird der
     * `security`-Mandant in den Filter einer `reinigung`-Sitzung gelegt — und
     * es kommt nichts zurück.
     */
    const fremd = ids.get('security')!;
    const kontext = { mandantId: fremd, mandantIds: [fremd] };
    const neue = alle.find((k) => k.schluessel === 'neue_leads')!;

    const zeilen = await alsBereich('reinigung',
      (db) => kachelZeilen(db, neue, kontext));
    expect(zeilen).toEqual([]);
  });

  it('jeder Bereich hat sein eigenes Linkziel', async () => {
    const ziele = new Set(
      ['reinigung', 'security'].map((slug) => {
        const mandantId = ids.get(slug)!;
        return alle[0]!.ziel({ mandantId, mandantIds: [mandantId] });
      }),
    );
    // Zwei Bereiche, zwei Ziele — sonst führt die Kachel des einen in den
    // anderen.
    expect(ziele.size).toBe(2);
  });

  it('die Gruppenansicht zählt über mehrere Bereiche zusammen', async () => {
    const beide = [ids.get('reinigung')!, ids.get('security')!];
    const neue = alle.find((k) => k.schluessel === 'neue_leads')!;

    const zusammen = await alsApp(
      { scope: 'gruppe', mandantIds: beide, benutzerId: adminId, portal: 'intern' },
      async (tx) => kachelWert(
        {
          abfrage: async <R,>(s: string, w: readonly unknown[] = []) =>
            (await tx.unsafe(s, w as never[])) as readonly R[],
        },
        neue,
        { mandantId: null, mandantIds: beide },
      ),
    );
    // Zwei je Bereich, vier zusammen — die Gruppenansicht addiert, sie
    // verdoppelt nicht und sie unterschlägt nicht.
    expect(zusammen).toBe(4);
  });
});

/**
 * Der Kontext, den die Seiten unter `/dev` wirklich benutzen.
 *
 * Er wurde zunaechst NICHT geprueft — die uebrigen Tests binden ihre Sitzung
 * selbst und kamen daran vorbei. Er war kaputt: er wechselte auf `cse_app`,
 * BEVOR er den Super-Admin nachschlug, und als `cse_app` ohne gebundene
 * Sitzung sieht man `benutzer` nicht. Jede Dashboard-Seite waere mit
 * "Kein Super-Admin gefunden" gestorben.
 *
 * Ein Test, den nur der Browser findet, findet ihn eine Viertelstunde spaeter
 * und in einem Bericht, den niemand liest. Deshalb steht er jetzt hier.
 */
describe('withDevAdmin — der Kontext der Entwicklungsflaechen', () => {
  /**
   * Den Schalter setzen und danach zuverlaessig zuruecksetzen.
   *
   * `NODE_ENV` gehoert dazu: `devFlaechenAn()` ist ausserhalb eines
   * Produktionsbaus ohnehin an. Nur `CSE_DEV_FLAECHEN` zu loeschen prueft
   * deshalb NICHTS — der erste Anlauf dieses Tests bestand genau deshalb
   * nicht, und das war die richtige Antwort: die Zusage lautet "in einem
   * Deployment aus", und ein Deployment ist `NODE_ENV=production`.
   */
  async function mitSchalter<T>(an: boolean, fn: () => Promise<T>): Promise<T> {
    const flagge = process.env['CSE_DEV_FLAECHEN'];
    const modus = process.env['NODE_ENV'];
    if (an) process.env['CSE_DEV_FLAECHEN'] = '1';
    else {
      delete process.env['CSE_DEV_FLAECHEN'];
      process.env['NODE_ENV'] = 'production';
    }
    try { return await fn(); } finally {
      if (flagge === undefined) delete process.env['CSE_DEV_FLAECHEN'];
      else process.env['CSE_DEV_FLAECHEN'] = flagge;
      if (modus === undefined) delete process.env['NODE_ENV'];
      else process.env['NODE_ENV'] = modus;
    }
  }

  it('bindet den Super-Admin und liefert die Kacheln — nicht KeinAdminFehler', async () => {
    const mandantId = ids.get('reinigung')!;
    const werte = await mitSchalter(true, () => sql.begin((tx) =>
      withDevAdmin(tx, mandantId, (kontext) =>
        dashboard(kontext, { mandantId, mandantIds: kontext.mandantIds }, () => true))));

    expect(werte.length).toBe(alle.length);
    // Und die Zahlen sind echt: die zwei Leads dieses Bereichs stehen drin.
    const neue = werte.find((w) => w.kachel.schluessel === 'neue_leads');
    expect(neue?.wert).toBe(2);
  });

  it('im Deployment wirft er, statt einen Admin ohne Anmeldung zu binden',
    async () => {
      await expect(mitSchalter(false, () => sql.begin((tx) =>
        withDevAdmin(tx, null, async () => 'nie'))))
        .rejects.toBeInstanceOf(DevFlaecheAusFehler);
    });

  it('er laeuft readonly — auch mit Super-Admin ist kein Schreiben moeglich', async () => {
    const [zustand] = await mitSchalter(true, () => sql.begin((tx) =>
      withDevAdmin(tx, null, (kontext) =>
        kontext.abfrage<{ readonly_an: boolean; rolle: string }>(
          `select app.ist_readonly() as readonly_an, current_user as rolle`))));

    expect(zustand?.readonly_an).toBe(true);
    // Und nicht als Eigentuemer: eine Kachel, die als `postgres` zaehlt, zaehlt
    // an RLS vorbei und beweist ueber die Trennung nichts.
    expect(zustand?.rolle).toBe('cse_app');
  });

  it('die Gruppenansicht sieht alle Bereiche, der Bereich genau einen', async () => {
    const gruppe = await mitSchalter(true, () => sql.begin((tx) =>
      withDevAdmin(tx, null, (k) => Promise.resolve(k.mandantIds.length))));
    const einer = await mitSchalter(true, () => sql.begin((tx) =>
      withDevAdmin(tx, ids.get('security')!, (k) => Promise.resolve(k.mandantIds.length))));

    expect(gruppe).toBeGreaterThan(1);
    expect(einer).toBe(1);
  });
});
