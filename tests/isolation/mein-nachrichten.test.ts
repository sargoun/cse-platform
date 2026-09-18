/**
 * Der Posteingang der Kraft gegen echte Policies (EMP-11, NOT-03, D-09, K-18,
 * AUT-06, Invariante 7, Invariante 8, 0350).
 *
 * **Der Befund, den diese Datei beweist und einfriert.** Die Gruppenleitung
 * schrieb aus `/portal/[mandant]/nachrichten` eine interne Nachricht an eine
 * Mitarbeiterin. Die Oberfläche meldete „gesendet". In ihrem Konto kam nichts
 * an — weil `/portal/mein/nachrichten` `benachrichtigung` las und die
 * Nachricht in `nachricht` steht. Zwei verschiedene Tabellen.
 *
 * Geprüft wird deshalb nicht eine Behauptung über Policies, sondern der WEG,
 * den der Bildschirm nimmt: dieselben Dienstfunktionen, die die Seite aufruft,
 * gegen echtes Postgres, als `cse_app`, mit FORCE RLS.
 *
 * Die Sätze:
 *
 *  1. Eine Nachricht des Super-Admins an eine PERSON erreicht deren
 *     Posteingang — und den einer anderen Person nicht (der Isolationsbeweis,
 *     den der Auftrag verlangt).
 *  2. Dasselbe für `empfaenger_typ = 'benutzer'`: eine Anmelde-Id und eine
 *     Personen-Id sind zwei verschiedene Ids (D-09, §7.9 B11), und BEIDE
 *     Bindungen müssen tragen.
 *  3. Der Faden öffnet sich MIT dem Namen des Absenders — im Personen-Scope
 *     ist `benutzer` bis auf die eigene Zeile unlesbar (K-20), und der Name
 *     kommt aus `kern.nachricht_absender_name()` (0350).
 *  4. Dieselbe Funktion schweigt gegenüber jemandem, der nicht im Faden steht
 *     — sie ist kein Namensorakel.
 *  5. Die Gegenrichtung: die Kraft antwortet, und die Antwort kommt beim
 *     Absender als UNGELESEN an. Ein Faden, der nur in eine Richtung trägt,
 *     ist kein Faden.
 *  6. Und sie verlässt das Haus nicht: `intern`, `portal`, `ausstehend`.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import type { LeseKontext, SchreibKontext } from '../../src/server/kontext/index.js';
import {
  antwortZiele, fadenGeschlossen, ladeMeinenFaden, listeMeineFaeden, mandantDesFadens,
} from '../../src/server/services/mitarbeiter/nachricht.js';
import {
  antworte, eroeffneFaden, listeFaeden, markiereGelesen,
} from '../../src/server/services/kern/nachricht.js';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';

let f: Fixtur;
const zufall = (): string => Math.random().toString(36).slice(2, 10);

/** Ein Konto — mit oder ohne Person dahinter (D-09: das sind zwei Dinge). */
async function legeKontoAn(
  mandantId: string, rolle: string, name: string, personId: string | null = null,
): Promise<string> {
  const email = `mn-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, person_id)
     values ($1, $2, $3, 'aktiv', $4)`, [u!.id, email, name, personId]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1, $2, (select id from rolle where schluessel = $3 and mandant_id is null), true)`,
    [u!.id, mandantId, rolle]);
  return u!.id;
}

function kontextAus(
  tx: postgres.TransactionSql,
  z: { scope: 'mandant' | 'person'; mandantId: string | null; benutzerId: string },
): SchreibKontext {
  const fuehre = async <T,>(s: string, w?: readonly unknown[]): Promise<readonly T[]> =>
    tx.unsafe(s, (w ?? []) as never[]) as unknown as readonly T[];
  return {
    scope: z.scope,
    portal: z.scope === 'person' ? 'mitarbeiter' : 'intern',
    benutzerId: z.benutzerId,
    aktiverMandantId: z.mandantId as string,
    mandantIds: z.mandantId === null ? [] : [z.mandantId],
    abfrage: fuehre, schreibe: fuehre,
  } satisfies LeseKontext & SchreibKontext;
}

/** Die Sitzung einer Kraft: Personen-Scope, Portal `mitarbeiter`, lesend. */
function alsKraft<T>(
  benutzerId: string, personId: string, mandanten: readonly string[],
  fn: (k: LeseKontext) => Promise<T>,
): Promise<T> {
  return alsApp(
    { scope: 'person', mandantIds: mandanten, benutzerId, personId, readonly: true },
    async (tx) => fn(kontextAus(tx, { scope: 'person', mandantId: null, benutzerId })),
  );
}

/**
 * Dieselbe Kraft, aber SCHREIBEND — und genau so, wie
 * `api/mein/nachrichten/[id]` es tut: Mandant im Personen-Scope aufgelöst,
 * dann `withTenant` mit `portal: 'mitarbeiter'`, damit die K-04-Decke bleibt
 * (K-18). Hier nachgebaut, weil die Route selbst keine Datenbank annimmt.
 */
function alsKraftSchreibend<T>(
  benutzerId: string, personId: string, mandantId: string,
  fn: (k: SchreibKontext) => Promise<T>,
): Promise<T> {
  return alsApp(
    { scope: 'mandant', mandantId, benutzerId, personId, portal: 'mitarbeiter',
      readonly: false },
    async (tx) => fn(kontextAus(tx, { scope: 'mandant', mandantId, benutzerId })),
  );
}

/** Und die Leitung: Mandantenscope, internes Portal, schreibend. */
function alsLeitung<T>(
  benutzerId: string, mandantId: string, fn: (k: SchreibKontext) => Promise<T>,
): Promise<T> {
  return alsApp(
    { scope: 'mandant', mandantId, benutzerId, portal: 'intern', readonly: false },
    async (tx) => fn(kontextAus(tx, { scope: 'mandant', mandantId, benutzerId })),
  );
}

interface Aufbau {
  readonly chef: string;
  readonly fatima: string;
  readonly jonas: string;
}

async function aufbau(): Promise<Aufbau> {
  return {
    chef: await legeKontoAn(f.reinigung, 'leitung', 'Leitung Reinigung'),
    fatima: await legeKontoAn(f.reinigung, 'mitarbeiter', 'Fatima Yildiz', f.fatima),
    jonas: await legeKontoAn(f.reinigung, 'mitarbeiter', 'Jonas Weber', f.jonas),
  };
}

/**
 * Die Antwort, so wie `api/mein/nachrichten/[id]` sie schreibt: der
 * FACHDIENST `antworte` (services/kern/nachricht.ts), mit ÜBERGEBENEN
 * Empfängern. Kein Dienst unter `services/mitarbeiter/` schreibt — das ist
 * eine Zusage des Dienstregisters (`tests/kern/mitarbeiter.test.ts`).
 */
function antwortEingabe(koerper: string, ziele: readonly string[]) {
  return {
    koerper,
    empfaenger: ziele.map((id) => ({ typ: 'benutzer' as const, id, art: 'an' as const })),
  };
}

beforeEach(async () => { f = await seed(); });
afterAll(schliessen);

describe('(1) eine Nachricht des Super-Admins an eine PERSON erreicht sie', () => {
  it('sie steht in IHREM Posteingang — und mit der richtigen Ungelesen-Zahl', async () => {
    const a = await aufbau();
    const thread = await alsLeitung(a.chef, f.reinigung, async (k) => eroeffneFaden(k, {
      betreff: 'Schlüsselübergabe Mitte',
      koerper: 'Bitte morgen den Schlüssel bei der Einsatzleitung abholen.',
      empfaenger: [{ typ: 'person', id: f.fatima, art: 'an' }],
    }));

    const meine = await alsKraft(a.fatima, f.fatima, [f.reinigung],
                                 async (k) => listeMeineFaeden(k));
    expect(meine.map((m) => m.betreff)).toEqual(['Schlüsselübergabe Mitte']);
    expect(meine[0]?.threadId).toBe(thread);
    expect(meine[0]?.ungelesen).toBe(1);
    /* Die Gesellschaft steht an der Zeile: ein Mensch, zwei GmbHs (D-09). */
    expect(meine[0]?.mandantSlug).toBe('reinigung');
  });

  it('und im Posteingang einer ANDEREN Person steht sie nicht', async () => {
    const a = await aufbau();
    await alsLeitung(a.chef, f.reinigung, async (k) => eroeffneFaden(k, {
      betreff: 'Nur für Fatima',
      koerper: 'Vertraulich.',
      empfaenger: [{ typ: 'person', id: f.fatima, art: 'an' }],
    }));

    const fremd = await alsKraft(a.jonas, f.jonas, [f.reinigung],
                                 async (k) => listeMeineFaeden(k));
    expect(fremd).toEqual([]);
  });

  it('`ladeMeinenFaden` gibt einem Fremden `null` — 404, nie 403 (AUT-06)', async () => {
    const a = await aufbau();
    const thread = await alsLeitung(a.chef, f.reinigung, async (k) => eroeffneFaden(k, {
      betreff: 'Nur für Fatima', koerper: 'Vertraulich.',
      empfaenger: [{ typ: 'person', id: f.fatima, art: 'an' }],
    }));

    expect(await alsKraft(a.jonas, f.jonas, [f.reinigung],
                          async (k) => ladeMeinenFaden(k, thread))).toBeNull();
    /*
     * „Gibt es nicht" und „darf ich nicht" sind byte-gleich. Auch der Mandant
     * des Fadens — die Angabe, aus der die Route ihren Schreibscope baut —
     * bleibt dem Fremden verborgen; sonst wäre der Umweg über zwei Scopes das
     * Leck, das er verhindern soll (K-18).
     */
    expect(await alsKraft(a.jonas, f.jonas, [f.reinigung],
                          async (k) => mandantDesFadens(k, thread))).toBeNull();
  });
});

describe('(2) `benutzer` und `person` sind zwei verschiedene Ids (D-09, B11)', () => {
  it('an die ANMELDE-Id adressiert kommt ebenfalls an', async () => {
    const a = await aufbau();
    await alsLeitung(a.chef, f.reinigung, async (k) => eroeffneFaden(k, {
      betreff: 'An das Konto',
      koerper: 'Die Wahl der Empfängerart darf den Posteingang nicht entscheiden.',
      empfaenger: [{ typ: 'benutzer', id: a.fatima, art: 'an' }],
    }));

    const meine = await alsKraft(a.fatima, f.fatima, [f.reinigung],
                                 async (k) => listeMeineFaeden(k));
    expect(meine.map((m) => m.betreff)).toEqual(['An das Konto']);
    expect(meine[0]?.ungelesen).toBe(1);
  });

  it('und an eine andere Anmelde-Id adressiert nicht', async () => {
    const a = await aufbau();
    await alsLeitung(a.chef, f.reinigung, async (k) => eroeffneFaden(k, {
      betreff: 'An Jonas’ Konto', koerper: 'Nicht für Fatima.',
      empfaenger: [{ typ: 'benutzer', id: a.jonas, art: 'an' }],
    }));

    expect(await alsKraft(a.fatima, f.fatima, [f.reinigung],
                          async (k) => listeMeineFaeden(k))).toEqual([]);
  });

  it('die Mandantengrenze gilt auch im Personen-Scope', async () => {
    const a = await aufbau();
    const chefBau = await legeKontoAn(f.bau, 'leitung', 'Leitung Bau');
    await alsLeitung(chefBau, f.bau, async (k) => eroeffneFaden(k, {
      betreff: 'Aus dem Bau', koerper: 'Fatima arbeitet hier nicht.',
      empfaenger: [{ typ: 'person', id: f.fatima, art: 'an' }],
    }));

    /*
     * `app.sichtbare_mandanten()` ist im Personen-Scope die Menge der lebenden
     * Beschäftigungen (0004) — im Bau hat Fatima keine. Die Zeile fällt an
     * `t_nachricht_eigene`, nicht an einer Prüfung in der Anwendung.
     */
    expect(await alsKraft(a.fatima, f.fatima, [f.reinigung],
                          async (k) => listeMeineFaeden(k))).toEqual([]);
  });
});

describe('(3) der Name des Absenders steht auf dem Bildschirm', () => {
  it('der Faden öffnet sich mit Betreff, Text und Absendername', async () => {
    const a = await aufbau();
    const thread = await alsLeitung(a.chef, f.reinigung, async (k) => eroeffneFaden(k, {
      betreff: 'Einsatz Freitag',
      koerper: 'Beginn 06:00, Treffpunkt Hausmeisterloge.',
      empfaenger: [{ typ: 'person', id: f.fatima, art: 'an' }],
    }));

    const faden = await alsKraft(a.fatima, f.fatima, [f.reinigung],
                                 async (k) => ladeMeinenFaden(k, thread));
    expect(faden?.betreff).toBe('Einsatz Freitag');
    expect(faden?.ungelesen).toBe(1);
    expect(faden?.zeilen).toHaveLength(1);
    expect(faden?.zeilen[0]?.koerper).toContain('06:00');
    expect(faden?.zeilen[0]?.anMich).toBe(true);
    expect(faden?.zeilen[0]?.vonMir).toBe(false);
    /*
     * **Der Punkt dieser Zusage.** `t_benutzer_lesen` (0007) gibt einer
     * Mitarbeitersitzung nur die EIGENE Zeile heraus — ein `join` auf
     * `benutzer` lieferte hier stillschweigend NULL, und auf dem Telefon
     * stünde „Nachricht von —".
     */
    expect(faden?.zeilen[0]?.absender).toBe('Leitung Reinigung');
  });

  it('die Liste zeigt denselben Namen am Fadenkopf', async () => {
    const a = await aufbau();
    await alsLeitung(a.chef, f.reinigung, async (k) => eroeffneFaden(k, {
      betreff: 'Einsatz Freitag', koerper: 'Beginn 06:00.',
      empfaenger: [{ typ: 'person', id: f.fatima, art: 'an' }],
    }));
    const meine = await alsKraft(a.fatima, f.fatima, [f.reinigung],
                                 async (k) => listeMeineFaeden(k));
    expect(meine[0]?.absender).toBe('Leitung Reinigung');
    expect(meine[0]?.letzteVonMir).toBe(false);
  });
});

describe('(3b) Anlagen — die ZAHL trägt, die Datei nicht (O-831)', () => {
  it('eine Anlage wird gezählt, auch im Personen-Scope', async () => {
    const a = await aufbau();
    const thread = await alsLeitung(a.chef, f.reinigung, async (k) => eroeffneFaden(k, {
      betreff: 'Dienstplan', koerper: 'Anbei der Plan.',
      empfaenger: [{ typ: 'person', id: f.fatima, art: 'an' }],
    }));
    const [d] = await sql.unsafe<{ id: string }[]>(
      `insert into dokument (mandant_id, kategorie, titel, objekt_schluessel,
                             mime_typ, mime_verifiziert, groesse_bytes, exif_entfernt)
       values ($1::uuid, 'mitarbeiter', 'Dienstplan', $2, 'application/pdf', true, 100, true)
       returning id`, [f.reinigung, `rein/${zufall()}.pdf`]);
    await sql.unsafe(
      `insert into nachricht_anhang (mandant_id, nachricht_id, dokument_id)
       values ($1::uuid, $2::uuid, $3::uuid)`, [f.reinigung, thread, d!.id]);

    /*
     * `t_anhang_eigene` (0231) gibt die KINDZEILE im Personen-Scope heraus —
     * die Datei hängt an `dokument` und bleibt dort. Eine Nachricht mit einer
     * Anlage, die auf dem Telefon aussieht wie eine ohne, wäre die schlechtere
     * Antwort: dann sucht niemand nach der Datei, von der sie spricht.
     */
    const faden = await alsKraft(a.fatima, f.fatima, [f.reinigung],
                                 async (k) => ladeMeinenFaden(k, thread));
    expect(faden?.zeilen[0]?.anhaenge).toBe(1);

    /* Und die Datei selbst bleibt zu — O-831 ist offen, nicht halb gebaut. */
    const dokumente = await alsApp(
      { scope: 'person', mandantIds: [f.reinigung], benutzerId: a.fatima,
        personId: f.fatima, readonly: true },
      async (tx) => tx.unsafe(`select id from dokument where id = $1::uuid`,
                              [d!.id] as never[]),
    ) as readonly unknown[];
    expect(dokumente).toEqual([]);
  });
});

describe('(4) `kern.nachricht_absender_name` ist kein Namensorakel', () => {
  it('wer nicht im Faden steht, bekommt NULL statt eines Namens', async () => {
    const a = await aufbau();
    const thread = await alsLeitung(a.chef, f.reinigung, async (k) => eroeffneFaden(k, {
      betreff: 'Nur für Fatima', koerper: 'Vertraulich.',
      empfaenger: [{ typ: 'person', id: f.fatima, art: 'an' }],
    }));
    const [zeile] = await sql.unsafe<{ id: string }[]>(
      `select id from nachricht where thread_id = $1`, [thread]);

    /*
     * Gefragt wird mit der ECHTEN Id — die Funktion schützt sich nicht durch
     * Unkenntnis des Aufrufers, sondern durch die Beteiligung der Sitzung.
     * Ohne diese Bedingung wäre sie ein Verzeichnis: wer uuids durchprobiert,
     * erführe, welche Konten es gibt und wie sie heissen.
     */
    const fremd = await alsApp(
      { scope: 'person', mandantIds: [f.reinigung], benutzerId: a.jonas,
        personId: f.jonas, readonly: true },
      async (tx) => tx.unsafe(
        `select kern.nachricht_absender_name($1::uuid) as name`, [zeile!.id] as never[]),
    ) as readonly { name: string | null }[];
    expect(fremd[0]?.name).toBeNull();
  });
});

describe('(5) die Gegenrichtung — die Antwort kommt an', () => {
  it('die Kraft antwortet, und die Absenderin sieht es als ungelesen', async () => {
    const a = await aufbau();
    const thread = await alsLeitung(a.chef, f.reinigung, async (k) => eroeffneFaden(k, {
      betreff: 'Einsatz Freitag', koerper: 'Beginn 06:00?',
      empfaenger: [{ typ: 'person', id: f.fatima, art: 'an' }],
    }));

    /* Der Weg der Route: Mandant im Personen-Scope, Ziele im Personen-Scope. */
    const mandantId = await alsKraft(a.fatima, f.fatima, [f.reinigung],
                                     async (k) => mandantDesFadens(k, thread));
    expect(mandantId).toBe(f.reinigung);
    const ziele = await alsKraft(a.fatima, f.fatima, [f.reinigung],
                                 async (k) => antwortZiele(k, thread));
    expect(ziele).toEqual([a.chef]);
    expect(await alsKraft(a.fatima, f.fatima, [f.reinigung],
                          async (k) => fadenGeschlossen(k, thread))).toBe(false);

    const neu = await alsKraftSchreibend(a.fatima, f.fatima, f.reinigung, async (k) => {
      await markiereGelesen(k, thread);
      return antworte(k, thread, antwortEingabe('Ja, ich bin um 06:00 da.', ziele));
    });
    expect(neu).not.toBeNull();

    /*
     * **Der eigentliche Beweis.** Ohne die Empfängerzeile auf die Leitung —
     * die `p_beteiligt` bis 0350 ausserhalb des internen Portals nicht
     * zuliess — stünde die Antwort zwar im Faden, aber mit `ungelesen = 0`:
     * `listeFaeden` zählt nur EIGENE Empfängerzeilen. Der Faden trüge dann in
     * eine Richtung.
     */
    const beimChef = await alsLeitung(a.chef, f.reinigung, async (k) => listeFaeden(k));
    const kopf = beimChef.find((x) => x.threadId === thread);
    expect(kopf?.anzahl).toBe(2);
    expect(kopf?.ungelesen).toBe(1);
    expect(kopf?.auszug).toContain('06:00 da');

    /* Und die Kraft selbst hat nichts Offenes mehr — sie hat gelesen und geantwortet. */
    const beiIhr = await alsKraft(a.fatima, f.fatima, [f.reinigung],
                                  async (k) => ladeMeinenFaden(k, thread));
    expect(beiIhr?.zeilen).toHaveLength(2);
    expect(beiIhr?.ungelesen).toBe(0);
    expect(beiIhr?.zeilen[1]?.vonMir).toBe(true);
  });

  it('sie kann NICHT in einen fremden Faden antworten', async () => {
    const a = await aufbau();
    const thread = await alsLeitung(a.chef, f.reinigung, async (k) => eroeffneFaden(k, {
      betreff: 'Für Jonas', koerper: 'Nicht für Fatima.',
      empfaenger: [{ typ: 'person', id: f.jonas, art: 'an' }],
    }));

    /*
     * Die Route bricht schon hier ab — und das ist die Stelle, an der sie es
     * tun soll: ohne Mandanten gibt es keinen Schreibscope (K-18), und die
     * Antwort nach aussen ist 404 statt 403 (AUT-06).
     */
    expect(await alsKraft(a.fatima, f.fatima, [f.reinigung],
                          async (k) => mandantDesFadens(k, thread))).toBeNull();

    /*
     * Und selbst wer den Scope erzwingt, schreibt nichts: `antworte` findet
     * unter der K-04-Decke keine Elternzeile. Die zweite Linie steht, auch
     * wenn die erste umgangen wird.
     */
    const versuch = await alsKraftSchreibend(a.fatima, f.fatima, f.reinigung,
                                             async (k) => antworte(
                                               k, thread,
                                               antwortEingabe('Dazwischengerufen.', [a.chef])));
    expect(versuch).toBeNull();
  });

  it('in einen GESCHLOSSENEN Faden nimmt niemand mehr etwas auf (Invariante 8)', async () => {
    const a = await aufbau();
    const thread = await alsLeitung(a.chef, f.reinigung, async (k) => eroeffneFaden(k, {
      betreff: 'Erledigt', koerper: 'Danke, abgeschlossen.',
      empfaenger: [{ typ: 'person', id: f.fatima, art: 'an' }],
    }));
    await sql.unsafe(`update nachricht set geschlossen_am = now() where id = $1`, [thread]);

    expect(await alsKraft(a.fatima, f.fatima, [f.reinigung],
                          async (k) => fadenGeschlossen(k, thread))).toBe(true);
    await expect(alsKraftSchreibend(a.fatima, f.fatima, f.reinigung,
                                    async (k) => antworte(k, thread,
                                                          antwortEingabe('Doch noch.', []))))
      .rejects.toThrow(/geschlossen/u);
  });
});

describe('(6) nichts verlässt das System (Invariante 7)', () => {
  it('die Antwort ist intern, im Portal, und nichts ist hinausgegangen', async () => {
    const a = await aufbau();
    const thread = await alsLeitung(a.chef, f.reinigung, async (k) => eroeffneFaden(k, {
      betreff: 'Frage', koerper: 'Bitte kurz melden.',
      empfaenger: [{ typ: 'person', id: f.fatima, art: 'an' }],
    }));
    const neu = await alsKraftSchreibend(a.fatima, f.fatima, f.reinigung,
                                         async (k) => antworte(
                                           k, thread,
                                           antwortEingabe('Melde mich.', [a.chef])));

    const [z] = await sql.unsafe<{
      richtung: string; kanal: string; stand: string; gesendet: string | null;
    }[]>(
      `select richtung::text as richtung, kanal::text as kanal,
              zustell_status::text as stand, gesendet_am::text as gesendet
         from nachricht where id = $1`, [neu]);
    expect(z?.richtung).toBe('intern');
    expect(z?.kanal).toBe('portal');
    /* Kein Versender ist verbunden (O-36) — und die Zeile behauptet nichts anderes. */
    expect(z?.stand).toBe('ausstehend');
    expect(z?.gesendet).toBeNull();
  });

  it('der Gelesen-Stempel trifft nur die EIGENE Zeile', async () => {
    const a = await aufbau();
    const meiner = await alsLeitung(a.chef, f.reinigung, async (k) => eroeffneFaden(k, {
      betreff: 'An Fatima', koerper: 'Für dich.',
      empfaenger: [{ typ: 'person', id: f.fatima, art: 'an' },
                   { typ: 'person', id: f.jonas, art: 'kopie' }],
    }));

    const getroffen = await alsKraftSchreibend(a.fatima, f.fatima, f.reinigung,
                                               async (k) => markiereGelesen(k, meiner));
    expect(getroffen).toBe(1);

    /* Jonas' Kopie bleibt ungelesen — sein Lesestand ist seiner. */
    const beiJonas = await alsKraft(a.jonas, f.jonas, [f.reinigung],
                                    async (k) => listeMeineFaeden(k));
    expect(beiJonas.find((x) => x.threadId === meiner)?.ungelesen).toBe(1);
  });
});
