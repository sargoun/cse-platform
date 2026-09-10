/**
 * Die Arbeitszeitpruefung ueber Gesellschaftsgrenzen — PR 32, das
 * Abnahmekriterium der ROADMAP fuer Phase 5, auf Datenbankebene.
 *
 * **Der Fall:** ein Mensch reinigt sechs Stunden fuer die eine Gesellschaft
 * und bewacht fuenf fuer die andere. Das sind elf Stunden an einem Tag. Die
 * Zeilen liegen in zwei Mandanten, und die naheliegende Abfrage findet unter
 * RLS nur sechs — sie schliesst „kein Verstoss" und besteht damit immer.
 *
 * Dieser Test ist die Gegenprobe. Er prueft nicht nur, dass der Verstoss
 * gefunden wird, sondern auch, **wie wenig** dabei ueber die andere
 * Gesellschaft herauskommt: Dauern und Grenzen, kein Mandant, kein Objekt,
 * kein Kunde, kein Lohn (K-06).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur, type Sitzung } from './harness.js';
import { pruefeEinsatz, leseBelastung } from '../../src/server/services/arbzg/pruefung.js';

let f: Fixtur;
const zufall = (): string => String(Math.random()).slice(2, 10);

/** Ein Tag in der Zukunft — der Detektor liest, was geplant ist. */
const TAG = '2028-05-15';

async function objektMit(mandant: string): Promise<{ objekt: string; kunde: string }> {
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name)
     values ($1, $2, 'ArbZG-Testkunde') returning id`, [mandant, `K-${zufall()}`]);
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
     values ($1, $2, $3, 'ArbZG-Testobjekt', 'Teststr.', '10115', 'Berlin') returning id`,
    [mandant, k!.id, `O-${zufall()}`]);
  return { objekt: o!.id, kunde: k!.id };
}

/** Eine geplante Schicht MIT Besetzung — nur die erzeugt ein Fenster. */
async function schichtMit(
  mandant: string, anstellung: string, person: string,
  datum: string, von: string, bis: string, folgetag = false,
): Promise<string> {
  const { objekt, kunde } = await objektMit(mandant);
  const [e] = await sql.unsafe<{ id: string }[]>(
    `insert into einsatz (mandant_id, quelle, quell_schluessel, plan_datum,
                          beginn_zeitpunkt, ende_zeitpunkt, zeitzone,
                          beginn_lokal, ende_lokal, endet_am_folgetag,
                          objekt_id, kunde_id, soll_besetzung, min_besetzung,
                          erstellt_von_art, status)
     values ($1, 'manuell', $2, $3::date,
             (select zeitpunkt from app.loese_ortszeit($3::date, $4::time, 'Europe/Berlin')),
             (select zeitpunkt from app.loese_ortszeit(
                ($3::date + case when $6 then 1 else 0 end), $5::time, 'Europe/Berlin')),
             'Europe/Berlin', $4::time, $5::time, $6,
             $7, $8, 1, 1, 'system', 'geplant')
     returning id`,
    [mandant, `arbzg:${zufall()}`, datum, von, bis, folgetag, objekt, kunde],
  );
  await sql.unsafe(
    `insert into einsatz_zuordnung (mandant_id, einsatz_id, anstellung_id, person_id,
                                    beginn_zeitpunkt, ende_zeitpunkt, erstellt_von_art)
     select $1, $2, $3, $4, beginn_zeitpunkt, ende_zeitpunkt, 'system'
       from einsatz where id = $2`,
    [mandant, e!.id, anstellung, person],
  );
  return e!.id;
}

/** Die Sitzung einer Planerin im Reinigungsmandanten, mit dem Pruefrecht. */
async function planerin(mandant: string): Promise<Sitzung> {
  const email = `planerin-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`, [u!.id, email]);
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = 'admin' and mandant_id is null`);
  // `benutzer_mandant` hat keinen Status — eine Mitgliedschaft endet ueber
  // `entzogen_am`/`gueltig_bis`, nicht ueber ein Statuswort. Das ist der
  // Unterschied zwischen „war einmal zustaendig" und „ist es nie gewesen".
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1,$2,$3,true)`, [u!.id, mandant, r!.id]);
  return {
    scope: 'mandant', mandantId: mandant, mandantIds: [mandant],
    benutzerId: u!.id, readonly: false, portal: 'intern',
  };
}

beforeEach(async () => { f = await seed(); });
afterAll(async () => { await schliessen(); });

describe('(1) sechs Stunden reinigen plus fuenf bewachen sind elf Stunden', () => {
  it('und werden als 8h- UND als 10h-Ueberschreitung erkannt (660 Minuten)', async () => {
    await schichtMit(f.reinigung, f.fatimaReinigung, f.fatima, TAG, '06:00', '12:00');
    await schichtMit(f.security, f.fatimaSecurity, f.fatima, TAG, '13:00', '18:00');

    const sitzung = await planerin(f.reinigung);
    const ergebnis = await alsApp(sitzung, async (tx) =>
      pruefeEinsatz(tx, f.fatima,
        new Date(`${TAG}T04:00:00Z`), new Date(`${TAG}T16:00:00Z`)));

    const regeln = ergebnis.befunde.map((b) => b.regel);
    expect(regeln).toContain('tagesarbeitszeit_ueber_8h');
    expect(regeln).toContain('tagesarbeitszeit_ueber_10h');
    const zehn = ergebnis.befunde.find((b) => b.regel === 'tagesarbeitszeit_ueber_10h');
    expect(zehn?.minuten, '6 h + 5 h auf dem Berliner Kalendertag').toBe(660);
    expect(ergebnis.ueberGesellschaften).toBe(true);
  });

  it('KONTROLLE: dieselbe Person mit NUR der Reinigungsschicht ist sauber', async () => {
    await schichtMit(f.reinigung, f.fatimaReinigung, f.fatima, TAG, '06:00', '12:00');

    const sitzung = await planerin(f.reinigung);
    const ergebnis = await alsApp(sitzung, async (tx) =>
      pruefeEinsatz(tx, f.fatima,
        new Date(`${TAG}T04:00:00Z`), new Date(`${TAG}T16:00:00Z`)));

    expect(ergebnis.befunde).toEqual([]);
    expect(ergebnis.ueberGesellschaften).toBe(false);
  });
});

describe('(2) 23:00 hier, 07:00 dort — die Ruhezeit ist zu kurz', () => {
  it('§ 5 ArbZG greift ueber die Gesellschaftsgrenze', async () => {
    await schichtMit(f.reinigung, f.fatimaReinigung, f.fatima, TAG, '15:00', '23:00');
    await schichtMit(f.security, f.fatimaSecurity, f.fatima, '2028-05-16', '07:00', '12:00');

    const sitzung = await planerin(f.reinigung);
    const ergebnis = await alsApp(sitzung, async (tx) =>
      pruefeEinsatz(tx, f.fatima,
        new Date(`${TAG}T12:00:00Z`), new Date('2028-05-16T12:00:00Z')));

    const ruhe = ergebnis.befunde.find((b) => b.regel === 'ruhezeit_unter_11h');
    expect(ruhe, 'acht Stunden Ruhe statt elf').toBeDefined();
    expect(ruhe?.minuten).toBe(8 * 60);
  });
});

describe('(3) was der Leser NICHT zurueckgibt — Feld fuer Feld', () => {
  it('Dauern und Grenzen, sonst nichts (K-06)', async () => {
    await schichtMit(f.reinigung, f.fatimaReinigung, f.fatima, TAG, '06:00', '12:00');
    await schichtMit(f.security, f.fatimaSecurity, f.fatima, TAG, '13:00', '18:00');

    const sitzung = await planerin(f.reinigung);
    const roh = await alsApp(sitzung, async (tx) =>
      tx.unsafe(
        `select * from app.arbzg_belastung($1, $2::timestamptz, $3::timestamptz)`,
        [f.fatima, `${TAG}T00:00:00Z`, `${TAG}T23:59:00Z`],
      ));

    expect(roh.length).toBeGreaterThan(0);
    const felder = Object.keys(roh[0] as Record<string, unknown>).sort();
    // Die vollstaendige Liste, nicht eine Auswahl: ein spaeter hinzugefuegtes
    // Feld faellt hier auf, statt unbemerkt eine Kennung mitzuliefern.
    expect(felder).toEqual(['beginn_utc', 'ende_utc', 'fenster_gruppe', 'fremd', 'minuten']);
    for (const verboten of ['mandant_id', 'objekt_id', 'kunde_id', 'anstellung_id',
      'personalnummer', 'stundensatz_intern', 'bezeichnung', 'name']) {
      expect(felder, `${verboten} darf nicht herauskommen`).not.toContain(verboten);
    }
    // Und die Gruppe ist ein Hash, keine UUID der Quelle.
    const gruppen = (roh as Record<string, unknown>[]).map((z) => String(z['fenster_gruppe']));
    expect(gruppen.every((g) => !/^[0-9a-f]{8}-[0-9a-f]{4}-/u.test(g))).toBe(true);
  });

  it('das fremde Fenster ist als fremd markiert — mehr erfaehrt die Planerin nicht', async () => {
    await schichtMit(f.reinigung, f.fatimaReinigung, f.fatima, TAG, '06:00', '12:00');
    await schichtMit(f.security, f.fatimaSecurity, f.fatima, TAG, '13:00', '18:00');
    const sitzung = await planerin(f.reinigung);
    const fenster = await alsApp(sitzung, async (tx) =>
      leseBelastung(tx, f.fatima, new Date(`${TAG}T00:00:00Z`), new Date(`${TAG}T23:00:00Z`)));
    expect(fenster.filter((x) => x.fremd)).toHaveLength(1);
    expect(fenster.filter((x) => !x.fremd)).toHaveLength(1);
    expect(fenster.find((x) => x.fremd)?.minuten).toBe(300);
  });
});

describe('(4) zwei Schichten zur selben Zeit auf EINER Anstellung', () => {
  it('werden als Ueberschneidung sichtbar', async () => {
    await schichtMit(f.reinigung, f.fatimaReinigung, f.fatima, TAG, '06:00', '12:00');
    await schichtMit(f.reinigung, f.fatimaReinigung, f.fatima, TAG, '08:00', '14:00');

    const sitzung = await planerin(f.reinigung);
    const fenster = await alsApp(sitzung, async (tx) =>
      leseBelastung(tx, f.fatima, new Date(`${TAG}T00:00:00Z`), new Date(`${TAG}T23:00:00Z`)));

    // Zwei Fenster, und sie ueberlappen — das ist der Befund, den TIM-05
    // meint. Verhindert wird die Ueberschneidung NICHT (TIM-04 verlangt, dass
    // sie moeglich bleibt), sie wird erkannt.
    expect(fenster).toHaveLength(2);
    const [a, b] = [...fenster].sort((x, y) => x.beginn.getTime() - y.beginn.getTime());
    expect(b!.beginn.getTime()).toBeLessThan((a!.ende ?? a!.beginn).getTime());
  });
});

describe('(5) jede Ueberschreitung der Grenze steht im Protokoll', () => {
  it('mit Aktion `arbzg.aggregat_gelesen`', async () => {
    await schichtMit(f.reinigung, f.fatimaReinigung, f.fatima, TAG, '06:00', '12:00');
    const sitzung = await planerin(f.reinigung);

    const vorher = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from audit_log where aktion = 'arbzg.aggregat_gelesen'`);
    await alsApp(sitzung, async (tx) =>
      leseBelastung(tx, f.fatima, new Date(`${TAG}T00:00:00Z`), new Date(`${TAG}T23:00:00Z`)));
    const nachher = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from audit_log where aktion = 'arbzg.aggregat_gelesen'`);

    expect(nachher[0]!.n).toBe(vorher[0]!.n + 1);
  });
});

describe('die Vorbedingungen der Definer-Funktion', () => {
  it('ohne Zustaendigkeit fuer die Person: 42501, kein leeres Ergebnis', async () => {
    // Jonas ist nur in der Reinigung beschaeftigt. Eine Planerin im
    // SECURITY-Mandanten hat mit ihm nichts zu tun.
    const sitzung = await planerin(f.security);
    await expect(alsApp(sitzung, async (tx) =>
      leseBelastung(tx, f.jonas, new Date(`${TAG}T00:00:00Z`), new Date(`${TAG}T23:00:00Z`)),
    )).rejects.toThrow(/nicht berechtigt/u);
  });

  it('ein Fenster ueber 35 Tage wird abgewiesen — das ist ein Planungswerkzeug', async () => {
    const sitzung = await planerin(f.reinigung);
    await expect(alsApp(sitzung, async (tx) =>
      leseBelastung(tx, f.fatima, new Date('2028-01-01T00:00:00Z'), new Date('2028-06-01T00:00:00Z')),
    )).rejects.toThrow(/zu gross/u);
  });
});
