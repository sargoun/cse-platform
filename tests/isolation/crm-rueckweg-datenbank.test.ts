/**
 * Die Abweisungen der Datenbank kommen als GRUND an, nie als ihr Satz —
 * ausgelöst an der echten Datenbank, durch die echten Dienste (D-769 Nr. 8,
 * D-772, V-274).
 *
 * **Warum an der Datenbank.** Die Dienste bilden den deutschen Satz eines
 * Definers auf seinen Grund ab (`ZUGANG_DATENBANK_GRUENDE`). Der Kerntest
 * prüft die Abbildung gegen den Text der Migration — nicht aber, dass
 * postgres.js genau diesen Text und genau diesen SQLSTATE liefert. Stimmte
 * eines davon nicht, fiele jede Abweisung still auf den allgemeinen Satz
 * `abgewiesen`: die Seite bliebe richtig, aber stumm darüber, WARUM. Diese
 * Datei zeigt für jeden Satz, dass er ankommt und seinen Grund findet.
 *
 * **Die Sätze, die diese Datei beweist:**
 *
 *  1. Jede Antwort `ok = false` der drei Definer aus 0249 wird ihr Grund.
 *  2. Jeder ihrer Würfe (`insufficient_privilege`, `no_data_found`) wird ein
 *     `ZugangFehler` mit seinem Grund — der Satz der Datenbank steht in der
 *     Abbildung, fällt also nicht auf `abgewiesen`.
 *  3. Ein Erfolg ist ein Schlüssel; die Zahl beendeter Sitzungen reist nicht
 *     mehr im Satz, sie steht im Protokoll des Definers.
 *  4. Dasselbe für die beiden Widerspruchs-Definer (0248, 0222): jeder
 *     erreichbare Wurf wird ein `CrmFehler` mit seinem Grund
 *     (`WIDERSPRUCH_DATENBANK_GRUENDE`), mit dem Status seines SQLSTATE.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import type postgres from 'postgres';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import {
  ZUGANG_DATENBANK_GRUENDE, ZugangFehler, entzieheZugang, ladeNeuEin, stelleZugangAus,
} from '../../src/server/services/crm/kundenzugang.js';
import { CrmFehler } from '../../src/server/services/crm/anlegen.js';
import {
  WIDERSPRUCH_DATENBANK_GRUENDE, erfasseVollwiderspruch, erfasseWerbewiderspruch,
} from '../../src/server/services/crm/kontakt-grundlage.js';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';

let f: Fixtur;
let chef = '';
let chefEmail = '';

const zufall = (): string => Math.random().toString(36).slice(2, 10);
const adresse = (): string => `rw-${zufall()}@hv.test`;
const hash = (t: string): string => createHash('sha256').update(t, 'utf8').digest('hex');

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function recht(rolle: string, schluessel: string, mandant: string, gewaehrt: boolean): Promise<void> {
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     select $1, b.id, $2, $4 from berechtigung b where b.schluessel = $3`,
    [await rolleId(rolle), mandant, schluessel, gewaehrt]);
}

async function konto(rolle: string, mandantId: string): Promise<{ id: string; email: string }> {
  const email = `rw-intern-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`, [u!.id, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1, $2, $3, false)`, [u!.id, mandantId, await rolleId(rolle)]);
  return { id: u!.id, email };
}

async function kunde(mandantId: string): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name)
     values ($1, $2, 'Hausverwaltung Rückweg') returning id`, [mandantId, `K-${zufall()}`]);
  return z!.id;
}

/** Die Lage der Sitzung, in der ein Dienst läuft — Vorgabe: die Verwaltung, intern, mit zweitem Faktor. */
interface Lage {
  /** `null`: keine aktive Gesellschaft. */
  readonly mandant?: string | null;
  readonly portal?: 'intern' | 'kunde';
  readonly readonly?: boolean;
  readonly aal?: 'aal1' | 'aal2';
  readonly benutzer?: string;
  /** Läuft in derselben Transaktion VOR dem Dienst, als Eigentümer — und fällt mit ihr zurück. */
  readonly vorher?: string;
}

function kontextAus(tx: postgres.TransactionSql, mandant: string, benutzerId: string): SchreibKontext {
  const abfrage = async <T,>(anweisung: string, werte?: readonly unknown[]): Promise<readonly T[]> =>
    (await tx.unsafe(anweisung, (werte ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId,
    aktiverMandantId: mandant, mandantIds: [mandant], abfrage, schreibe: abfrage,
  };
}

async function als<T>(lage: Lage, fn: (k: SchreibKontext) => Promise<T>): Promise<T> {
  const mandant = lage.mandant === undefined ? f.reinigung : lage.mandant;
  const benutzer = lage.benutzer ?? chef;
  return alsApp({
    scope: 'mandant', mandantId: mandant ?? '', benutzerId: benutzer,
    portal: lage.portal ?? 'intern', readonly: lage.readonly ?? false, aal: lage.aal ?? 'aal2',
  }, async (tx) => {
    if (lage.vorher !== undefined) {
      await tx.unsafe('reset role');
      await tx.unsafe(lage.vorher);
      await tx.unsafe('set local role cse_app');
    }
    return fn(kontextAus(tx, mandant ?? f.reinigung, benutzer));
  });
}

/** Der Wurf eines Dienstes — und die Zusicherung, dass es einer der erwarteten Klasse war. */
async function wurf<F extends Error = ZugangFehler>(
  p: Promise<unknown>, klasse: abstract new (...a: never[]) => F = ZugangFehler as never,
): Promise<F> {
  try {
    await p;
  } catch (fehler) {
    expect(fehler).toBeInstanceOf(klasse);
    return fehler as F;
  }
  throw new Error('Der Dienst hat nicht abgewiesen.');
}

async function kontakt(mandantId: string): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into ansprechpartner (mandant_id, kunde_id, nachname, email)
     values ($1, $2, 'Beispiel', $3) returning id`,
    [mandantId, await kunde(mandantId), `k-${zufall()}@example.test`]);
  return z!.id;
}

async function zugangVon(kundeId: string): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `select id from kunde_zugang where kunde_id = $1 order by erstellt_am desc limit 1`, [kundeId]);
  return z!.id;
}

async function ausgestellt(kundeId: string): Promise<string> {
  const e = await als({}, (k) => stelleZugangAus(k, { kundeId, email: adresse(), name: 'Bernd Beispiel' }));
  expect(e.ok).toBe(true);
  return zugangVon(kundeId);
}

beforeEach(async () => {
  f = await seed();
  const k = await konto('admin', f.reinigung);
  chef = k.id;
  chefEmail = k.email;
});

afterAll(async () => { await schliessen(); });

describe('Kundenzugang · jede Antwort `ok = false` wird ihr Grund (0249)', () => {
  it('ausstellen: fremder Kunde, E-Mail, Name, internes Konto, zweiter Zugang', async () => {
    const kd = await kunde(f.reinigung);
    const fremd = await kunde(f.bau);
    const aus = (kundeId: string, email: string, name = 'Bernd Beispiel') =>
      als({}, (k) => stelleZugangAus(k, { kundeId, email, name }));

    expect(await aus(fremd, adresse())).toEqual({ ok: false, grund: 'kunde_unbekannt' });
    expect(await aus(kd, 'kein-at-zeichen')).toEqual({ ok: false, grund: 'email_ungueltig' });
    expect(await aus(kd, adresse(), '   ')).toEqual({ ok: false, grund: 'name_fehlt' });
    expect(await aus(kd, chefEmail)).toEqual({ ok: false, grund: 'internes_konto' });
    const email = adresse();
    expect((await aus(kd, email)).ok).toBe(true);
    expect(await aus(kd, email)).toEqual({ ok: false, grund: 'zugang_besteht' });
  });

  it('neu einladen und entziehen: kein Zugang (beide Sätze), Entzug ohne Grund', async () => {
    const kd = await kunde(f.reinigung);
    const zugang = await ausgestellt(kd);
    expect(await als({}, (k) => entzieheZugang(k, zugang, '   ')))
      .toEqual({ ok: false, grund: 'entzug_ohne_grund' });

    expect((await als({}, (k) => entzieheZugang(k, zugang, 'Vertrag beendet'))).ok).toBe(true);
    /* „… oder er ist entzogen." */
    expect(await als({}, (k) => ladeNeuEin(k, zugang)))
      .toEqual({ ok: false, grund: 'nicht_gefunden' });
    /* „… oder er ist schon entzogen." */
    expect(await als({}, (k) => entzieheZugang(k, zugang, 'Vertrag beendet')))
      .toEqual({ ok: false, grund: 'nicht_gefunden' });
  });
});

describe('Kundenzugang · jeder Wurf wird ein ZugangFehler mit Grund — nie `abgewiesen`', () => {
  it('Portal, Gruppenansicht, ohne Gesellschaft — für alle drei Vorgänge', async () => {
    const kd = await kunde(f.reinigung);
    const zugang = await ausgestellt(kd);
    const vorgaenge = [
      (k: SchreibKontext) => stelleZugangAus(k, { kundeId: kd, email: adresse(), name: 'B' }),
      (k: SchreibKontext) => ladeNeuEin(k, zugang),
      (k: SchreibKontext) => entzieheZugang(k, zugang, 'Vertrag beendet'),
    ];
    for (const [i, vorgang] of vorgaenge.entries()) {
      const portal = await wurf(als({ portal: 'kunde' }, vorgang));
      expect([portal.grund, portal.status], `Portal ${String(i)}`).toEqual(['nur_intern', 403]);
      expect(ZUGANG_DATENBANK_GRUENDE.has(portal.message), portal.message).toBe(true);

      const gruppe = await wurf(als({ readonly: true }, vorgang));
      expect([gruppe.grund, gruppe.status], `Gruppe ${String(i)}`).toEqual(['gruppenansicht', 403]);
      expect(ZUGANG_DATENBANK_GRUENDE.has(gruppe.message), gruppe.message).toBe(true);
    }
    const ohne = await wurf(als({ mandant: null }, vorgaenge[0]!));
    expect([ohne.grund, ohne.status]).toEqual(['ohne_gesellschaft', 403]);
  });

  it('ohne das Recht, die Benutzerkonten zu verwalten — für alle drei Vorgänge', async () => {
    const kd = await kunde(f.reinigung);
    const zugang = await ausgestellt(kd);
    await recht('admin', 'system.benutzer_verwalten', f.reinigung, false);
    for (const vorgang of [
      (k: SchreibKontext) => stelleZugangAus(k, { kundeId: kd, email: adresse(), name: 'B' }),
      (k: SchreibKontext) => ladeNeuEin(k, zugang),
      (k: SchreibKontext) => entzieheZugang(k, zugang, 'Vertrag beendet'),
    ]) {
      const e = await wurf(als({}, vorgang));
      expect([e.grund, e.status, e.message]).toEqual(['kein_recht', 403, 'system.benutzer_verwalten fehlt']);
    }
  });

  it('ohne zweiten Faktor — bei einer Rolle, die das Recht OHNE Faktor hält', async () => {
    /*
     * Die Rolle `admin` gewährt ohne aal2 gar nichts (V-136), dort weist
     * schon die Rechtefrage ab. Die Stufenprüfung des Definers erreicht nur
     * eine Rolle ohne `erfordert_2fa`, die das Recht hält.
     */
    const kd = await kunde(f.reinigung);
    const zugang = await ausgestellt(kd);
    await recht('leitung', 'system.benutzer_verwalten', f.reinigung, true);
    const leitung = await konto('leitung', f.reinigung);
    const aus = await wurf(als({ aal: 'aal1', benutzer: leitung.id },
      (k) => stelleZugangAus(k, { kundeId: kd, email: adresse(), name: 'B' })));
    expect([aus.grund, aus.status]).toEqual(['zweiter_faktor', 403]);
    const ein = await wurf(als({ aal: 'aal1', benutzer: leitung.id }, (k) => ladeNeuEin(k, zugang)));
    expect([ein.grund, ein.status]).toEqual(['zweiter_faktor', 403]);
  });

  it('die fehlende Rolle für Kundenkonten ist `no_data_found` — und findet ihren Grund', async () => {
    const kd = await kunde(f.reinigung);
    const e = await wurf(als({
      vorher: `update rolle set schluessel = 'kunde_umbenannt'
                where schluessel = 'kunde' and mandant_id is null`,
    }, (k) => stelleZugangAus(k, { kundeId: kd, email: adresse(), name: 'B' })));
    expect([e.grund, e.status]).toEqual(['rolle_fehlt', 500]);
    /* Die Umbenennung fiel mit der Transaktion zurück. */
    expect(await rolleId('kunde')).toMatch(/^[0-9a-f-]{36}$/u);
  });
});

describe('Kundenzugang · ein Erfolg ist ein Schlüssel', () => {
  it('ausgestellt und eingeladen — mit dem Klartext des Links, einmal', async () => {
    const kd = await kunde(f.reinigung);
    const aus = await als({}, (k) => stelleZugangAus(k, { kundeId: kd, email: adresse(), name: 'B' }));
    expect(aus).toMatchObject({ ok: true, erfolg: 'ausgestellt', neuesKonto: true });
    expect(aus.ok && aus.token).toMatch(/^\S{20,}$/u);
    const ein = await als({}, async (k) => ladeNeuEin(k, await zugangVon(kd)));
    expect(ein).toMatchObject({ ok: true, erfolg: 'eingeladen', neuesKonto: false });
  });

  it('entzogen, entzogen mit Sitzungen — die Zahl steht im Protokoll, nicht in der Adresse', async () => {
    const ohne = await ausgestellt(await kunde(f.reinigung));
    expect(await als({}, (k) => entzieheZugang(k, ohne, 'Vertrag beendet')))
      .toEqual({ ok: true, erfolg: 'entzogen', token: null, neuesKonto: false });

    const kd = await kunde(f.reinigung);
    const mit = await ausgestellt(kd);
    const [kontoZeile] = await sql.unsafe<{ benutzer_id: string }[]>(
      `select benutzer_id from kunde_zugang where id = $1`, [mit]);
    await sql.unsafe(
      `insert into benutzer_sitzung
         (benutzer_id, token_hash, aktiver_mandant_id, ansicht, aal, ablauf_am)
       values ($1, $2, $3, 'mandant', 'aal1', now() + interval '8 hours')`,
      [kontoZeile!.benutzer_id, hash(randomBytes(32).toString('hex')), f.reinigung]);
    expect(await als({}, (k) => entzieheZugang(k, mit, 'Vertrag beendet')))
      .toEqual({ ok: true, erfolg: 'entzogen_mit_sitzungen', token: null, neuesKonto: false });

    const [p] = await sql.unsafe<{ n: string }[]>(
      `select nachher->>'beendete_sitzungen' as n from audit_log
        where aktion = 'kunde.zugang_entzogen' and objekt_id = $1`, [kd]);
    expect(p!.n).toBe('1');
  });
});

describe('Widerspruch · jeder erreichbare Wurf der Definer wird ein CrmFehler mit Grund (0248, 0222)', () => {
  /** Ein Tag, der sicher in der Zukunft liegt — in jeder Zeitzone. */
  const uebermorgen = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);

  it('Werbewiderspruch: Portal, Gruppenansicht, Recht, Zukunft, Kanal, fremder Kontakt', async () => {
    const a = await kontakt(f.reinigung);
    const fremd = await kontakt(f.bau);
    const werbung = (eingabe: Parameters<typeof erfasseWerbewiderspruch>[1]) =>
      (k: SchreibKontext) => erfasseWerbewiderspruch(k, eingabe);
    const faelle: readonly [Lage, Parameters<typeof erfasseWerbewiderspruch>[1], string, number][] = [
      [{ portal: 'kunde' }, { ansprechpartnerId: a }, 'nur_intern', 403],
      [{ readonly: true }, { ansprechpartnerId: a }, 'gruppenansicht', 403],
      [{}, { ansprechpartnerId: a, eingegangenAm: uebermorgen }, 'eingang_in_zukunft', 400],
      [{}, { ansprechpartnerId: a, kanal: 'brieftaube' }, 'kanal_unbekannt', 400],
      [{}, { ansprechpartnerId: fremd }, 'nicht_gefunden', 404],
    ];
    for (const [lage, eingabe, grund, status] of faelle) {
      const e = await wurf(als(lage, werbung(eingabe)), CrmFehler);
      expect([e.grund, e.status], grund).toEqual([grund, status]);
      expect(WIDERSPRUCH_DATENBANK_GRUENDE.get(e.message), e.message).toBe(grund);
    }

    await recht('admin', 'crm.rechtsgrundlage_setzen', f.reinigung, false);
    const ohneRecht = await wurf(als({}, werbung({ ansprechpartnerId: a })), CrmFehler);
    expect([ohneRecht.grund, ohneRecht.status]).toEqual(['kein_setzrecht', 403]);
    expect(WIDERSPRUCH_DATENBANK_GRUENDE.has(ohneRecht.message)).toBe(true);
  });

  it('Werbewiderspruch: ohne Betroffenen weist schon der Dienst ab; ein gültiger wird erfasst', async () => {
    const ohne = await wurf(als({}, (k) => erfasseWerbewiderspruch(k, {})), CrmFehler);
    expect(ohne.grund).toBe('ohne_betroffenen');

    const a = await kontakt(f.reinigung);
    await als({}, (k) => erfasseWerbewiderspruch(k, { ansprechpartnerId: a, kanal: 'telefon' }));
    const [z] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from werbewiderspruch
        where ansprechpartner_id = $1 and art = 'werbung'`, [a]);
    expect(z!.n).toBe('1');
  });

  it('Vollwiderspruch: das eigene Recht, Portal, Gruppenansicht, fremder Kontakt', async () => {
    const a = await kontakt(f.reinigung);
    const fremd = await kontakt(f.bau);
    /* Die Rolle `admin` hält das Recht der Datenschutzstelle nicht — so ist es vergeben. */
    const ohneRecht = await wurf(
      als({}, (k) => erfasseVollwiderspruch(k, a, 'Schreiben vom 12.03.')), CrmFehler);
    expect([ohneRecht.grund, ohneRecht.status]).toEqual(['kein_widerspruchsrecht', 403]);
    expect(WIDERSPRUCH_DATENBANK_GRUENDE.has(ohneRecht.message)).toBe(true);

    await recht('admin', 'datenschutz.auskunft_erstellen', f.reinigung, true);
    const faelle: readonly [Lage, string, string, number][] = [
      [{ portal: 'kunde' }, a, 'nur_intern', 403],
      [{ readonly: true }, a, 'gruppenansicht', 403],
      [{}, fremd, 'nicht_gefunden', 404],
    ];
    for (const [lage, id, grund, status] of faelle) {
      const e = await wurf(als(lage, (k) => erfasseVollwiderspruch(k, id, 'Schreiben vom 12.03.')),
        CrmFehler);
      expect([e.grund, e.status], grund).toEqual([grund, status]);
      expect(WIDERSPRUCH_DATENBANK_GRUENDE.get(e.message), e.message).toBe(grund);
    }
  });

  it('Vollwiderspruch: ohne Begründung weist schon der Dienst ab; ein begründeter wird erfasst', async () => {
    await recht('admin', 'datenschutz.auskunft_erstellen', f.reinigung, true);
    const a = await kontakt(f.reinigung);
    const ohne = await wurf(als({}, (k) => erfasseVollwiderspruch(k, a, '   ')), CrmFehler);
    expect(ohne.grund).toBe('ohne_begruendung');

    await als({}, (k) => erfasseVollwiderspruch(k, a, 'Schreiben vom 12.03.'));
    const [z] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from werbewiderspruch
        where ansprechpartner_id = $1 and art = 'verarbeitung'`, [a]);
    expect(z!.n).toBe('1');
  });
});
