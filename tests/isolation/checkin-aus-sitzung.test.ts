/**
 * Die zweite Tuer zur Stempeluhr — gegen echtes Postgres
 * (D-618, O-93, EMP-01, EMP-07, K-04, K-08, 0373).
 *
 * **Der Befund.** Die Stempeluhr ist vollstaendig gebaut und war vom
 * Arbeiterportal aus unerreichbar: eine Suche nach `check-in` in
 * `src/app/portal/mein/` lieferte null Treffer. Wer sich als Mitarbeiterin
 * anmeldete, fand keinen Knopf „Arbeit beginnen".
 *
 * **Was hier wirklich geprueft wird, ist die eine neue Pruefung.** Der
 * Token-Weg beweist die Person durch BESITZ der Marke; dieser Weg beweist sie
 * durch die Sitzung. Faellt die Zugehoerigkeitspruefung, stempelt jeder, der
 * eine fremde Einteilungskennung erraet, fuer einen fremden Menschen — und
 * das faellt im Betrieb niemandem auf, weil der Eintrag voellig normal
 * aussieht.
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';

let f: Fixtur;
const zufall = (): string => String(Math.random()).slice(2, 10);

async function objektMit(mandant: string): Promise<{ objekt: string; kunde: string }> {
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name)
     values ($1, $2, 'Stempel-Testkunde') returning id`, [mandant, `K-${zufall()}`]);
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
     values ($1, $2, $3, 'Hackescher Markt', 'Teststr.', '10115', 'Berlin') returning id`,
    [mandant, k!.id, `O-${zufall()}`]);
  return { objekt: o!.id, kunde: k!.id };
}

/**
 * Eine Schicht, die JETZT laeuft.
 *
 * **Beginn vor ZEHN Minuten, nicht vor einer Stunde.** `ct_fenster_ableiten`
 * (0035) leitet das Markenfenster aus der Zuordnung ab, mit einer
 * Check-in-Toleranz von ±1 h (TIM-07). Eine Schicht, die vor genau einer
 * Stunde begann, liegt damit auf der Kante — der erste Entwurf dieser Datei
 * tat das und bekam `abgelehnt`, was wie ein Fehler der neuen Funktion
 * aussah und keiner war.
 */
async function zuordnungJetzt(
  mandant: string, anstellung: string, person: string,
): Promise<string> {
  const { objekt, kunde } = await objektMit(mandant);
  const [e] = await sql.unsafe<{ id: string }[]>(
    `insert into einsatz (mandant_id, quelle, quell_schluessel, plan_datum,
                          beginn_zeitpunkt, ende_zeitpunkt, zeitzone,
                          beginn_lokal, ende_lokal, endet_am_folgetag,
                          objekt_id, kunde_id, soll_besetzung, min_besetzung,
                          erstellt_von_art, status)
     values ($1, 'manuell', $2, (now() at time zone 'Europe/Berlin')::date,
             now() - interval '10 minutes', now() + interval '7 hours',
             'Europe/Berlin', '08:00', '16:00', false,
             $3, $4, 1, 1, 'system', 'geplant')
     returning id`,
    [mandant, `stempel:${zufall()}`, objekt, kunde] as never[]);
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into einsatz_zuordnung (mandant_id, einsatz_id, anstellung_id, person_id,
                                    beginn_zeitpunkt, ende_zeitpunkt, erstellt_von_art)
     select $1, $2, $3, $4, beginn_zeitpunkt, ende_zeitpunkt, 'system'
       from einsatz where id = $2
     returning id`,
    [mandant, e!.id, anstellung, person] as never[]);
  return z!.id;
}

/** Eine Sitzung des ARBEITERPORTALS — Person gesetzt, Portal `mitarbeiter`. */
const alsArbeiter = <T>(
  person: string, fn: (tx: postgres.TransactionSql) => Promise<T>,
  portal: 'mitarbeiter' | 'intern' = 'mitarbeiter',
): Promise<T> => alsApp({
  scope: 'mandant', mandantId: f.reinigung, personId: person,
  portal, readonly: false,
}, fn);

interface Stempel {
  ergebnis: string; zeiteintrag_id: string | null; objekt: string | null;
}

const stempeln = (tx: postgres.TransactionSql, zuordnung: string, zweck = 'checkin') =>
  tx.unsafe<Stempel[]>(
    `select ergebnis, zeiteintrag_id, objekt
       from app.checkin_aus_der_sitzung($1::uuid, $2::token_zweck, now(),
                                        '10.0.0.1'::inet, 'vitest', null)`,
    [zuordnung, zweck] as never[]);

/**
 * Ein Arbeitskonto fuer die Person.
 *
 * **Ohne das faellt `checkin_verbrauchen` mit „kein Benutzerkonto fuer diese
 * Person"** — eine Zusicherung aus 0035, die genau den Fall trifft, dass
 * jemandem ein Link VOR der Freischaltung geschickt wurde. Fuer DIESEN Weg
 * kann der Fall gar nicht eintreten: wer im Portal angemeldet ist, hat ein
 * Konto. Die Fixtur bildet das nach, statt die Zusicherung zu umgehen.
 */
async function arbeitskonto(person: string): Promise<void> {
  const email = `arbeiter-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, person_id)
     values ($1,$2,$2,'aktiv',$3)`, [u!.id, email, person] as never[]);
}

beforeEach(async () => {
  f = await seed();
  await arbeitskonto(f.jonas);
  await arbeitskonto(f.fatima);
});
afterAll(schliessen);

describe('(1) die Arbeiterin stempelt ihre EIGENE Schicht', () => {
  it('der Eintrag entsteht, und er laeuft', async () => {
    const z = await zuordnungJetzt(f.reinigung, f.jonasReinigung, f.jonas);
    const [r] = await alsArbeiter(f.jonas, (tx) => stempeln(tx, z));

    expect(r?.ergebnis, 'ohne diesen Weg findet sie keinen Knopf').toBe('eingecheckt');
    expect(r?.zeiteintrag_id).not.toBeNull();
    expect(r?.objekt).toBe('Hackescher Markt');

    const [e] = await sql.unsafe<{ status: string; person_id: string }[]>(
      `select status::text as status, person_id from zeiteintrag where id = $1`,
      [r!.zeiteintrag_id]);
    expect(e?.status).toBe('laufend');
    expect(e?.person_id).toBe(f.jonas);
  });

  /*
   * O-93 in der Zeile selbst: die Spalte sagt hinterher, welcher Weg genommen
   * wurde. Ohne sie liessen sich Portal- und Link-Stempel nicht unterscheiden,
   * und die Antwort auf „wie kommt der Link zu ihr" waere nicht nachpruefbar.
   */
  it('und die Zeile sagt, welcher Weg es war: `portal`', async () => {
    const z = await zuordnungJetzt(f.reinigung, f.jonasReinigung, f.jonas);
    await alsArbeiter(f.jonas, (tx) => stempeln(tx, z));

    const [t] = await sql.unsafe<{ kanal: string; eingeloest: Date | null }[]>(
      `select ausgabe_kanal as kanal, eingeloest_am as eingeloest
         from checkin_token where einsatz_zuordnung_id = $1`, [z]);
    expect(t?.kanal).toBe('portal');
    /* Ausgestellt UND eingeloest im selben Vorgang — es bleibt keine
       benutzbare Marke liegen, die jemand abfotografieren koennte. */
    expect(t?.eingeloest).not.toBeNull();
  });
});

describe('(2) die Pruefung, auf die es ankommt', () => {
  /*
   * Der Fall, der diese Datei rechtfertigt. Faellt er, stempelt jeder, der
   * eine fremde Kennung erraet, fuer einen fremden Menschen — und der
   * Eintrag sieht voellig normal aus.
   */
  it('eine FREMDE Einteilung wird abgewiesen', async () => {
    const fremd = await zuordnungJetzt(f.reinigung, f.fatimaReinigung, f.fatima);
    const [r] = await alsArbeiter(f.jonas, (tx) => stempeln(tx, fremd));

    expect(r?.ergebnis).toBe('abgelehnt');
    expect(r?.zeiteintrag_id).toBeNull();

    const [e] = await sql.unsafe<{ anzahl: string }[]>(
      `select count(*) as anzahl from zeiteintrag where einsatz_zuordnung_id = $1`, [fremd]);
    expect(Number(e?.anzahl)).toBe(0);
  });

  /* „Gibt es nicht" und „gehoert dir nicht" antworten GLEICH (AUT-06) —
     sonst lohnt das Durchprobieren von Kennungen. */
  it('eine Einteilung, die es nicht gibt, antwortet genauso', async () => {
    const [r] = await alsArbeiter(f.jonas, (tx) =>
      stempeln(tx, '00000000-0000-0000-0000-000000000000'));
    expect(r?.ergebnis).toBe('abgelehnt');
  });

  it('aus dem VERWALTUNGSportal gar nicht — dort ist der Planerweg zustaendig (K-04)', async () => {
    const z = await zuordnungJetzt(f.reinigung, f.jonasReinigung, f.jonas);
    await expect(alsArbeiter(f.jonas, (tx) => stempeln(tx, z), 'intern'))
      .rejects.toThrow(/Arbeiterportal|privilege/iu);
  });
});

describe('(3) es bleibt EIN Schreiber — der Weg aendert nichts am Beleg', () => {
  /*
   * **Zweimal auf den Knopf ist kein Randfall**, und ein doppelter
   * `zeiteintrag` ist doppelt abgerechnete Zeit (FIN-07) und ein doppelter
   * § 17-Nachweis (K-09).
   *
   * Die Sicherung ist `z_offen_uk` — ein eindeutiger Index auf den OFFENEN
   * Eintrag je Person. Der zweite Versuch scheitert also LAUT, nicht still,
   * und das ist die richtige Richtung: ein stilles „schon eingecheckt" waere
   * von „eingecheckt" nicht zu unterscheiden.
   *
   * **Die Oberflaeche darf diesen Fehler trotzdem nie zeigen.** Sie kennt den
   * offenen Eintrag und bietet dann „Arbeit beenden" statt „Arbeit beginnen";
   * der Index ist der Rueckhalt fuer den Doppeltipp auf einer langsamen
   * Verbindung, nicht der Weg, auf dem der Fall behandelt wird.
   */
  it('ein zweiter Stempel bricht ab — und laesst genau EINEN offenen Eintrag', async () => {
    const z = await zuordnungJetzt(f.reinigung, f.jonasReinigung, f.jonas);
    await alsArbeiter(f.jonas, (tx) => stempeln(tx, z));
    await expect(alsArbeiter(f.jonas, (tx) => stempeln(tx, z)))
      .rejects.toThrow(/z_offen_uk|duplicate key/iu);

    const [e] = await sql.unsafe<{ anzahl: string }[]>(
      `select count(*) as anzahl from zeiteintrag
        where einsatz_zuordnung_id = $1 and status = 'laufend'`, [z]);
    expect(Number(e?.anzahl)).toBe(1);
  });

  /*
   * Invariante 5: die Serveruhr ist die Wahrheit. Der Beginn kommt aus der
   * DATENBANK, nicht aus dem Geraet — ein Telefon mit falscher Uhr darf die
   * abgerechnete Zeit nicht verschieben.
   */
  it('der Beginn kommt aus der Serveruhr, nicht aus dem Geraet', async () => {
    const z = await zuordnungJetzt(f.reinigung, f.jonasReinigung, f.jonas);
    const [r] = await alsArbeiter(f.jonas, (tx) => stempeln(tx, z));

    const [e] = await sql.unsafe<{ abstand: number }[]>(
      `select abs(extract(epoch from (now() - beginn_zeitpunkt)))::int as abstand
         from zeiteintrag where id = $1`, [r!.zeiteintrag_id]);
    expect(e?.abstand).toBeLessThan(60);
  });
});
