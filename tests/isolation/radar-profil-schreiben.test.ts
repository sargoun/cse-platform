/**
 * Der Schreibweg eines Suchprofils gegen eine echte Datenbank (RAD-04,
 * RAD-05, Invariante 3, Invariante 10, O-15, O-98).
 *
 *  1. **Die Fassung ist die Spur.** Jede Änderung — an den Stammdaten, an
 *     einer CPV-Zeile, an einem Empfänger — zählt `radar_profil.version` hoch,
 *     und der nächste Lauf schreibt eine NEUE `bewertung` neben die alte. Das
 *     tun sieben Trigger, nicht der Dienst.
 *  2. **Und ein Speichern ohne Änderung zählt sie NICHT hoch.** Das ist der
 *     Fall, der ohne Prüfung schiefgeht: `geaendert_am = now()` machte jede
 *     Zeile „anders", also hätte jeder Klick auf „Speichern" die Fassung
 *     bewegt und für jede Bekanntmachung eine Bewertungszeile mit derselben
 *     Punktzahl erzeugt — eine Aufzeichnung, die eine Änderung behauptet, die
 *     keine war.
 *  3. **Die Wände**: ohne `radar.profil_schreiben` geht kein Schreiben durch,
 *     und zwar OHNE dass es wie ein Erfolg aussieht; ein fremder Bereich ist
 *     unsichtbar; in der Gruppenansicht wird nichts geschrieben.
 *  4. **Die Kindtabellen werden HART gelöscht** — sie tragen kein
 *     `geloescht_am`, und Invariante 8 nennt Radar nicht. Der Test hält fest,
 *     dass das geht UND dass es die Fassung bewegt.
 *  5. **Was gesperrt ist, bleibt gesperrt**: eine neue CPV-Zeile ist
 *     `ist_platzhalter` (O-98), ein neuer Empfänger hat keine Schwelle (O-15).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import {
  ProfilFehler, entferneCpv, entferneEmpfaenger, leseProfil, schreibeProfil,
  setzeCpv, setzeEmpfaenger,
} from '../../src/server/services/radar/profil.js';
import { cent, type Cent } from '../../src/server/services/finanz/geld.js';

let f: Fixtur;
let benutzer: string;
let profil: string;

const zufall = (): string => String(Math.random()).slice(2, 10);
const c = (wert: number | bigint): Cent => cent(BigInt(wert));

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

/**
 * Ein Konto DIESER Gesellschaft. `module` ist die Schnittmenge aus 0008:
 * `null` heisst „keine Einschraenkung", eine Liste heisst „nur diese". Damit
 * laesst sich `radar.profil_schreiben` entziehen, ohne eine Rolle zu
 * erfinden.
 */
async function konto(
  mandant: string, module: readonly string[] | null, rolle = 'admin',
): Promise<string> {
  const email = `profil-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,'Radarpflege','aktiv')`,
    [u!.id, email] as never[]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, module)
     values ($1,$2,$3,$4::text[])`,
    [u!.id, mandant, await rolleId(rolle),
      module === null ? null : `{${module.join(',')}}`] as never[]);
  return u!.id;
}

function kontext(
  tx: postgres.TransactionSql, mandantId?: string, benutzerId?: string,
): SchreibKontext {
  const abfrage = async <T>(a: string, w?: readonly unknown[]): Promise<readonly T[]> =>
    (await tx.unsafe(a, (w ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId: benutzerId ?? benutzer,
    aktiverMandantId: mandantId ?? f.reinigung, mandantIds: [mandantId ?? f.reinigung],
    abfrage, schreibe: abfrage,
  };
}

async function alsWer<T>(
  benutzerId: string, fn: (k: SchreibKontext) => Promise<T>, mandantId?: string,
): Promise<T> {
  return alsApp(
    { scope: 'mandant', mandantId: mandantId ?? f.reinigung, benutzerId,
      portal: 'intern', readonly: false },
    (tx) => fn(kontext(tx, mandantId, benutzerId)),
  );
}

async function version(): Promise<number> {
  const [z] = await sql.unsafe<{ version: number }[]>(
    `select version from radar_profil where id = $1`, [profil]);
  return z!.version;
}

/** Die Eingabe, die dem heutigen Stand entspricht — Grundlage jeder Änderung. */
const STAND = {
  name: 'Unterhaltsreinigung Berlin',
  nutsPraefixe: ['DE300'] as readonly string[],
  positivKeywords: ['Unterhaltsreinigung'] as readonly string[],
  negativKeywords: [] as readonly string[],
  wertMinCent: null as Cent | null,
  wertMaxCent: null as Cent | null,
  fristMinTage: null as number | null,
  oberhalbSchwellenwert: null as boolean | null,
  istAktiv: true,
};

beforeEach(async () => {
  f = await seed();
  benutzer = await konto(f.reinigung, null);
  const [p] = await sql.unsafe<{ id: string }[]>(
    `insert into radar_profil
       (mandant_id, name, nuts_praefixe, positiv_keywords)
     values ($1, $2, '{DE300}'::text[], '{Unterhaltsreinigung}'::text[])
     returning id`,
    [f.reinigung, STAND.name] as never[]);
  profil = p!.id;
});

afterAll(async () => {
  await schliessen();
});

describe('(1) die Fassung als Spur', () => {
  it('eine geänderte Suche zählt die Fassung hoch', async () => {
    expect(await version()).toBe(1);
    await alsWer(benutzer, (k) => schreibeProfil(k, profil, {
      ...STAND, positivKeywords: ['Unterhaltsreinigung', 'Glasreinigung'],
    }));
    expect(await version()).toBe(2);
  });

  it('und setzt `geaendert_am` samt `geaendert_von`', async () => {
    /*
     * `radar_profil` traegt keinen `setze_geaendert_am`-Trigger — nur den
     * Versionszaehler. Ohne die Zeile im Dienst blieb die Spalte leer, und
     * die Seite sagte „seit dem Anlegen unveraendert" ueber ein Profil, das
     * eben geaendert wurde.
     */
    await alsWer(benutzer, (k) => schreibeProfil(k, profil, { ...STAND, name: 'Neu' }));
    const [z] = await sql.unsafe<{ geaendert_am: Date | null; geaendert_von: string | null }[]>(
      `select geaendert_am, geaendert_von from radar_profil where id = $1`, [profil]);
    expect(z?.geaendert_am).not.toBeNull();
    expect(z?.geaendert_von).toBe(benutzer);
  });

  it('schreibt Vorher UND Nachher ins Protokoll', async () => {
    await alsWer(benutzer, (k) => schreibeProfil(k, profil, { ...STAND, name: 'Neu' }));
    const [z] = await sql.unsafe<{
      vorher: Record<string, unknown> | null; nachher: Record<string, unknown> | null;
      geaendert_felder: readonly string[] | null;
    }[]>(
      `select vorher, nachher, geaendert_felder from audit_log
        where aktion = 'radar.profil_gesetzt' and mandant_id = $1
        order by id desc limit 1`, [f.reinigung]);
    expect(z?.vorher?.['name']).toBe(STAND.name);
    expect(z?.nachher?.['name']).toBe('Neu');
    /* `app.protokolliere` leitet die Feldliste aus dem Unterschied ab. */
    expect(z?.geaendert_felder).toContain('name');
  });
});

describe('(2) ein Speichern ohne Änderung bewegt nichts', () => {
  it('zählt die Fassung NICHT hoch', async () => {
    /*
     * Der Fall, der ohne Pruefung schiefgeht. `geaendert_am = now()` macht die
     * Zeile immer „anders", und `trg_radar_profil_version` zaehlt hoch, sobald
     * irgendeine Spalte anders ist. Jeder Klick auf „Speichern" haette damit
     * eine neue Profilfassung erzeugt — und der naechste Nachtlauf fuer JEDE
     * Bekanntmachung eine Bewertungszeile mit derselben Punktzahl.
     */
    await alsWer(benutzer, (k) => schreibeProfil(k, profil, { ...STAND }));
    expect(await version()).toBe(1);
  });

  it('und schreibt auch keinen Protokolleintrag', async () => {
    await alsWer(benutzer, (k) => schreibeProfil(k, profil, { ...STAND }));
    const [z] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from audit_log
        where aktion = 'radar.profil_gesetzt' and mandant_id = $1`, [f.reinigung]);
    expect(z?.n).toBe('0');
  });

  it('erkennt eine Umsortierung der Stichwörter als Änderung', async () => {
    /*
     * Die Reihenfolge geht in den `eingaben_hash` einer Bewertung ein. Sie als
     * „gleich" zu behandeln waere bequem und falsch: die naechste Bewertung
     * haette einen anderen Hash, und die Fassung haette nichts davon gewusst.
     */
    await alsWer(benutzer, (k) => schreibeProfil(k, profil, {
      ...STAND, positivKeywords: ['Glasreinigung', 'Unterhaltsreinigung'],
    }));
    expect(await version()).toBe(2);
    await alsWer(benutzer, (k) => schreibeProfil(k, profil, {
      ...STAND, positivKeywords: ['Unterhaltsreinigung', 'Glasreinigung'],
    }));
    expect(await version()).toBe(3);
  });

  it('erkennt eine geänderte Wertgrenze am Cent', async () => {
    await alsWer(benutzer, (k) => schreibeProfil(k, profil, {
      ...STAND, wertMinCent: c(10_000_00),
    }));
    expect(await version()).toBe(2);
    /* Derselbe Betrag: keine Änderung. */
    await alsWer(benutzer, (k) => schreibeProfil(k, profil, {
      ...STAND, wertMinCent: c(10_000_00),
    }));
    expect(await version()).toBe(2);
    /* Ein Cent mehr: Änderung. */
    await alsWer(benutzer, (k) => schreibeProfil(k, profil, {
      ...STAND, wertMinCent: c(10_000_01),
    }));
    expect(await version()).toBe(3);
  });
});

describe('(3) die Wände', () => {
  it('ohne `radar.profil_schreiben` wird nicht geschrieben — und es sieht nicht wie ein Erfolg aus', async () => {
    /*
     * Die wichtige Haelfte ist der zweite Teil. Ein `update`, das null Zeilen
     * trifft, ist in Postgres ein Erfolg; ohne die Sperre und die Pruefung im
     * Dienst haette die Seite „gespeichert" gemeldet und nichts getan.
     */
    const ohne = await konto(f.reinigung, ['objekt']);
    await expect(alsWer(ohne, (k) => schreibeProfil(k, profil, { ...STAND, name: 'Fremd' })))
      .rejects.toThrow(ProfilFehler);
    const [z] = await sql.unsafe<{ name: string; version: number }[]>(
      `select name, version from radar_profil where id = $1`, [profil]);
    expect(z?.name).toBe(STAND.name);
    expect(z?.version).toBe(1);
  });

  it('ein fremder Bereich sieht das Profil nicht (Invariante 3)', async () => {
    const imBau = await konto(f.bau, null);
    expect(await alsWer(imBau, (k) => leseProfil(k, profil), f.bau)).toBeNull();
  });

  it('und schreibt es nicht', async () => {
    const imBau = await konto(f.bau, null);
    await expect(alsWer(imBau, (k) => schreibeProfil(k, profil, { ...STAND, name: 'X' }), f.bau))
      .rejects.toThrow(ProfilFehler);
  });

  it('in der Gruppenansicht wird nichts geschrieben (Invariante 10)', async () => {
    /*
     * `t_profil_schreiben` verlangt `not app.ist_readonly()`. Die Sperrklausel
     * `select … for update` wendet dieses `using` mit an — die Zeile ist damit
     * in der Gruppenansicht nicht sperrbar, und der Dienst weist ab, statt
     * still nichts zu tun.
     */
    const ergebnis = await alsApp(
      { scope: 'gruppe', mandantIds: [f.reinigung, f.bau], benutzerId: benutzer,
        readonly: true },
      (tx) => tx.unsafe(
        `update radar_profil set name = 'Gruppe' where id = $1 returning id`,
        [profil] as never[]),
    ) as unknown[];
    expect(ergebnis).toHaveLength(0);
  });

  it('ein archiviertes Profil wird weder gelesen noch geschrieben', async () => {
    await sql.unsafe(
      `update radar_profil set geloescht_am = now() where id = $1`, [profil] as never[]);
    expect(await alsWer(benutzer, (k) => leseProfil(k, profil))).toBeNull();
    await expect(alsWer(benutzer, (k) => schreibeProfil(k, profil, { ...STAND, name: 'X' })))
      .rejects.toThrow(ProfilFehler);
  });
});

describe('(4) die CPV-Zeilen', () => {
  it('eine neue Zeile ist ein PLATZHALTER (O-98) und zählt die Fassung hoch', async () => {
    await alsWer(benutzer, (k) => setzeCpv(k, profil, {
      code: '90910000', praefixLaenge: 8, wirkung: 'positiv',
      bezeichnung: 'Reinigungsdienste',
    }));
    const [z] = await sql.unsafe<{
      cpv_code: string; ist_platzhalter: boolean; gewichtung: number; wirkung: string;
    }[]>(
      `select cpv_code, ist_platzhalter, gewichtung, wirkung::text as wirkung
         from radar_profil_cpv where radar_profil_id = $1`, [profil]);
    expect(z?.cpv_code).toBe('90910000');
    /*
     * Nicht verhandelbar: die CPV-Listen der Gewerke sind gegen die amtliche
     * Liste unbestaetigt. Eine von Hand eingetragene Zeile ist eine Eingabe,
     * keine bestaetigte Leistungsart.
     */
    expect(z?.ist_platzhalter).toBe(true);
    /* Kein eigenes Gewicht: die Bewertung benutzt die Spalte nicht (O-15). */
    expect(z?.gewichtung).toBe(100);
    expect(await version()).toBe(2);
  });

  it('dieselbe Zeile zweimal legt keine zweite an, sondern ändert die Wirkung', async () => {
    await alsWer(benutzer, (k) => setzeCpv(k, profil, {
      code: '90910000', praefixLaenge: 8, wirkung: 'positiv', bezeichnung: null,
    }));
    await alsWer(benutzer, (k) => setzeCpv(k, profil, {
      code: '90910000', praefixLaenge: 8, wirkung: 'abzug', bezeichnung: null,
    }));
    const zeilen = await sql.unsafe<{ wirkung: string }[]>(
      `select wirkung::text as wirkung from radar_profil_cpv where radar_profil_id = $1`,
      [profil]);
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]?.wirkung).toBe('abzug');
  });

  it('derselbe Code mit anderer Präfixlänge ist eine ANDERE Zeile', async () => {
    /*
     * Der Eindeutigkeitsindex `rpc_uk` nimmt die Laenge mit — und das ist
     * fachlich richtig: `45000000` bei Laenge 2 fangt den ganzen Hochbau,
     * bei Laenge 8 genau einen Code.
     */
    await alsWer(benutzer, (k) => setzeCpv(k, profil, {
      code: '45000000', praefixLaenge: 2, wirkung: 'positiv', bezeichnung: null,
    }));
    await alsWer(benutzer, (k) => setzeCpv(k, profil, {
      code: '45000000', praefixLaenge: 8, wirkung: 'positiv', bezeichnung: null,
    }));
    const zeilen = await sql.unsafe<unknown[]>(
      `select id from radar_profil_cpv where radar_profil_id = $1`, [profil]);
    expect(zeilen).toHaveLength(2);
  });

  it('eine unsinnige Eingabe weist der Dienst ab, bevor die Datenbank es tut', async () => {
    await expect(alsWer(benutzer, (k) => setzeCpv(k, profil, {
      code: '9091', praefixLaenge: 8, wirkung: 'positiv', bezeichnung: null,
    }))).rejects.toThrow(ProfilFehler);
    await expect(alsWer(benutzer, (k) => setzeCpv(k, profil, {
      code: '90910000', praefixLaenge: 1, wirkung: 'positiv', bezeichnung: null,
    }))).rejects.toThrow(ProfilFehler);
  });

  it('entfernen löscht HART — und zählt die Fassung hoch', async () => {
    /*
     * `radar_profil_cpv` traegt kein `geloescht_am`, kein `ist_aktiv`, haengt
     * per `on delete cascade` am Profil und hat eigens `trg_rpc_version_del`.
     * Invariante 8 nennt Finanzen, Zeiterfassung und Audit — Radar nicht. Die
     * Spur bleibt: die Fassung springt, und das Protokoll haelt es fest.
     */
    await alsWer(benutzer, (k) => setzeCpv(k, profil, {
      code: '90910000', praefixLaenge: 8, wirkung: 'positiv', bezeichnung: null,
    }));
    const [zeile] = await sql.unsafe<{ id: string }[]>(
      `select id from radar_profil_cpv where radar_profil_id = $1`, [profil]);
    const vorher = await version();
    await alsWer(benutzer, (k) => entferneCpv(k, profil, zeile!.id));
    expect(await sql.unsafe(
      `select id from radar_profil_cpv where radar_profil_id = $1`, [profil] as never[],
    )).toHaveLength(0);
    expect(await version()).toBe(vorher + 1);
    const [log] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from audit_log
        where aktion = 'radar.profil_cpv_entfernt' and mandant_id = $1`, [f.reinigung]);
    expect(log?.n).toBe('1');
  });

  it('eine Zeile eines fremden Profils lässt sich nicht entfernen', async () => {
    const [fremdProfil] = await sql.unsafe<{ id: string }[]>(
      `insert into radar_profil (mandant_id, name) values ($1, 'Fremd') returning id`,
      [f.reinigung] as never[]);
    const [fremdCpv] = await sql.unsafe<{ id: string }[]>(
      `insert into radar_profil_cpv
         (mandant_id, radar_profil_id, cpv_code, praefix_laenge, wirkung)
       values ($1, $2, '79710000', 8, 'positiv') returning id`,
      [f.reinigung, fremdProfil!.id] as never[]);
    await expect(alsWer(benutzer, (k) => entferneCpv(k, profil, fremdCpv!.id)))
      .rejects.toThrow(ProfilFehler);
    expect(await sql.unsafe(
      `select id from radar_profil_cpv where id = $1`, [fremdCpv!.id] as never[],
    )).toHaveLength(1);
  });
});

describe('(5) die Empfänger', () => {
  it('werden OHNE Schwelle eingetragen (O-15) und zählen die Fassung hoch', async () => {
    /*
     * Ab welcher Punktzahl benachrichtigt wird, hat niemand entschieden. Eine
     * erfundene Zahl schickte entweder Post, deren Auswahlregel niemand
     * bestaetigt hat, oder verschwiege Treffer, die niemand sucht.
     */
    await alsWer(benutzer, (k) => setzeEmpfaenger(k, profil, benutzer));
    const [z] = await sql.unsafe<{ ab_punkte: number | null }[]>(
      `select ab_punkte from radar_profil_empfaenger where radar_profil_id = $1`, [profil]);
    expect(z?.ab_punkte).toBeNull();
    expect(await version()).toBe(2);
  });

  it('zweimal derselbe Empfänger ist kein Fehler und keine zweite Zeile', async () => {
    await alsWer(benutzer, (k) => setzeEmpfaenger(k, profil, benutzer));
    await alsWer(benutzer, (k) => setzeEmpfaenger(k, profil, benutzer));
    expect(await sql.unsafe(
      `select id from radar_profil_empfaenger where radar_profil_id = $1`,
      [profil] as never[])).toHaveLength(1);
  });

  it('ein Konto einer FREMDEN Gesellschaft weist die Datenbank ab', async () => {
    /*
     * `trg_rpe_empfaenger_im_mandant` besteht auf einer gueltigen
     * `benutzer_mandant`-Zeile in DIESEM Mandanten. Ohne den Trigger
     * bekaeme jemand aus dem Bau Treffermeldungen der Reinigung.
     */
    const imBau = await konto(f.bau, null);
    await expect(alsWer(benutzer, (k) => setzeEmpfaenger(k, profil, imBau)))
      .rejects.toThrow();
  });

  it('entfernen löscht hart und zählt die Fassung hoch', async () => {
    await alsWer(benutzer, (k) => setzeEmpfaenger(k, profil, benutzer));
    const [zeile] = await sql.unsafe<{ id: string }[]>(
      `select id from radar_profil_empfaenger where radar_profil_id = $1`, [profil]);
    const vorher = await version();
    await alsWer(benutzer, (k) => entferneEmpfaenger(k, profil, zeile!.id));
    expect(await sql.unsafe(
      `select id from radar_profil_empfaenger where radar_profil_id = $1`,
      [profil] as never[])).toHaveLength(0);
    expect(await version()).toBe(vorher + 1);
  });
});

describe('(6) `leseProfil` liest, was der Editor braucht', () => {
  it('liefert Stammdaten, CPV-Zeilen und Empfänger in einem Blick', async () => {
    await alsWer(benutzer, (k) => setzeCpv(k, profil, {
      code: '90910000', praefixLaenge: 8, wirkung: 'positiv', bezeichnung: 'Reinigung',
    }));
    await alsWer(benutzer, (k) => setzeEmpfaenger(k, profil, benutzer));
    const blick = await alsWer(benutzer, (k) => leseProfil(k, profil));
    expect(blick?.name).toBe(STAND.name);
    expect(blick?.nutsPraefixe).toEqual(['DE300']);
    expect(blick?.cpv).toHaveLength(1);
    expect(blick?.cpv[0]?.istPlatzhalter).toBe(true);
    expect(blick?.empfaenger).toHaveLength(1);
    expect(blick?.empfaenger[0]?.abPunkte).toBeNull();
    /* Die gesperrten Felder kommen mit — die Seite ZEIGT sie als gesperrt. */
    expect(blick?.skalaMax).toBe(100);
    expect(blick?.waehrung).toBe('EUR');
    expect(blick?.negativWirkung).toBe('abzug');
    expect(blick?.istPlatzhalter).toBe(true);
  });

  it('gibt für eine unbekannte Kennung null, nicht leere Felder', async () => {
    expect(await alsWer(
      benutzer, (k) => leseProfil(k, '00000000-0000-0000-0000-000000000000'))).toBeNull();
  });
});

/**
 * **Die drei Schreibhandlungen, die keine Spur hinterliessen** (Befund der
 * Prüfrunde).
 *
 * `setzeCpv`, `setzeEmpfaenger` und `entferneEmpfaenger` riefen
 * `app.protokolliere` nicht, während `schreibeProfil` und `entferneCpv` es
 * taten — und beide Kindtabellen tragen keinen Audit-Trigger, nur ihre
 * Versionszähler. Weil sie HART gelöscht werden, hiess das: wer einen
 * Benachrichtigungsempfänger einträgt oder wieder entfernt, tat das spurlos.
 * Der Zähler sprang zwar, sagte aber nur „irgendetwas hat sich geändert".
 */
describe('(7) jede Schreibhandlung hinterlässt eine Spur', () => {
  it('eine neue CPV-Zeile steht im Protokoll — mit Code und Wirkung', async () => {
    await alsWer(benutzer, (k) => setzeCpv(k, profil, {
      code: '90910000', praefixLaenge: 8, wirkung: 'positiv', bezeichnung: 'Reinigung',
    }));
    const [z] = await sql.unsafe<{
      objekt_id: string; nachher: Record<string, unknown> | null;
    }[]>(
      `select objekt_id, nachher from audit_log
        where aktion = 'radar.profil_cpv_gesetzt' and mandant_id = $1
        order by id desc limit 1`, [f.reinigung]);
    expect(z?.objekt_id).toBe(profil);
    expect(z?.nachher?.['cpvCode']).toBe('90910000');
    expect(z?.nachher?.['wirkung']).toBe('positiv');
  });

  it('ein eingetragener Empfänger steht im Protokoll', async () => {
    const wer = await konto(f.reinigung, null);
    await alsWer(benutzer, (k) => setzeEmpfaenger(k, profil, wer));
    const [z] = await sql.unsafe<{ nachher: Record<string, unknown> | null }[]>(
      `select nachher from audit_log
        where aktion = 'radar.profil_empfaenger_gesetzt' and mandant_id = $1
        order by id desc limit 1`, [f.reinigung]);
    expect(z?.nachher?.['benutzerId']).toBe(wer);
  });

  it('ein zweites Eintragen desselben Empfängers protokolliert NICHT', async () => {
    /*
     * `do nothing` aendert nichts, und eine Protokollzeile fuer eine Handlung
     * ohne Wirkung macht das Protokoll unlesbar — genau dort, wo es gelesen
     * wird, um eine Aenderung zu finden.
     */
    const wer = await konto(f.reinigung, null);
    await alsWer(benutzer, (k) => setzeEmpfaenger(k, profil, wer));
    await alsWer(benutzer, (k) => setzeEmpfaenger(k, profil, wer));
    const [z] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from audit_log
        where aktion = 'radar.profil_empfaenger_gesetzt' and mandant_id = $1`,
      [f.reinigung]);
    expect(z?.n).toBe('1');
  });

  it('ein entfernter Empfänger steht im Protokoll — VOR seinem Verschwinden', async () => {
    const wer = await konto(f.reinigung, null);
    await alsWer(benutzer, (k) => setzeEmpfaenger(k, profil, wer));
    const [e] = await sql.unsafe<{ id: string }[]>(
      `select id from radar_profil_empfaenger
        where radar_profil_id = $1 and benutzer_id = $2`, [profil, wer] as never[]);
    await alsWer(benutzer, (k) => entferneEmpfaenger(k, profil, e!.id));
    const [z] = await sql.unsafe<{ vorher: Record<string, unknown> | null }[]>(
      `select vorher from audit_log
        where aktion = 'radar.profil_empfaenger_entfernt' and mandant_id = $1
        order by id desc limit 1`, [f.reinigung]);
    /* Die Zeile ist weg — im Protokoll steht, WER sie war. */
    expect(z?.vorher?.['benutzerId']).toBe(wer);
  });
});

/**
 * **Entdoppelt wird nach dem Normalisieren** (Befund der Prüfrunde).
 *
 * `teileListe` entdoppelt die rohen Teile, `pruefeNutsPraefix` schreibt erst
 * danach gross: „de3, DE3" ergab `['DE3','DE3']`. Beim nächsten Öffnen und
 * Speichern entdoppelte `teileListe` die jetzt gleich geschriebenen Werte, der
 * Vergleich schlug an, und die Profilfassung sprang ohne inhaltliche Änderung
 * — genau das, was (2) sonst verhindert.
 */
describe('(8) doppelte NUTS-Präfixe nach dem Grossschreiben', () => {
  it('speichert jedes Präfix genau einmal', async () => {
    await alsWer(benutzer, (k) => schreibeProfil(k, profil, {
      ...STAND, nutsPraefixe: ['de3', 'DE3'],
    }));
    const [z] = await sql.unsafe<{ nuts_praefixe: readonly string[] }[]>(
      `select nuts_praefixe from radar_profil where id = $1`, [profil]);
    expect(z?.nuts_praefixe).toEqual(['DE3']);
  });

  it('und ein zweites Speichern derselben Eingabe bewegt die Fassung nicht', async () => {
    await alsWer(benutzer, (k) => schreibeProfil(k, profil, {
      ...STAND, nutsPraefixe: ['de3', 'DE3'],
    }));
    const nach = await version();
    /* Die Rückkehr aus dem Formular: dort steht jetzt „DE3", einmal. */
    await alsWer(benutzer, (k) => schreibeProfil(k, profil, {
      ...STAND, nutsPraefixe: ['DE3'],
    }));
    expect(await version()).toBe(nach);
  });
});
