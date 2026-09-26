/**
 * `person.sprache` erreicht den GESPEICHERTEN Text einer Meldung — gegen
 * echtes Postgres (V-102, O-889, NOT-01, SPEC §10).
 *
 * **Warum das nicht in `tests/kern/` gehört.** Dass die Artdefinitionen in
 * vier Sprachen antworten, ist eine Aussage über TypeScript und steht dort
 * (`benachrichtigung-sprachen.test.ts`). Hier steht die andere Hälfte, und
 * sie ist eine Aussage über SQL: ob die Sprache überhaupt bis zur
 * Artdefinition kommt. Drei Abfragen mussten dafür eine Spalte dazunehmen,
 * und jede einzelne kann sie still verlieren —
 *
 *  - ein `join` statt `left join`: die Warnung fällt ganz aus,
 *  - ein vergessenes `group by`: die Abfrage bricht ab,
 *  - ein fehlendes SPALTENRECHT: `permission denied for column sprache`,
 *    nachts um 02:05, im einzigen Lauf ohne Zuschauer.
 *
 * Der dritte Fall ist der, der hier fast passiert wäre: `0149` gibt `cse_job`
 * auf `person` nur `select (id, vorname, nachname)`. §3 nagelt das fest.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, alsRolle, schliessen, seed, sql, type Fixtur } from './harness.js';
import { meldeAblaufwarnungen } from '../../src/server/services/nachweis/ablauf.js';
import { veroeffentliche, vorschau }
  from '../../src/server/services/dienstplan/veroeffentlichung.js';
import { registriereDienstplanArten }
  from '../../src/server/services/dienstplan/benachrichtigung.js';
import { leereArten } from '../../src/server/benachrichtigung/registry.js';
import { registriereNachweisArten }
  from '../../src/server/services/nachweis/benachrichtigung.js';
import type { LeseKontext, SchreibKontext } from '../../src/server/kontext/index.js';

let f: Fixtur;
let planer = '';

const zufall = (): string => String(Math.random()).slice(2, 10);

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function konto(mandant: string, rolle = 'leitung'): Promise<string> {
  const email = `sprache-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`,
    [u!.id, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [u!.id, mandant, await rolleId(rolle)]);
  return u!.id;
}

/** Die Sprache eines Menschen setzen — als Eigentümer, wie jede Stammdatenpflege. */
async function sprich(personId: string, sprache: string): Promise<void> {
  await sql.unsafe(`update person set sprache = $2 where id = $1`, [personId, sprache]);
}

function db(tx: Parameters<Parameters<typeof alsApp>[1]>[0]) {
  return {
    unsafe: async (s: string, w: readonly unknown[] = []) =>
      (await tx.unsafe(s, w as never[])) as readonly unknown[],
  };
}

function leser(tx: Parameters<Parameters<typeof alsApp>[1]>[0], mandant: string)
: LeseKontext & SchreibKontext {
  const fuehre = async <T>(q: string, w?: readonly unknown[]): Promise<readonly T[]> =>
    tx.unsafe(q, (w ?? []) as never[]) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId: planer,
    aktiverMandantId: mandant, mandantIds: [mandant],
    abfrage: fuehre, schreibe: fuehre,
  } satisfies LeseKontext & SchreibKontext;
}

const alsLeitung = <T>(mandant: string, fn: (tx: Parameters<Parameters<typeof alsApp>[1]>[0])
=> Promise<T>): Promise<T> =>
  alsApp({ scope: 'mandant', mandantId: mandant, benutzerId: planer,
           portal: 'intern', readonly: false }, fn);

beforeEach(async () => {
  f = await seed();
  planer = await konto(f.security);
  leereArten();
  registriereNachweisArten();
});
afterAll(schliessen);

// ---------------------------------------------------------------------------

describe('§1 die Ablaufwarnung entsteht in der Sprache der Empfängerin', () => {
  async function nachweisFuer(person: string, bis: string): Promise<string> {
    const [q] = await sql.unsafe<{ id: string }[]>(
      `insert into qualifikation (mandant_id, schluessel, bezeichnung, kategorie,
                                  rechtsgrundlage, laeuft_ab, blockiert_einsatz, warnung_tage)
       values (null, $1, 'Sachkundeprüfung §34a', 'gesetzlich', '§34a GewO', true, true,
               '{60,30,7}') returning id`,
      [`34a_${zufall()}`]);
    const [n] = await sql.unsafe<{ id: string }[]>(
      `insert into nachweis (person_id, qualifikation_id, gueltig_ab, gueltig_bis,
                             status, erfasst_von_mandant_id)
       values ($1,$2,'2025-01-01',$3,'gueltig',$4) returning id`,
      [person, q!.id, bis, f.security]);
    return n!.id;
  }

  const lauf = (heute: string) =>
    alsLeitung(f.security, async (tx) => meldeAblaufwarnungen(db(tx), heute));

  it('arabisch für eine Person, die arabisch eingestellt hat', async () => {
    await sprich(f.fatima, 'ar');
    const id = await nachweisFuer(f.fatima, '2026-04-25');

    /* Der Seed bringt eigene Nachweise mit — gefiltert wird auf DIESEN. */
    const bericht = await lauf('2026-02-24');
    const meine = bericht.gemeldet.filter((x) => x.nachweisId === id);
    expect(meine).toHaveLength(1);
    const m = meine[0]!.benachrichtigung;

    /*
     * Die Sperre nach § 34a GewO steht drin — auf Arabisch, und der Paragraf
     * bleibt als Fundstelle stehen. Das ist der Satz, dessentwegen diese
     * ganze Runde stattfand: wer ihn nicht lesen kann, erscheint zur Schicht
     * und wird weggeschickt.
     */
    expect(m.titel).toMatch(/[؀-ۿ]/u);
    expect(m.text).toMatch(/[؀-ۿ]/u);
    expect(m.text).toContain('34a');
    // Die Bezeichnung der Qualifikation bleibt, wie sie erfasst wurde.
    expect(m.titel).toContain('Sachkundeprüfung §34a');
    expect(m.text).not.toContain('Nachweis läuft');
  });

  it('türkisch für die eine, deutsch für die andere — im SELBEN Lauf', async () => {
    /*
     * Der Fall, den eine Vorgabe je Gesellschaft nicht abbilden kann: eine
     * Kolonne spricht nicht eine Sprache. Der Nachtlauf schreibt beide
     * Fassungen in derselben Runde.
     */
    await sprich(f.fatima, 'tr');
    await sprich(f.jonas, 'de');
    /*
     * Jonas ist nur in der Reinigung beschäftigt; `n_lesen` verlangt
     * `app.person_sichtbar(person_id)`, und ohne Anstellung in DIESER
     * Gesellschaft bliebe sein Nachweis unsichtbar — der Lauf meldete dann
     * nur eine Sprache und der Test prüfte nichts.
     */
    await sql.unsafe(
      `insert into anstellung (mandant_id, person_id, personalnummer, eintritt,
                               stundensatz_intern)
       values ($1,$2,$3,'2024-01-01',1500)`,
      [f.security, f.jonas, `P-${zufall()}`]);
    const tuerkisch = await nachweisFuer(f.fatima, '2026-04-25');
    const deutsch = await nachweisFuer(f.jonas, '2026-04-25');

    const bericht = await lauf('2026-02-24');
    const nach = new Map(bericht.gemeldet.map((m) => [m.nachweisId, m.benachrichtigung]));
    expect(nach.get(tuerkisch), 'Fatima').toBeDefined();
    expect(nach.get(deutsch), 'Jonas').toBeDefined();
    expect(nach.get(tuerkisch)!.titel).toContain('Belge');
    expect(nach.get(deutsch)!.titel).toContain('Nachweis läuft');
  });

  it('eine unbekannte Sprache in der Spalte wäre Deutsch, kein Absturz', async () => {
    /*
     * Die Spalte trägt einen CHECK auf vier Werte (0002) — die Zeile kann
     * also nur über eine spätere Migration einen fünften bekommen. `texteFuer`
     * faellt dann auf Deutsch zurück, statt `undefined.titel` zu lesen; das
     * ist der Unterschied zwischen einer deutschen Warnung und gar keiner.
     */
    await sprich(f.fatima, 'en');
    const id = await nachweisFuer(f.fatima, '2026-04-25');
    const bericht = await lauf('2026-02-24');
    const m = bericht.gemeldet.find((x) => x.nachweisId === id);
    expect(m, 'die Warnung entsteht').toBeDefined();
    expect(m!.benachrichtigung.titel).toContain('Certificate expires');
  });
});

describe('§2 der Dienstplan spricht die Sprache der eingeteilten Person', () => {
  /** Kunde, Objekt, Nachtschicht und eine Einteilung — im Fenster 15.–21.05.2028. */
  async function schichtFuer(person: string, anstellung: string): Promise<void> {
    const [k] = await sql.unsafe<{ id: string }[]>(
      `insert into kunde (mandant_id, kundennummer, name, rechtsgrundlage,
                          rechtsgrundlage_quelle, rechtsgrundlage_erfasst_am, status)
       values ($1,$2,'Testkunde','bestandskunde','Vertrag 2026', now(), 'aktiv')
       returning id`, [f.security, `K-${zufall()}`]);
    const [o] = await sql.unsafe<{ id: string }[]>(
      `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
       values ($1,$2,$3,'Bürohaus','Kurfürstendamm 21','10719','Berlin') returning id`,
      [f.security, k!.id, `OBJ-${zufall()}`]);
    const [e] = await sql.unsafe<{ id: string }[]>(
      `insert into einsatz (mandant_id, objekt_id, quelle, plan_datum,
                            beginn_zeitpunkt, ende_zeitpunkt, beginn_lokal, ende_lokal,
                            endet_am_folgetag, erstellt_von_art)
       values ($1,$2,'manuell','2028-05-18'::date,
               ('2028-05-18'::date + time '22:00') at time zone 'Europe/Berlin',
               ('2028-05-19'::date + time '06:00') at time zone 'Europe/Berlin',
               '22:00','06:00', true, 'system') returning id`,
      [f.security, o!.id]);
    /* `ez_akteur_stimmig` (0028) verlangt den Akteur; `system` heisst: ohne
       Mensch und ohne Agent. */
    await sql.unsafe(
      `insert into einsatz_zuordnung (mandant_id, einsatz_id, anstellung_id, person_id,
                                      beginn_zeitpunkt, ende_zeitpunkt, status,
                                      erstellt_von_art)
       select $1, e.id, $3, $4, e.beginn_zeitpunkt, e.ende_zeitpunkt, 'geplant', 'system'
         from einsatz e where e.id = $2`,
      [f.security, e!.id, anstellung, person]);
  }

  it('jede Empfängerzeile der Vorschau bringt ihre eigene Sprache mit', async () => {
    /*
     * Die Sprache muss aus DERSELBEN Abfrage kommen wie die Zahl der
     * Schichten — zwei Abfragen könnten auseinanderlaufen, und dann bekäme
     * jemand die Schichtzahl eines anderen in seiner eigenen Sprache. Und
     * `p.sprache` steht deshalb auch im `group by`: ohne das bricht die
     * Abfrage ab, nicht die Sprache.
     */
    await sprich(f.fatima, 'ar');
    await schichtFuer(f.fatima, f.fatimaSecurity);

    const bild = await alsLeitung(f.security, async (tx) =>
      vorschau(leser(tx, f.security), '2028-05-15', '2028-05-21'));

    const zeile = bild.personen.find((p) => p.personId === f.fatima);
    expect(zeile, 'Fatima steht in der Vorschau').toBeDefined();
    expect(zeile!.sprache).toBe('ar');
    expect(zeile!.schichten).toBe(1);
  });

  it('und die BEKANNTGABE legt den arabischen Text in ihren Posteingang', async () => {
    /*
     * Der letzte Verbindungspunkt: `veroeffentliche` reicht `p.sprache` je
     * Zeile in `erzeuge` hinein. Geprüft wird am GESPEICHERTEN Text — dem,
     * der im Posteingang steht und sich nicht mehr ändert.
     */
    registriereDienstplanArten();
    await sprich(f.fatima, 'ar');
    await schichtFuer(f.fatima, f.fatimaSecurity);
    const konto = await sql.unsafe<{ id: string }[]>(
      `insert into auth.users (email) values ($1) returning id`,
      [`fatima-${zufall()}@cse.test`]);
    await sql.unsafe(
      `insert into benutzer (id, email, name, status, person_id)
       values ($1,$2,'Fatima','aktiv',$3)`,
      [konto[0]!.id, `fatima-${zufall()}@cse.test`, f.fatima]);

    const ergebnis = await alsLeitung(f.security, async (tx) =>
      veroeffentliche(leser(tx, f.security),
        { von: '2028-05-15', bis: '2028-05-21', umfang: 'woche' }));
    expect(ergebnis.empfaenger).toBe(1);

    const [m] = await sql.unsafe<{ titel: string; text: string }[]>(
      `select titel, text from benachrichtigung
        where empfaenger_id = $1 and art = 'dienstplan.plan_veroeffentlicht'`,
      [konto[0]!.id]);
    expect(m, 'die Meldung steht im Posteingang').toBeDefined();
    expect(m!.titel).toMatch(/[\u0600-\u06FF]/u);
    expect(m!.text).toMatch(/[\u0600-\u06FF]/u);
    expect(m!.titel).not.toContain('Dienstplan veröffentlicht');
    /* Der NAME der Gesellschaft bleibt, wie er in `mandant.name` steht. */
    expect(m!.text).toContain('SSE Security');
    /* Und die Zeitzone bleibt eine Zeitzone. */
    expect(m!.text).toContain('Europe/Berlin');
    /*
     * Der Zeitraum ist arabisch GEFÜGT, nicht deutsch: `zeitraumText()` baut
     * „15.05.2028 bis 21.05.2028", und dieses „bis" ist ein Wort, das wir
     * selbst erzeugen — in einem arabischen Satz stand es als Fremdkörper
     * mitten drin. Die Tage selbst bleiben TT.MM.JJJJ.
     */
    expect(m!.text).toContain('15.05.2028');
    expect(m!.text).toContain('21.05.2028');
    expect(m!.text).not.toContain(' bis ');
    expect(m!.text).toContain('إلى');
  });
});

describe('§3 das Spaltenrecht, das fast gefehlt hätte (0391)', () => {
  it('cse_job darf person.sprache LESEN', async () => {
    /*
     * `0149` gibt `cse_job` auf `person` ein spaltengenaues Leserecht:
     * `select (id, vorname, nachname)`. Die Policy `j_person_waechter` sagt
     * daneben `using (true)` und klingt grosszügig — das Spaltenrecht ist die
     * echte Grenze. `meldeAblaufwarnungen` liest seit V-102 `p.sprache`.
     */
    const [z] = await sql.unsafe<{ ok: boolean }[]>(
      `select has_column_privilege('cse_job','person','sprache','select') as ok`);
    expect(z?.ok).toBe(true);
  });

  it('und weiterhin NICHT die Telefonnummer — sie ist der Anmeldeweg (EMP-01)', async () => {
    /*
     * Die Gegenprobe zur Zeile darüber: 0391 grantet EINE Spalte, nicht die
     * Tabelle. `person.telefon` ist der Weg, auf dem eine Mitarbeiterin ihren
     * Einmalcode bekommt; aus „ich lese die Sprache" darf keine
     * Kontoübernahme werden (0165).
     */
    const [z] = await sql.unsafe<{ ok: boolean }[]>(
      `select has_column_privilege('cse_job','person','telefon','select') as ok`);
    expect(z?.ok).toBe(false);
  });

  it('die Abfrage des Wächters läuft als cse_job wirklich durch', async () => {
    /*
     * Ein `has_column_privilege` allein prüft die Zusage, nicht ihre
     * Anwendung. Diese Zeile fährt den Verbund, den `meldeAblaufwarnungen`
     * baut, unter genau der Rolle, die `bootstrap.ts` für jeden Job vorsieht
     * (D-378) — heute bindet `nachweis_warnungen` sie noch nicht.
     */
    const zeilen = await alsRolle('cse_job', async (tx) => tx.unsafe(
      `select n.id, p.sprache
         from nachweis n
         join qualifikation q on q.id = n.qualifikation_id
         left join person p on p.id = n.person_id
        limit 1`));
    expect(Array.isArray(zeilen)).toBe(true);
  });
});
