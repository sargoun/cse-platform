/**
 * PR 10 Akzeptanz (2), (3), (4) — der Runner ohne Datenbank.
 *
 * Wiederholung, Idempotenz und Registrierung sind Eigenschaften des Codes; sie
 * hier zu pruefen heisst, sie ohne Warten und ohne Zeitplan pruefen zu koennen.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  JobRegistrierungsFehler, leereRegister, registriere, jobs, type JobDefinition,
} from '../../src/server/jobs/registry.js';
import {
  backoffMs, fuehreAus, type Alarm, type Ergebnis, type LaufProtokoll,
} from '../../src/server/jobs/runner.js';

/** Ein Protokoll im Speicher — derselbe Vertrag wie das gegen Postgres. */
class TestProtokoll implements LaufProtokoll {
  readonly laeufe: { id: string; job: string; schluessel: string | null;
                     ergebnis?: Ergebnis; fehler?: string | null }[] = [];
  readonly jeMandant: { laufId: string; mandantId: string; ergebnis: Ergebnis }[] = [];
  readonly erledigt = new Set<string>();

  neuerLauf(job: string, schluessel: string | null):
    Promise<{ laufId: string; bereitsErledigt: boolean }> {
    if (schluessel !== null && this.erledigt.has(`${job}:${schluessel}`)) {
      return Promise.resolve({ laufId: 'alt', bereitsErledigt: true });
    }
    const id = `l${this.laeufe.length + 1}`;
    this.laeufe.push({ id, job, schluessel });
    return Promise.resolve({ laufId: id, bereitsErledigt: false });
  }

  beendeLauf(laufId: string, ergebnis: Ergebnis, _k: Record<string, unknown>,
             fehlertext: string | null): Promise<void> {
    const l = this.laeufe.find((x) => x.id === laufId)!;
    l.ergebnis = ergebnis;
    l.fehler = fehlertext;
    if (ergebnis === 'erfolg' && l.schluessel !== null) {
      this.erledigt.add(`${l.job}:${l.schluessel}`);
    }
    return Promise.resolve();
  }

  ergebnisJeMandant(laufId: string, mandantId: string, ergebnis: Ergebnis): Promise<void> {
    this.jeMandant.push({ laufId, mandantId, ergebnis });
    return Promise.resolve();
  }
}

class TestAlarm implements Alarm {
  readonly meldungen: { job: string; fehler: string; versuche: number }[] = [];
  melde(job: string, _laufId: string, fehler: string, versuche: number): Promise<void> {
    this.meldungen.push({ job, fehler, versuche });
    return Promise.resolve();
  }
}

const sofort = (): Promise<void> => Promise.resolve();

function job(teil: Partial<JobDefinition> = {}): JobDefinition {
  return {
    schluessel: 'test_job', bezeichnung: 'Test', zeitplan: '0 3 * * *',
    bereich: 'plattform', versuche: 0,
    ausfuehren: () => Promise.resolve({ getan: 1 }),
    ...teil,
  };
}

beforeEach(leereRegister);

describe('(4) ein Job ohne erklaerten Mandantenbezug scheitert BEIM REGISTRIEREN', () => {
  it('nicht beim ersten Lauf um drei Uhr nachts', () => {
    expect(() => registriere(job({ bereich: undefined as never })))
      .toThrow(JobRegistrierungsFehler);
  });

  it('ein Zeitplan, der kein 5-Feld-Cron ist, ebenfalls', () => {
    expect(() => registriere(job({ zeitplan: 'taeglich' }))).toThrow(/5-Feld-Cron/u);
  });

  it('und ein Job, der ewig wiederholen wuerde', () => {
    // Ein Job, der ewig wiederholt, stirbt nicht — er faellt nur nie auf.
    expect(() => registriere(job({ versuche: 999 }))).toThrow(/versuche/u);
  });

  it('derselbe Schluessel zweimal ist ein Fehler, keine stille Ueberschreibung', () => {
    registriere(job());
    expect(() => registriere(job())).toThrow(/bereits registriert/u);
  });

  it('ein gueltiger Job landet im Register', () => {
    registriere(job({ bereich: 'uebergreifend' }));
    expect(jobs().map((j) => j.schluessel)).toEqual(['test_job']);
  });
});

describe('(2) ein scheiternder Job wiederholt, wird als fehler markiert und ALARMIERT', () => {
  it('kein stiller Tod', async () => {
    const protokoll = new TestProtokoll();
    const alarm = new TestAlarm();
    let versuche = 0;

    const ergebnis = await fuehreAus(
      job({ versuche: 2, ausfuehren: () => { versuche += 1; throw new Error('Netz weg'); } }),
      protokoll, alarm, { warte: sofort },
    );

    expect(versuche).toBe(3);                       // 1 + 2 Wiederholungen
    expect(ergebnis.ergebnis).toBe('fehler');
    expect(protokoll.laeufe[0]!.ergebnis).toBe('fehler');
    expect(protokoll.laeufe[0]!.fehler).toBe('Netz weg');
    // DIE Zusage: der Fehler erreicht jemanden.
    expect(alarm.meldungen).toHaveLength(1);
    expect(alarm.meldungen[0]!.versuche).toBe(3);
  });

  it('ein Job, der beim zweiten Versuch gelingt, gilt als Erfolg', async () => {
    const protokoll = new TestProtokoll();
    const alarm = new TestAlarm();
    let n = 0;
    const ergebnis = await fuehreAus(
      job({ versuche: 3, ausfuehren: () => {
        n += 1;
        if (n < 2) throw new Error('einmal daneben');
        return Promise.resolve({ n });
      } }),
      protokoll, alarm, { warte: sofort },
    );
    expect(ergebnis.ergebnis).toBe('erfolg');
    expect(ergebnis.versuche).toBe(2);
    expect(alarm.meldungen).toHaveLength(0);
  });

  it('der Backoff waechst exponentiell und ist gedeckelt', () => {
    expect(backoffMs(1)).toBe(1000);
    expect(backoffMs(2)).toBe(2000);
    expect(backoffMs(3)).toBe(4000);
    // Gedeckelt: ein Lauf soll nicht stundenlang haengen.
    expect(backoffMs(20)).toBe(60_000);
  });
});

describe('(3) derselbe Idempotenzschluessel: die Arbeit passiert EINMAL', () => {
  it('der zweite Lauf wird uebersprungen, nicht wiederholt', async () => {
    const protokoll = new TestProtokoll();
    const alarm = new TestAlarm();
    let getan = 0;
    const j = job({ ausfuehren: () => { getan += 1; return Promise.resolve({}); } });

    await fuehreAus(j, protokoll, alarm, { idempotenzSchluessel: '2026-09-08', warte: sofort });
    const zweiter = await fuehreAus(
      j, protokoll, alarm, { idempotenzSchluessel: '2026-09-08', warte: sofort },
    );

    // Ohne das erzeugt ein doppelt ausgeloester naechtlicher Lauf zwei
    // Mahnungen an denselben Kunden.
    expect(getan).toBe(1);
    expect(zweiter.uebersprungen).toBe(true);
    expect(protokoll.laeufe).toHaveLength(1);
  });

  it('ein anderer Schluessel laeuft wieder', async () => {
    const protokoll = new TestProtokoll();
    const alarm = new TestAlarm();
    let getan = 0;
    const j = job({ ausfuehren: () => { getan += 1; return Promise.resolve({}); } });
    await fuehreAus(j, protokoll, alarm, { idempotenzSchluessel: 'a', warte: sofort });
    await fuehreAus(j, protokoll, alarm, { idempotenzSchluessel: 'b', warte: sofort });
    expect(getan).toBe(2);
  });

  it('ohne Schluessel laeuft er jedes Mal — Idempotenz ist eine Zusage, keine Vorgabe', async () => {
    const protokoll = new TestProtokoll();
    const alarm = new TestAlarm();
    let getan = 0;
    const j = job({ ausfuehren: () => { getan += 1; return Promise.resolve({}); } });
    await fuehreAus(j, protokoll, alarm, { warte: sofort });
    await fuehreAus(j, protokoll, alarm, { warte: sofort });
    expect(getan).toBe(2);
  });
});

describe('(1) ein je_mandant-Job schreibt eine Zeile je beruehrtem Mandanten', () => {
  it('ein Lauf, vier Mandantenergebnisse', async () => {
    const protokoll = new TestProtokoll();
    const alarm = new TestAlarm();
    const gesehen: (string | null)[] = [];

    await fuehreAus(
      job({ bereich: 'je_mandant', ausfuehren: (k) => {
        gesehen.push(k.mandantId);
        return Promise.resolve({ verarbeitet: 3 });
      } }),
      protokoll, alarm, { mandanten: ['m1', 'm2', 'm3', 'm4'], warte: sofort },
    );

    expect(gesehen).toEqual(['m1', 'm2', 'm3', 'm4']);
    expect(protokoll.laeufe).toHaveLength(1);
    expect(protokoll.jeMandant).toHaveLength(4);
    expect(protokoll.laeufe[0]!.ergebnis).toBe('erfolg');
  });

  it('ein scheiternder Mandant beendet den Lauf fuer die anderen nicht', async () => {
    const protokoll = new TestProtokoll();
    const alarm = new TestAlarm();

    const ergebnis = await fuehreAus(
      job({ bereich: 'je_mandant', ausfuehren: (k) => {
        if (k.mandantId === 'm2') throw new Error('kaputt');
        return Promise.resolve({});
      } }),
      protokoll, alarm, { mandanten: ['m1', 'm2', 'm3'], warte: sofort },
    );

    // `teilweise` — und der Alarm geht trotzdem raus.
    expect(ergebnis.ergebnis).toBe('teilweise');
    expect(protokoll.jeMandant.filter((x) => x.ergebnis === 'fehler')).toHaveLength(1);
    expect(protokoll.jeMandant.filter((x) => x.ergebnis === 'erfolg')).toHaveLength(2);
    expect(alarm.meldungen).toHaveLength(1);
  });

  it('scheitern alle, ist der Lauf `fehler`, nicht `teilweise`', async () => {
    const protokoll = new TestProtokoll();
    const alarm = new TestAlarm();
    const ergebnis = await fuehreAus(
      job({ bereich: 'je_mandant', ausfuehren: () => { throw new Error('alle'); } }),
      protokoll, alarm, { mandanten: ['m1', 'm2'], warte: sofort },
    );
    expect(ergebnis.ergebnis).toBe('fehler');
  });
});
