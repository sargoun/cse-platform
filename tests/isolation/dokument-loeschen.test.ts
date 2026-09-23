import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import { LokalerSpeicher, type Bucket, type Speicher } from '../../src/server/storage/adapter.js';
import {
  LoeschungFehler, loescheDokument,
} from '../../src/server/services/dokument/loeschung.js';

/**
 * **Ein Mensch kann ein Dokument löschen** (V-026, DOC-07, LEG-01).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `services/dokument/loeschung.ts` ist der EINE Weg, auf dem ein Dokument
 * samt Datei verschwindet — gebaut, geprüft, mit zwei Auslösern dahinter.
 * Aufgerufen hat ihn genau einer: der Nachtlauf `dokument_aufbewahrung`
 * (V-116). **Ein Mensch konnte nichts löschen** — auch nicht die Datei, die
 * vor zwei Minuten beim falschen Kunden landete. `dokument.archivieren` stand
 * im Katalog und war an keine Seite und an keine Route gebunden.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Was hier geprüft wird, und was ausdrücklich nicht.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Geprüft wird, dass der WEG jetzt einen menschlichen Aufrufer hat und dass
 * die beiden Riegel dabei halten: `kern.dokument_loeschsperre` (0009) und
 * `fin.dokument_haengt_an_buchung` (0132). Beide stehen VOR der Zeile und
 * gelten für jeden Weg — der Dienst baut sie nicht nach, und diese Datei
 * prüft sie an der echten Datenbank statt an einer zweiten Fassung.
 *
 * Und geprüft wird die REIHENFOLGE: erst die Zeile, dann das Objekt. Wer sie
 * umdreht, hinterlässt bei einer abgewiesenen Löschung einen leeren Bucket
 * unter einer Zeile, die noch auf die Datei zeigt — genau der Zustand, den
 * eine Betriebsprüfung „Beleg nicht vorgelegt" nennt.
 */

let f: Fixtur;
let mensch = '';

const zufall = (): string => Math.random().toString(36).slice(2, 10);

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function konto(mandant: string, rolle: string): Promise<string> {
  const email = `dok-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,'Ablage','aktiv')`,
    [u!.id, email] as never[]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1,$2,$3,true)`, [u!.id, mandant, await rolleId(rolle)] as never[]);
  return u!.id;
}

interface Abgelegt {
  readonly id: string;
  readonly bucket: Bucket;
  readonly schluessel: string;
}

/**
 * Ein Dokument mit einer Datei im Speicher — beides, sonst prüft die
 * Reihenfolge unten nichts.
 */
async function abgelegt(
  speicher: Speicher, kategorie: string, mandant = f.reinigung,
): Promise<Abgelegt> {
  const schluessel = `${mandant}/${kategorie}/${zufall()}.pdf`;
  const [d] = await sql.unsafe<{ id: string; bucket: string }[]>(
    `insert into dokument
       (mandant_id, kategorie, titel, objekt_schluessel, mime_typ, mime_verifiziert,
        groesse_bytes, exif_entfernt)
     values ($1,$2::dokument_kategorie,'Angebot Muster',$3,'application/pdf',true,2048,true)
     returning id, bucket`,
    [mandant, kategorie, schluessel] as never[]);
  await speicher.lege(d!.bucket as Bucket, schluessel, new Uint8Array([1, 2, 3]));
  return { id: d!.id, bucket: d!.bucket as Bucket, schluessel };
}

function kontext(tx: postgres.TransactionSql, mandantId: string, benutzerId: string): SchreibKontext {
  const lauf = async <T>(a: string, w?: readonly unknown[]): Promise<readonly T[]> =>
    (await tx.unsafe(a, (w ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId,
    aktiverMandantId: mandantId, mandantIds: [mandantId],
    abfrage: lauf, schreibe: lauf,
  };
}

async function alsWer<T>(
  benutzerId: string, fn: (k: SchreibKontext) => Promise<T>,
  o: { readonly mandantId?: string; readonly readonly?: boolean } = {},
): Promise<T> {
  const mandantId = o.mandantId ?? f.reinigung;
  return alsApp(
    { scope: 'mandant', mandantId, benutzerId, portal: 'intern',
      readonly: o.readonly ?? false, aal: 'aal2' },
    (tx) => fn(kontext(tx, mandantId, benutzerId)),
  );
}

interface Stand {
  readonly weg: boolean;
  readonly grund: string | null;
  readonly von: string | null;
}

async function stand(id: string): Promise<Stand> {
  const [z] = await sql.unsafe<{
    geloescht: string | null; loeschgrund: string | null; geloescht_von: string | null;
  }[]>(
    `select geloescht_am::text as geloescht, loeschgrund, geloescht_von::text as geloescht_von
       from dokument where id = $1`, [id] as never[]);
  return { weg: z?.geloescht !== null, grund: z?.loeschgrund ?? null,
           von: z?.geloescht_von ?? null };
}

beforeEach(async () => {
  f = await seed();
  /*
   * `leitung` hält `dokument.archivieren` per Plattformvorgabe — der Katalog
   * bindet es an `super_admin`, `admin` und `leitung`. Genommen wird
   * ausdrücklich die UNTERSTE der drei: hält es dort, hält es überall.
   */
  mensch = await konto(f.reinigung, 'leitung');
});
afterAll(schliessen);

describe('§1 der menschliche Weg', () => {
  it('löscht die Zeile UND die Datei — und schreibt Grund und Person dazu', async () => {
    const speicher = new LokalerSpeicher();
    const d = await abgelegt(speicher, 'angebot');
    expect(speicher.rohBytes(d.bucket, d.schluessel)).toBeDefined();

    const ort = await alsWer(mensch, (k) => loescheDokument(k, speicher, {
      dokumentId: d.id, grund: 'Versehentlich beim falschen Kunden abgelegt.',
    }));
    expect(ort.objektSchluessel).toBe(d.schluessel);

    /* Die Datei ist fort. */
    expect(speicher.rohBytes(d.bucket, d.schluessel)).toBeUndefined();
    /* Die Zeile bleibt — mit Zeitpunkt, Grund und Person (Invariante 8). */
    const z = await stand(d.id);
    expect(z.weg).toBe(true);
    expect(z.grund).toBe('Versehentlich beim falschen Kunden abgelegt.');
    expect(z.von).toBe(mensch);
  });

  it('weist einen zu kurzen Grund ab — und fasst nichts an', async () => {
    const speicher = new LokalerSpeicher();
    const d = await abgelegt(speicher, 'angebot');
    await expect(alsWer(mensch, (k) => loescheDokument(k, speicher, {
      dokumentId: d.id, grund: 'weg',
    }))).rejects.toMatchObject({ grund: 'grund' });
    expect(speicher.rohBytes(d.bucket, d.schluessel)).toBeDefined();
    expect((await stand(d.id)).weg).toBe(false);
  });

  it('löscht auch, solange die Aufbewahrungsfrist noch LÄUFT', async () => {
    /*
     * Nur `loeschsperre` sperrt; `aufbewahrung_bis` steuert den Nachtlauf.
     * Ein versehentlich abgelegtes Angebots-PDF sechs Jahre stehen lassen zu
     * müssen wäre keine Aufbewahrung, sondern ein fehlender Weg — und die
     * Seite sagt in genau diesem Fall, dass die Frist noch läuft.
     */
    const speicher = new LokalerSpeicher();
    const d = await abgelegt(speicher, 'angebot');
    const [z] = await sql.unsafe<{ laeuft: boolean; sperre: boolean }[]>(
      `select aufbewahrung_bis > app.berlin_heute() as laeuft, loeschsperre as sperre
         from dokument where id = $1`, [d.id] as never[]);
    expect(z?.laeuft, 'sechs Jahre nach § 257 HGB').toBe(true);
    expect(z?.sperre).toBe(false);

    await alsWer(mensch, (k) => loescheDokument(k, speicher, {
      dokumentId: d.id, grund: 'Falsche Datei hochgeladen, Ersatz liegt daneben.',
    }));
    expect((await stand(d.id)).weg).toBe(true);
  });

  it('ein zweites Mal geht nicht — gelöscht ist gelöscht', async () => {
    const speicher = new LokalerSpeicher();
    const d = await abgelegt(speicher, 'angebot');
    await alsWer(mensch, (k) => loescheDokument(k, speicher, {
      dokumentId: d.id, grund: 'Doppelt abgelegt, dies ist die Kopie.',
    }));
    await expect(alsWer(mensch, (k) => loescheDokument(k, speicher, {
      dokumentId: d.id, grund: 'Doppelt abgelegt, dies ist die Kopie.',
    }))).rejects.toMatchObject({ grund: 'nicht_gefunden' });
  });
});

describe('§2 was bleibt, entscheidet die Datenbank', () => {
  it('ein Dokument unter Aufbewahrungspflicht bleibt — und seine Datei auch', async () => {
    const speicher = new LokalerSpeicher();
    /*
     * `rechnung` trägt aus einer ENTSCHIEDENEN Regel eine Löschsperre
     * (§ 147 AO, § 14b UStG — zehn Jahre). `kern.setze_aufbewahrung` setzt
     * sie beim Anlegen; gelöst wird sie nie (D-49).
     */
    const d = await abgelegt(speicher, 'rechnung');
    await expect(alsWer(mensch, (k) => loescheDokument(k, speicher, {
      dokumentId: d.id, grund: 'Aufräumen im Archiv.',
    }))).rejects.toMatchObject({ grund: 'gesperrt' });

    /*
     * **Die Reihenfolge ist der Punkt.** Erst die Zeile, dann das Objekt —
     * die Zeile wird abgewiesen, also wird das Objekt gar nicht angefasst.
     * Umgekehrt läge im Bucket nichts mehr, während die Zeile noch auf die
     * Datei zeigt.
     */
    expect(speicher.rohBytes(d.bucket, d.schluessel)).toBeDefined();
    expect((await stand(d.id)).weg).toBe(false);
  });

  it('und ein Dokument, auf das eine Buchungszeile zeigt, ebenso (ACC-03)', async () => {
    const speicher = new LokalerSpeicher();
    /*
     * Der Regelfall aus `0132`: eine Datei wird in einer FREIEN Kategorie
     * abgelegt — sie trägt also keine Löschsperre — und erst SPÄTER zum
     * Beleg einer Buchung. Der Grund, warum sie bleiben muss, entsteht nach
     * dem Hochladen.
     */
    const d = await abgelegt(speicher, 'angebot');
    const [z] = await sql.unsafe<{ sperre: boolean }[]>(
      `select loeschsperre as sperre from dokument where id = $1`, [d.id] as never[]);
    expect(z?.sperre, 'die Kategorie sperrt hier NICHT').toBe(false);

    /*
     * `beleg` zeigt auf die VERSION und nicht nur auf das Dokument (0123):
     * ein Dokument kann eine neue Fassung bekommen, und dann wäre der
     * archivierte Beleg still ein anderer. Die Fixtur baut deshalb beides.
     */
    const hash = 'a'.repeat(64);
    const [v] = await sql.unsafe<{ id: string }[]>(
      `insert into dokument_version (mandant_id, dokument_id, version, objekt_schluessel,
                                     sha256, groesse_bytes, mime_typ)
       values ($1,$2,1,$3,$4,2048,'application/pdf') returning id`,
      [f.reinigung, d.id, d.schluessel, hash] as never[]);
    /*
     * `beleg_akteur_stimmig` verlangt einen benannten Handelnden: Mensch MIT
     * Kennung, Agent mit Agentenkennung, oder System mit Dienstnamen. Ein
     * Beleg, von dem niemand sagen kann, wer ihn ins Haus gebracht hat, ist
     * im Streitfall keiner.
     */
    const [bl] = await sql.unsafe<{ id: string }[]>(
      `insert into beleg (mandant_id, belegnummer, typ, quelle, dokument_id,
                          dokument_version_id, datei_sha256, belegdatum,
                          erstellt_von_art, erstellt_von)
       values ($1,$2,'kassenbeleg','scan',$3,$4,$5,app.berlin_heute(),'mensch',$6)
       returning id`,
      [f.reinigung, `B-${zufall()}`, d.id, v!.id, hash, mensch] as never[]);
    /*
     * **Zwei Zeilen, nicht eine.** Die Buchführung geht auf: Soll und Haben
     * einer `buchung_id` müssen dieselbe Summe tragen, und ein Auslöser
     * besteht darauf. Eine halbe Buchung wäre eine Fixtur, die etwas anderes
     * prüft als das, was im Betrieb steht.
     */
    /*
     * Die Periode entsteht hier als EIGENTÜMER und nicht über
     * `app.periode_sichern`: die Funktion weist eine Sitzung ohne gebundenen
     * Mandanten mit „Die Gruppenansicht bucht nicht" ab, und die Fixtur
     * stellt nur den Ausgangszustand her. Was die Buchung selbst darf,
     * prüfen die Buchhaltungsdateien.
     */
    await sql.unsafe(
      `insert into periode (mandant_id, jahr, monat, beginn_am, ende_am,
                            erstellt_von_art, erstellt_von_dienst)
       select $1, extract(year from app.berlin_heute())::int,
              extract(month from app.berlin_heute())::smallint,
              date_trunc('month', app.berlin_heute())::date,
              (date_trunc('month', app.berlin_heute()) + interval '1 month'
               - interval '1 day')::date,
              'system', 'test:dokument-loeschen'
       on conflict do nothing`, [f.reinigung] as never[]);
    const [periode] = await sql.unsafe<{ id: string }[]>(
      `select id from periode
        where mandant_id = $1 and app.berlin_heute() between beginn_am and ende_am`,
      [f.reinigung] as never[]);
    await sql.unsafe(
      `insert into buchungssatz
         (mandant_id, buchung_id, buchungsdatum, belegdatum, periode_id, umsatz_cent,
          soll_haben, beleg_id, buchungstext, herkunft, erstellt_von_art,
          erstellt_von_dienst)
       select $1, b.id, app.berlin_heute(), app.berlin_heute(), $2, 10000,
              v.sh::soll_haben, $3, 'Testbuchung zum Beleg', 'manuell', 'system',
              'test:dokument-loeschen'
         from (select gen_random_uuid() as id) b,
              (values ('soll'), ('haben')) as v(sh)`,
      [f.reinigung, periode!.id, bl!.id] as never[]);

    await expect(alsWer(mensch, (k) => loescheDokument(k, speicher, {
      dokumentId: d.id, grund: 'Aufräumen im Archiv.',
    }))).rejects.toMatchObject({ grund: 'gesperrt' });
    expect(speicher.rohBytes(d.bucket, d.schluessel)).toBeDefined();
    expect((await stand(d.id)).weg).toBe(false);
  });
});

describe('§3 die Wände', () => {
  it('ohne `dokument.archivieren` geschieht nichts', async () => {
    const speicher = new LokalerSpeicher();
    const d = await abgelegt(speicher, 'angebot');
    /*
     * `mitarbeiter` hält `dokument.archivieren` nicht. Das UPDATE fällt an
     * der Schreibpolicy aus und trifft null Zeilen — ein `update`, das null
     * Zeilen trifft, ist in Postgres ein Erfolg, und genau deshalb prüft der
     * Dienst das Ergebnis und meldet `nicht_gefunden` statt „gespeichert".
     */
    const ohne = await konto(f.reinigung, 'mitarbeiter');
    await expect(alsWer(ohne, (k) => loescheDokument(k, speicher, {
      dokumentId: d.id, grund: 'Sollte gar nicht gehen.',
    }))).rejects.toBeInstanceOf(LoeschungFehler);
    expect(speicher.rohBytes(d.bucket, d.schluessel)).toBeDefined();
    expect((await stand(d.id)).weg).toBe(false);
  });

  it('ein Dokument einer FREMDEN Gesellschaft gibt es nicht (Invariante 3)', async () => {
    const speicher = new LokalerSpeicher();
    const d = await abgelegt(speicher, 'angebot', f.bau);
    await expect(alsWer(mensch, (k) => loescheDokument(k, speicher, {
      dokumentId: d.id, grund: 'Aus der falschen Gesellschaft.',
    }))).rejects.toMatchObject({ grund: 'nicht_gefunden' });
    expect((await stand(d.id)).weg).toBe(false);
  });

  it('in der Nur-Lese-Bindung geschieht nichts — und es ist ein Satz', async () => {
    /*
     * **Der Unterschied, den dieser Fall gefunden hat.** Fehlt das RECHT,
     * fällt die Zeile aus dem `using` der Policy: das UPDATE trifft null
     * Zeilen, und der Dienst meldet `nicht_gefunden`. Ist die Bindung
     * NUR-LESEND, fällt sie am `with check` — und das WIRFT. Bis hierher kam
     * die rohe Meldung „new row violates row-level security policy" beim
     * Aufrufer an, also ein 500er dort, wo „in dieser Ansicht wird nicht
     * geschrieben" die Wahrheit ist.
     */
    const speicher = new LokalerSpeicher();
    const d = await abgelegt(speicher, 'angebot');
    await expect(alsWer(mensch, (k) => loescheDokument(k, speicher, {
      dokumentId: d.id, grund: 'In der Gruppenansicht.',
    }), { readonly: true })).rejects.toMatchObject({ grund: 'gesperrt' });
    expect(speicher.rohBytes(d.bucket, d.schluessel)).toBeDefined();
    expect((await stand(d.id)).weg).toBe(false);
  });

  it('scheitert das Entfernen im Speicher, steht die Zeile wieder da', async () => {
    /*
     * **Die Zusage, die den halben Zustand ausschliesst.** Der Dienst löscht
     * erst die Zeile, dann das Objekt; wirft das Zweite, rollt die
     * Transaktion des Aufrufers das Erste zurück. Ohne diese Prüfung fiele
     * eine Regression auf, wenn ein Dokument als gelöscht gilt und die Datei
     * noch im Bucket liegt — und das merkt niemand, bis eine Prüfung danach
     * fragt.
     */
    const kaputt: Speicher = {
      verbunden: true,
      lege: () => Promise.resolve(),
      hole: () => Promise.reject(new Error('nicht verbunden')),
      entferne: () => Promise.reject(new Error('Bucket unerreichbar')),
      signierteUrl: () => Promise.reject(new Error('nicht verbunden')),
    };
    const speicher = new LokalerSpeicher();
    const d = await abgelegt(speicher, 'angebot');
    await expect(alsWer(mensch, (k) => loescheDokument(k, kaputt, {
      dokumentId: d.id, grund: 'Der Speicher antwortet nicht.',
    }))).rejects.toThrow(/Bucket unerreichbar/u);
    expect((await stand(d.id)).weg, 'die Transaktion hat zurueckgerollt').toBe(false);
  });
});
