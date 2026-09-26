/**
 * Eine Korrektur an einem GESPERRTEN Monat findet ihre Gegenbuchung
 * (V-065, EMP-04, TIM-11, §12.2).
 *
 * **Der Befund, den diese Datei festnagelt.** `bucheKorrektur` hatte im
 * ganzen Baum keinen einzigen Aufrufer. Der Auslöser
 * `kern.korrektur_sperre_ausgleich` weist eine Korrektur an einem gesperrten
 * Zeiteintrag ab, solange `ausgleich_bewegung_id` fehlt — mit genau dem
 * richtigen Satz: „Eine Korrektur ohne Gegenbuchung verschöbe die Differenz
 * ins Nichts." Nur konnte ihn niemand befolgen.
 *
 * Damit war **jede** Korrektur an einem abgeschlossenen Monat unmöglich — und
 * das ist der häufigste Fall, weil eine falsche Stunde meistens auffällt,
 * wenn der Lohn da ist.
 *
 * Geprüft wird: dass die Buchung entsteht, dass sie die RICHTIGE Differenz
 * trägt, dass sie im ersten OFFENEN Monat landet (nicht im gesperrten), dass
 * sie den gesperrten Monat benennt — und dass ein offener Monat weiterhin
 * OHNE Gegenbuchung auskommt.
 */
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { LeseKontext, SchreibKontext } from '../../src/server/kontext/index.js';
import { korrigiereZeiteintrag } from '../../src/server/services/zeit/korrektur.js';

let f: Fixtur;
let planer = '';

const zufall = (): string => String(Math.random()).slice(2, 10);

function kontextAus(tx: postgres.TransactionSql): SchreibKontext {
  const fuehre = async <T>(q: string, w?: readonly unknown[]): Promise<readonly T[]> =>
    tx.unsafe(q, (w ?? []) as never[]) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId: planer,
    aktiverMandantId: f.reinigung, mandantIds: [f.reinigung],
    abfrage: fuehre, schreibe: fuehre,
  } satisfies LeseKontext & SchreibKontext;
}

const als = <T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> =>
  alsApp({ scope: 'mandant', mandantId: f.reinigung, benutzerId: planer,
           portal: 'intern', readonly: false }, fn);

beforeAll(async () => {
  f = await seed();
  const email = `zeitkorrektur-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  planer = u!.id;
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [planer]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, globale_rolle_id)
     values ($1,$2,'Zeitkorrektur','aktiv',
             (select id from rolle where schluessel='super_admin' and mandant_id is null))`,
    [planer, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1,$2,(select id from rolle where schluessel='admin' and mandant_id is null),true)`,
    [planer, f.reinigung]);
});
afterAll(schliessen);

/**
 * Ein abgeschlossener Eintrag von 8 Stunden am 11. März des gegebenen Jahres.
 *
 * **Jede Prüfung bekommt ihr EIGENES Jahr, statt hinterher aufzuräumen.**
 * `stundenkonto` und `stundenkonto_bewegung` stehen unter Löschsperre
 * (Invariante 8, K-16) — ein `delete` zwischen zwei Fällen wirft. Das ist
 * richtig so, und die Prüfung richtet sich danach.
 */
async function eintrag(jahr: number, gesperrt: boolean): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into zeiteintrag
       (mandant_id, anstellung_id, person_id, beginn_zeitpunkt, ende_zeitpunkt,
        pause_minuten, erfassungsart_beginn, erfassungsart_ende,
        quelle_beginn, quelle_ende, status, erstellt_von_art)
     values ($1,$2,$3,
             ($4 || '-03-11T06:00:00Z')::timestamptz,
             ($4 || '-03-11T14:00:00Z')::timestamptz, 0,
             'import','import','import','import','abgeschlossen','system')
     returning id`,
    [f.reinigung, f.jonasReinigung, f.jonas, String(jahr)] as never[]);
  if (gesperrt) {
    await sql.unsafe(`update zeiteintrag set gesperrt_am = now() where id = $1`, [z!.id]);
  }
  return z!.id;
}

/** Zwei Konten des Jahres — der März gesperrt oder offen, der April offen. */
async function konten(jahr: number, maerzGesperrt = true): Promise<void> {
  await sql.unsafe(
    /* `saldo_minuten` ist eine GENERIERTE Spalte — sie nimmt keinen Wert an. */
    `insert into stundenkonto (mandant_id, anstellung_id, jahr, monat,
                               status, gesperrt_am, gesperrt_von)
     values ($1,$2,$4,3, case when $5 then 'gesperrt' else 'offen' end::stundenkonto_status,
             case when $5 then now() else null end,
             case when $5 then $3::uuid else null end),
            ($1,$2,$4,4,'offen',null,null)`,
    [f.reinigung, f.jonasReinigung, planer, jahr, maerzGesperrt] as never[]);
}

async function bewegungen(jahr: number): Promise<readonly {
  minuten: number; jahr: number; monat: number; art: string;
  korrektur_fuer_stundenkonto_id: string | null; begruendung: string | null;
}[]> {
  return sql.unsafe(
    `select b.minuten, k.jahr, k.monat, b.art::text as art,
            b.korrektur_fuer_stundenkonto_id, b.begruendung
       from stundenkonto_bewegung b
       join stundenkonto k on k.id = b.stundenkonto_id
      where k.anstellung_id = $1 and k.jahr = $2
      order by b.erstellt_am`, [f.jonasReinigung, jahr]) as never;
}

describe('§1 ein GESPERRTER Monat bekommt seine Gegenbuchung', () => {
  it('bucht die Differenz in den ersten OFFENEN Monat', async () => {
    await konten(2031);
    const id = await eintrag(2031, true);
    /* Aus 8 Stunden werden 9 — eine Stunde mehr, also +60 Minuten. */
    await als((tx) => korrigiereZeiteintrag(kontextAus(tx), {
      zeiteintragId: id, art: 'zeit_korrektur', grundKategorie: 'vergessen_auszustempeln',
      begruendung: 'Eine Stunde Übergabe war nicht erfasst.',
      durchgefuehrtVon: planer,
      endeZeitpunkt: new Date('2031-03-11T15:00:00Z'),
    }));

    const b = (await bewegungen(2031)).filter((x) => x.art === 'korrektur');
    expect(b.length).toBe(1);
    expect(Number(b[0]!.minuten)).toBe(60);
    /* Der gesperrte Maerz bleibt gesperrt; gebucht wird im April. */
    expect(b[0]!.jahr).toBe(2031);
    expect(b[0]!.monat).toBe(4);
    /* Und die Zeile sagt, WELCHEN Monat sie ausgleicht. */
    expect(b[0]!.korrektur_fuer_stundenkonto_id).not.toBeNull();
  });

  it('bucht beim STORNO die ganze Zeit mit umgekehrtem Vorzeichen', async () => {
    await konten(2032);
    const id = await eintrag(2032, true);
    await als((tx) => korrigiereZeiteintrag(kontextAus(tx), {
      zeiteintragId: id, art: 'storno', grundKategorie: 'sonstiges',
      begruendung: 'Der Eintrag stand doppelt im Buch.',
      durchgefuehrtVon: planer,
    }));
    const b = (await bewegungen(2032)).filter((x) => x.art === 'korrektur');
    expect(b.length).toBe(1);
    expect(Number(b[0]!.minuten)).toBe(-480);
  });

  it('trägt die Begründung der Korrektur in die Buchung', async () => {
    await konten(2033);
    const id = await eintrag(2033, true);
    const grund = 'Pause war 30 Minuten, nicht null.';
    await als((tx) => korrigiereZeiteintrag(kontextAus(tx), {
      zeiteintragId: id, art: 'pause_korrektur', grundKategorie: 'sonstiges',
      begruendung: grund, durchgefuehrtVon: planer, pauseMinuten: 30,
    }));
    const b = (await bewegungen(2033)).filter((x) => x.art === 'korrektur');
    expect(b[0]!.begruendung).toBe(grund);
    expect(Number(b[0]!.minuten)).toBe(-30);
  });
});

describe('§2 ein OFFENER Monat braucht keine', () => {
  it('korrigiert ohne jede Gegenbuchung', async () => {
    await konten(2034, false);
    const id = await eintrag(2034, false);
    await als((tx) => korrigiereZeiteintrag(kontextAus(tx), {
      zeiteintragId: id, art: 'zeit_korrektur', grundKategorie: 'vergessen_auszustempeln',
      begruendung: 'Eine Stunde Übergabe war nicht erfasst.',
      durchgefuehrtVon: planer,
      endeZeitpunkt: new Date('2034-03-11T15:00:00Z'),
    }));
    /*
     * Kein Ausgleich, weil nichts auszugleichen ist: die Stunde landet ueber
     * den gewoehnlichen Weg im Monat, in dem sie gearbeitet wurde.
     */
    expect((await bewegungen(2034)).filter((x) => x.art === 'korrektur')).toEqual([]);
  });
});
