/**
 * **Stelle und Bewerbung bewegen sich ohne Entscheidung** (V-363, O-200,
 * D-812) — an echtem Postgres.
 *
 * Seit 0168 ändert `cse_app` keine Bewerbung; der Status wandert über eine
 * Entscheidung. Die Stände dazwischen setzt jetzt die Datenbank selbst —
 * `in_pruefung` bei der ersten Bewertung eines Menschen, `gespraech` beim
 * geplanten Gespräch —, und der Rückzug ist ein Vermerk mit Namen. Danach
 * wird nicht mehr entschieden. Eine Stelle lässt sich mit Grund schliessen.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, alsRolle, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import {
  AKTION_STELLE_GESCHLOSSEN, RecruitingFehler, bewerte, entscheide, ladeBewerbung,
  ladeStelle, planeGespraech, schliesseStelle, zieheBewerbungZurueck,
} from '../../src/server/services/recruiting/dienst.js';
import { sageGespraechAb } from '../../src/server/services/recruiting/gespraech.js';
import { registriereBewerberLoeschung } from '../../src/server/jobs/bewerberLoeschung.js';
import { leereRegister } from '../../src/server/jobs/registry.js';

let f: Fixtur;
let leitung = '';
const zufall = (): string => Math.random().toString(36).slice(2, 10);

async function konto(rolle: string): Promise<string> {
  const email = `stand-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1, $2, 'Leitung Recruiting', 'aktiv')`,
    [u!.id, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1, $2, (select id from rolle where schluessel = $3 and mandant_id is null), true)`,
    [u!.id, f.reinigung, rolle]);
  return u!.id;
}

function als<T>(benutzerId: string, fn: (k: SchreibKontext) => Promise<T>): Promise<T> {
  return alsApp(
    { scope: 'mandant', mandantId: f.reinigung, benutzerId, portal: 'intern', readonly: false },
    async (tx: postgres.TransactionSql) => {
      const abfrage = async <R>(a: string, w?: readonly unknown[]): Promise<readonly R[]> =>
        (await tx.unsafe(a, (w ?? []) as never[])) as unknown as readonly R[];
      return fn({
        scope: 'mandant', portal: 'intern', benutzerId,
        aktiverMandantId: f.reinigung, mandantIds: [f.reinigung],
        abfrage, schreibe: abfrage,
      });
    },
  ) as Promise<T>;
}

/** Eine Stelle und eine Bewerbung, am Portal vorbei angelegt. */
async function bewerbung(): Promise<{ stelleId: string; bewerbungId: string }> {
  return alsRolle('', async (tx) => {
    const [s] = (await tx.unsafe(
      `insert into stelle (mandant_id, titel, beschreibung, anforderungen)
       values ($1::uuid, 'Objektleitung', 'Testbeschreibung', array['A'])
       returning id`, [f.reinigung])) as unknown as { id: string }[];
    const [b] = (await tx.unsafe(
      `insert into bewerbung (mandant_id, stelle_id, name, email, aufbewahrung_bis)
       values ($1::uuid, $2::uuid, 'Erika Muster', 'erika@example.test', app.berlin_heute() + 10)
       returning id`, [f.reinigung, s!.id])) as unknown as { id: string }[];
    return { stelleId: s!.id, bewerbungId: b!.id };
  });
}

async function stand(bewerbungId: string): Promise<string> {
  const [z] = await sql.unsafe<{ status: string }[]>(
    `select status::text as status from bewerbung where id = $1`, [bewerbungId]);
  return z!.status;
}

/**
 * Die Stelle veröffentlicht — mit einer genehmigten Freigabe, am Auslöser
 * vorbei, der die Freigabe an den Text bindet (das prüft `recruiting.test.ts`).
 */
async function veroeffentlicht(stelleId: string): Promise<void> {
  const [fr] = await sql.unsafe<{ id: string }[]>(
    `insert into freigabe (mandant_id, aktion, status, freigegeben_von, freigegeben_am)
     values ($1, 'stelle_veroeffentlichen', 'genehmigt', $2, now()) returning id`,
    [f.reinigung, leitung]);
  await sql.begin(async (tx) => {
    await tx.unsafe(`set local session_replication_role = replica`);
    await tx.unsafe(
      `update stelle set freigabe_id = $2, status = 'veroeffentlicht', veroeffentlicht_am = now()
        where id = $1`, [stelleId, fr!.id]);
  });
}

/** Was die Karriereseite sieht: `cse_app` ohne Sitzung, also nur `t_stelle_oeffentlich`. */
async function oeffentlich(stelleId: string): Promise<number> {
  const z = await alsRolle('cse_app', (tx) => tx.unsafe(
    `select id from stelle where id = $1`, [stelleId]));
  return z.length;
}

const MORGEN = (): Date => new Date(Date.now() + 86_400_000);
const KRITERIUM = { kriterium: 'Erfahrung', gewicht: 50, punkte: 7, begruendung: 'Drei Jahre.' };

beforeEach(async () => {
  f = await seed();
  leitung = await konto('leitung');
});
afterAll(schliessen);

describe('V-363 — die Stände zwischen Eingang und Entscheidung', () => {
  it('die erste Bewertung eines Menschen setzt in_pruefung — die eines Agenten nicht', async () => {
    const a = await bewerbung();
    await als(leitung, (k) => bewerte(k, a.bewerbungId, [{ ...KRITERIUM, vonArt: 'agent' }]));
    expect(await stand(a.bewerbungId)).toBe('eingegangen');
    await als(leitung, (k) => bewerte(k, a.bewerbungId, [KRITERIUM]));
    expect(await stand(a.bewerbungId)).toBe('in_pruefung');
  });

  it('ein geplantes Gespräch setzt gespraech; sind alle abgesagt, zurück auf in_pruefung', async () => {
    const a = await bewerbung();
    const g1 = await als(leitung, (k) => planeGespraech(k, a.bewerbungId, MORGEN(), 45, null, []));
    const g2 = await als(leitung, (k) => planeGespraech(k, a.bewerbungId, MORGEN(), 45, null, []));
    expect(await stand(a.bewerbungId)).toBe('gespraech');

    await als(leitung, (k) => sageGespraechAb(k, g1, 'Raum belegt.'));
    expect(await stand(a.bewerbungId), 'ein Gespräch steht noch').toBe('gespraech');
    await als(leitung, (k) => sageGespraechAb(k, g2, 'Bewerberin verhindert.'));
    expect(await stand(a.bewerbungId)).toBe('in_pruefung');
  });

  it('eine entschiedene Bewerbung bewegt sich durch Bewertung und Gespräch nicht mehr', async () => {
    const a = await bewerbung();
    await als(leitung, (k) => entscheide(k, a.bewerbungId, 'abgelehnt', 'Andere Qualifikation.'));
    await als(leitung, (k) => bewerte(k, a.bewerbungId, [KRITERIUM]));
    await als(leitung, (k) => planeGespraech(k, a.bewerbungId, MORGEN(), 45, null, []));
    expect(await stand(a.bewerbungId)).toBe('abgelehnt');
  });

  it('cse_app ändert bewerbung weiterhin nicht selbst (0168)', async () => {
    const a = await bewerbung();
    await expect(alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: leitung, portal: 'intern', readonly: false },
      (tx) => tx.unsafe(`update bewerbung set status = 'zurueckgezogen' where id = $1`, [a.bewerbungId]),
    )).rejects.toThrow();
  });
});

describe('V-363 — der Rückzug ist ein Vermerk, keine Entscheidung', () => {
  it('vermerkt Stand, Zeitpunkt, Namen und Vermerk; die Frist läuft wie bei einer Absage', async () => {
    const a = await bewerbung();
    const [frist] = await sql.unsafe<{ tage: number }[]>(
      `select (wert #>> '{}')::int as tage from plattform_einstellung
        where schluessel = 'recruiting.aufbewahrung_tage'`);
    await als(leitung, (k) => zieheBewerbungZurueck(k, a.bewerbungId, 'Per E-Mail am 3. Oktober.'));

    const [z] = await sql.unsafe<{
      status: string; von: string; vermerk: string; am: Date | null; frist_tage: number;
    }[]>(
      `select status::text as status, zurueckgezogen_von as von,
              zurueckgezogen_vermerk as vermerk, zurueckgezogen_am as am,
              (aufbewahrung_bis - app.berlin_heute())::int as frist_tage
         from bewerbung where id = $1`, [a.bewerbungId]);
    expect(z!.status).toBe('zurueckgezogen');
    expect(z!.von).toBe(leitung);
    expect(z!.vermerk).toBe('Per E-Mail am 3. Oktober.');
    expect(z!.am).not.toBeNull();
    // Ab heute neu gezählt, nicht die zehn Tage ab Eingang (0498).
    expect(z!.frist_tage).toBe(frist!.tage);

    const b = await als(leitung, (k) => ladeBewerbung(k, a.bewerbungId));
    expect(b!.zurueckgezogenVermerk).toBe('Per E-Mail am 3. Oktober.');
    expect(b!.zurueckgezogenVon).toBe('Leitung Recruiting');
    expect(b!.zurueckgezogenLokal).toMatch(/^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/u);
  });

  it('danach wird nicht mehr entschieden — im Dienst und in der Datenbank', async () => {
    const a = await bewerbung();
    await als(leitung, (k) => zieheBewerbungZurueck(k, a.bewerbungId, 'Telefonisch abgesagt.'));
    await expect(als(leitung, (k) => entscheide(k, a.bewerbungId, 'abgelehnt', 'Zu spät.')))
      .rejects.toThrow(RecruitingFehler);
    await expect(alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: leitung, portal: 'intern', readonly: false },
      (tx) => tx.unsafe(
        `insert into einstellungsentscheidung
           (mandant_id, bewerbung_id, ergebnis, begruendung, entschieden_von)
         values ($1, $2, 'abgelehnt', 'Direkt.', $3)`, [f.reinigung, a.bewerbungId, leitung]),
    )).rejects.toThrow(/zurueckgezogene Bewerbung/u);
    expect(await stand(a.bewerbungId)).toBe('zurueckgezogen');
  });

  it('nur offene Bewerbungen, nur mit Vermerk, nur mit dem Recht', async () => {
    const a = await bewerbung();
    await expect(als(leitung, (k) => zieheBewerbungZurueck(k, a.bewerbungId, ' x ')))
      .rejects.toThrow(RecruitingFehler);
    await als(leitung, (k) => entscheide(k, a.bewerbungId, 'abgelehnt', 'Andere Qualifikation.'));
    await expect(als(leitung, (k) => zieheBewerbungZurueck(k, a.bewerbungId, 'Per Post.')))
      .rejects.toThrow(RecruitingFehler);

    const b = await bewerbung();
    const mitarbeiter = await konto('mitarbeiter');
    await expect(als(mitarbeiter, (k) => k.schreibe(
      `select app.bewerbung_zurueckziehen($1::uuid, 'Per Post.')`, [b.bewerbungId])))
      .rejects.toThrow();
    expect(await stand(b.bewerbungId)).toBe('eingegangen');
  });

  it('der Löschlauf leert den Vermerk mit den übrigen Angaben', async () => {
    const a = await bewerbung();
    await als(leitung, (k) => zieheBewerbungZurueck(k, a.bewerbungId, 'Erika rief an.'));
    await sql.unsafe(
      `update bewerbung set aufbewahrung_bis = app.berlin_heute() - 1 where id = $1`,
      [a.bewerbungId]);
    leereRegister();
    const job = registriereBewerberLoeschung(sql);
    await job.ausfuehren({ mandantId: f.reinigung, laufId: 'v363', versuch: 1 });
    const [z] = await sql.unsafe<{ vermerk: string | null; geloescht: boolean; status: string }[]>(
      `select zurueckgezogen_vermerk as vermerk, geloescht_am is not null as geloescht,
              status::text as status
         from bewerbung where id = $1`, [a.bewerbungId]);
    expect(z!.geloescht).toBe(true);
    expect(z!.vermerk).toBeNull();
    expect(z!.status).toBe('zurueckgezogen');
  });
});

describe('V-363 — eine Stelle schliessen', () => {
  it('mit Grund, protokolliert, und danach nicht mehr auf der Karriereseite', async () => {
    const a = await bewerbung();
    await veroeffentlicht(a.stelleId);
    expect(await oeffentlich(a.stelleId), 'vorher steht sie da').toBe(1);
    await als(leitung, (k) => schliesseStelle(k, a.stelleId, 'Besetzt aus dem eigenen Haus.'));

    const s = await als(leitung, (k) => ladeStelle(k, a.stelleId));
    expect(s!.status).toBe('geschlossen');
    expect(s!.geschlossenAm).not.toBeNull();
    expect(s!.geschlossenGrund).toBe('Besetzt aus dem eigenen Haus.');

    const [p] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from audit_log
        where aktion = $1 and objekt_typ = 'stelle' and objekt_id = $2`,
      [AKTION_STELLE_GESCHLOSSEN, a.stelleId]);
    expect(p!.n).toBe(1);

    expect(await oeffentlich(a.stelleId), 'danach nicht mehr').toBe(0);

    // Die offene Bewerbung bleibt und wird weiter entschieden.
    expect(await stand(a.bewerbungId)).toBe('eingegangen');
  });

  it('zweimal schliessen ist ein Konflikt, ohne Grund eine Abweisung', async () => {
    const a = await bewerbung();
    await expect(als(leitung, (k) => schliesseStelle(k, a.stelleId, '  ')))
      .rejects.toThrow(RecruitingFehler);
    await als(leitung, (k) => schliesseStelle(k, a.stelleId, 'Budget gestrichen.'));
    await expect(als(leitung, (k) => schliesseStelle(k, a.stelleId, 'Noch einmal.')))
      .rejects.toThrow(RecruitingFehler);
  });
});
