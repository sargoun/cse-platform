/**
 * Der Planlauf (SOC-03) auf dem Weg, den er nachts wirklich nimmt.
 *
 * **Warum es diese Datei zusätzlich zu `social.test.ts` gibt.** Jene prüft
 * `veroeffentliche` als `cse_app`, aus einer Portalsitzung heraus — und der
 * Dienst war damit grün. Nachts läuft er nicht so: ohne Benutzer, ohne
 * Portalsitzung, unter `cse_job`. Auf diesem Weg war er nie gelaufen.
 *
 * **Was ohne diese Datei passiert wäre**, ist dieselbe teuerste Sorte
 * Ausfall wie beim Kettenprüfer: keine Fehlermeldung, sondern ein LEERER
 * Lauf. Der Job suchte die fälligen Beiträge über die rohe Verbindung; in CI
 * und im Seed steht dort `postgres`, ein Superuser mit `BYPASSRLS`, also fand
 * er sie. In einer Auslieferung mit der Anwendungsrolle hätte derselbe Lauf
 * null Zeilen gefunden und brav `faellig: 0` gemeldet — jede Nacht, ohne ein
 * einziges rotes Zeichen.
 *
 * Deshalb steht hier überall `veroeffentlicht` in der Zusicherung und nicht
 * nur „kein Fehler". Ein blinder Lauf wirft auch nicht.
 *
 * **Falsifizierbar:** der vorletzte Fall nimmt dem Lauf den Mandanten weg und
 * zeigt, dass der Riegel aus 0163 dann schliesst. Die Bindung je Beitrag
 * trägt also, statt danebenzustehen.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { schliessen, seed, sql, type Fixtur } from './harness.js';
import { alsJobRolle, alsJobSitzung } from '../../src/server/jobs/sitzung.js';
import { registriereSocialPlan } from '../../src/server/jobs/socialPlan.js';
import { leereRegister, type JobDefinition } from '../../src/server/jobs/registry.js';
import { veroeffentliche, type SchreibZugriff } from '../../src/server/services/social/dienst.js';

let f: Fixtur;
let job: JobDefinition;
const zufall = (): string => Math.random().toString(36).slice(2, 10);

/** Siehe `social.test.ts`: der Riegel aus 0163 braucht einen aktiven Mandanten. */
async function imMandanten<T>(
  mandantId: string, fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx.unsafe(`select set_config('app.scope', 'mandant', true),
                            set_config('app.mandant_id', $1, true)`, [mandantId]);
    return fn(tx);
  }) as Promise<T>;
}

async function mensch(mandantId: string): Promise<string> {
  const [vorhanden] = await sql.unsafe<{ id: string }[]>(
    `select benutzer_id as id from benutzer_mandant
      where mandant_id = $1::uuid and entzogen_am is null limit 1`, [mandantId]);
  if (vorhanden !== undefined) return vorhanden.id;
  const email = `socjob-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1, $2, 'Leitung', 'aktiv')`,
    [u!.id, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1, $2, (select id from rolle where schluessel = 'leitung' and mandant_id is null),
             true)`,
    [u!.id, mandantId]);
  return u!.id;
}

/**
 * Ein Beitrag, der JETZT fällig ist — mit genehmigter Freigabe, weil ohne sie
 * der Riegel aus 0163 den Status `geplant` gar nicht erst zulässt.
 */
async function legeFaelligAn(mandantId: string, minutenHer: number): Promise<string> {
  const titel = `Planlauf ${zufall()}`;
  const wer = await mensch(mandantId);
  const [fr] = await sql.unsafe<{ id: string }[]>(
    `insert into freigabe (mandant_id, aktion, status, vorgang_typ, titel,
                           zusammenfassung, risiko, vorschau_payload, payload_hash,
                           freigegeben_von, freigegeben_am, bezug_typ)
     values ($1::uuid, 'social_veroeffentlichen', 'genehmigt'::freigabe_status,
             'beitrag_veroeffentlichen', $2, 'Probe', 'mittel'::risiko_stufe,
             '{}'::jsonb, encode(sha256(convert_to($2::text, 'UTF8')), 'hex'),
             $3::uuid, now(), 'beitrag')
     returning id`, [mandantId, titel, wer]);
  const [b] = await imMandanten(mandantId, (tx) => tx.unsafe<{ id: string }[]>(
    `insert into beitrag (mandant_id, titel, text, status, freigabe_id, geplant_fuer)
     values ($1::uuid, $2, 'Text', 'geplant'::beitrag_status, $3::uuid,
             now() - ($4 || ' minutes')::interval)
     returning id`, [mandantId, titel, fr!.id, String(minutenHer)]));
  /*
   * Die Fixtur baut EIGENE Gesellschaften; der Demo-Seed legt seine zwanzig
   * Kanäle woanders an. Ohne diesen Kanal liefe der Fall „nicht verbunden"
   * über null Kanäle — und wäre grün, ohne etwas zu zeigen.
   */
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into social_kanal (mandant_id, plattform, anzeigename, verbunden)
     values ($1::uuid, 'instagram'::social_plattform, 'Instagram (Probe)', false)
     on conflict (mandant_id, plattform) do update set anzeigename = excluded.anzeigename
     returning id`, [mandantId]);
  await sql.unsafe(
    `insert into beitrag_kanal (mandant_id, beitrag_id, kanal_id)
     values ($1::uuid, $2::uuid, $3::uuid)`, [mandantId, b!.id, k!.id]);
  return b!.id;
}

async function status(beitragId: string): Promise<string> {
  const [z] = await sql.unsafe<{ status: string }[]>(
    `select status::text as status from beitrag where id = $1::uuid`, [beitragId]);
  return z!.status;
}

beforeEach(async () => {
  f = await seed();
  await sql.unsafe(`update beitrag set status = 'entwurf'::beitrag_status,
                           geplant_fuer = null
                     where status = 'geplant'`);
  leereRegister();
  job = registriereSocialPlan(sql);
}, 180_000);

afterAll(async () => {
  leereRegister();
  await schliessen();
});

describe('Der Planlauf läuft als JOB — nicht als Portalsitzung', () => {
  it('findet unter `cse_job` fällige Beiträge ÜBER Gesellschaftsgrenzen hinweg', async () => {
    const a = await legeFaelligAn(f.reinigung, 10);
    const b = await legeFaelligAn(f.security, 5);

    const kennzahlen = await job.ausfuehren({ mandantId: null, laufId: 'test-lauf', versuch: 1 });

    /*
     * `faellig` ist die Zusicherung, nicht „kein Fehler": ein blinder Lauf
     * meldet ebenfalls fehlerfrei — nur eben über nichts.
     */
    expect(kennzahlen['faellig']).toBe(2);
    expect(kennzahlen['veroeffentlicht']).toBe(2);
    expect(await status(a)).toBe('veroeffentlicht');
    expect(await status(b)).toBe('veroeffentlicht');
  });

  it('und tut das wirklich unter `cse_job`, nicht unter der Verbindungsrolle', async () => {
    const rolle = await alsJobRolle(sql, async (db) =>
      (await db.abfrage<{ rolle: string }>('select current_user as rolle'))[0]?.rolle);
    expect(rolle).toBe('cse_job');
  });

  it('ein nicht verbundener Kanal bricht ihn NICHT ab — er wird gezählt (SOC-07)', async () => {
    /*
     * Der Seed legt zwanzig Kanäle an, alle `verbunden = false` (O-10). Genau
     * das ist der Zustand, in dem diese Plattform ausgeliefert wird: der
     * Beitrag steht danach auf der eigenen Seite, und am Kanal steht, dass
     * dort nichts ankam.
     */
    await legeFaelligAn(f.reinigung, 1);
    const kennzahlen = await job.ausfuehren({ mandantId: null, laufId: 'test-lauf-2', versuch: 1 });
    expect(kennzahlen['veroeffentlicht']).toBe(1);
    expect(kennzahlen['kanaele_nicht_verbunden']).toBe(1);
    expect(kennzahlen['kanaele_fehlgeschlagen']).toBe(0);
  });

  it('was noch nicht fällig ist, bleibt liegen', async () => {
    const spaeter = await legeFaelligAn(f.bau, -120);
    const kennzahlen = await job.ausfuehren({ mandantId: null, laufId: 'test-lauf-3', versuch: 1 });
    expect(kennzahlen['faellig']).toBe(0);
    expect(await status(spaeter)).toBe('geplant');
  });

  it('OHNE gebundenen Mandanten schliesst der Riegel — die Bindung trägt', async () => {
    /*
     * Genau der Zustand, in dem der Lauf vor dieser Runde gearbeitet hätte:
     * richtige Rolle, keine Mandantensitzung. `app.freigabe_genehmigt` ist ein
     * Definer, dessen Policy auf `freigabe` `mandant_id = app.aktiver_mandant()`
     * verlangt — ohne ihn sieht er null Zeilen, und der Riegel schliesst.
     *
     * **Richtig herum, aber zur falschen Zeit:** der Beitrag HAT eine
     * genehmigte Freigabe. Was fehlt, ist der Blick darauf. Diese Prüfung hält
     * fest, dass das unterscheidbar ist — und dass `alsJobSitzung` je Beitrag
     * kein Schmuck ist.
     */
    const id = await legeFaelligAn(f.reinigung, 3);
    await expect(alsJobRolle(sql, async (db) => {
      const zugriff: SchreibZugriff = {
        abfrage: db.abfrage.bind(db), schreibe: db.abfrage.bind(db), benutzerId: null,
      };
      return veroeffentliche(zugriff, id, null);
    })).rejects.toThrow(/GENEHMIGTEN Freigabe/u);
    expect(await status(id)).toBe('geplant');
  });

  it('mit Bindung geht derselbe Beitrag hinaus — ohne Benutzer dahinter', async () => {
    const id = await legeFaelligAn(f.reinigung, 3);
    const ergebnis = await alsJobSitzung(sql, f.reinigung, async (db) => {
      const zugriff: SchreibZugriff = {
        abfrage: db.abfrage.bind(db), schreibe: db.abfrage.bind(db), benutzerId: null,
      };
      return veroeffentliche(zugriff, id, null);
    }, { nurLesen: false });
    expect(ergebnis.kanaele).toHaveLength(1);
    expect(await status(id)).toBe('veroeffentlicht');
  });

  it('JEDE Anweisung des Laufs läuft unter `cse_job` — auch das Finden', async () => {
    /*
     * **Warum das eine eigene Prüfung braucht.** Die Fälle oben liefen alle
     * grün, als der Lauf noch über die rohe Verbindung suchte — weil in CI und
     * im Seed `postgres` in `DATABASE_URL` steht, ein Superuser mit
     * `BYPASSRLS`. Sie prüfen also, DASS er findet, und nicht, unter welcher
     * Rolle. Genau diese Lücke hat die Altlast aus D-378 so lange getragen.
     *
     * Der Horcher liest die Rolle am Ende jeder Transaktion des Laufs — dort
     * gilt `set local role` noch. Ein Lauf, der irgendetwas an der Rolle vorbei
     * täte, hinterliesse hier `postgres`.
     */
    await legeFaelligAn(f.reinigung, 2);
    const rollen: string[] = [];
    leereRegister();
    const horcher = registriereSocialPlan({
      begin: async <T,>(rueckruf: (tx: {
        unsafe(a: string, w?: readonly unknown[]): Promise<readonly unknown[]>;
      }) => Promise<T>): Promise<T> => sql.begin(async (tx) => {
        const ergebnis = await rueckruf(tx);
        const [u] = await tx.unsafe(`select current_user as u`) as unknown as
          readonly { u: string }[];
        rollen.push(u!.u);
        return ergebnis;
      }) as Promise<T>,
    });

    const kennzahlen = await horcher.ausfuehren({ mandantId: null, laufId: 'test-lauf-4', versuch: 1 });
    expect(kennzahlen['veroeffentlicht']).toBe(1);
    // Eine Transaktion zum Finden, eine je Beitrag zum Hinausgeben.
    expect(rollen).toEqual(['cse_job', 'cse_job']);
  });

  it('und der Job ist übergreifend deklariert — er hat keine Mandantenschleife', () => {
    expect(job.bereich).toBe('uebergreifend');
    expect(job.zeitplan).toBe('*/5 * * * *');
  });
});
