/**
 * PR 42, Abnahme 1 und 2 — an echtem Postgres.
 *
 *  (1) Fassung 3 zu veroeffentlichen macht jede fruehere Kenntnisnahme
 *      VERALTET und verlangt eine neue; die alte Fassung und die alten
 *      Kenntnisnahmen bleiben UNVERAENDERT; die Kenntnisnahme speichert den
 *      Fassungs-Hash.
 *  (2) Eine Mitarbeiterin sieht eine unbestaetigte Dienstanweisung vor ihrer
 *      naechsten Schicht und bestaetigt sie — im Personen-Scope gelesen, im
 *      Mandanten-Scope geschrieben, ohne ein einziges Recht dieser Domaene.
 *
 * Dazu die Eigenschaften, ohne die beides nichts wert waere: die Serverzeit,
 * die Abweisung eines Entwurfs, die Unveraenderlichkeit der Bestaetigung und
 * die Mandantenwand.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { LeseKontext, SchreibKontext } from '../../src/server/kontext/index.js';
import {
  bestaetigeKenntnisnahme, legeAnweisungAn, leseAnweisung, leseFassungen,
  leseKenntnisstand, neueFassung, veroeffentlicheFassung,
  SchonBestaetigt, FassungNichtGefunden,
} from '../../src/server/services/security/dienstanweisung.js';
import {
  findeBestaetigungsziel, findeEigeneDienstanweisung,
  listeEigeneDienstanweisungen,
} from '../../src/server/services/mitarbeiter/dienstanweisungen.js';

let f: Fixtur;
let leitung = '';
let wache = '';
let objektId = '';
let fremdObjektId = '';

const zufall = (): string => String(Math.random()).slice(2, 10);

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function konto(personId: string | null): Promise<string> {
  const email = `da-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, person_id)
     values ($1,$2,$2,'aktiv',$3)`, [u!.id, email, personId]);
  return u!.id;
}

async function objekt(mandant: string): Promise<string> {
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name)
     values ($1,$2,'Anweisungskunde') returning id`, [mandant, `K-${zufall()}`]);
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
     values ($1,$2,$3,'Werkstor Nord','Teststr. 1','10115','Berlin') returning id`,
    [mandant, k!.id, `O-${zufall()}`]);
  return o!.id;
}

/**
 * Eine LAUFENDE Schicht auf dem Objekt — sie ist die Bedingung fuer alles
 * hier: `app.ist_eingesetzt_auf_objekt` traegt die Mitarbeiterdecke, und
 * `kern.pflege_da_pflicht` macht aus der Einteilung die Pflicht.
 */
async function schicht(
  mandant: string, objekt_id: string, anstellung: string, person: string,
  stundenVoraus = 2,
): Promise<string> {
  const [e] = await sql.unsafe<{ id: string }[]>(
    `insert into einsatz (mandant_id, quelle, quell_schluessel, plan_datum,
                          beginn_zeitpunkt, ende_zeitpunkt, zeitzone,
                          beginn_lokal, ende_lokal, objekt_id, kunde_id,
                          erstellt_von_art, status)
     select $1, 'manuell', $2, (now() at time zone 'Europe/Berlin')::date,
            now() + ($3 || ' hours')::interval,
            now() + (($3::int + 8) || ' hours')::interval,
            'Europe/Berlin', '06:00', '14:00', $4, o.kunde_id, 'system', 'geplant'
       from objekt o where o.id = $4
     returning id`,
    [mandant, `pr42:${zufall()}`, String(stundenVoraus), objekt_id]);
  await sql.unsafe(
    `insert into einsatz_zuordnung
       (mandant_id, einsatz_id, anstellung_id, person_id,
        beginn_zeitpunkt, ende_zeitpunkt, status, erstellt_von_art)
     select $1, e.id, $2, $3, e.beginn_zeitpunkt, e.ende_zeitpunkt, 'geplant', 'system'
       from einsatz e where e.id = $4`,
    [mandant, anstellung, person, e!.id]);
  return e!.id;
}

/** Als die Leitung — sie haelt `dienstanweisung.lesen` und `.schreiben`. */
function alsLeitung<T>(fn: (k: SchreibKontext) => Promise<T>): Promise<T> {
  return alsApp(
    {
      scope: 'mandant', mandantId: f.security, benutzerId: leitung,
      portal: 'intern', readonly: false,
    },
    async (tx) => {
      const abfrage = async <R,>(s: string, w: readonly unknown[] = []) =>
        (await tx.unsafe(s, w as never[])) as readonly R[];
      return fn({
        scope: 'mandant', portal: 'intern', benutzerId: leitung,
        aktiverMandantId: f.security, mandantIds: [f.security],
        abfrage, schreibe: abfrage,
      });
    },
  );
}

/**
 * Als die Wache im PERSONEN-Scope — das Mitarbeiterportal (K-18).
 *
 * `app.mandant_id` ist hier LEER, und das ist der ganze Punkt: was sichtbar
 * ist, entscheidet `app.sichtbare_mandanten()` plus `t_person`.
 */
function alsWachePerson<T>(fn: (k: LeseKontext) => Promise<T>): Promise<T> {
  return alsApp(
    {
      scope: 'person', personId: f.fatima, benutzerId: wache,
      mandantIds: [f.reinigung, f.security], portal: 'mitarbeiter', readonly: true,
    },
    async (tx) => {
      const abfrage = async <R,>(s: string, w: readonly unknown[] = []) =>
        (await tx.unsafe(s, w as never[])) as readonly R[];
      return fn({
        scope: 'person', portal: 'mitarbeiter', benutzerId: wache,
        aktiverMandantId: null, mandantIds: [f.reinigung, f.security], abfrage,
      });
    },
  );
}

/** Als die Wache im MANDANTEN-Scope mit Mitarbeiterdecke — der Schreibweg. */
function alsWacheSchreibend<T>(fn: (k: SchreibKontext) => Promise<T>): Promise<T> {
  return alsApp(
    {
      scope: 'mandant', mandantId: f.security, benutzerId: wache,
      personId: f.fatima, portal: 'mitarbeiter', readonly: false,
    },
    async (tx) => {
      const abfrage = async <R,>(s: string, w: readonly unknown[] = []) =>
        (await tx.unsafe(s, w as never[])) as readonly R[];
      return fn({
        scope: 'mandant', portal: 'mitarbeiter', benutzerId: wache,
        aktiverMandantId: f.security, mandantIds: [f.security],
        abfrage, schreibe: abfrage,
      });
    },
  );
}

beforeEach(async () => {
  f = await seed();
  leitung = await konto(null);
  wache = await konto(f.fatima);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [leitung, f.security, await rolleId('leitung')]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [wache, f.security, await rolleId('mitarbeiter')]);
  objektId = await objekt(f.security);
  fremdObjektId = await objekt(f.reinigung);
  await schicht(f.security, objektId, f.fatimaSecurity, f.fatima);
});
afterAll(schliessen);

// ---------------------------------------------------------------------------

describe('(1) Fassung 3 veraltet die alten Bestaetigungen — ohne eine anzufassen', () => {
  it('die Kenntnisnahme speichert den Fassungs-Hash, und zwar den der Datenbank', async () => {
    const { anweisungId, versionId } = await alsLeitung((k) => legeAnweisungAn(k, {
      titel: 'Hausordnung Werkstor', objektId,
      inhalt: 'Tor ab 22:00 verschlossen halten.',
      gueltigAb: '2026-01-01', veroeffentlichen: true,
    }));

    await alsWacheSchreibend((k) => bestaetigeKenntnisnahme(k, { versionId }));

    const [zeile] = await sql.unsafe<{
      hash: string; version_hash: string; anstellung_id: string; person_id: string;
      pflicht_id: string | null; art: string;
    }[]>(
      `select k.bestaetigter_inhalt_hash as hash, v.inhalt_hash as version_hash,
              k.anstellung_id, k.person_id, k.da_pflicht_id as pflicht_id, k.art::text as art
         from da_kenntnisnahme k
         join dienstanweisung_version v on v.id = k.dienstanweisung_version_id
        where v.dienstanweisung_id = $1`, [anweisungId]);

    expect(zeile!.hash).toMatch(/^[0-9a-f]{64}$/u);
    // Die KOPIE ist der Hash der Fassung — nicht irgendein Hash.
    expect(zeile!.hash).toBe(zeile!.version_hash);
    // Der Urheber kommt aus der SITZUNG, kein Formularfeld traegt ihn.
    expect(zeile!.anstellung_id).toBe(f.fatimaSecurity);
    expect(zeile!.person_id).toBe(f.fatima);
    // Der Ausloeser hat die Pflicht aufgeloest, die damit erledigt ist.
    expect(zeile!.pflicht_id).not.toBeNull();
    expect(zeile!.art).toBe('portal_klick');
  });

  it('nach Fassung 3 ist die alte Bestaetigung BYTEGLEICH und trotzdem veraltet', async () => {
    const { anweisungId, versionId } = await alsLeitung((k) => legeAnweisungAn(k, {
      titel: 'Alarmweg', objektId, inhalt: 'Fassung 1',
      gueltigAb: '2026-01-01', veroeffentlichen: true,
    }));
    await alsWacheSchreibend((k) => bestaetigeKenntnisnahme(k, { versionId }));

    /**
     * Die GANZE Zeile vorher — nicht drei Spalten. Eine Aufzaehlung der
     * geprueften Spalten ist beim naechsten `alter table add column`
     * unvollstaendig, und zwar lautlos (dieselbe Begruendung wie im
     * Einfrierungsausloeser selbst).
     */
    const vorher = await sql.unsafe<{ zeile: unknown; fassung: unknown }[]>(
      `select to_jsonb(k) as zeile,
              (select to_jsonb(v) from dienstanweisung_version v where v.id = $1) as fassung
         from da_kenntnisnahme k where k.dienstanweisung_version_id = $1`, [versionId]);

    // Fassung 2 und 3 — beide veroeffentlicht.
    await alsLeitung((k) => neueFassung(k, anweisungId, {
      inhalt: 'Fassung 2', gueltigAb: '2026-02-01', veroeffentlichen: true,
    }));
    await alsLeitung((k) => neueFassung(k, anweisungId, {
      inhalt: 'Fassung 3', gueltigAb: '2026-03-01', veroeffentlichen: true,
    }));

    const nachher = await sql.unsafe<{ zeile: unknown; fassung: unknown }[]>(
      `select to_jsonb(k) as zeile,
              (select to_jsonb(v) from dienstanweisung_version v where v.id = $1) as fassung
         from da_kenntnisnahme k where k.dienstanweisung_version_id = $1`, [versionId]);

    // Keine einzige Spalte der alten Bestaetigung und der alten Fassung.
    expect(nachher[0]!.zeile).toEqual(vorher[0]!.zeile);
    expect(nachher[0]!.fassung).toEqual(vorher[0]!.fassung);

    // Der Kopf zeigt jetzt auf Fassung 3 — und NUR daraus folgt „veraltet".
    const kopf = await alsLeitung((k) => leseAnweisung(k, anweisungId));
    expect(kopf!.aktiveVersion).toBe(3);
    expect(kopf!.pflichtig).toBe(1);
    expect(kopf!.bestaetigt).toBe(0);

    const stand = await alsLeitung((k) => leseKenntnisstand(k, anweisungId));
    expect(stand).toHaveLength(1);
    // Was sie bestaetigt hat, steht weiter da — es zaehlt nur nicht mehr.
    expect(stand[0]!.bestaetigteVersion).toBe(1);
    expect(stand[0]!.aktuell).toBe(false);
    expect(stand[0]!.bestaetigterHash).toMatch(/^[0-9a-f]{64}$/u);

    // Und alle drei Fassungen sind noch lesbar, mit ihrem eigenen Text.
    const fassungen = await alsLeitung((k) => leseFassungen(k, anweisungId));
    expect(fassungen.map((v) => v.version)).toEqual([3, 2, 1]);
    expect(fassungen.map((v) => v.inhalt))
      .toEqual(['Fassung 3', 'Fassung 2', 'Fassung 1']);
    expect(fassungen.filter((v) => v.istAktiv).map((v) => v.version)).toEqual([3]);
    // Drei Fassungen, drei verschiedene Digests.
    expect(new Set(fassungen.map((v) => v.inhaltHash)).size).toBe(3);
  });

  it('die neue Fassung verlangt eine neue Bestaetigung — und dann stimmt es wieder', async () => {
    const { anweisungId, versionId } = await alsLeitung((k) => legeAnweisungAn(k, {
      titel: 'Streifenplan', objektId, inhalt: 'Fassung 1',
      gueltigAb: '2026-01-01', veroeffentlichen: true,
    }));
    await alsWacheSchreibend((k) => bestaetigeKenntnisnahme(k, { versionId }));
    await alsLeitung((k) => neueFassung(k, anweisungId, {
      inhalt: 'Fassung 2', gueltigAb: '2026-02-01', veroeffentlichen: true,
    }));

    const neu = await alsLeitung((k) => leseAnweisung(k, anweisungId));
    await alsWacheSchreibend((k) => bestaetigeKenntnisnahme(k, {
      versionId: neu!.aktiveVersionId!,
    }));

    const stand = await alsLeitung((k) => leseKenntnisstand(k, anweisungId));
    expect(stand[0]!.bestaetigteVersion).toBe(2);
    expect(stand[0]!.aktuell).toBe(true);
    // BEIDE Bestaetigungen stehen im Buch — die alte wurde nicht ersetzt.
    const [zahl] = await sql.unsafe<{ n: string }[]>(
      `select count(*) as n from da_kenntnisnahme k
         join dienstanweisung_version v on v.id = k.dienstanweisung_version_id
        where v.dienstanweisung_id = $1`, [anweisungId]);
    expect(Number(zahl!.n)).toBe(2);
  });

  it('bei `neue_version_oeffnet_pflicht = false` zaehlt die alte Bestaetigung weiter (O-153)', async () => {
    const { anweisungId, versionId } = await alsLeitung((k) => legeAnweisungAn(k, {
      titel: 'Rahmenanweisung', objektId, inhalt: 'Fassung 1',
      gueltigAb: '2026-01-01', veroeffentlichen: true,
    }));
    await alsWacheSchreibend((k) => bestaetigeKenntnisnahme(k, { versionId }));
    // Die milde Lesart — der Platzhalter, den O-153 offen laesst.
    await sql.unsafe(
      `update dienstanweisung set neue_version_oeffnet_pflicht = false where id = $1`,
      [anweisungId]);
    await alsLeitung((k) => neueFassung(k, anweisungId, {
      inhalt: 'Fassung 2', gueltigAb: '2026-02-01', veroeffentlichen: true,
    }));

    const stand = await alsLeitung((k) => leseKenntnisstand(k, anweisungId));
    expect(stand[0]!.bestaetigteVersion).toBe(1);
    expect(stand[0]!.aktuell).toBe(true);
    const kopf = await alsLeitung((k) => leseAnweisung(k, anweisungId));
    expect(kopf!.bestaetigt).toBe(1);
  });

  it('ohne jede Bestaetigung meldet auch die milde Lesart NICHT „erledigt"', async () => {
    /**
     * Der Fehler, den `ZAEHLT_NOCH` mit `k.id is not null` verhindert: ohne
     * diese Haelfte waere der Ausdruck fuer `neue_version_oeffnet_pflicht =
     * false` auch dann wahr, wenn es gar keine Bestaetigung gibt.
     */
    const { anweisungId } = await alsLeitung((k) => legeAnweisungAn(k, {
      titel: 'Nie gelesen', objektId, inhalt: 'Text',
      gueltigAb: '2026-01-01', veroeffentlichen: true,
    }));
    await sql.unsafe(
      `update dienstanweisung set neue_version_oeffnet_pflicht = false where id = $1`,
      [anweisungId]);

    const kopf = await alsLeitung((k) => leseAnweisung(k, anweisungId));
    expect(kopf!.pflichtig).toBe(1);
    expect(kopf!.bestaetigt).toBe(0);
    const stand = await alsLeitung((k) => leseKenntnisstand(k, anweisungId));
    expect(stand[0]!.aktuell).toBe(false);
  });

  it('eine aeltere Fassung freizugeben schreibt den Kopf NICHT zurueck', async () => {
    const { anweisungId } = await alsLeitung((k) => legeAnweisungAn(k, {
      titel: 'Rueckfall', objektId, inhalt: 'Fassung 1',
      gueltigAb: '2026-01-01', veroeffentlichen: true,
    }));
    // Ein Entwurf (Fassung 2), dann Fassung 3 freigeben, dann Fassung 2.
    const entwurf = await alsLeitung((k) => neueFassung(k, anweisungId, {
      inhalt: 'Fassung 2', gueltigAb: '2026-02-01',
    }));
    await alsLeitung((k) => neueFassung(k, anweisungId, {
      inhalt: 'Fassung 3', gueltigAb: '2026-03-01', veroeffentlichen: true,
    }));
    await alsLeitung((k) => veroeffentlicheFassung(k, entwurf, anweisungId));

    const kopf = await alsLeitung((k) => leseAnweisung(k, anweisungId));
    // Eine stille Ruecknahme gaebe es nicht: 3 bleibt die geltende Fassung.
    expect(kopf!.aktiveVersion).toBe(3);
  });

  /**
   * **Eine Fassung gehoert zu EINER Dienstanweisung** — und die Freigabe
   * nimmt die aus dem Pfad.
   *
   * Vorher nahm `veroeffentlicheFassung` nur die Kennung der Fassung. Die RLS
   * haelt sie im Mandanten, mehr nicht: wer das Schreibrecht hat und eine
   * fremde Fassungs-UUID kennt, konnte sie ueber die Route JEDER anderen
   * Dienstanweisung freigeben. Der Pfad sagte das eine, der Rumpf tat das
   * andere.
   *
   * Geantwortet wird wie auf etwas, das es nicht gibt (AUT-06): dass die
   * Fassung existiert und woanders haengt, ist eine Auskunft fuer sich.
   */
  it('eine Fassung einer ANDEREN Anweisung laesst sich hier nicht freigeben', async () => {
    const eins = await alsLeitung((k) => legeAnweisungAn(k, {
      titel: 'Haus A', objektId, inhalt: 'A1',
      gueltigAb: '2026-01-01', veroeffentlichen: true,
    }));
    const zwei = await alsLeitung((k) => legeAnweisungAn(k, {
      titel: 'Haus B', objektId, inhalt: 'B1',
      gueltigAb: '2026-01-01', veroeffentlichen: false,
    }));
    // Ein Entwurf, der zu `zwei` gehoert.
    const fremd = await alsLeitung((k) => neueFassung(k, zwei.anweisungId, {
      inhalt: 'B2', gueltigAb: '2026-02-01',
    }));

    await expect(
      alsLeitung((k) => veroeffentlicheFassung(k, fremd, eins.anweisungId)),
    ).rejects.toThrow(FassungNichtGefunden);

    // Gegenprobe: ueber die RICHTIGE Anweisung geht sie durch. Sonst hiesse
    // die Reparatur nur „es geht gar nicht mehr".
    await alsLeitung((k) => veroeffentlicheFassung(k, fremd, zwei.anweisungId));
    const kopf = await alsLeitung((k) => leseAnweisung(k, zwei.anweisungId));
    expect(kopf!.aktiveVersion).toBe(2);
  });
});

// ---------------------------------------------------------------------------

describe('(2) die Wache sieht die offene Anweisung und bestaetigt mit einem Tipp', () => {
  it('sie steht im Personen-Scope, mit der naechsten Schicht daneben', async () => {
    await alsLeitung((k) => legeAnweisungAn(k, {
      titel: 'Vor der Schicht lesen', objektId,
      inhalt: 'Schlüsselübergabe nur gegen Quittung.',
      gueltigAb: '2026-01-01', veroeffentlichen: true,
    }));

    const liste = await alsWachePerson((k) => listeEigeneDienstanweisungen(k, 'de'));
    expect(liste).toHaveLength(1);
    expect(liste[0]!.offen).toBe(true);
    expect(liste[0]!.anstellungId).toBe(f.fatimaSecurity);
    expect(liste[0]!.mandantSlug).toBe('security');
    // „Vor ihrer naechsten Schicht" ist keine Prosa, sondern eine Spalte.
    expect(liste[0]!.naechsteSchichtLokal).toMatch(/^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/u);
    expect(liste[0]!.inhaltHash).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('der Weg des Formulars: Personen-Scope aufloesen, Mandanten-Scope schreiben', async () => {
    const { anweisungId, versionId } = await alsLeitung((k) => legeAnweisungAn(k, {
      titel: 'Ein Tipp', objektId, inhalt: 'Text',
      gueltigAb: '2026-01-01', veroeffentlichen: true,
    }));

    const ziel = await alsWachePerson((k) =>
      findeBestaetigungsziel(k, anweisungId, versionId));
    expect(ziel).not.toBeNull();
    expect(ziel!.mandantId).toBe(f.security);
    expect(ziel!.istAktiv).toBe(true);

    await alsWacheSchreibend((k) => bestaetigeKenntnisnahme(k, {
      versionId: ziel!.versionId, sprache: 'tr',
    }));

    const blatt = await alsWachePerson((k) =>
      findeEigeneDienstanweisung(k, 'de', anweisungId));
    expect(blatt!.offen).toBe(false);
    expect(blatt!.bestaetigteVersion).toBe(1);
    expect(blatt!.bestaetigtLokal).toMatch(/^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/u);
  });

  it('der Text kommt in ihrer Sprache — und sagt es, wenn nicht (EMP-12)', async () => {
    const { anweisungId } = await alsLeitung((k) => legeAnweisungAn(k, {
      titel: 'Mehrsprachig', objektId,
      inhalt: 'Tor ab 22:00 verschlossen halten.',
      inhaltI18n: { tr: 'Kapıyı 22:00’den itibaren kilitli tutun.' },
      gueltigAb: '2026-01-01', veroeffentlichen: true,
    }));

    const tuerkisch = await alsWachePerson((k) =>
      findeEigeneDienstanweisung(k, 'tr', anweisungId));
    expect(tuerkisch!.uebersetzt).toBe(true);
    expect(tuerkisch!.angezeigteSprache).toBe('tr');
    expect(tuerkisch!.inhalt).toContain('kilitli');

    const arabisch = await alsWachePerson((k) =>
      findeEigeneDienstanweisung(k, 'ar', anweisungId));
    // Kein stiller Rueckfall: der Text ist der deutsche, und das steht dran.
    expect(arabisch!.uebersetzt).toBe(false);
    expect(arabisch!.angezeigteSprache).toBe('de');
    expect(arabisch!.inhalt).toContain('22:00');
  });

  it('die jsonb-Spalte traegt ein OBJEKT und keine Zeichenkette', async () => {
    /**
     * Die Falle, die andere Sitzungen bezahlt haben: `JSON.stringify(obj)` in
     * einem blossen `$n::jsonb` legt eine JSON-ZEICHENKETTE ab, und jeder
     * `->>`-Zugriff liefert danach NULL — ohne Fehler.
     */
    const { versionId } = await alsLeitung((k) => legeAnweisungAn(k, {
      titel: 'Typprobe', objektId, inhalt: 'de',
      inhaltI18n: { en: 'english', tr: 'türkçe' },
      gueltigAb: '2026-01-01', veroeffentlichen: true,
    }));
    const [z] = await sql.unsafe<{ typ: string; en: string | null }[]>(
      `select jsonb_typeof(inhalt_i18n) as typ, inhalt_i18n ->> 'en' as en
         from dienstanweisung_version where id = $1`, [versionId]);
    expect(z!.typ).toBe('object');
    expect(z!.en).toBe('english');
  });

  it('ein Entwurf wird nicht bestaetigt — die DATENBANK weist ihn ab', async () => {
    const { anweisungId } = await alsLeitung((k) => legeAnweisungAn(k, {
      titel: 'Entwurf', objektId, inhalt: 'Noch im Streit',
      gueltigAb: '2026-01-01',
    }));
    const [v] = await sql.unsafe<{ id: string }[]>(
      `select id from dienstanweisung_version where dienstanweisung_id = $1`,
      [anweisungId]);

    await expect(
      alsWacheSchreibend((k) => bestaetigeKenntnisnahme(k, { versionId: v!.id })),
    ).rejects.toThrow(/Entwurf wird nicht bestaetigt/u);
  });

  it('ein zweiter Tipp auf dieselbe Fassung ist kein zweiter Vorgang', async () => {
    const { versionId } = await alsLeitung((k) => legeAnweisungAn(k, {
      titel: 'Doppeltipp', objektId, inhalt: 'Text',
      gueltigAb: '2026-01-01', veroeffentlichen: true,
    }));
    await alsWacheSchreibend((k) => bestaetigeKenntnisnahme(k, { versionId }));
    await expect(
      alsWacheSchreibend((k) => bestaetigeKenntnisnahme(k, { versionId })),
    ).rejects.toThrow(SchonBestaetigt);

    // Und wenn jemand den Dienst umgeht, haelt der Eindeutigkeitsindex.
    await expect(sql.unsafe(
      `insert into da_kenntnisnahme
         (mandant_id, dienstanweisung_version_id, anstellung_id, person_id,
          bestaetigter_inhalt_hash, erstellt_von_art)
       values ($1,$2,$3,$4, repeat('0',64), 'system')`,
      [f.security, versionId, f.fatimaSecurity, f.fatima],
    )).rejects.toThrow(/da_kenntnis_uk/u);
  });

  it('eine Anweisung eines fremden Objekts ist fuer sie nicht vorhanden', async () => {
    // Direkt gesetzt, am Dienst vorbei: die Anweisung existiert wirklich —
    // sie ist nur fuer DIESE Anmeldung nicht vorhanden (AUT-06).
    const [d] = await sql.unsafe<{ id: string }[]>(
      `insert into dienstanweisung (mandant_id, objekt_id, titel, erstellt_von_art)
       values ($1,$2,'Fremde Hausordnung','system') returning id`,
      [f.reinigung, fremdObjektId]);
    await sql.unsafe(
      `insert into dienstanweisung_version
         (mandant_id, dienstanweisung_id, inhalt, inhalt_hash, gueltig_ab,
          veroeffentlicht_am, erstellt_von_art)
       values ($1,$2,'Fremder Text', repeat('0',64), current_date, now(), 'system')`,
      [f.reinigung, d!.id]);

    // Fatima ist in der Reinigung beschaeftigt — aber auf DIESEM Objekt nicht
    // eingesetzt. `ist_eingesetzt_auf_objekt` ist die Decke, nicht der Mandant.
    const liste = await alsWachePerson((k) => listeEigeneDienstanweisungen(k, 'de'));
    expect(liste.map((x) => x.titel)).not.toContain('Fremde Hausordnung');
    const blatt = await alsWachePerson((k) =>
      findeEigeneDienstanweisung(k, 'de', d!.id));
    expect(blatt).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('die Serverzeit und die Unveraenderlichkeit', () => {
  it('eine manipulierte Geraeteuhr aendert die aufgezeichnete Zeit nicht', async () => {
    const { versionId } = await alsLeitung((k) => legeAnweisungAn(k, {
      titel: 'Zeitprobe', objektId, inhalt: 'Text',
      gueltigAb: '2026-01-01', veroeffentlichen: true,
    }));
    // Drei Stunden vor — die Behauptung des Geraets.
    const behauptet = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
    await alsWacheSchreibend((k) => bestaetigeKenntnisnahme(k, {
      versionId, geraeteZeit: behauptet,
    }));

    const [z] = await sql.unsafe<{
      nah: boolean; abweichung: number; geraet: Date;
    }[]>(
      `select (abs(extract(epoch from (now() - bestaetigt_am))) < 60) as nah,
              zeitabweichung_sek as abweichung, geraete_zeit as geraet
         from da_kenntnisnahme where dienstanweisung_version_id = $1`, [versionId]);
    // Aufgezeichnet ist die SERVERZEIT.
    expect(z!.nah).toBe(true);
    // Die Behauptung steht daneben, samt ihrer Abweichung (Geraet minus Server).
    expect(Number(z!.abweichung)).toBeLessThan(-3 * 3600 + 120);
    expect(Number(z!.abweichung)).toBeGreaterThan(-3 * 3600 - 120);
    expect(z!.geraet).not.toBeNull();
  });

  it('ein UPDATE und ein DELETE scheitern — auch als Eigentuemer der Tabelle', async () => {
    const { versionId } = await alsLeitung((k) => legeAnweisungAn(k, {
      titel: 'Unveraenderlich', objektId, inhalt: 'Text',
      gueltigAb: '2026-01-01', veroeffentlichen: true,
    }));
    await alsWacheSchreibend((k) => bestaetigeKenntnisnahme(k, { versionId }));

    /**
     * `sql` ist die Verbindung OHNE `set role cse_app`, also der Eigentuemer.
     * Genau das ist der Punkt: eine Regel, die nur fuer die Anwendungsrolle
     * gilt, ist keine Regel.
     */
    await expect(sql.unsafe(
      `update da_kenntnisnahme set bestaetigt_am = now() - interval '5 days'
        where dienstanweisung_version_id = $1`, [versionId],
    )).rejects.toThrow(/wird nicht geaendert/u);

    await expect(sql.unsafe(
      `update da_kenntnisnahme set bestaetigter_inhalt_hash = repeat('a',64)
        where dienstanweisung_version_id = $1`, [versionId],
    )).rejects.toThrow(/wird nicht geaendert/u);

    await expect(sql.unsafe(
      `delete from da_kenntnisnahme where dienstanweisung_version_id = $1`, [versionId],
    )).rejects.toThrow();
  });

  it('eine veroeffentlichte Fassung laesst sich nicht umschreiben', async () => {
    const { versionId } = await alsLeitung((k) => legeAnweisungAn(k, {
      titel: 'Eingefroren', objektId, inhalt: 'Der Text, gegen den bestaetigt wird',
      gueltigAb: '2026-01-01', veroeffentlichen: true,
    }));
    await expect(sql.unsafe(
      `update dienstanweisung_version set inhalt = 'umgeschrieben' where id = $1`,
      [versionId],
    )).rejects.toThrow(/wird nicht geaendert/u);
    await expect(sql.unsafe(
      `update dienstanweisung_version set gueltig_ab = '2020-01-01' where id = $1`,
      [versionId],
    )).rejects.toThrow(/wird nicht geaendert/u);
  });

  it('die Fassungsnummern sind fortlaufend und der Hash haengt am Inhalt', async () => {
    const { anweisungId } = await alsLeitung((k) => legeAnweisungAn(k, {
      titel: 'Nummern', objektId, inhalt: 'A', gueltigAb: '2026-01-01',
    }));
    await alsLeitung((k) => neueFassung(k, anweisungId, {
      inhalt: 'B', gueltigAb: '2026-02-01',
    }));
    await alsLeitung((k) => neueFassung(k, anweisungId, {
      inhalt: 'A', gueltigAb: '2026-03-01',
    }));

    const f3 = await alsLeitung((k) => leseFassungen(k, anweisungId));
    expect(f3.map((v) => v.version)).toEqual([3, 2, 1]);
    // Gleicher Inhalt, gleicher Digest — der Hash ist eine Funktion des Textes.
    const nachNummer = new Map(f3.map((v) => [v.version, v.inhaltHash]));
    expect(nachNummer.get(1)).toBe(nachNummer.get(3));
    expect(nachNummer.get(1)).not.toBe(nachNummer.get(2));
  });
});
