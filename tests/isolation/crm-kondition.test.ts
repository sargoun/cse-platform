/**
 * Die Zahlungskonditionen eines Kunden — der SCHREIBWEG, gegen echte
 * Spaltenentzüge und echte Rechte (CRM-01, FIN-15, K-05).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund, den diese Datei festschreibt: Schreiben OHNE Lesen.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `kunde.debitorennummer`, `.zahlungsziel_tage`, `.mahnsperre_bis` und
 * `.mahnsperre_grund` sind `cse_app` spaltenweise entzogen (0020) — gelesen
 * werden sie nur über `app.zahlungskondition_lesen`, und die verlangt
 * `crm_entgelt.lesen`. Der Schreibweg prüfte aber allein `crm.schreiben` und
 * setzte alle vier Spalten bedingungslos. Damit konnte genau die Sitzung, der
 * die Werte strukturell verborgen sind, sie auf NULL setzen und bekam „Die
 * Konditionen sind gespeichert." zurück.
 *
 * Das ist keine Randrolle: `crm.schreiben` ist für `leitung` GEBUNDEN,
 * `crm_entgelt.lesen` nur BINDBAR. Eine Leitung ohne Zusatzerteilung sieht auf
 * der Seite ein 404 und erreicht den Endpunkt trotzdem von jeder anderen
 * Portalseite aus. Die Folge wäre still, teuer und spät entdeckt:
 * Debitorennummer weg (DATEV-Export), Zahlungsziel weg (die Faktura schreibt
 * kein `faellig_am`), Mahnsperre samt Grund weg (der Mahnlauf mahnt einen
 * Kunden mit vereinbarter Stundung, samt § 288 BGB).
 *
 * **Was diese Datei beweist:**
 *
 *  1. Ohne `crm_entgelt.lesen` wird der Schreibvorgang mit benanntem Grund
 *     abgewiesen — und die vorhandenen Werte stehen danach unverändert da.
 *  2. Ohne `crm.schreiben` ebenso, mit dem anderen Grund.
 *  3. Ein TEILformular löscht die übrigen Angaben NICHT.
 *  4. Ein ausdrücklich leeres Feld löscht sehr wohl.
 *  5. Eine ABGELAUFENE Mahnsperre lässt sich unverändert mitschicken; nur ein
 *     GEÄNDERTES Datum in der Vergangenheit wird abgewiesen.
 *  6. Das Paar `mahnsperre_bis` / `mahnsperre_grund` wird gegen den Stand
 *     NACH dem Speichern geprüft, nicht gegen die Eingabe.
 *  7. Der Schreibweg nennt keine der vier Spalten in `RETURNING` oder
 *     `WHERE` — sonst schlüge K-05 mit `42501` zu.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import { CrmFehler } from '../../src/server/services/crm/anlegen.js';
import {
  leseKondition, setzeKondition,
} from '../../src/server/services/crm/kondition.js';

let f: Fixtur;
let chef = '';

const zufall = (): string => Math.random().toString(36).slice(2, 10);

async function konto(): Promise<string> {
  const email = `kond-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`,
    [u!.id, email]);
  return u!.id;
}

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

/** Entzieht einer Rolle ein Recht in genau einem Bereich. */
async function entziehe(rolle: string, recht: string, mandant: string): Promise<void> {
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     select $1, b.id, $2, false from berechtigung b where b.schluessel = $3`,
    [await rolleId(rolle), mandant, recht]);
}

async function mitgliedschaft(
  benutzerId: string, mandantId: string, rolle = 'admin',
): Promise<void> {
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1, $2, $3, false)`, [benutzerId, mandantId, await rolleId(rolle)]);
}

/**
 * Ein Kunde MIT gepflegten Konditionen — als Eigentümer geschrieben, weil
 * `cse_app` die vier Spalten zwar setzen, aber nicht zurücklesen darf.
 */
async function kunde(mandantId: string, felder: Partial<{
  debitor: string; ziel: number; sperreTage: number; sperreGrund: string;
}> = {}): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, rechtsgrundlage,
                        rechtsgrundlage_quelle, rechtsgrundlage_erfasst_am,
                        debitorennummer, zahlungsziel_tage,
                        mahnsperre_bis, mahnsperre_grund)
     values ($1, $2, 'Konditionen Testfall', 'bestandskunde', 'Rahmenvertrag', now(),
             $3, $4::smallint,
             case when $5::integer is null then null
                  else app.berlin_heute() + $5::integer end,
             $6)
     returning id`,
    [mandantId, `K-${zufall()}`, felder.debitor ?? null, felder.ziel ?? null,
      felder.sperreTage ?? null, felder.sperreGrund ?? null]);
  return z!.id;
}

/** Was WIRKLICH in den vier Spalten steht — als Eigentümer, an K-05 vorbei. */
async function stand(kundeId: string): Promise<{
  debitor: string | null; ziel: number | null;
  bis: string | null; grund: string | null;
}> {
  const [z] = await sql.unsafe<{
    debitor: string | null; ziel: number | null;
    bis: string | null; grund: string | null;
  }[]>(
    `select debitorennummer as debitor, zahlungsziel_tage as ziel,
            mahnsperre_bis::text as bis, mahnsperre_grund as grund
       from kunde where id = $1`, [kundeId]);
  return z!;
}

type Abfrager = { unsafe(s: string, w?: readonly unknown[]): Promise<readonly unknown[]> };

function kontextAus(tx: Abfrager, mandantId: string) {
  return {
    scope: 'mandant',
    portal: 'intern',
    aktiverMandantId: mandantId,
    benutzerId: chef,
    mandantIds: [mandantId],
    abfrage: async <T,>(s: string, w: readonly unknown[] = []) =>
      (await tx.unsafe(s, w)) as readonly T[],
    schreibe: async <T,>(s: string, w: readonly unknown[] = []) =>
      (await tx.unsafe(s, w)) as readonly T[],
  } as never;
}

async function alsIntern<T>(
  mandantId: string, fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return alsApp(
    { scope: 'mandant', mandantId, benutzerId: chef, portal: 'intern', readonly: false },
    async (tx) => {
      await tx.unsafe(`select set_config('app.aal','aal2',true)`);
      return fn(tx);
    },
  );
}

beforeEach(async () => {
  f = await seed();
  chef = await konto();
  await mitgliedschaft(chef, f.reinigung);
});

afterAll(async () => { await schliessen(); });

describe('K-05 · die vier Spalten sind `cse_app` entzogen', () => {
  it('ein `select debitorennummer` scheitert mit 42501', async () => {
    await kunde(f.reinigung);
    await expect(alsIntern(f.reinigung, async (tx) =>
      tx.unsafe(`select debitorennummer from kunde limit 1`)))
      .rejects.toThrow(/permission denied/iu);
  });

  it('ein `where zahlungsziel_tage is null` scheitert ebenso', async () => {
    await kunde(f.reinigung);
    await expect(alsIntern(f.reinigung, async (tx) =>
      tx.unsafe(`select id from kunde where zahlungsziel_tage is null`)))
      .rejects.toThrow(/permission denied/iu);
  });

  it('der Schreibweg selbst nennt sie NICHT — er läuft durch', async () => {
    const k = await kunde(f.reinigung);
    await alsIntern(f.reinigung, async (tx) =>
      setzeKondition(kontextAus(tx, f.reinigung), {
        kundeId: k, debitorennummer: '70002', zahlungszielTage: '45',
      }));
    const s = await stand(k);
    expect(s.debitor).toBe('70002');
    expect(s.ziel).toBe(45);
  });
});

describe('Schreiben ohne Lesen · der blockierende Befund', () => {
  it('ohne `crm_entgelt.lesen` wird abgewiesen — mit benanntem Grund', async () => {
    await entziehe('admin', 'crm_entgelt.lesen', f.reinigung);
    const k = await kunde(f.reinigung,
      { debitor: '10001', ziel: 30, sperreTage: 30, sperreGrund: 'Stundung' });

    await expect(alsIntern(f.reinigung, async (tx) =>
      setzeKondition(kontextAus(tx, f.reinigung), {
        kundeId: k, debitorennummer: '', zahlungszielTage: '',
        mahnsperreBis: '', mahnsperreGrund: '',
      }))).rejects.toThrow(CrmFehler);
  });

  it('und die vorhandenen Werte stehen danach UNVERÄNDERT da', async () => {
    await entziehe('admin', 'crm_entgelt.lesen', f.reinigung);
    const k = await kunde(f.reinigung,
      { debitor: '10001', ziel: 30, sperreTage: 30, sperreGrund: 'Stundung' });

    await alsIntern(f.reinigung, async (tx) =>
      setzeKondition(kontextAus(tx, f.reinigung), {
        kundeId: k, debitorennummer: '', zahlungszielTage: '',
        mahnsperreBis: '', mahnsperreGrund: '',
      })).catch(() => undefined);

    const s = await stand(k);
    expect(s.debitor).toBe('10001');
    expect(s.ziel).toBe(30);
    expect(s.grund).toBe('Stundung');
  });

  it('der Grund nennt das fehlende Recht beim Namen', async () => {
    await entziehe('admin', 'crm_entgelt.lesen', f.reinigung);
    const k = await kunde(f.reinigung);
    await expect(alsIntern(f.reinigung, async (tx) =>
      setzeKondition(kontextAus(tx, f.reinigung), {
        kundeId: k, debitorennummer: '70003',
      }))).rejects.toThrow(/crm_entgelt\.lesen/u);
  });

  it('ohne `crm.schreiben` wird mit dem ANDEREN Grund abgewiesen', async () => {
    await entziehe('admin', 'crm.schreiben', f.reinigung);
    const k = await kunde(f.reinigung);
    await expect(alsIntern(f.reinigung, async (tx) =>
      setzeKondition(kontextAus(tx, f.reinigung), {
        kundeId: k, debitorennummer: '70004',
      }))).rejects.toThrow(/crm\.schreiben/u);
  });
});

describe('ein Teilformular löscht nicht, was es nicht nennt', () => {
  it('nur die Debitorennummer ändern lässt Ziel und Sperre stehen', async () => {
    const k = await kunde(f.reinigung,
      { debitor: '10001', ziel: 30, sperreTage: 30, sperreGrund: 'Stundung' });

    await alsIntern(f.reinigung, async (tx) =>
      setzeKondition(kontextAus(tx, f.reinigung), {
        kundeId: k, debitorennummer: '70005',
      }));

    const s = await stand(k);
    expect(s.debitor).toBe('70005');
    expect(s.ziel).toBe(30);
    expect(s.grund).toBe('Stundung');
    expect(s.bis).not.toBeNull();
  });

  it('ein ausdrücklich LEERES Feld löscht sehr wohl', async () => {
    const k = await kunde(f.reinigung, { debitor: '10001', ziel: 30 });
    await alsIntern(f.reinigung, async (tx) =>
      setzeKondition(kontextAus(tx, f.reinigung), {
        kundeId: k, zahlungszielTage: '',
      }));
    const s = await stand(k);
    expect(s.ziel).toBeNull();
    expect(s.debitor).toBe('10001');
  });

  it('gar keine Angabe wird abgewiesen statt stillschweigend zu leeren', async () => {
    const k = await kunde(f.reinigung, { debitor: '10001', ziel: 30 });
    await expect(alsIntern(f.reinigung, async (tx) =>
      setzeKondition(kontextAus(tx, f.reinigung), { kundeId: k })))
      .rejects.toThrow(CrmFehler);
    const s = await stand(k);
    expect(s.debitor).toBe('10001');
  });
});

describe('eine abgelaufene Mahnsperre blockiert nicht das ganze Formular', () => {
  it('sie darf unverändert mitgeschickt werden', async () => {
    const k = await kunde(f.reinigung,
      { debitor: '10001', sperreTage: -10, sperreGrund: 'Stundung bis Quartalsende' });
    const alt = await stand(k);

    await alsIntern(f.reinigung, async (tx) =>
      setzeKondition(kontextAus(tx, f.reinigung), {
        kundeId: k, debitorennummer: '70006',
        mahnsperreBis: alt.bis ?? '', mahnsperreGrund: alt.grund ?? '',
      }));

    const s = await stand(k);
    expect(s.debitor).toBe('70006');
    expect(s.bis).toBe(alt.bis);
    expect(s.grund).toBe('Stundung bis Quartalsende');
  });

  it('ein NEUES Datum in der Vergangenheit wird weiterhin abgewiesen', async () => {
    const k = await kunde(f.reinigung);
    const [g] = await sql.unsafe<{ tag: string }[]>(
      `select (app.berlin_heute() - 5)::text as tag`);
    await expect(alsIntern(f.reinigung, async (tx) =>
      setzeKondition(kontextAus(tx, f.reinigung), {
        kundeId: k, mahnsperreBis: g!.tag, mahnsperreGrund: 'zu spät',
      }))).rejects.toThrow(/abgelaufen/u);
  });
});

describe('die Mahnsperre ist ein Paar — geprüft wird der Stand NACHHER', () => {
  it('nur den Grund ändern geht, solange ein Datum steht', async () => {
    const k = await kunde(f.reinigung, { sperreTage: 30, sperreGrund: 'alter Grund' });
    await alsIntern(f.reinigung, async (tx) =>
      setzeKondition(kontextAus(tx, f.reinigung), {
        kundeId: k, mahnsperreGrund: 'Reklamation offen',
      }));
    expect((await stand(k)).grund).toBe('Reklamation offen');
  });

  it('nur das Datum leeren, ohne den Grund, wird abgewiesen', async () => {
    const k = await kunde(f.reinigung, { sperreTage: 30, sperreGrund: 'Stundung' });
    await expect(alsIntern(f.reinigung, async (tx) =>
      setzeKondition(kontextAus(tx, f.reinigung), {
        kundeId: k, mahnsperreBis: '',
      }))).rejects.toThrow(CrmFehler);
    expect((await stand(k)).grund).toBe('Stundung');
  });

  it('beide leeren hebt die Sperre auf', async () => {
    const k = await kunde(f.reinigung, { sperreTage: 30, sperreGrund: 'Stundung' });
    await alsIntern(f.reinigung, async (tx) =>
      setzeKondition(kontextAus(tx, f.reinigung), {
        kundeId: k, mahnsperreBis: '', mahnsperreGrund: '',
      }));
    const s = await stand(k);
    expect(s.bis).toBeNull();
    expect(s.grund).toBeNull();
  });

  it('einen Grund ohne Datum nachreichen wird abgewiesen', async () => {
    const k = await kunde(f.reinigung);
    await expect(alsIntern(f.reinigung, async (tx) =>
      setzeKondition(kontextAus(tx, f.reinigung), {
        kundeId: k, mahnsperreGrund: 'ohne Datum',
      }))).rejects.toThrow(CrmFehler);
  });
});

describe('der Leser bleibt der Leser', () => {
  it('`leseKondition` gibt zurück, was der Schreibweg gesetzt hat', async () => {
    const k = await kunde(f.reinigung);
    await alsIntern(f.reinigung, async (tx) =>
      setzeKondition(kontextAus(tx, f.reinigung), {
        kundeId: k, debitorennummer: '70007', zahlungszielTage: '14',
      }));
    const gelesen = await alsIntern(f.reinigung, async (tx) =>
      leseKondition(kontextAus(tx, f.reinigung), k));
    expect(gelesen?.debitorennummer).toBe('70007');
    expect(gelesen?.zahlungszielTage).toBe(14);
  });

  it('ein fremder Bereich findet den Kunden nicht (Invariante 3)', async () => {
    const k = await kunde(f.bau);
    await expect(alsIntern(f.reinigung, async (tx) =>
      setzeKondition(kontextAus(tx, f.reinigung), {
        kundeId: k, debitorennummer: '70008',
      }))).rejects.toThrow(CrmFehler);
  });
});
