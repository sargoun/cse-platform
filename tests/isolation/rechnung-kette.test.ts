/**
 * PR 46 — Abnahme (6): eine manipulierte Nutzlast lässt den nächtlichen Lauf
 * die ERSTE kaputte Rechnungsnummer benennen.
 *
 * Manipuliert wird hier UNTERHALB der Anwendungsschicht: mit
 * `session_replication_role = replica` feuert kein Auslöser mehr, und genau
 * das ist der Fall, gegen den die Kette geschrieben ist. Ein Test, der die
 * Manipulation über die Anwendung versucht, prüfte den Auslöser — den prüft
 * `rechnung.test.ts`. Hier geht es um das, was danach noch trägt.
 *
 * **Falsifizierbar:** ohne Manipulation meldet derselbe Lauf `ok`. Und dass er
 * das ERSTE kaputte Glied nennt und nicht irgendeines, wird mit zwei
 * gleichzeitigen Brüchen geprüft.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import { cent } from '../../src/server/services/finanz/geld.js';
import { milliMenge } from '../../src/server/services/finanz/menge.js';
import {
  fuegePositionHinzu, legeEntwurfAn, finalisiere, type Abfrage,
} from '../../src/server/services/finanz/rechnung.js';
import { meldung, pruefeKette } from '../../src/server/services/finanz/kettenlauf.js';
import { formatiereNummer } from '../../src/server/services/finanz/nummernkreis.js';

let f: Fixtur;
let benutzer: string;
let kunde: string;
let nummern: string[] = [];

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

beforeEach(async () => {
  f = await seed();
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ('kette@cse.test') returning id`,
  );
  benutzer = u!.id;
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [benutzer]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, globale_rolle_id)
     values ($1, 'kette@cse.test', 'Buchhaltung', 'aktiv',
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
     values ($1, 'K-1001', 'Bezirksamt Mitte', 'Karl-Marx-Allee', '31', '10178', 'Berlin')
     returning id`, [f.reinigung],
  );
  kunde = k!.id;

  nummern = [];
  for (let i = 0; i < 5; i += 1) {
    nummern.push(await alsApp(sitzung(), async (tx) => {
      const d = alsDienst(tx);
      const id = await legeEntwurfAn(d, {
        kundeId: kunde, leistungVon: '2026-08-01', leistungBis: '2026-08-31',
        zahlungszielTage: 30,
      });
      await fuegePositionHinzu(d, {
        rechnungId: id, bezeichnung: `Leistung ${String(i + 1)}`,
        menge: milliMenge(1000n), einheit: 'stk',
        einzelpreisCent: cent(BigInt(1000 + i)), steuergruppe: 'ust_19',
      });
      return (await finalisiere(d, id)).nummer;
    }));
  }
}, 120_000);

afterAll(schliessen);

describe('(6) der nächtliche Lauf benennt die erste kaputte Rechnungsnummer', () => {
  it('eine unversehrte Kette meldet `ok` — sonst prüfte alles Folgende nichts', async () => {
    const befund = await alsApp(sitzung(), (tx) => pruefeKette(alsDienst(tx)));
    expect(befund.ok).toBe(true);
    expect(befund.geprueft).toBe(5);
    expect(befund.ersterBruch).toBeNull();
    expect(meldung(befund)).toMatch(/5 Rechnungen, keine Abweichung/u);
  });

  it('eine manipulierte NUTZLAST wird an der zweiten Rechnung benannt', async () => {
    /**
     * Ein Byte in der abgelegten Nutzlast — nicht in der Zeile. Der
     * gespeicherte Kettenhash bleibt derselbe; was nicht mehr passt, ist
     * `nutzlast_sha256`, und genau das ist der Befund, den der Lauf melden
     * soll: die NUTZLAST wurde verändert, nicht die Verkettung.
     */
    await ohneAusloeser(
      `update rechnung_snapshot
          set nutzlast_bytes = (convert_from(nutzlast_bytes, 'UTF8') || ' ')::bytea
        where rechnung_id = (select id from rechnung where nummer = $1)`,
      [nummern[1]!],
    );

    const befund = await alsApp(sitzung(), (tx) => pruefeKette(alsDienst(tx)));
    expect(befund.ok).toBe(false);
    expect(befund.ersterBruch?.nummer).toBe(nummern[1]);
    expect(befund.ersterBruch?.grund).toBe('nutzlast_veraendert');
    expect(meldung(befund)).toMatch(new RegExp(`Rechnung ${nummern[1]!}`, 'u'));
  });

  it('und bei ZWEI Brüchen nennt er den ERSTEN — alles danach ist Folge', async () => {
    for (const i of [3, 1]) {
      await ohneAusloeser(
        `update rechnung_snapshot
            set nutzlast_bytes = (convert_from(nutzlast_bytes, 'UTF8') || ' ')::bytea
          where rechnung_id = (select id from rechnung where nummer = $1)`,
        [nummern[i]!],
      );
    }
    const befund = await alsApp(sitzung(), (tx) => pruefeKette(alsDienst(tx)));
    expect(befund.ersterBruch?.nummer).toBe(nummern[1]);
    // Eine Liste aus fünf Folgefehlern verdeckte die Ursache; deshalb genau
    // einer, und zwar der erste.
    expect(befund.ersterBruch?.position).toBe(2);
  });

  it('ein entferntes Kettenglied ist eine LÜCKE und wird als solche benannt', async () => {
    await ohneAusloeser(
      `delete from rechnung_hash
        where rechnung_id = (select id from rechnung where nummer = $1)`,
      [nummern[2]!],
    );
    const befund = await alsApp(sitzung(), (tx) => pruefeKette(alsDienst(tx)));
    expect(befund.ok).toBe(false);
    expect(befund.ersterBruch?.grund).toBe('position_luecke');
    // Position 3 fehlt, also stolpert der Lauf an der Stelle, an der jetzt die
    // vierte Rechnung steht.
    expect(befund.ersterBruch?.nummer).toBe(nummern[3]);
  });

  it('ein verstellter Hash bricht die VERKETTUNG, nicht die Nutzlast', async () => {
    await ohneAusloeser(
      `update rechnung_hash set hash = repeat('b', 64)
        where rechnung_id = (select id from rechnung where nummer = $1)`,
      [nummern[0]!],
    );
    const befund = await alsApp(sitzung(), (tx) => pruefeKette(alsDienst(tx)));
    expect(befund.ersterBruch?.nummer).toBe(nummern[0]);
    expect(befund.ersterBruch?.grund).toBe('hash_falsch');
  });

  /**
   * Schritt 4 des §5.7: eine Änderung, die an den Auslösern VORBEI in die
   * Zeile gelangt ist. Der Hash bliebe gültig — er bezeugt den Snapshot, nicht
   * die Zeile —, und ohne diese Prüfung meldete der Lauf „intakt" über eine
   * Rechnung, deren Bruttobetrag nicht mehr der ist, der ausgestellt wurde.
   */
  it('ein an den Auslösern vorbei geänderter KOPF wird bemerkt', async () => {
    /**
     * Die drei Cent-Spalten zusammen, weil `rechnung_brutto_stimmig` und
     * `rechnung_zahlbetrag_stimmig` CHECKS sind und kein
     * `session_replication_role` sie abschaltet. Das ist auch der Punkt: die
     * Zeile bleibt in sich stimmig und WIRKT unverdächtig — nur der
     * Snapshot sagt etwas anderes.
     */
    await ohneAusloeser(
      `update rechnung set netto_gesamt_cent = netto_gesamt_cent + 1,
              brutto_cent = brutto_cent + 1, zahlbetrag_cent = zahlbetrag_cent + 1
        where nummer = $1`, [nummern[3]!],
    );
    const befund = await alsApp(sitzung(), (tx) => pruefeKette(alsDienst(tx)));
    expect(befund.ok).toBe(false);
    expect(befund.ersterBruch?.nummer).toBe(nummern[3]);
    expect(befund.ersterBruch?.grund).toBe('kopf_weicht_ab');
  });

  it('eine festgeschriebene Rechnung ohne Kettenglied wird namentlich gemeldet', async () => {
    await ohneAusloeser(
      `delete from rechnung_hash
        where rechnung_id = (select id from rechnung where nummer = $1)`,
      [nummern[4]!],
    );
    const befund = await alsApp(sitzung(), (tx) => pruefeKette(alsDienst(tx)));
    expect(befund.ok).toBe(false);
    expect(befund.ersterBruch?.nummer).toBe(nummern[4]);
    expect(befund.ersterBruch?.grund).toBe('ohne_kettenglied');
  });

  it('der Lauf SCHREIBT nichts — ein Prüfer, der repariert, bezeugt nichts mehr', async () => {
    await ohneAusloeser(
      `update rechnung_hash set hash = repeat('c', 64)
        where rechnung_id = (select id from rechnung where nummer = $1)`,
      [nummern[0]!],
    );
    await alsApp(sitzung(), (tx) => pruefeKette(alsDienst(tx)));
    const [z] = await sql.unsafe<{ hash: string }[]>(
      `select h.hash from rechnung_hash h join rechnung r on r.id = h.rechnung_id
        where r.nummer = $1`, [nummern[0]!],
    );
    expect(z!.hash).toBe('c'.repeat(64));
  });

  it('und `cse_job` hält auf keiner der beiden Kettentabellen ein Schreibrecht', async () => {
    const rechte = await sql.unsafe<{ table_name: string }[]>(
      `select table_name from information_schema.table_privileges
        where grantee = 'cse_job'
          and table_name in ('rechnung_snapshot','rechnung_hash')
          and privilege_type <> 'SELECT'`,
    );
    expect(rechte).toEqual([]);
  });
});

describe('Die Kette beginnt mit 64 Nullen und hängt Glied an Glied (§5.4)', () => {
  it('das erste Glied trägt den Genesis, jedes weitere den Hash seines Vorgängers', async () => {
    const kette = await sql.unsafe<{ vorheriger_hash: string; hash: string }[]>(
      `select h.vorheriger_hash, h.hash from rechnung_hash h
        where h.mandant_id = $1 order by h.kette_position`, [f.reinigung],
    );
    expect(kette[0]!.vorheriger_hash).toBe('0'.repeat(64));
    for (let i = 1; i < kette.length; i += 1) {
      expect(kette[i]!.vorheriger_hash).toBe(kette[i - 1]!.hash);
    }
  });

  it('und `nummernkreis.letzter_hash` ist der Kopf des letzten Gliedes', async () => {
    const [kopf] = await sql.unsafe<{ letzter_hash: string }[]>(
      `select letzter_hash from nummernkreis
        where mandant_id = $1 and kreis_typ = 'ausgangsrechnung'`, [f.reinigung],
    );
    const [letzte] = await sql.unsafe<{ hash: string }[]>(
      `select h.hash from rechnung_hash h where h.mandant_id = $1
        order by h.kette_position desc limit 1`, [f.reinigung],
    );
    expect(kopf!.letzter_hash).toBe(letzte!.hash);
  });
});

/**
 * Die Maske wird an ZWEI Stellen aufgelöst — in SQL (der Zug läuft unter der
 * Zeilensperre) und in TypeScript (die übrigen fünf Kreistypen zieht die
 * Anwendung). Zwei Fassungen, die niemand vergleicht, sind zwei
 * Rechnungsnummernformate; also werden sie hier gegen dieselben Vektoren
 * geprüft.
 */
describe('SQL und TypeScript lösen dieselbe Maske gleich auf', () => {
  const vektoren: readonly (readonly [string, number, number, string])[] = [
    ['RE-{jahr}-{nr:5}', 42, 2026, 'RE-2026-00042'],
    ['RE-{nr:5}', 1, 0, 'RE-00001'],
    ['LN-{nr:3}', 7, 0, 'LN-007'],
    ['{nr}', 1234, 0, '1234'],
    ['RE-{jahr}-{nr}', 9, 2027, 'RE-2027-9'],
  ];

  it.each(vektoren)('%s / %i / %i → %s', async (maske, nummer, jahr, erwartet) => {
    expect(formatiereNummer(maske, nummer, jahr)).toBe(erwartet);
    const [z] = await sql.unsafe<{ t: string }[]>(
      `select fin.nummer_formatieren($1, $2::bigint, $3::integer) as t`,
      [maske, nummer, jahr],
    );
    expect(z!.t).toBe(erwartet);
  });

  it('beide verweigern `{jahr}` in einem fortlaufenden Kreis', async () => {
    expect(() => formatiereNummer('RE-{jahr}-{nr:5}', 1, 0)).toThrow(/fortlaufend/u);
    await expect(sql.unsafe(
      `select fin.nummer_formatieren('RE-{jahr}-{nr:5}', 1::bigint, 0::integer)`,
    )).rejects.toThrow(/fortlaufend/u);
  });

  it('und beide eine Maske ohne {nr}', async () => {
    expect(() => formatiereNummer('RE-{jahr}', 1, 2026)).toThrow(/kein \{nr\}/u);
    await expect(sql.unsafe(
      `select fin.nummer_formatieren('RE-{jahr}', 1::bigint, 2026::integer)`,
    )).rejects.toThrow(/kein \{nr\}/u);
  });

  it('und beide einen unbekannten Platzhalter', async () => {
    expect(() => formatiereNummer('RE-{monat}-{nr:5}', 1, 2026)).toThrow(/\{monat\}/u);
    await expect(sql.unsafe(
      `select fin.nummer_formatieren('RE-{monat}-{nr:5}', 1::bigint, 2026::integer)`,
    )).rejects.toThrow(/unbekannter Platzhalter/u);
  });
});
