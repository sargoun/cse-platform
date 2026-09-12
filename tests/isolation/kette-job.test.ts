/**
 * Der Kettenprüfer auf dem Weg, den er nachts wirklich nimmt.
 *
 * **Warum es diese Datei zusätzlich zu `rechnung-kette.test.ts` gibt.** Jene
 * prüft `pruefeKette` als `cse_app`, aus einer Portalsitzung heraus — und der
 * Dienst war damit seit PR 46 grün. Nachts läuft er aber nicht so: er läuft
 * als Job, ohne Benutzer, ohne Portalsitzung, unter `cse_job`. Auf diesem Weg
 * war er nie gelaufen, und auf diesem Weg fehlten ihm die Leserechte auf
 * `nummernkreis` und `rechnung` (0108).
 *
 * Was ohne diese Datei passiert wäre, ist die teuerste Sorte Ausfall: keine
 * Fehlermeldung, sondern eine LEERE Prüfung. Die Kreisabfrage hätte null
 * Zeilen geliefert, die Schleife darunter wäre nie gelaufen, und der Lauf
 * hätte jede Nacht „0 Rechnungen, keine Abweichung" gemeldet. Eine grüne
 * Meldung, die nichts gesehen hat, ist schlimmer als gar keine — sie ersetzt
 * Aufmerksamkeit durch Vertrauen.
 *
 * Deshalb steht hier überall `geprueft` in der Zusicherung und nicht nur `ok`.
 * `ok === true` ist genau das, was eine blinde Prüfung auch meldet.
 *
 * **Falsifizierbar:** der dritte Fall nimmt dem Lauf die Bindung weg und
 * zeigt, dass er dann NICHTS sieht — die Policy aus 0108 ist an
 * `app.aktiver_mandant()` gebunden, der Binder trägt also, statt daneben zu
 * stehen.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, alsRolle, schliessen, seed, sql, type Fixtur } from './harness.js';
import { cent } from '../../src/server/services/finanz/geld.js';
import { milliMenge } from '../../src/server/services/finanz/menge.js';
import {
  fuegePositionHinzu, legeEntwurfAn, finalisiere, vonHand, type Abfrage,
} from '../../src/server/services/finanz/rechnung.js';
import { pruefeKette } from '../../src/server/services/finanz/kettenlauf.js';
import { alsJobSitzung } from '../../src/server/jobs/sitzung.js';
import { KetteGebrochen, registriereKettenpruefer } from '../../src/server/jobs/kettenpruefer.js';
import { leereRegister, type JobDefinition } from '../../src/server/jobs/registry.js';

let f: Fixtur;
let benutzer: string;
let nummern: string[] = [];
let job: JobDefinition;

function alsDienst(tx: postgres.TransactionSql): Abfrage {
  return {
    abfrage: async <T,>(anweisung: string, werte: readonly unknown[] = []) =>
      (await tx.unsafe(anweisung, werte as never[])) as readonly T[],
  };
}

function sitzung() {
  return {
    scope: 'mandant' as const, mandantId: f.reinigung, benutzerId: benutzer,
    portal: 'intern' as const, readonly: false,
  };
}

/** Der Eingriff unter der Anwendung: kein Auslöser feuert. */
async function ohneAusloeser(anweisung: string, werte: readonly unknown[]): Promise<void> {
  await sql.begin(async (tx) => {
    await tx.unsafe(`set local session_replication_role = replica`);
    await tx.unsafe(anweisung, werte as never[]);
  });
}

beforeAll(async () => {
  f = await seed();
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ('kettenjob@cse.test') returning id`,
  );
  benutzer = u!.id;
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [benutzer]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, globale_rolle_id)
     values ($1, 'kettenjob@cse.test', 'Buchhaltung', 'aktiv',
             (select id from rolle where schluessel = 'super_admin' and mandant_id is null))`,
    [benutzer],
  );
  await sql.unsafe(
    `update mandant set ist_rechtseinheit = true, eigener_nummernkreis = true,
            strasse = 'Kurfürstendamm 21', plz = '10719', ort = 'Berlin',
            ust_id = 'DE123456789'
      where id = $1`, [f.reinigung],
  );
  await sql.unsafe(
    `insert into nummernkreis
       (mandant_id, kreis_typ, kontext_id, jahr, bezeichnung, lueckenlos, format_maske,
        zuruecksetzung, geoeffnet_am, ist_platzhalter, erstellt_von_art, erstellt_von_dienst)
     values ($1, 'ausgangsrechnung', null, 0, 'Rechnungen', true, 'RE-{nr:5}', 'nie',
             '2026-01-01', false, 'system', 'job:test')`,
    [f.reinigung],
  );
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, strasse, hausnummer, plz, ort)
     values ($1, 'K-2001', 'Bezirksamt Mitte', 'Karl-Marx-Allee', '31', '10178', 'Berlin')
     returning id`, [f.reinigung],
  );

  nummern = [];
  for (let i = 0; i < 3; i += 1) {
    nummern.push(await alsApp(sitzung(), async (tx) => {
      const d = alsDienst(tx);
      const id = await legeEntwurfAn(d, {
        kundeId: k!.id, leistungVon: '2026-08-01', leistungBis: '2026-08-31',
        zahlungszielTage: 30,
      });
      await fuegePositionHinzu(d, {
        rechnungId: id, bezeichnung: `Leistung ${String(i + 1)}`,
        menge: milliMenge(1000n), einheit: 'stk',
        einzelpreisCent: cent(BigInt(2000 + i)), steuergruppe: 'ust_19',
        quellen: vonHand('Testfixtur ohne Beleg — von Hand erfasst'),
      });
      return (await finalisiere(d, id)).nummer;
    }));
  }

  leereRegister();
  job = registriereKettenpruefer(sql);
}, 180_000);

afterAll(async () => {
  leereRegister();
  await schliessen();
});

describe('der Kettenprüfer läuft als JOB — nicht als Portalsitzung', () => {
  it('sieht unter `cse_job` alle drei Rechnungen, nicht null', async () => {
    const kennzahlen = await job.ausfuehren({
      mandantId: f.reinigung, laufId: 'test-lauf', versuch: 1,
    });
    // `geprueft` ist die Zusicherung, nicht `ok`: ein blinder Lauf meldet
    // ebenfalls „keine Abweichung", nur eben über nichts.
    expect(kennzahlen['geprueft']).toBe(3);
    expect(kennzahlen['kreise']).toBe(1);
    expect(String(kennzahlen['meldung'])).toMatch(/3 Rechnungen, keine Abweichung/u);
  });

  it('läuft wirklich unter `cse_job` und nicht unter der Verbindungsrolle', async () => {
    const rolle = await alsJobSitzung(sql, f.reinigung, async (db) => {
      const z = await db.abfrage<{ rolle: string }>('select current_user as rolle');
      return z[0]?.rolle;
    });
    expect(rolle).toBe('cse_job');
  });

  it('ohne Bindung sieht derselbe Lauf NICHTS — die Policy hängt am Mandanten', async () => {
    /*
     * Genau der Zustand, in dem der Prüfer vor 0108 registriert worden wäre:
     * richtige Rolle, keine Sitzung. `app.aktiver_mandant()` ist dann NULL,
     * `mandant_id = NULL` liefert keine Zeile — der Lauf meldet „ok" über
     * null Rechnungen. Diese Prüfung hält fest, dass das UNTERSCHEIDBAR ist.
     */
    const befund = await alsRolle('cse_job', (tx) => pruefeKette(alsDienst(tx)));
    expect(befund.ok).toBe(true);
    expect(befund.geprueft).toBe(0);
    expect(befund.kreise).toHaveLength(0);
  });

  it('ein Bruch lässt den Job werfen und benennt die Rechnungsnummer', async () => {
    await ohneAusloeser(
      `update rechnung_snapshot
          set nutzlast_bytes = (convert_from(nutzlast_bytes, 'UTF8') || ' ')::bytea
        where rechnung_id = (select id from rechnung where nummer = $1)`,
      [nummern[1]!],
    );

    await expect(job.ausfuehren({
      mandantId: f.reinigung, laufId: 'test-lauf-2', versuch: 1,
    })).rejects.toThrow(KetteGebrochen);

    // Und die Meldung nennt die Nummer — ein Alarm ohne sie ist keiner.
    await expect(job.ausfuehren({
      mandantId: f.reinigung, laufId: 'test-lauf-3', versuch: 1,
    })).rejects.toThrow(new RegExp(`Rechnung ${nummern[1]!}`, 'u'));
  });

  it('und der Job ist als `je_mandant` deklariert, ohne Wiederholung', () => {
    expect(job.bereich).toBe('je_mandant');
    // Ein gebrochener Hash wird beim zweiten Hinsehen nicht heil.
    expect(job.versuche).toBe(0);
  });
});
