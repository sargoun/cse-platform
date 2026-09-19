/**
 * `arbeitszeitmodell` und `tarifvereinbarung` gegen die echte Datenbank
 * (EMP-04, TIM-06, TIM-14, LEG-03, O-18, O-50, 0201).
 *
 * Vier Dinge, die nur hier zu pruefen sind:
 *
 *  - **Die gesetzlichen ArbZG-Grenzen sind keine Einstellung.**
 *    `tv_mindestens_gesetz` laesst keinen Wert unter § 4 / § 5 ArbZG in die
 *    Tabelle. Das muss die DATENBANK halten und nicht nur die Oberflaeche:
 *    ein schwaecherer Wert wuerde still wirken — `pruefeArbzg` faende dann
 *    keinen Verstoss mehr, wo einer ist.
 *  - **Zwei gleichzeitig gueltige Fassungen gibt es nicht.** Jede
 *    Sollzeitrechnung muesste sonst raten, welche gilt, und sie wuerde je
 *    Abfrage anders raten.
 *  - **Lesen braucht ZWEI Rechte** (`stammdaten.verwalten` ODER
 *    `zeit.konto_lesen`): das Stundenkonto braucht das Modell und laeuft
 *    nicht unter dem Recht der Einstellungsseite. Nur das erste zu nehmen
 *    hiesse „Sollzeit nicht hinterlegt" fuer ein hinterlegtes Modell.
 *  - **Kein DELETE.** Eine geloeschte Fassung bewertet jeden abgerechneten
 *    Monat neu, in dem sie galt.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';

let f: Fixtur;
const zufall = (): string => String(Math.random()).slice(2, 10);

/** Ein fester Tag — „heute" waere ein Test, der im Winter anders faellt. */
const AB = '2026-10-01';
const SPAETER = '2026-11-01';

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function konto(
  mandant: string, rolle: string, module: readonly string[] | null = null,
): Promise<string> {
  const email = `arbeitszeit-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`,
    [u!.id, email] as never[]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, module)
     values ($1,$2,$3,$4::text[])`,
    [u!.id, mandant, await rolleId(rolle),
      module === null ? null : `{${module.join(',')}}`] as never[]);
  return u!.id;
}

async function modell(mandant: string, schluessel: string, ab: string): Promise<string> {
  const [m] = await sql.unsafe<{ id: string }[]>(
    `insert into arbeitszeitmodell
       (mandant_id, schluessel, bezeichnung, wochenstunden, arbeitstage_woche, gueltig_ab)
     values ($1, $2, $3, 39.000, 5.000, $4::date) returning id`,
    [mandant, schluessel, `Probe ${schluessel}`, ab] as never[]);
  return m!.id;
}

async function tarif(mandant: string, o: {
  gewerk?: string; pause6?: number | null; pause9?: number | null;
  ruhezeit?: number | null; ab?: string;
} = {}): Promise<string> {
  const [t] = await sql.unsafe<{ id: string }[]>(
    `insert into tarifvereinbarung
       (mandant_id, gewerk, bezeichnung, pause_ab_6h_minuten, pause_ab_9h_minuten,
        ruhezeit_minuten, gilt_ab)
     values ($1, $2, 'Probe-Tarif', $3::int, $4::int, $5::int, $6::date) returning id`,
    [mandant, o.gewerk ?? 'reinigung', o.pause6 ?? null, o.pause9 ?? null,
      o.ruhezeit ?? null, o.ab ?? AB] as never[]);
  return t!.id;
}

beforeEach(async () => {
  f = await seed();
});

afterAll(async () => {
  await schliessen();
});

describe('Die ArbZG-Grenzen sind keine Einstellung', () => {
  it('30 / 45 / 660 gehen durch — gleich dem Gesetz', async () => {
    await expect(tarif(f.reinigung, { pause6: 30, pause9: 45, ruhezeit: 660 }))
      .resolves.toBeTruthy();
  });

  it('strenger geht durch', async () => {
    await expect(tarif(f.reinigung, { pause6: 45, pause9: 60, ruhezeit: 720 }))
      .resolves.toBeTruthy();
  });

  it('29 Minuten Pause ab 6 Stunden wird abgewiesen (§ 4 ArbZG)', async () => {
    await expect(tarif(f.reinigung, { pause6: 29 }))
      .rejects.toThrow(/tv_mindestens_gesetz/u);
  });

  it('44 Minuten Pause ab 9 Stunden wird abgewiesen (§ 4 ArbZG)', async () => {
    await expect(tarif(f.reinigung, { pause9: 44 }))
      .rejects.toThrow(/tv_mindestens_gesetz/u);
  });

  it('zehn Stunden Ruhezeit wird abgewiesen (§ 5 ArbZG verlangt elf)', async () => {
    await expect(tarif(f.reinigung, { ruhezeit: 600 }))
      .rejects.toThrow(/tv_mindestens_gesetz/u);
  });

  it('leere Felder gehen durch — „der Tarif sagt dazu nichts"', async () => {
    await expect(tarif(f.reinigung, {})).resolves.toBeTruthy();
  });

  it('eine 9-Stunden-Pause unter der 6-Stunden-Pause wird abgewiesen', async () => {
    await expect(tarif(f.reinigung, { pause6: 60, pause9: 45 }))
      .rejects.toThrow(/tv_pausen_geordnet/u);
  });
});

describe('Eine gueltige Fassung je Tag', () => {
  it('zwei Modelle mit demselben Schluessel und ueberlappendem Zeitraum: abgewiesen', async () => {
    await modell(f.reinigung, 'vollzeit', AB);
    await expect(modell(f.reinigung, 'vollzeit', SPAETER))
      .rejects.toThrow(/azm_kein_ueberlapp/u);
  });

  it('nach dem Schliessen der ersten geht die zweite', async () => {
    await modell(f.reinigung, 'vollzeit', AB);
    await sql.unsafe(
      `update arbeitszeitmodell set gueltig_bis = ($1::date - 1)
        where mandant_id = $2 and schluessel = 'vollzeit'`,
      [SPAETER, f.reinigung] as never[]);
    await expect(modell(f.reinigung, 'vollzeit', SPAETER)).resolves.toBeTruthy();
  });

  it('ein anderer Schluessel darf gleichzeitig gelten', async () => {
    await modell(f.reinigung, 'vollzeit', AB);
    await expect(modell(f.reinigung, 'teilzeit', AB)).resolves.toBeTruthy();
  });

  it('derselbe Schluessel in einer ANDEREN Gesellschaft ist kein Konflikt', async () => {
    await modell(f.reinigung, 'vollzeit', AB);
    await expect(modell(f.bau, 'vollzeit', AB)).resolves.toBeTruthy();
  });

  it('zwei Tarife je Gewerk mit ueberlappendem Zeitraum: abgewiesen', async () => {
    await tarif(f.reinigung, { ab: AB });
    await expect(tarif(f.reinigung, { ab: SPAETER }))
      .rejects.toThrow(/tv_kein_ueberlapp/u);
  });

  it('ein anderes Gewerk darf gleichzeitig gelten', async () => {
    await tarif(f.reinigung, { gewerk: 'reinigung', ab: AB });
    await expect(tarif(f.reinigung, { gewerk: 'bau', ab: AB })).resolves.toBeTruthy();
  });
});

describe('Bestaetigung und Platzhalter schliessen sich aus', () => {
  it('bestaetigt und ist_platzhalter zugleich: abgewiesen', async () => {
    const id = await modell(f.reinigung, 'vollzeit', AB);
    await expect(sql.unsafe(
      `update arbeitszeitmodell set bestaetigt_am = now(), bestaetigt_von = $1
        where id = $2`,
      [await konto(f.reinigung, 'admin'), id] as never[],
    )).rejects.toThrow(/azm_bestaetigt_kein_platzhalter/u);
  });

  it('ein Datum ohne Namen belegt nichts', async () => {
    const id = await modell(f.reinigung, 'vollzeit', AB);
    await expect(sql.unsafe(
      `update arbeitszeitmodell set ist_platzhalter = false, bestaetigt_am = now()
        where id = $1`, [id] as never[],
    )).rejects.toThrow(/azm_bestaetigung_paarweise/u);
  });
});

describe('Die Rechte (0201)', () => {
  it('stammdaten.verwalten liest und schreibt', async () => {
    const benutzer = await konto(f.reinigung, 'admin', ['stammdaten']);
    const befund = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: benutzer,
        portal: 'intern', readonly: false },
      async (tx) => {
        const angelegt = await tx.unsafe(
          `insert into arbeitszeitmodell
             (mandant_id, schluessel, bezeichnung, gueltig_ab)
           values (app.aktiver_mandant(), 'vollzeit', 'Vollzeit', $1::date)
           returning id`, [AB] as never[]) as unknown[];
        const gelesen = await tx.unsafe(
          `select schluessel from arbeitszeitmodell`) as unknown[];
        return { angelegt, gelesen };
      },
    );
    expect(befund.angelegt).toHaveLength(1);
    expect(befund.gelesen).toHaveLength(1);
  });

  it('zeit.konto_lesen LIEST — das Stundenkonto braucht das Modell', async () => {
    await modell(f.reinigung, 'vollzeit', AB);
    /*
     * Ohne diese zweite Zulassung sagte das Stundenkonto „Sollzeit nicht
     * hinterlegt" fuer ein hinterlegtes Modell: Tor offen, Datenbank leer —
     * der stille Fehler, den Invariante 3 meint.
     */
    const benutzer = await konto(f.reinigung, 'leitung', ['zeit']);
    const befund = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: benutzer,
        portal: 'intern', readonly: false },
      async (tx) => {
        const [r] = await tx.unsafe(
          `select app.hat_recht('stammdaten.verwalten') as stamm,
                  app.hat_recht('zeit.konto_lesen') as konto`) as
          { stamm: boolean; konto: boolean }[];
        const zeilen = await tx.unsafe(
          `select schluessel from arbeitszeitmodell`) as unknown[];
        return { recht: r!, zeilen };
      },
    );
    expect(befund.recht.stamm).toBe(false);
    expect(befund.recht.konto).toBe(true);
    expect(befund.zeilen).toHaveLength(1);
  });

  it('ohne beide Rechte: nichts', async () => {
    await modell(f.reinigung, 'vollzeit', AB);
    const benutzer = await konto(f.reinigung, 'leitung', ['objekt']);
    const zeilen = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: benutzer,
        portal: 'intern', readonly: false },
      (tx) => tx.unsafe(`select schluessel from arbeitszeitmodell`),
    ) as unknown[];
    expect(zeilen).toHaveLength(0);
  });

  it('das Modell eines fremden Bereichs bleibt unsichtbar (Invariante 3)', async () => {
    await modell(f.bau, 'vollzeit', AB);
    const benutzer = await konto(f.reinigung, 'admin', ['stammdaten']);
    const zeilen = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: benutzer,
        portal: 'intern', readonly: false },
      (tx) => tx.unsafe(`select schluessel from arbeitszeitmodell`),
    ) as unknown[];
    expect(zeilen).toHaveLength(0);
  });

  it('das Kundenportal sieht die Arbeitszeitkonfiguration nicht (K-04)', async () => {
    await modell(f.reinigung, 'vollzeit', AB);
    const benutzer = await konto(f.reinigung, 'admin', ['stammdaten']);
    const zeilen = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: benutzer,
        portal: 'kunde', readonly: false },
      (tx) => tx.unsafe(`select schluessel from arbeitszeitmodell`),
    ) as unknown[];
    expect(zeilen).toHaveLength(0);
  });

  it('in der Gruppenansicht wird nichts angelegt (Invariante 10)', async () => {
    const benutzer = await konto(f.reinigung, 'admin', ['stammdaten']);
    await expect(alsApp(
      { scope: 'gruppe', mandantIds: [f.reinigung, f.bau], benutzerId: benutzer,
        readonly: true },
      (tx) => tx.unsafe(
        `insert into arbeitszeitmodell (mandant_id, schluessel, bezeichnung, gueltig_ab)
         values ($1, 'x', 'X', $2::date)`, [f.reinigung, AB] as never[]),
    )).rejects.toThrow();
  });

  it('cse_app aendert nur gueltig_bis und die Bestaetigung — nicht die Stunden', async () => {
    await modell(f.reinigung, 'vollzeit', AB);
    const benutzer = await konto(f.reinigung, 'admin', ['stammdaten']);
    await expect(alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: benutzer,
        portal: 'intern', readonly: false },
      (tx) => tx.unsafe(
        `update arbeitszeitmodell set wochenstunden = 20.000
          where schluessel = 'vollzeit'`),
    )).rejects.toThrow();
  });
});

describe('Kein DELETE (Invariante 8)', () => {
  it('weder Modell noch Tarif', async () => {
    const id = await modell(f.reinigung, 'vollzeit', AB);
    await expect(sql.unsafe(
      `delete from arbeitszeitmodell where id = $1`, [id] as never[])).rejects.toThrow();
    const tid = await tarif(f.reinigung, {});
    await expect(sql.unsafe(
      `delete from tarifvereinbarung where id = $1`, [tid] as never[])).rejects.toThrow();
  });

  it('cse_app hat das Recht gar nicht', async () => {
    for (const tabelle of ['arbeitszeitmodell', 'tarifvereinbarung']) {
      const [g] = await sql.unsafe<{ n: string }[]>(
        `select count(*)::text as n from information_schema.table_privileges
          where table_name = $1 and grantee = 'cse_app'
            and privilege_type in ('DELETE', 'TRUNCATE')`, [tabelle]);
      expect(g?.n, tabelle).toBe('0');
    }
  });
});
