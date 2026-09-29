/**
 * Jede Abweisung der Personaldienste trägt einen GRUND — an jeder Stelle, an
 * der sie geworfen wird (V-273, D-771, D-769).
 *
 * **Warum das eine eigene Prüfung ist.** Die Route schickt seit V-273 nur
 * noch den Grund als `?fehler=` auf die Seite zurück, und die Seite schlägt
 * ihren Satz danach nach (`tests/kern/personal-rueckweg.test.ts`). Ein
 * falscher Grund an einer Wurfstelle wäre dort unsichtbar: die Seite zeigte
 * einen richtigen Satz zu einem falschen Anlass. Der Übersetzer prüft nur,
 * DASS ein Grund aus der Liste dasteht, nicht WELCHER — das tut diese Datei,
 * an den echten Diensten. Ersetzt ist nur die Datenbank: ein Kontext, der auf
 * jede Abfrage genau die Zeilen gibt, die den Dienst an die Wurfstelle führen.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import { cent } from '../../src/server/services/finanz/geld.js';
import { milliMenge } from '../../src/server/services/finanz/menge.js';
import {
  AnstellungNichtGefunden, BEENDEN_EINGABE_GRUENDE, BEENDIGUNG_GRUENDE, BeendigungFehler,
  KONDITION_GRENZEN, KONDITION_GRUENDE, KeinEntgeltRecht, PersonalnummerVergeben,
  STICHTAG_GRUENDE,
  VERTRAG_AENDERN_GRUENDE, VertragEingabeFehler, aendereVertrag, beendeAnstellung,
  beendigungsfolgen, leseEntgelt, setzeKondition,
} from '../../src/server/services/personal/anstellung.js';
import {
  DubletteImHaus, EINSTELLUNG_GRUENDE, EinstellungFehler, PersonNichtSichtbar,
  PersonalnummerVergeben as NummerBeimEinstellen, pruefeEingabe, stelleEin,
  type EinstellungEingabe,
} from '../../src/server/services/personal/einstellung.js';
import {
  BestaetigungFehlt, FUNKTION_ABWEISUNGEN, ZUSAMMENFUEHREN_GRUENDE, ZusammenfuehrenFehler,
  fuehreZusammen,
} from '../../src/server/services/personal/dublette.js';
import {
  KeinStammdatenRecht, PersonNichtGefunden, STAMMDATEN_GRUENDE, StammdatenEingabeFehler,
  leseStammdaten, schreibeStammdaten,
} from '../../src/server/services/personal/stammdaten.js';
import { PersonalnummerVergeben as NummerVergeben }
  from '../../src/server/services/personal/personalnummer.js';

const WURZEL = resolve(import.meta.dirname, '../..');
const MANDANT = '00000000-0000-4000-8000-0000000000a1';
const ANSTELLUNG = '5b0d6c1e-0a41-4c55-9d1c-1c2f3b4a5d6e';
const PERSON = '6c1e5b0d-0a41-4c55-9d1c-1c2f3b4a5d6f';
const PERSON_ZWEI = '7d2f6c1e-0a41-4c55-9d1c-1c2f3b4a5d70';

type Antwort = (sql: string) => readonly unknown[] | Error;

/** Ein Kontext, der jede Abfrage mit `antwort` beantwortet — die Datenbank dieses Tests. */
function kontext(antwort: Antwort): SchreibKontext {
  const frage = <T,>(sql: string): Promise<readonly T[]> => {
    const a = antwort(sql);
    return a instanceof Error ? Promise.reject(a) : Promise.resolve(a as readonly T[]);
  };
  return {
    scope: 'mandant', portal: 'intern',
    benutzerId: '00000000-0000-4000-8000-0000000000b1',
    aktiverMandantId: MANDANT, mandantIds: [MANDANT],
    abfrage: frage, schreibe: frage,
  };
}

/** Die Zeile, die `findeAnstellung` liest. */
function zeile(anders: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ANSTELLUNG, mandant_id: MANDANT, person_id: PERSON, person_name: 'Anna Berg',
    personalnummer: 'R-1', eintritt: '2025-01-01', austritt: null, austritt_grund: null,
    status: 'aktiv', arbeitszeitmodell: null, wochenstunden: null, arbeitstage_woche: null,
    kostenstelle: null, ...anders,
  };
}

const IST_ZEILE = /join person p on p\.id = a\.person_id/u;

async function wurf(lauf: () => unknown): Promise<unknown> {
  try {
    await lauf();
  } catch (fehler) {
    return fehler;
  }
  throw new Error('Der Dienst hat nicht abgewiesen.');
}

/** `[Beschreibung, Klasse, Grund, Lauf]` — eine Wurfstelle. */
type Fall = readonly [string, abstract new (...a: never[]) => Error, string, () => unknown];

function pruefe(faelle: readonly Fall[], liste: readonly string[]): void {
  it.each(faelle)('%s', async (_, klasse, grund, lauf) => {
    const f = await wurf(lauf);
    expect(f).toBeInstanceOf(klasse);
    expect((f as { grund?: unknown }).grund).toBe(grund);
    expect(liste, 'der Grund steht in der Liste, die die Seite liest').toContain(grund);
  });
}

describe('pruefeEingabe und stelleEin — EinstellungFehler und die drei Einzelklassen', () => {
  const gueltig: EinstellungEingabe = {
    mensch: { art: 'neu', vorname: 'Anna', nachname: 'Berg', telefon: null, sprache: 'de' },
    personalnummer: 'R-7', eintritt: '2026-10-01',
  };
  const mit = (anders: Partial<EinstellungEingabe>, mensch?: Record<string, unknown>): EinstellungEingabe => ({
    ...gueltig, ...anders,
    ...(mensch === undefined ? {} : { mensch: { ...gueltig.mensch, ...mensch } as EinstellungEingabe['mensch'] }),
  });
  const leer = kontext(() => []);
  const liste = [...EINSTELLUNG_GRUENDE, 'dublette_im_haus', 'person_nicht_sichtbar',
    'personalnummer_vergeben'];

  pruefe([
    ['ohne Personalnummer', EinstellungFehler, 'personalnummer_fehlt',
      () => pruefeEingabe(mit({ personalnummer: '  ' }))],
    ['Personalnummer über 40 Zeichen', EinstellungFehler, 'personalnummer_zu_lang',
      () => pruefeEingabe(mit({ personalnummer: 'R'.repeat(41) }))],
    ['Eintritt ohne Kalenderform', EinstellungFehler, 'eintritt_ungueltig',
      () => pruefeEingabe(mit({ eintritt: '01.10.2026' }))],
    ['kein Mensch gewählt', EinstellungFehler, 'kein_mensch_gewaehlt',
      () => pruefeEingabe({ ...gueltig, mensch: { art: 'bestehend', personId: 'x' } })],
    ['ohne Nachname', EinstellungFehler, 'name_fehlt',
      () => pruefeEingabe(mit({}, { nachname: ' ' }))],
    ['Vorname über 80 Zeichen', EinstellungFehler, 'name_zu_lang',
      () => pruefeEingabe(mit({}, { vorname: 'A'.repeat(81) }))],
    ['eine fünfte Sprache', EinstellungFehler, 'sprache_ungueltig',
      () => pruefeEingabe(mit({}, { sprache: 'fr' }))],
    ['Telefon über 40 Zeichen', EinstellungFehler, 'telefon_zu_lang',
      () => pruefeEingabe(mit({}, { telefon: '0'.repeat(41) }))],
    ['die Personalnummer ist schon vergeben', NummerBeimEinstellen, 'personalnummer_vergeben',
      () => stelleEin(kontext((sql) => (/personalnummer = \$2/u.test(sql) ? [{ id: ANSTELLUNG }] : [])),
        gueltig)],
    ['der gewählte Mensch ist nicht sichtbar', PersonNichtSichtbar, 'person_nicht_sichtbar',
      () => stelleEin(leer, { ...gueltig, mensch: { art: 'bestehend', personId: PERSON } })],
    ['der gewählte Mensch ist zusammengeführt', EinstellungFehler, 'person_zusammengefuehrt',
      () => stelleEin(kontext((sql) => (/as merge/u.test(sql)
        ? [{ id: PERSON, name: 'Anna Berg', merge: PERSON_ZWEI }] : [])),
      { ...gueltig, mensch: { art: 'bestehend', personId: PERSON } })],
    ['derselbe Name in dieser Gesellschaft', DubletteImHaus, 'dublette_im_haus',
      () => stelleEin(kontext((sql) => (/app\.namensform/u.test(sql)
        ? [{ id: PERSON, name: 'Anna Berg' }] : [])), gueltig)],
  ], liste);
});

describe('aendereVertrag — VertragEingabeFehler, AnstellungNichtGefunden, PersonalnummerVergeben', () => {
  const eingabe = { anstellungId: ANSTELLUNG, personalnummer: 'R-2', eintritt: '2025-02-01' };
  const liste = [...VERTRAG_AENDERN_GRUENDE, 'nicht_gefunden', 'personalnummer_vergeben'];
  pruefe([
    ['ohne Personalnummer', VertragEingabeFehler, 'personalnummer_fehlt',
      () => aendereVertrag(kontext(() => []), { ...eingabe, personalnummer: ' ' })],
    ['Eintritt ohne Kalenderform', VertragEingabeFehler, 'eintritt_ungueltig',
      () => aendereVertrag(kontext(() => []), { ...eingabe, eintritt: '01.02.2025' })],
    ['die Beschäftigung ist nicht da', AnstellungNichtGefunden, 'nicht_gefunden',
      () => aendereVertrag(kontext(() => []), eingabe)],
    ['der Eintritt läge nach dem Austritt', VertragEingabeFehler, 'eintritt_nach_austritt',
      () => aendereVertrag(kontext((sql) => (IST_ZEILE.test(sql)
        ? [zeile({ austritt: '2025-01-31' })] : [])), eingabe)],
    ['die Personalnummer ist schon vergeben', PersonalnummerVergeben, 'personalnummer_vergeben',
      () => aendereVertrag(kontext((sql) => (IST_ZEILE.test(sql) ? [zeile()]
        : /id <> \$3/u.test(sql) ? [{ id: PERSON_ZWEI }] : [])), eingabe)],
    ['das Update trifft keine Zeile mehr', AnstellungNichtGefunden, 'nicht_gefunden',
      () => aendereVertrag(kontext((sql) => (IST_ZEILE.test(sql) ? [zeile()] : [])), eingabe)],
  ], liste);
});

describe('beendeAnstellung und beendigungsfolgen — VertragEingabeFehler, BeendigungFehler', () => {
  const eingabe = { anstellungId: ANSTELLUNG, austritt: '2025-06-30', grund: 'Eigenkündigung' };
  const liste = [...BEENDEN_EINGABE_GRUENDE, ...BEENDIGUNG_GRUENDE, 'nicht_gefunden'];
  pruefe([
    ['Austritt ohne Kalenderform', VertragEingabeFehler, 'austritt_ungueltig',
      () => beendeAnstellung(kontext(() => []), { ...eingabe, austritt: 'heute' })],
    ['die Vorschau mit einem Austritt ohne Kalenderform', VertragEingabeFehler, 'austritt_ungueltig',
      () => beendigungsfolgen(kontext(() => []), ANSTELLUNG, '30.06.2025')],
    ['ohne Grund', VertragEingabeFehler, 'grund_fehlt',
      () => beendeAnstellung(kontext(() => []), { ...eingabe, grund: '  ' })],
    ['die Beschäftigung ist nicht da', AnstellungNichtGefunden, 'nicht_gefunden',
      () => beendeAnstellung(kontext(() => []), eingabe)],
    ['schon beendet', BeendigungFehler, 'bereits_beendet',
      () => beendeAnstellung(kontext((sql) => (IST_ZEILE.test(sql)
        ? [zeile({ status: 'beendet', austritt: '2025-03-31' })] : [])), eingabe)],
    ['der Austritt läge vor dem Eintritt', BeendigungFehler, 'austritt_vor_eintritt',
      () => beendeAnstellung(kontext((sql) => (IST_ZEILE.test(sql)
        ? [zeile({ eintritt: '2025-07-01' })] : [])), eingabe)],
    ['eine Kollegin war schneller: das Update trifft keine offene Zeile', AnstellungNichtGefunden,
      'nicht_gefunden',
      () => beendeAnstellung(kontext((sql) => (IST_ZEILE.test(sql) ? [zeile()]
        : /as tag/u.test(sql) ? [{ tag: '2025-06-01' }] : [])), eingabe)],
  ], liste);
});

describe('setzeKondition und leseEntgelt — VertragEingabeFehler, KeinEntgeltRecht', () => {
  const eingabe = { anstellungId: ANSTELLUNG, giltAb: '2025-05-01', stundensatzCent: cent(1750n) };
  const liste = [...KONDITION_GRUENDE, ...STICHTAG_GRUENDE, 'nicht_gefunden', 'kein_recht'];
  pruefe([
    ['„gilt ab" ohne Kalenderform', VertragEingabeFehler, 'gilt_ab_ungueltig',
      () => setzeKondition(kontext(() => []), { ...eingabe, giltAb: '2025-5-1' })],
    ['ein negativer Satz', VertragEingabeFehler, 'satz_negativ',
      () => setzeKondition(kontext(() => []), { ...eingabe, stundensatzCent: cent(-1n) })],
    ['Wochenstunden über der Grenze der Datenbank', VertragEingabeFehler, 'wochenstunden_ungueltig',
      () => setzeKondition(kontext(() => []), { ...eingabe, wochenstunden: milliMenge(168_001n) })],
    ['negative Wochenstunden', VertragEingabeFehler, 'wochenstunden_ungueltig',
      () => setzeKondition(kontext(() => []), { ...eingabe, wochenstunden: milliMenge(-1n) })],
    ['Arbeitstage über der Grenze der Datenbank', VertragEingabeFehler, 'arbeitstage_ungueltig',
      () => setzeKondition(kontext(() => []), { ...eingabe, arbeitstageWoche: milliMenge(7_001n) })],
    /* Die Grenze selbst ist erlaubt: der Dienst fragt danach die Zeile (die es hier nicht gibt). */
    ['genau 168 Stunden und 7 Tage gehen durch bis zur Zeile', AnstellungNichtGefunden, 'nicht_gefunden',
      () => setzeKondition(kontext(() => []), {
        ...eingabe, wochenstunden: milliMenge(168_000n), arbeitstageWoche: milliMenge(7_000n),
      })],
    ['die Beschäftigung ist nicht da', AnstellungNichtGefunden, 'nicht_gefunden',
      () => setzeKondition(kontext(() => []), eingabe)],
    ['vor dem Eintritt', VertragEingabeFehler, 'vor_eintritt',
      () => setzeKondition(kontext((sql) => (IST_ZEILE.test(sql)
        ? [zeile({ eintritt: '2025-06-01' })] : [])), eingabe)],
    ['in einer geschlossenen Periode', VertragEingabeFehler, 'periode_belegt',
      () => setzeKondition(kontext((sql) => (IST_ZEILE.test(sql) ? [zeile()]
        : /daterange/u.test(sql) ? [{ gilt_ab: '2025-01-01', gilt_bis: '2025-12-31' }] : [])),
      eingabe)],
    ['nicht nach der laufenden', VertragEingabeFehler, 'nicht_nach_laufender',
      () => setzeKondition(kontext((sql) => (IST_ZEILE.test(sql) ? [zeile()]
        : /gilt_bis is null/u.test(sql) ? [{ id: PERSON_ZWEI, gilt_ab: '2025-06-01' }] : [])),
      eingabe)],
    ['ein Stichtag ohne Kalenderform', VertragEingabeFehler, 'stichtag_ungueltig',
      () => leseEntgelt(kontext(() => []), ANSTELLUNG, 'gestern')],
    ['ohne Entgeltrecht', KeinEntgeltRecht, 'kein_recht',
      () => leseEntgelt(kontext(() => Object.assign(new Error('permission denied'),
        { code: '42501' })), ANSTELLUNG)],
  ], liste);
});

describe('fuehreZusammen — ZusammenfuehrenFehler, BestaetigungFehlt', () => {
  const eingabe = {
    dublettePersonId: PERSON, fuehrendPersonId: PERSON_ZWEI, grund: 'doppelt angelegt',
    bestaetigung: 'Berg',
  };
  const liste = [...ZUSAMMENFUEHREN_GRUENDE, 'bestaetigung_falsch'];
  pruefe([
    ['dieselbe Zeile zweimal', ZusammenfuehrenFehler, 'dieselbe_zeile',
      () => fuehreZusammen(kontext(() => []), { ...eingabe, fuehrendPersonId: PERSON })],
    ['ohne Grund', ZusammenfuehrenFehler, 'grund_fehlt',
      () => fuehreZusammen(kontext(() => []), { ...eingabe, grund: ' ' })],
    ['die führende Zeile ist nicht sichtbar', ZusammenfuehrenFehler, 'fuehrend_nicht_sichtbar',
      () => fuehreZusammen(kontext(() => []), eingabe)],
    ['die getippte Bestätigung stimmt nicht', BestaetigungFehlt, 'bestaetigung_falsch',
      () => fuehreZusammen(kontext((sql) => (/select nachname from person/u.test(sql)
        ? [{ nachname: 'Bergmann' }] : [])), eingabe)],
  ], liste);
});

describe('schreibeStammdaten und leseStammdaten — StammdatenEingabeFehler, PersonNichtGefunden', () => {
  const liste = [...STAMMDATEN_GRUENDE, 'nicht_gefunden', 'kein_recht'];
  pruefe([
    ['ein Geburtsdatum ohne Kalenderform', StammdatenEingabeFehler, 'geburtsdatum_ungueltig',
      () => schreibeStammdaten(kontext(() => []), { personId: PERSON, geburtsdatum: '31.02.1990' })],
    ['eine Staatsangehörigkeit als Wort', StammdatenEingabeFehler, 'staat_ungueltig',
      () => schreibeStammdaten(kontext(() => []),
        { personId: PERSON, staatsangehoerigkeit: 'Deutschland' })],
    ['diesen Menschen pflegt diese Gesellschaft nicht', PersonNichtGefunden, 'nicht_gefunden',
      () => schreibeStammdaten(kontext(() => []), { personId: PERSON, geburtsort: 'Berlin' })],
    ['ohne Leserecht', KeinStammdatenRecht, 'kein_recht',
      () => leseStammdaten(kontext(() => Object.assign(new Error('permission denied'),
        { code: '42501' })), PERSON)],
  ], liste);
});

describe('Kalendertage, die es nicht gibt — ein Grund vor dem Cast, keine 22008 (D-771 Nachtrag)', () => {
  /* Jede Abfrage wirft: fragte der Dienst die Datenbank, käme DIESER Fehler statt des Grundes. */
  const stumm = kontext(() => new Error('Abfrage verboten — der Tag hätte vorher fallen müssen.'));
  const liste = [...EINSTELLUNG_GRUENDE, ...VERTRAG_AENDERN_GRUENDE, ...BEENDEN_EINGABE_GRUENDE,
    ...KONDITION_GRUENDE, ...STICHTAG_GRUENDE, ...STAMMDATEN_GRUENDE];
  pruefe([
    ['Eintritt am 29. Februar 2025', EinstellungFehler, 'eintritt_ungueltig',
      () => pruefeEingabe({ mensch: { art: 'bestehend', personId: PERSON },
        personalnummer: 'R-7', eintritt: '2025-02-29' })],
    ['Vertrag: Eintritt am 30. Februar', VertragEingabeFehler, 'eintritt_ungueltig',
      () => aendereVertrag(stumm, { anstellungId: ANSTELLUNG, personalnummer: 'R-2', eintritt: '2025-02-30' })],
    ['Beenden: Austritt am 31. April', VertragEingabeFehler, 'austritt_ungueltig',
      () => beendeAnstellung(stumm, { anstellungId: ANSTELLUNG, austritt: '2025-04-31', grund: 'Eigenkündigung' })],
    ['Vorschau: Austritt am 31. Juni', VertragEingabeFehler, 'austritt_ungueltig',
      () => beendigungsfolgen(stumm, ANSTELLUNG, '2025-06-31')],
    ['Kondition: gilt ab 31. Februar', VertragEingabeFehler, 'gilt_ab_ungueltig',
      () => setzeKondition(stumm, { anstellungId: ANSTELLUNG, giltAb: '2025-02-31', stundensatzCent: null })],
    ['Stichtag im dreizehnten Monat', VertragEingabeFehler, 'stichtag_ungueltig',
      () => leseEntgelt(stumm, ANSTELLUNG, '2025-13-01')],
    ['Geburtsdatum am 30. Februar', StammdatenEingabeFehler, 'geburtsdatum_ungueltig',
      () => schreibeStammdaten(stumm, { personId: PERSON, geburtsdatum: '1990-02-30' })],
    /* Die Gegenprobe: den 29. Februar eines Schaltjahrs gibt es — der Dienst fragt weiter. */
    ['der 29. Februar 2024 geht bis zur Zeile', AnstellungNichtGefunden, 'nicht_gefunden',
      () => setzeKondition(kontext(() => []), { anstellungId: ANSTELLUNG, giltAb: '2024-02-29', stundensatzCent: null })],
  ], [...liste, 'nicht_gefunden']);
});

describe('eine gleichzeitige Anlage mit derselben Personalnummer — der Constraint wird der Grund (D-771 Nachtrag)', () => {
  const kollision = (): Error => Object.assign(
    new Error('duplicate key value violates unique constraint "anstellung_personalnummer_uk"'),
    { code: '23505', constraint_name: 'anstellung_personalnummer_uk' });
  const gueltig: EinstellungEingabe = {
    mensch: { art: 'bestehend', personId: PERSON }, personalnummer: 'R-7', eintritt: '2026-10-01',
  };
  pruefe([
    /* Die Vorabfrage sieht die andere Anlage noch nicht — erst das INSERT läuft in den Constraint. */
    ['Einstellen', NummerVergeben, 'personalnummer_vergeben',
      () => stelleEin(kontext((sql) => (/as merge/u.test(sql)
        ? [{ id: PERSON, name: 'Anna Berg', merge: null }]
        : /insert into anstellung/u.test(sql) ? kollision() : [])), gueltig)],
    ['Vertrag ändern', NummerVergeben, 'personalnummer_vergeben',
      () => aendereVertrag(kontext((sql) => (IST_ZEILE.test(sql) ? [zeile()]
        : /update anstellung/u.test(sql) ? kollision() : [])),
      { anstellungId: ANSTELLUNG, personalnummer: 'R-7', eintritt: '2025-02-01' })],
  ], ['personalnummer_vergeben']);

  it('ein ANDERER Constraint bleibt, was er ist — keine erfundene Abweisung', async () => {
    const fremd = Object.assign(new Error('duplicate key value violates unique constraint "anstellung_pk"'),
      { code: '23505', constraint_name: 'anstellung_pk' });
    const f = await wurf(() => stelleEin(kontext((sql) => (/as merge/u.test(sql)
      ? [{ id: PERSON, name: 'Anna Berg', merge: null }]
      : /insert into anstellung/u.test(sql) ? fremd : [])), gueltig));
    expect(f).toBe(fremd);
  });
});

describe('die Abweisungen von app.person_zusammenfuehren werden Gründe (D-771 Nachtrag)', () => {
  const eingabe = {
    dublettePersonId: PERSON, fuehrendPersonId: PERSON_ZWEI, grund: 'doppelt angelegt',
    bestaetigung: 'Berg',
  };
  const mitFunktionsfehler = (fehler: Error): SchreibKontext => kontext((sql) =>
    (/select nachname from person/u.test(sql) ? [{ nachname: 'Berg' }]
      : /app\.person_zusammenfuehren/u.test(sql) ? fehler : []));

  it.each(FUNKTION_ABWEISUNGEN.map((a) => [a.grund, a] as const))('%s', async (grund, a) => {
    const f = await wurf(() => fuehreZusammen(mitFunktionsfehler(
      Object.assign(new Error(`${a.satz} Und was die Funktion sonst noch sagt.`), { code: a.code })),
    eingabe));
    expect(f).toBeInstanceOf(ZusammenfuehrenFehler);
    expect((f as ZusammenfuehrenFehler).grund).toBe(grund);
    expect(ZUSAMMENFUEHREN_GRUENDE as readonly string[]).toContain(grund);
  });

  it.each([
    ['Gruppenansicht (Invariante 10) — vorher fragt `authorize`', '23001', 'Die Gruppenansicht schreibt nicht (Invariante 10).'],
    ['das Recht — vorher fragt `authorize`', '42501', 'nicht berechtigt'],
    ['derselbe Satz mit einem anderen Code', '23514', 'Dieser Datensatz ist bereits zusammengeführt.'],
    ['ein Fehler ohne Satz der Funktion', '23001', 'irgendein anderer Text'],
  ] as const)('unbekannt bleibt ein Wurf: %s', async (_, code, satz) => {
    const roh = Object.assign(new Error(satz), { code });
    expect(await wurf(() => fuehreZusammen(mitFunktionsfehler(roh), eingabe))).toBe(roh);
  });

  it('jeder erkannte Satz steht so in 0194 — mit dem errcode, den der Dienst erwartet', () => {
    const migration = readFileSync(resolve(WURZEL, 'drizzle/0194_person_zusammenfuehren.sql'), 'utf8');
    const CODE: Readonly<Record<string, string>> = {
      restrict_violation: '23001', check_violation: '23514',
    };
    for (const a of FUNKTION_ABWEISUNGEN) {
      const i = migration.indexOf(`'${a.satz}`);
      expect(i, a.satz).toBeGreaterThan(-1);
      const errcode = /using errcode = '(\w+)'/u.exec(migration.slice(i))?.[1] ?? '';
      expect(CODE[errcode], a.satz).toBe(a.code);
    }
  });
});

describe('die Gründe selbst', () => {
  it('jeder Grund ist ein Schlüssel — kein Satz, keine Kennung', () => {
    for (const g of [
      ...EINSTELLUNG_GRUENDE, ...VERTRAG_AENDERN_GRUENDE, ...BEENDEN_EINGABE_GRUENDE,
      ...KONDITION_GRUENDE, ...STICHTAG_GRUENDE, ...BEENDIGUNG_GRUENDE,
      ...ZUSAMMENFUEHREN_GRUENDE, ...STAMMDATEN_GRUENDE,
    ]) expect(g).toMatch(/^[a-z][a-z0-9_]{0,63}$/u);
  });

  it('die Grenzen einer Kondition sind die der Datenbank (0192) — an einer Stelle abgelesen', () => {
    const migration = readFileSync(resolve(WURZEL, 'drizzle/0192_anstellung_kondition.sql'), 'utf8');
    const grenze = (spalte: string): number => {
      const m = new RegExp(`${spalte} >= 0 and ${spalte} <= (\\d+)\\)`, 'u').exec(migration);
      expect(m, spalte).not.toBeNull();
      return Number(m?.[1]);
    };
    expect(KONDITION_GRENZEN).toEqual({
      wochenstunden: grenze('wochenstunden'), arbeitstageWoche: grenze('arbeitstage_woche'),
    });
  });

  it('jede Fehlerklasse der vier Dienste trägt einen Grund — die nächste auch', () => {
    /*
     * Am Quelltext, weil eine neue Klasse keinen Eintrag in einer Liste
     * bekommt, die sie nicht kennt: steht sie in einer dieser Dateien, muss
     * sie einen `grund` tragen, sonst reiste sie mit ihrem allgemeinen `code`.
     */
    let klassen = 0;
    for (const datei of ['einstellung', 'anstellung', 'dublette', 'stammdaten', 'personalnummer']) {
      const quelle = readFileSync(
        resolve(WURZEL, `src/server/services/personal/${datei}.ts`), 'utf8');
      for (const m of quelle.matchAll(/export class (\w+) extends Error \{([\s\S]*?)\n\}/gu)) {
        klassen += 1;
        expect(m[2], `${datei}.ts: ${m[1] ?? ''}`).toMatch(/readonly grund\b/u);
      }
    }
    /* 14 bis V-273 — seit dem Nachtrag ist `PersonalnummerVergeben` EINE Klasse. */
    expect(klassen).toBe(13);
  });

  it('eine Personalnummer, die schon vergeben ist, ist EIN Befund: eine Klasse, ein Code (D-771 Nachtrag)', () => {
    /* Beide Dienste reichen dieselbe Klasse durch — ein `instanceof` fängt beide Wege. */
    expect(NummerBeimEinstellen).toBe(NummerVergeben);
    expect(PersonalnummerVergeben).toBe(NummerVergeben);
    const f = new NummerVergeben('R-7');
    expect({ code: f.code, status: f.status, grund: f.grund }).toEqual({
      code: 'ungueltiger_zustand', status: 409, grund: 'personalnummer_vergeben',
    });
  });
});
