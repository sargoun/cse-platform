/**
 * **Die Betriebsüberwachung sieht drei Ausfälle — und den stillsten zuerst**
 * (SPEC §14, D-540, Phase 10).
 *
 * Ein Nachtlauf, der scheitert, schreibt `job_lauf.ergebnis = 'fehler'` und
 * eine Zeile auf `stderr`. Beides sieht niemand. Diese Fälle prüfen, dass er
 * jetzt auf einem Bildschirm steht — und zwar zusammen mit den zwei Ausfällen,
 * die noch leiser sind:
 *
 *  - der Lauf, der begonnen und nie geendet hat. Er meldet nichts, weil er nie
 *    dazu kommt — und er verschwindet aus jeder „letzter Lauf"-Liste, sobald
 *    der nächste startet.
 *  - der Lauf, der gar nicht erst gestartet ist. **Er erzeugt keinen Fehler,
 *    er erzeugt nur nichts.**
 *
 * Gegen die echte Datenbank und nicht gegen eine Nachbildung: `job_lauf` steht
 * unter FORCE RLS und ist nur mit `system.betrieb_lesen` lesbar, `job_lauf_
 * mandant` trägt zusätzlich die Mandantentrennung. Eine Überwachung, die die
 * Fehler einer fremden Gesellschaft zeigt, wäre schlimmer als eine, die
 * schweigt.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { JobDefinition } from '../../src/server/jobs/registry.js';
import {
  liesBetriebslage, type Betriebslage,
} from '../../src/server/services/betrieb/ueberwachung.js';

let f: Fixtur;
let benutzer: string;

const zufall = (): string => Math.random().toString(36).slice(2, 10);

async function legeAdministrationAn(mandantId: string): Promise<string> {
  const email = `betrieb-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status)
     values ($1, $2, 'Betrieb', 'aktiv')`, [u!.id, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id)
     values ($1, $2, (select id from rolle where schluessel = 'admin' and mandant_id is null))`,
    [u!.id, mandantId]);
  return u!.id;
}

function sitzung(mandantId?: string) {
  return {
    scope: 'mandant' as const, mandantId: mandantId ?? f.reinigung,
    benutzerId: benutzer, portal: 'intern' as const, readonly: false,
  };
}

function kontextAus(tx: postgres.TransactionSql, mandantId?: string) {
  const m = mandantId ?? f.reinigung;
  return {
    aktiverMandantId: m,
    abfrage: async <T,>(a: string, w?: readonly unknown[]): Promise<readonly T[]> =>
      (await tx.unsafe(a, (w ?? []) as never[])) as unknown as readonly T[],
  };
}

/** Ein Job, wie ihn das Register trägt — nur die Felder, die hier zählen. */
function job(schluessel: string, zeitplan: string): JobDefinition {
  return {
    schluessel,
    bezeichnung: `Prüflauf ${schluessel}`,
    zeitplan,
    bereich: 'je_mandant',
    versuche: 0,
    ausfuehren: () => Promise.reject(new Error('Der Fall führt keinen Job aus.')),
  };
}

const TAEGLICH = job('taeglich_probe', '15 2 * * *');
const STUENDLICH = job('stuendlich_probe', '0 * * * *');
const HALBJAEHRLICH = job('halbjahr_probe', '0 6 15 6,12 *');

/**
 * Schreibt einen Lauf ins Protokoll. `vorMinuten` ist der Abstand zu **jetzt
 * in der Datenbank** — dieselbe Uhr, mit der die Überwachung rechnet.
 */
async function lauf(opt: {
  job: string; vorMinuten: number; ergebnis: string | null;
  fehlertext?: string; kennzahlen?: Record<string, unknown>;
}): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into job_lauf (job, gestartet_am, beendet_am, ergebnis, fehlertext, kennzahlen)
     values ($1, now() - ($2::int * interval '1 minute'),
             case when $3::text is null then null else now() end,
             $3::job_ergebnis, $4, coalesce(($5::text)::jsonb, '{}'::jsonb))
     returning id`,
    /*
     * `($5::text)::jsonb` und nicht `$5::jsonb` — D-467, und dieser Fall ist
     * genau darüber gestolpert. Gegenüber einem jsonb-Ziel codiert der Treiber
     * den Wert SELBST; ein bereits serialisierter String wird dann ein zweites
     * Mal codiert, und die Spalte hält einen jsonb-STRING statt eines Objekts.
     * Jeder Feldzugriff darauf liefert `undefined` — `kennzahlen.fehlerhaft`
     * war still leer, und der Befund zeigte „null Gesellschaften betroffen".
     * Als TEXT übergeben wandert die Zeichenkette unverändert hinüber und
     * Postgres liest sie einmal.
     */
    [opt.job, opt.vorMinuten, opt.ergebnis, opt.fehlertext ?? null,
      opt.kennzahlen === undefined ? null : JSON.stringify(opt.kennzahlen)]);
  return z!.id;
}

async function jeMandant(
  laufId: string, mandantId: string, ergebnis: string, fehlertext: string,
): Promise<void> {
  await sql.unsafe(
    `insert into job_lauf_mandant (job_lauf_id, mandant_id, ergebnis, fehlertext)
     values ($1, $2, $3::job_ergebnis, $4)`, [laufId, mandantId, ergebnis, fehlertext]);
}

function lage(jobs: readonly JobDefinition[], mandantId?: string): Promise<Betriebslage> {
  return alsApp(sitzung(mandantId), (tx) =>
    liesBetriebslage(kontextAus(tx, mandantId), jobs));
}

beforeEach(async () => {
  f = await seed();
  benutzer = await legeAdministrationAn(f.reinigung);
  await sql.unsafe(`delete from job_lauf_mandant`);
  await sql.unsafe(`delete from job_lauf`);
});

afterAll(schliessen);

describe('ein gescheiterter Lauf wird sichtbar', () => {
  it('mit seinem Fehlertext — nicht nur als roter Punkt', async () => {
    await lauf({
      job: TAEGLICH.schluessel, vorMinuten: 30, ergebnis: 'fehler',
      fehlertext: 'Verbindung zur Belegablage abgelehnt',
    });
    const l = await lage([TAEGLICH]);
    const b = l.befunde.find((x) => x.schluessel === TAEGLICH.schluessel);
    expect(b?.art).toBe('fehler');
    expect(b?.fehlertext).toBe('Verbindung zur Belegablage abgelehnt');
    expect(l.unauffaellig).toBe(0);
  });

  /**
   * **Der stillste Ausfall.** Kein Protokoll hat eine Zeile dafür; sichtbar
   * wird er nur im Vergleich mit dem Zeitplan.
   */
  it('und ein Lauf, der gar nicht kam, ebenso — obwohl der letzte gelang', async () => {
    await lauf({ job: TAEGLICH.schluessel, vorMinuten: 60 * 72, ergebnis: 'erfolg' });
    const b = (await lage([TAEGLICH])).befunde[0];
    expect(b?.art).toBe('ausgeblieben');
    expect(b?.alterText).toBe('vor 3 Tagen');
    expect(b?.erwartung).toBe('einmal täglich');
  });

  it('ein Lauf innerhalb seines Abstands ist kein Befund', async () => {
    await lauf({ job: TAEGLICH.schluessel, vorMinuten: 30, ergebnis: 'erfolg' });
    const l = await lage([TAEGLICH]);
    expect(l.befunde).toEqual([]);
    expect(l.unauffaellig).toBe(1);
    expect(l.staende[0]?.ergebnis).toBe('erfolg');
  });

  it('ohne einen einzigen Lauf heisst es „noch nie gelaufen", nicht „in Ordnung"', async () => {
    const l = await lage([TAEGLICH, STUENDLICH]);
    expect(l.befunde.map((b) => b.art)).toEqual(['nie_gelaufen', 'nie_gelaufen']);
    expect(l.befunde[0]?.zuletzt).toBeNull();
    expect(l.unauffaellig).toBe(0);
  });
});

describe('ein Lauf, der begonnen und nie geendet hat', () => {
  it('gilt als hängend, sobald er sein Doppeltes überschritten hat', async () => {
    await lauf({ job: STUENDLICH.schluessel, vorMinuten: 200, ergebnis: null });
    const b = (await lage([STUENDLICH])).befunde[0];
    expect(b?.art).toBe('haengt');
    expect(b?.haengende).toBe(1);
  });

  it('ein Lauf, der gerade erst begonnen hat, ist kein Befund, sondern Arbeit', async () => {
    await lauf({ job: STUENDLICH.schluessel, vorMinuten: 2, ergebnis: null });
    const l = await lage([STUENDLICH]);
    expect(l.befunde).toEqual([]);
    expect(l.staende[0]?.ergebnis).toBe('läuft');
  });

  /**
   * **Der Fall, an dem eine „letzter Lauf"-Liste blind ist.** Sobald ein neuer
   * Lauf startet, steht der aufgegebene nicht mehr vorn — und wer nur den
   * neuesten ansieht, sieht ihn nie wieder. Er wird trotzdem nie beendet.
   */
  it('auch dann, wenn ein neuerer Lauf ihn längst überholt hat', async () => {
    await lauf({ job: STUENDLICH.schluessel, vorMinuten: 20, ergebnis: null });
    await lauf({ job: STUENDLICH.schluessel, vorMinuten: 1, ergebnis: 'erfolg' });
    const l = await lage([STUENDLICH]);
    expect(l.befunde[0]?.art, 'ein überholter offener Lauf wird nie beendet').toBe('haengt');
    expect(l.befunde[0]?.haengende).toBe(1);
  });

  it('ein schwererer Befund gewinnt den Rang, die Zahl bleibt trotzdem stehen', async () => {
    await lauf({ job: STUENDLICH.schluessel, vorMinuten: 20, ergebnis: null });
    await lauf({
      job: STUENDLICH.schluessel, vorMinuten: 1, ergebnis: 'fehler', fehlertext: 'kaputt',
    });
    const b = (await lage([STUENDLICH])).befunde[0];
    expect(b?.art).toBe('fehler');
    expect(b?.haengende).toBe(1);
  });
});

describe('was diese Gesellschaft angeht — und was nicht', () => {
  /**
   * **Ein Lauf über alle Gesellschaften scheitert für eine.** `job_lauf` sagt
   * dann `teilweise`, und `job_lauf_mandant` trägt den Grund je Gesellschaft.
   * Die Trennung ist keine Höflichkeit: der Fehlertext einer fremden
   * Gesellschaft nennt deren Daten.
   */
  it('der eigene Fehler steht mit Text da, der fremde gar nicht', async () => {
    const id = await lauf({
      job: TAEGLICH.schluessel, vorMinuten: 30, ergebnis: 'teilweise',
      kennzahlen: { mandanten: 3, fehlerhaft: 2 },
    });
    await jeMandant(id, f.reinigung, 'fehler', 'Reinigung: Beleg fehlt');
    await jeMandant(id, f.bau, 'fehler', 'Bau: Konto gesperrt');

    const l = await lage([TAEGLICH]);
    const b = l.befunde[0];
    expect(b?.art).toBe('teilweise');
    expect(b?.fehlerhafteMandanten, 'die Zahl ist plattformweit und darf stimmen').toBe(2);
    expect(b?.hier.length, 'sichtbar ist nur die eigene Zeile').toBe(1);
    expect(b?.hier[0]?.fehlertext).toBe('Reinigung: Beleg fehlt');
    expect(JSON.stringify(l), 'kein fremder Fehlertext im ganzen Ergebnis')
      .not.toContain('Konto gesperrt');
  });

  it('dieselbe Lage in der anderen Gesellschaft zeigt deren Zeile', async () => {
    const id = await lauf({
      job: TAEGLICH.schluessel, vorMinuten: 30, ergebnis: 'teilweise',
      kennzahlen: { mandanten: 3, fehlerhaft: 2 },
    });
    await jeMandant(id, f.reinigung, 'fehler', 'Reinigung: Beleg fehlt');
    await jeMandant(id, f.bau, 'fehler', 'Bau: Konto gesperrt');

    benutzer = await legeAdministrationAn(f.bau);
    const l = await lage([TAEGLICH], f.bau);
    expect(l.befunde[0]?.hier[0]?.fehlertext).toBe('Bau: Konto gesperrt');
    expect(JSON.stringify(l)).not.toContain('Beleg fehlt');
  });
});

describe('was die Überwachung NICHT behauptet', () => {
  /**
   * **Ein Zeitplan am Kalender bleibt unbeurteilt.** Der Basiszinssatz läuft am
   * 15. Juni und am 15. Dezember; als „täglich" gelesen stünde er ab dem 16.
   * Juni ein halbes Jahr lang auf Rot — und ein Bildschirm, der grundlos rot
   * ist, wird nicht mehr gelesen.
   */
  it('ein kalendergebundener Lauf wird nicht als ausgeblieben gemeldet', async () => {
    await lauf({ job: HALBJAEHRLICH.schluessel, vorMinuten: 60 * 24 * 100, ergebnis: 'erfolg' });
    const l = await lage([HALBJAEHRLICH]);
    expect(l.befunde).toEqual([]);
    expect(l.unbeurteilbar).toBe(1);
    expect(l.staende[0]?.beurteilbar).toBe(false);
    expect(l.staende[0]?.erwartung).toMatch(/Monatstag und Monat/u);
  });

  it('aber ein Fehler desselben Laufs steht sehr wohl da', async () => {
    await lauf({
      job: HALBJAEHRLICH.schluessel, vorMinuten: 60 * 24 * 100, ergebnis: 'fehler',
      fehlertext: 'Bundesbank antwortet nicht',
    });
    expect((await lage([HALBJAEHRLICH])).befunde[0]?.art).toBe('fehler');
  });

  it('und der Auslöser wird gefragt, nicht angenommen', async () => {
    const l = await lage([TAEGLICH, STUENDLICH]);
    expect(l.ausloeser.erwartet).toBe(2);
    if (!l.ausloeser.erweiterung) expect(l.ausloeser.text).toMatch(/pg_cron/u);
    else expect(l.ausloeser.text).toMatch(/cron\.job|Alle 2/u);
  });
});

describe('der Rückblick zeigt auch, was später behoben wurde', () => {
  it('ein gescheiterter Lauf bleibt im Verlauf, obwohl der nächste gelang', async () => {
    await lauf({
      job: STUENDLICH.schluessel, vorMinuten: 90, ergebnis: 'fehler', fehlertext: 'einmalig',
    });
    await lauf({ job: STUENDLICH.schluessel, vorMinuten: 5, ergebnis: 'erfolg' });
    const l = await lage([STUENDLICH]);
    expect(l.befunde, 'jetzt ist nichts mehr zu tun').toEqual([]);
    expect(l.fehllaeufe.length, 'passiert ist es trotzdem').toBe(1);
    expect(l.fehllaeufe[0]?.fehlertext).toBe('einmalig');
  });

  it('ein Lauf, den das Register nicht mehr kennt, wird benannt statt verschwiegen', async () => {
    await lauf({
      job: 'ausgebauter_lauf', vorMinuten: 10, ergebnis: 'fehler', fehlertext: 'Rest',
    });
    const l = await lage([STUENDLICH]);
    expect(l.fehllaeufe[0]?.bezeichnung).toMatch(/nicht mehr registriert/u);
  });
});

/**
 * **Ohne das Betriebsrecht ist die Lage leer — und nicht etwa grün.** Die
 * Policy auf `job_lauf` (0010:72) verlangt `system.betrieb_lesen` gegen den
 * aktiven Mandanten. Wer es nicht hält, sieht keine Zeile; die Seite selbst
 * liegt hinter demselben Recht und antwortet 404 (AUT-06).
 */
describe('das Betriebsrecht entscheidet, nicht die Abfrage', () => {
  it('eine Sitzung ohne das Recht bekommt keine einzige Laufzeile', async () => {
    await lauf({
      job: TAEGLICH.schluessel, vorMinuten: 30, ergebnis: 'fehler', fehlertext: 'geheim',
    });
    const email = `ohne-${zufall()}@cse.test`;
    const [u] = await sql.unsafe<{ id: string }[]>(
      `insert into auth.users (email) values ($1) returning id`, [email]);
    await sql.unsafe(
      `insert into benutzer (id, email, name, status) values ($1,$2,'Ohne','aktiv')`,
      [u!.id, email]);
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id)
       values ($1, $2, (select id from rolle
                         where schluessel = 'mitarbeiter' and mandant_id is null))`,
      [u!.id, f.reinigung]);
    benutzer = u!.id;

    const l = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: u!.id,
        portal: 'mitarbeiter', readonly: false },
      (tx) => liesBetriebslage(kontextAus(tx), [TAEGLICH]));
    expect(JSON.stringify(l)).not.toContain('geheim');
    expect(l.befunde[0]?.art, 'ohne Recht sieht es aus wie nie gelaufen').toBe('nie_gelaufen');
  });
});
