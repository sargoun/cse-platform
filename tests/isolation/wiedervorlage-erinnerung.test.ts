/**
 * Die Erinnerung an eine Wiedervorlage kommt an — als `cse_job`, je Mandant
 * (V-146, CRM-04, NOT-01, D-640, 0405).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund, den diese Datei festschreibt.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `erinnerung_am` wurde geschrieben und beim Verschieben mitgeführt — und von
 * nichts gelesen. Wer eine Erinnerung eintrug, bekam keine.
 *
 * **Geprüft wird der ECHTE Weg:** `laufe()` bindet über `alsJobSitzung` die
 * Rolle `cse_job` und den Mandanten; die Grants und Policies aus 0405 sind
 * das, was hier grün oder rot macht — nicht eine Hilfsfunktion, die als
 * Eigentümer schreibt (V-119 war genau dieser Fehler eine Tabelle weiter).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, alsRolle, schliessen, seed, sql, type Fixtur } from './harness.js';
import { laufe } from '../../src/server/jobs/wiedervorlageErinnerung.js';
import { ART_WIEDERVORLAGE_ERINNERUNG } from '../../src/server/services/crm/benachrichtigung.js';
import { verschiebe } from '../../src/server/services/crm/wiedervorlage.js';

let f: Fixtur;
let chef = '';

const zufall = (): string => Math.random().toString(36).slice(2, 10);

async function konto(): Promise<string> {
  const email = `wve-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`,
    [u!.id, email]);
  return u!.id;
}

async function mitgliedschaft(benutzerId: string, mandantId: string): Promise<void> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = 'admin' and mandant_id is null`);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1, $2, $3, false)`, [benutzerId, mandantId, r!.id]);
}

async function kunde(mandantId: string): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, rechtsgrundlage,
                        rechtsgrundlage_quelle, rechtsgrundlage_erfasst_am)
     values ($1, $2, 'Erinnerung Testfall', 'bestandskunde', 'Rahmenvertrag', now())
     returning id`, [mandantId, `K-${zufall()}`]);
  return z!.id;
}

/**
 * Eine Wiedervorlage mit Erinnerung — als Eigentümer angelegt, weil hier der
 * LAUF geprüft wird und nicht das Formular (das prüft `crm-wiedervorlage`).
 * Versätze in Minuten gegen die Datenbankuhr, nie gegen den Node-Prozess.
 */
async function wiedervorlage(o: {
  mandantId: string; kundeId: string; zustaendig: string | null; ersteller: string | null;
  faelligInMin: number; erinnerungInMin: number | null; erledigt?: boolean;
}): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into lead_aktivitaet
       (mandant_id, kunde_id, typ, richtung, zweck, betreff, benutzer_id,
        zustaendig_benutzer_id, faellig_am, erinnerung_am, erledigt_am)
     values ($1, $2, 'aufgabe', 'intern', 'intern', $3, $4::uuid, $5::uuid,
             now() + make_interval(mins => $6::int),
             case when $7::int is null then null else now() + make_interval(mins => $7::int) end,
             case when $8::boolean then now() else null end)
     returning id`,
    [o.mandantId, o.kundeId, `Rückruf ${zufall()}`, o.ersteller, o.zustaendig,
      o.faelligInMin, o.erinnerungInMin, o.erledigt ?? false]);
  return z!.id;
}

async function erinnert(id: string): Promise<boolean> {
  const [z] = await sql.unsafe<{ ja: boolean }[]>(
    `select erinnert_am is not null as ja from lead_aktivitaet where id = $1`, [id]);
  return z!.ja;
}

async function meldungen(empfaenger: string): Promise<readonly {
  art: string; ziel: string; titel: string; text: string; objekt_id: string; sammelbar: boolean;
  mandant_id: string;
}[]> {
  return sql.unsafe(
    `select art, ziel, titel, text, objekt_id, sammelbar, mandant_id::text as mandant_id
       from benachrichtigung where empfaenger_id = $1 order by erstellt_am`, [empfaenger]);
}

beforeEach(async () => {
  f = await seed();
  chef = await konto();
  await mitgliedschaft(chef, f.reinigung);
});

afterAll(async () => { await schliessen(); });

describe('§1 die fällige Erinnerung wird zugestellt — einmal', () => {
  it('an den Zuständigen, mit Ziel auf die Liste, nie sammelbar', async () => {
    const k = await kunde(f.reinigung);
    const id = await wiedervorlage({
      mandantId: f.reinigung, kundeId: k, zustaendig: chef, ersteller: chef,
      faelligInMin: 60, erinnerungInMin: -5,
    });

    const bericht = await laufe(sql, f.reinigung);
    expect(bericht.zugestellt).toBe(1);
    expect(await erinnert(id)).toBe(true);

    const [m] = await meldungen(chef);
    expect(m?.art).toBe(ART_WIEDERVORLAGE_ERINNERUNG);
    expect(m?.ziel).toBe('/portal/reinigung/crm/wiedervorlagen');
    expect(m?.objekt_id).toBe(id);
    expect(m?.mandant_id).toBe(f.reinigung);
    expect(m?.sammelbar).toBe(false);
    expect(m?.titel).toContain('Rückruf');
    // Die Fälligkeit steht als Berliner Datum im Text (TT.MM.JJJJ HH:MI).
    expect(m?.text).toMatch(/Fällig am \d{2}\.\d{2}\.\d{4} \d{2}:\d{2}/u);
  });

  it('ein zweiter Lauf stellt NICHTS mehr zu', async () => {
    const k = await kunde(f.reinigung);
    await wiedervorlage({
      mandantId: f.reinigung, kundeId: k, zustaendig: chef, ersteller: chef,
      faelligInMin: 60, erinnerungInMin: -5,
    });
    expect((await laufe(sql, f.reinigung)).zugestellt).toBe(1);
    const zweiter = await laufe(sql, f.reinigung);
    expect(zweiter.faellig).toBe(0);
    expect(await meldungen(chef)).toHaveLength(1);
  });

  it('ohne Zuständigen bekommt sie, wer die Wiedervorlage angelegt hat', async () => {
    const k = await kunde(f.reinigung);
    await wiedervorlage({
      mandantId: f.reinigung, kundeId: k, zustaendig: null, ersteller: chef,
      faelligInMin: 60, erinnerungInMin: -1,
    });
    expect((await laufe(sql, f.reinigung)).zugestellt).toBe(1);
    expect(await meldungen(chef)).toHaveLength(1);
  });
});

describe('§2 was der Lauf NICHT nimmt', () => {
  it('eine künftige Erinnerung, eine erledigte Wiedervorlage, eine ohne Erinnerung', async () => {
    const k = await kunde(f.reinigung);
    const kuenftig = await wiedervorlage({
      mandantId: f.reinigung, kundeId: k, zustaendig: chef, ersteller: chef,
      faelligInMin: 600, erinnerungInMin: 120,
    });
    const erledigt = await wiedervorlage({
      mandantId: f.reinigung, kundeId: k, zustaendig: chef, ersteller: chef,
      faelligInMin: 60, erinnerungInMin: -5, erledigt: true,
    });
    const ohne = await wiedervorlage({
      mandantId: f.reinigung, kundeId: k, zustaendig: chef, ersteller: chef,
      faelligInMin: -60, erinnerungInMin: null,
    });

    const bericht = await laufe(sql, f.reinigung);
    expect(bericht.faellig).toBe(0);
    for (const id of [kuenftig, erledigt, ohne]) expect(await erinnert(id)).toBe(false);
    expect(await meldungen(chef)).toHaveLength(0);
  });

  it('die Wiedervorlage eines ANDEREN Mandanten — der Lauf ist je_mandant', async () => {
    const fremd = await konto();
    await mitgliedschaft(fremd, f.security);
    const k = await kunde(f.security);
    const id = await wiedervorlage({
      mandantId: f.security, kundeId: k, zustaendig: fremd, ersteller: fremd,
      faelligInMin: 60, erinnerungInMin: -5,
    });

    await laufe(sql, f.reinigung);
    expect(await erinnert(id)).toBe(false);
    expect(await meldungen(fremd)).toHaveLength(0);

    // Im eigenen Mandanten dagegen schon.
    expect((await laufe(sql, f.security)).zugestellt).toBe(1);
    expect(await erinnert(id)).toBe(true);
  });
});

describe('§3 ohne berechtigten Menschen wird nichts beansprucht, ohne Menschen schon', () => {
  /** Die Zeilenversion — sie ändert sich mit jedem `update`, auch mit einem, das zurücknimmt. */
  async function version(id: string): Promise<string> {
    const [z] = await sql.unsafe<{ v: string }[]>(
      `select xmin::text as v from lead_aktivitaet where id = $1`, [id]);
    return z!.v;
  }

  it('ein stillgelegtes Konto: nicht zugestellt, nicht beansprucht — und kein Hin und Her', async () => {
    const still = await konto();
    await mitgliedschaft(still, f.reinigung);
    await sql.unsafe(
      `update benutzer set status = 'deaktiviert', deaktiviert_am = now() where id = $1`,
      [still]);
    const k = await kunde(f.reinigung);
    const id = await wiedervorlage({
      mandantId: f.reinigung, kundeId: k, zustaendig: still, ersteller: still,
      faelligInMin: 60, erinnerungInMin: -5,
    });
    const vorher = await version(id);

    const bericht = await laufe(sql, f.reinigung);
    expect(bericht.zugestellt).toBe(0);
    expect(bericht.faellig).toBe(0);
    expect(bericht.wartend).toBe(1);
    expect(bericht.ohneKonto).toBe(0);
    expect(await erinnert(id)).toBe(false);
    /*
     * V-153: vorher nahm jeder Lauf den Anspruch und gab ihn zurück — zwei
     * Schreibvorgänge alle fünfzehn Minuten, ohne Ende. Jetzt bleibt die
     * Zeile unberührt, auch über zwei Läufe.
     */
    await laufe(sql, f.reinigung);
    expect(await version(id)).toBe(vorher);

    // Wird das Konto wieder aktiv, kommt die Erinnerung noch an (D-640). Eine
    // Rolle mit Faktorpflicht wird nur mit eingerichtetem Faktor aktiv (AUT-02).
    await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [still]);
    await sql.unsafe(
      `update benutzer set status = 'aktiv', deaktiviert_am = null where id = $1`, [still]);
    expect((await laufe(sql, f.reinigung)).zugestellt).toBe(1);
    expect(await erinnert(id)).toBe(true);
  });

  it('ein Zuständiger ohne Zugang zu diesem Bereich: die Erinnerung geht an den Anlegenden', async () => {
    // Ein aktives Konto — aber ohne Mitgliedschaft in der Reinigung, also ohne `crm.lesen` dort.
    const fremd = await konto();
    await mitgliedschaft(fremd, f.security);
    const k = await kunde(f.reinigung);
    const id = await wiedervorlage({
      mandantId: f.reinigung, kundeId: k, zustaendig: fremd, ersteller: chef,
      faelligInMin: 60, erinnerungInMin: -5,
    });

    const bericht = await laufe(sql, f.reinigung);
    expect(bericht.zugestellt).toBe(1);
    expect(await meldungen(fremd)).toHaveLength(0);
    const [m] = await meldungen(chef);
    expect(m?.objekt_id).toBe(id);
    // Der Text sagt, warum — und das Ziel zeigt alle, denn „nur meine" zeigte sie ihm nicht.
    expect(m?.text).toContain('Sie haben diese Wiedervorlage angelegt');
    expect(m?.text).toContain('keinen Zugang zum CRM');
    expect(m?.ziel).toBe('/portal/reinigung/crm/wiedervorlagen?wer=alle');
  });

  it('der Zuständige bekommt den Satz des Zuständigen — nicht „Sie haben gebeten"', async () => {
    const zustaendig = await konto();
    await mitgliedschaft(zustaendig, f.reinigung);
    const k = await kunde(f.reinigung);
    await wiedervorlage({
      mandantId: f.reinigung, kundeId: k, zustaendig, ersteller: chef,
      faelligInMin: 60, erinnerungInMin: -5,
    });
    expect((await laufe(sql, f.reinigung)).zugestellt).toBe(1);
    expect(await meldungen(chef)).toHaveLength(0);
    const [m] = await meldungen(zustaendig);
    expect(m?.text).toContain('Sie sind für diese Wiedervorlage als zuständig eingetragen.');
    expect(m?.text).not.toContain('gebeten');
    expect(m?.ziel).toBe('/portal/reinigung/crm/wiedervorlagen');
  });

  it('weder zuständig noch Ersteller: gezählt, und der Anspruch bleibt', async () => {
    const k = await kunde(f.reinigung);
    const id = await wiedervorlage({
      mandantId: f.reinigung, kundeId: k, zustaendig: null, ersteller: null,
      faelligInMin: 60, erinnerungInMin: -5,
    });
    const bericht = await laufe(sql, f.reinigung);
    expect(bericht.ohneEmpfaenger).toBe(1);
    expect(await erinnert(id)).toBe(true);
  });
});

describe('§4 Verschieben macht aus der Erinnerung eine neue', () => {
  it('nach dem Verschieben erinnert der Lauf erneut — an den neuen Termin', async () => {
    const k = await kunde(f.reinigung);
    const id = await wiedervorlage({
      mandantId: f.reinigung, kundeId: k, zustaendig: chef, ersteller: chef,
      faelligInMin: 30, erinnerungInMin: -5,
    });
    expect((await laufe(sql, f.reinigung)).zugestellt).toBe(1);

    /* Auf gestern verschoben: die mitgewanderte Erinnerung liegt damit
       ebenfalls in der Vergangenheit und ist sofort fällig. */
    const [gestern] = await sql.unsafe<{ t: string }[]>(
      `select to_char((now() - interval '1 day') at time zone 'Europe/Berlin',
                      'YYYY-MM-DD"T"HH24:MI') as t`);
    await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: chef, portal: 'intern',
        readonly: false },
      async (tx: postgres.TransactionSql) => {
        await tx.unsafe(`select set_config('app.aal','aal2',true)`);
        await verschiebe({
          scope: 'mandant', portal: 'intern', aktiverMandantId: f.reinigung,
          benutzerId: chef, mandantIds: [f.reinigung],
          abfrage: async <T,>(s: string, w: readonly unknown[] = []) =>
            (await tx.unsafe(s, w as never[])) as readonly T[],
          schreibe: async <T,>(s: string, w: readonly unknown[] = []) =>
            (await tx.unsafe(s, w as never[])) as readonly T[],
        } as never, id, gestern!.t, 'Kunde bat um früheren Rückruf');
      });
    expect(await erinnert(id)).toBe(false);

    expect((await laufe(sql, f.reinigung)).zugestellt).toBe(1);
    expect(await meldungen(chef)).toHaveLength(2);
  });
});

describe('§5 die Rolle des Laufs ist eng (0405)', () => {
  it('cse_job liest den Inhalt einer Wiedervorlage nicht', async () => {
    await expect(alsRolle('cse_job', async (tx) => {
      await tx.unsafe(`select set_config('app.scope', 'mandant', true)`);
      await tx.unsafe(`select set_config('app.mandant_id', $1, true)`, [f.reinigung]);
      await tx.unsafe(`select set_config('app.mandant_ids', $1, true)`, [f.reinigung]);
      return tx.unsafe(`select inhalt from lead_aktivitaet limit 1`);
    })).rejects.toThrow(/permission denied/u);
  });

  it('und schreibt ausser erinnert_am keine Spalte', async () => {
    const k = await kunde(f.reinigung);
    const id = await wiedervorlage({
      mandantId: f.reinigung, kundeId: k, zustaendig: chef, ersteller: chef,
      faelligInMin: 60, erinnerungInMin: -5,
    });
    await expect(alsRolle('cse_job', async (tx) => {
      await tx.unsafe(`select set_config('app.scope', 'mandant', true)`);
      await tx.unsafe(`select set_config('app.mandant_id', $1, true)`, [f.reinigung]);
      await tx.unsafe(`select set_config('app.mandant_ids', $1, true)`, [f.reinigung]);
      return tx.unsafe(`update lead_aktivitaet set erledigt_am = now() where id = $1`, [id]);
    })).rejects.toThrow(/permission denied/u);
  });
});

describe('§6 der Altbestand (0406): nachgeholt wird nur, was vor seiner Wiedervorlage liegt', () => {
  it('die Regel der Migration — überfällige Wiedervorlage gestempelt, künftige zugestellt', async () => {
    const k = await kunde(f.reinigung);
    // Beide Erinnerungen lagen vor dem Lauf; die eine Wiedervorlage ist vorbei, die andere nicht.
    const vorbei = await wiedervorlage({
      mandantId: f.reinigung, kundeId: k, zustaendig: chef, ersteller: chef,
      faelligInMin: -3 * 24 * 60, erinnerungInMin: -3 * 24 * 60 - 60,
    });
    const kommt = await wiedervorlage({
      mandantId: f.reinigung, kundeId: k, zustaendig: chef, ersteller: chef,
      faelligInMin: 2 * 24 * 60, erinnerungInMin: -24 * 60,
    });
    const erledigt = await wiedervorlage({
      mandantId: f.reinigung, kundeId: k, zustaendig: chef, ersteller: chef,
      faelligInMin: -60, erinnerungInMin: -120, erledigt: true,
    });

    // Die Anweisung AUS der Migration, nicht eine Abschrift.
    const datei = readFileSync(
      resolve(import.meta.dirname, '../../drizzle/0406_erinnerung_altbestand.sql'), 'utf8');
    const anweisung = /update lead_aktivitaet[\s\S]*?;/u.exec(datei)?.[0];
    expect(anweisung).toBeDefined();
    await sql.unsafe(anweisung!);

    expect(await erinnert(vorbei)).toBe(true);
    expect(await erinnert(kommt)).toBe(false);
    expect(await erinnert(erledigt)).toBe(false);

    // Der erste Lauf danach stellt genau die eine zu, deren Termin noch kommt.
    const bericht = await laufe(sql, f.reinigung);
    expect(bericht.zugestellt).toBe(1);
    const liste = await meldungen(chef);
    expect(liste.map((m) => m.objekt_id)).toEqual([kommt]);
  });
});
