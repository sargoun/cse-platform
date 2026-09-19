/**
 * `/portal/mein/dokumente` und `/portal/mein/objekte` an echtem Postgres
 * (EMP-02, EMP-11, EMP-13, DOC-03, DOC-04, OPS-01, K-04, K-05, K-18, AUT-06).
 *
 * **Warum das hier steht und nicht in `tests/kern`.** Jede Zusage dieses
 * Stapels ist eine Aussage ueber die DATENBANK und in TypeScript nicht
 * falsifizierbar:
 *
 *  · ob eine nicht freigegebene Unterlage wirklich unsichtbar ist, entscheidet
 *    `dokument.p_ma_ceiling` + `t_person` (0009) und keine `if`-Zeile;
 *  · ob der Zutrittshinweis wirklich mit der letzten Schicht verschwindet,
 *    entscheidet `app.ist_eingesetzt_auf_objekt` (0069) in
 *    `app.mein_objekt_zugang` (0360);
 *  · ob die Spalte `zutritt_hinweis` ueberhaupt einen zweiten Weg hat,
 *    entscheidet ein SPALTENRECHT (0021) — und das laesst sich nur gegen
 *    Postgres pruefen.
 *
 * Jeder Fall ist so gebaut, dass er OHNE die Umsetzung fehlschlaegt.
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import {
  withPersonScope, type LeseKontext, type Sitzung,
} from '../../src/server/kontext/index.js';
import {
  MEIN_DOKUMENT_FELDER, findeEigenesDokument, listeEigeneDokumente,
  zaehleEigeneKategorien,
} from '../../src/server/services/mitarbeiter/dokumente.js';
import {
  EIGENES_OBJEKT_FELDER, OBJEKT_ZUGANG_FELDER, findeEigenesObjekt,
  leseObjektZugang, listeEigeneObjekte,
} from '../../src/server/services/mitarbeiter/objekte.js';
import {
  listeEigeneSchichtenAufObjekt,
} from '../../src/server/services/mitarbeiter/schichten.js';

let f: Fixtur;
/** Das Konto der Person mit ZWEI Beschaeftigungen (D-09). */
let fatimaKonto: string;

const SITZUNG = '00000000-0000-0000-0000-00000000360a';
const zufall = (): string => String(Math.random()).slice(2, 10);

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function konto(personId: string | null = null): Promise<string> {
  const email = `md-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, person_id)
     values ($1,$2,$2,'aktiv',$3)`, [u!.id, email, personId] as never[]);
  return u!.id;
}

async function mitglied(benutzer: string, mandant: string, rolle: string): Promise<void> {
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [benutzer, mandant, await rolleId(rolle)]);
}

interface ObjektOpts {
  readonly zutritt?: string | null;
  readonly kontakt?: { readonly nachname: string; readonly telefon: string } | null;
  readonly kontaktAusgeschieden?: boolean;
}

/** Ein Objekt mit Kunde, Zutrittshinweis und (auf Wunsch) Ansprechpartner. */
async function objekt(
  mandant: string, name = 'Buerohaus', opts: ObjektOpts = {},
): Promise<string> {
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, rechtsgrundlage,
                        rechtsgrundlage_quelle, rechtsgrundlage_erfasst_am, status)
     values ($1,$2,'Testkunde','bestandskunde','Vertrag 2026', now(), 'aktiv') returning id`,
    [mandant, `K-${zufall()}`]);
  let kontaktId: string | null = null;
  if (opts.kontakt !== undefined && opts.kontakt !== null) {
    const [ap] = await sql.unsafe<{ id: string }[]>(
      `insert into ansprechpartner (mandant_id, kunde_id, vorname, nachname, telefon,
                                    ausgeschieden_am)
       values ($1,$2,'Anna',$3,$4, case when $5 then current_date else null end)
       returning id`,
      [mandant, k!.id, opts.kontakt.nachname, opts.kontakt.telefon,
       opts.kontaktAusgeschieden ?? false] as never[]);
    kontaktId = ap!.id;
  }
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse,
                         hausnummer, plz, ort, etagen_anzahl, zutritt_hinweis,
                         ansprechpartner_id)
     values ($1,$2,$3,$4,'Kurfürstendamm','21','10719','Berlin',4,$5,$6) returning id`,
    [mandant, k!.id, `OBJ-${zufall()}`, name,
     opts.zutritt === undefined ? 'Schlüsselkasten Hintereingang, Code 4711' : opts.zutritt,
     kontaktId] as never[]);
  return o!.id;
}

/**
 * Eine Schicht mit ABSOLUTEN Zeitpunkten relativ zu `now()`.
 *
 * `app.ist_eingesetzt_auf_objekt` fragt `e.ende_zeitpunkt >= now()` — der Fall,
 * den dieser Stapel beweisen muss, ist genau der Wechsel an dieser Grenze.
 * Mit Kalendertagen liesse er sich nicht ausloesen, ohne die Uhr zu stellen.
 */
async function einsatz(
  mandant: string, objektId: string, vonStunden: number, bisStunden: number,
): Promise<string> {
  const [e] = await sql.unsafe<{ id: string }[]>(
    `insert into einsatz (mandant_id, objekt_id, quelle, plan_datum,
                          beginn_zeitpunkt, ende_zeitpunkt,
                          beginn_lokal, ende_lokal, endet_am_folgetag, erstellt_von_art)
     values ($1,$2,'manuell',
             ((now() + make_interval(hours => $3)) at time zone 'Europe/Berlin')::date,
             now() + make_interval(hours => $3),
             now() + make_interval(hours => $4),
             '06:00','14:00', false, 'system')
     returning id`,
    [mandant, objektId, vonStunden, bisStunden] as never[]);
  return e!.id;
}

async function zuordnung(
  mandant: string, einsatzId: string, anstellung: string, person: string,
): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into einsatz_zuordnung (mandant_id, einsatz_id, anstellung_id, person_id,
                                    beginn_zeitpunkt, ende_zeitpunkt, erstellt_von_art)
     select $1, e.id, $3, $4, e.beginn_zeitpunkt, e.ende_zeitpunkt, 'system'
       from einsatz e where e.id = $2
     returning id`,
    [mandant, einsatzId, anstellung, person] as never[]);
  return z!.id;
}

interface DokumentOpts {
  readonly fuerMitarbeiter?: boolean;
  readonly kategorie?: string;
  readonly objektId?: string | null;
  readonly geloescht?: boolean;
}

async function dokument(
  mandant: string, titel: string, opts: DokumentOpts = {},
): Promise<string> {
  const [d] = await sql.unsafe<{ id: string }[]>(
    `insert into dokument
       (mandant_id, kategorie, titel, objekt_id, bucket, objekt_schluessel,
        mime_typ, mime_verifiziert, groesse_bytes, exif_entfernt,
        sichtbar_fuer_kunde, sichtbar_fuer_mitarbeiter, entstanden_am, geloescht_am)
     values ($1, $2::dokument_kategorie, $3, $4::uuid, 'dokumente', $5,
             'application/pdf', true, 24576, true,
             false, $6, current_date, case when $7 then now() else null end)
     returning id`,
    [mandant, opts.kategorie ?? 'unternehmen', titel, opts.objektId ?? null,
     `test/${zufall()}.pdf`, opts.fuerMitarbeiter ?? true,
     opts.geloescht ?? false] as never[]);
  return d!.id;
}

/** Die Sitzung der Arbeiterin — `ansicht: 'mandant'`, wie sie aus dem Cookie kommt. */
function meineSitzung(aktiverMandantId: string): Sitzung {
  return {
    benutzerId: fatimaKonto, personId: f.fatima, aktiverMandantId,
    ansicht: 'mandant', aal: 'aal1', portal: 'mitarbeiter', sitzungId: SITZUNG,
  };
}

/** Der ECHTE Personen-Scope — nicht ein nachgebauter Kontext. */
async function alsPerson<T>(fn: (k: LeseKontext) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) =>
    withPersonScope(tx as never, meineSitzung(f.reinigung), fn)) as Promise<T>;
}

beforeEach(async () => {
  f = await seed();
  fatimaKonto = await konto(f.fatima);
  await mitglied(fatimaKonto, f.reinigung, 'mitarbeiter');
  await mitglied(fatimaKonto, f.security, 'mitarbeiter');
});

afterAll(async () => { await schliessen(); });

// ---------------------------------------------------------------------------
// Dokumente — die Decke ist die der Datenbank
// ---------------------------------------------------------------------------

describe('(1) sichtbar ist, was FREIGEGEBEN ist (DOC-04, K-04)', () => {
  it('eine freigegebene Unterlage der eigenen Gesellschaft steht in der Liste', async () => {
    const id = await dokument(f.reinigung, 'Betriebsanweisung');
    const liste = await alsPerson(async (k) => listeEigeneDokumente(k));
    expect(liste.map((d) => d.id)).toContain(id);
  });

  it('eine NICHT freigegebene ist unsichtbar — und zwar auch einzeln', async () => {
    /**
     * `sichtbar_fuer_mitarbeiter` ist `default false` und wird nur durch eine
     * Handlung wahr. Ohne diesen Fall bewiese der erste nur, dass ueberhaupt
     * etwas durchkommt.
     */
    const id = await dokument(f.reinigung, 'Kalkulation intern',
      { fuerMitarbeiter: false });
    const liste = await alsPerson(async (k) => listeEigeneDokumente(k));
    expect(liste.map((d) => d.id)).not.toContain(id);
    // 404 und nicht 403: das Blatt bekommt `null` und ruft `notFound()`.
    expect(await alsPerson(async (k) => findeEigenesDokument(k, id))).toBeNull();
  });

  it('eine weich geloeschte ebenfalls nicht (Invariante 8 loescht nicht, sie versteckt)', async () => {
    const id = await dokument(f.reinigung, 'Alte Fassung', { geloescht: true });
    const liste = await alsPerson(async (k) => listeEigeneDokumente(k));
    expect(liste.map((d) => d.id)).not.toContain(id);
    expect(await alsPerson(async (k) => findeEigenesDokument(k, id))).toBeNull();
  });

  it('und keine aus einer Gesellschaft, in der dieser Mensch nicht beschaeftigt ist', async () => {
    /**
     * D-09: `app.sichtbare_mandanten()` ist im Personen-Scope die Menge der
     * eigenen, lebenden Anstellungen. Fatima arbeitet in Reinigung und
     * Security — `bau` gehoert nicht dazu, auch wenn die Unterlage dort
     * ausdruecklich freigegeben ist.
     */
    const id = await dokument(f.bau, 'Baustellenordnung');
    const liste = await alsPerson(async (k) => listeEigeneDokumente(k));
    expect(liste.map((d) => d.id)).not.toContain(id);
  });

  it('beide Gesellschaften in EINER Liste — und jede Zeile nennt ihre (EMP-14)', async () => {
    const r = await dokument(f.reinigung, 'Reinigung: Aushang');
    const s = await dokument(f.security, 'Security: Aushang');
    const liste = await alsPerson(async (k) => listeEigeneDokumente(k));
    const ids = liste.map((d) => d.id);
    expect(ids).toContain(r);
    expect(ids).toContain(s);
    for (const d of liste) {
      expect(d.mandantSlug, d.titel).not.toBe('');
      expect(d.mandantName, d.titel).not.toBe('');
    }
  });

  it('der Gesellschaftsfilter greift, und der Kategoriefilter auch', async () => {
    const r = await dokument(f.reinigung, 'Reinigung: Aushang');
    const s = await dokument(f.security, 'Security: Aushang',
      { kategorie: 'projekt' });
    const nurR = await alsPerson(async (k) =>
      listeEigeneDokumente(k, { mandantSlug: 'reinigung' }));
    expect(nurR.map((d) => d.id)).toContain(r);
    expect(nurR.map((d) => d.id)).not.toContain(s);

    const nurProjekt = await alsPerson(async (k) =>
      listeEigeneDokumente(k, { kategorie: 'projekt' }));
    expect(nurProjekt.map((d) => d.id)).toContain(s);
    expect(nurProjekt.map((d) => d.id)).not.toContain(r);
  });

  it('die Kategoriezaehlung stimmt mit der Liste ueberein', async () => {
    /**
     * Eine Filterzeile, die eine andere Zahl nennt als die Liste dahinter,
     * ist eine zweite Wahrheit — und die falsche, sobald jemand sie glaubt.
     */
    await dokument(f.reinigung, 'A', { kategorie: 'unternehmen' });
    await dokument(f.reinigung, 'B', { kategorie: 'unternehmen' });
    await dokument(f.reinigung, 'C', { kategorie: 'projekt' });
    await dokument(f.reinigung, 'D', { kategorie: 'projekt', fuerMitarbeiter: false });

    const [zaehlung, liste] = await alsPerson(async (k) => [
      await zaehleEigeneKategorien(k), await listeEigeneDokumente(k),
    ] as const);
    for (const z of zaehlung) {
      expect(liste.filter((d) => d.kategorie === z.kategorie).length, z.kategorie)
        .toBe(z.anzahl);
    }
  });

  it('K-05: die Nutzlast fuehrt GENAU die festgeschriebenen Felder', async () => {
    const id = await dokument(f.reinigung, 'Betriebsanweisung');
    const d = await alsPerson(async (k) => findeEigenesDokument(k, id));
    expect(d).not.toBeNull();
    expect(Object.keys(d!).sort()).toEqual([...MEIN_DOKUMENT_FELDER].sort());
  });

  it('und weder `bucket` noch `kunde_id` kommen mit', async () => {
    const id = await dokument(f.reinigung, 'Betriebsanweisung');
    const d = await alsPerson(async (k) => findeEigenesDokument(k, id));
    const schluessel = Object.keys(d!);
    for (const verboten of ['bucket', 'objektSchluessel', 'kundeId', 'sichtbarFuerKunde']) {
      expect(schluessel, verboten).not.toContain(verboten);
    }
  });

  it('ein Dokument OHNE Objekt faellt nicht aus der Liste (left join, nicht join)', async () => {
    /**
     * `dokument.objekt_id` ist nullbar. Ein `join objekt` liesse jede
     * Unternehmensunterlage verschwinden — still, und es saehe aus wie „es
     * liegt nichts vor" (K-18).
     */
    const ohne = await dokument(f.reinigung, 'Notfallnummern', { objektId: null });
    const liste = await alsPerson(async (k) => listeEigeneDokumente(k));
    const zeile = liste.find((d) => d.id === ohne);
    expect(zeile).toBeDefined();
    expect(zeile!.objektBezeichnung).toBeNull();
  });

  it('und eines an einem FREMDEN Objekt auch nicht — nur ohne dessen Namen', async () => {
    /**
     * Im Personen-Scope gibt `objekt.t_person` nur die Objekte der eigenen
     * Einteilungen heraus. Haengt eine freigegebene Unterlage an einem anderen
     * Objekt, bleibt die Zeile — die Bezeichnung fehlt. Ein `join` haette das
     * Dokument selbst verschwinden lassen.
     */
    const fremdesObjekt = await objekt(f.reinigung, 'Fremdes Haus');
    const id = await dokument(f.reinigung, 'Aushang', { objektId: fremdesObjekt });
    const liste = await alsPerson(async (k) => listeEigeneDokumente(k));
    const zeile = liste.find((d) => d.id === id);
    expect(zeile).toBeDefined();
    expect(zeile!.objektBezeichnung).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Objekte — die Liste kommt aus der Einteilung
// ---------------------------------------------------------------------------

describe('(2) meine Objekte sind die meiner Einteilungen (EMP-02, OPS-01)', () => {
  async function eingeteilt(
    mandant: string, anstellung: string, name: string,
    vonStunden: number, bisStunden: number, opts: ObjektOpts = {},
  ): Promise<string> {
    const o = await objekt(mandant, name, opts);
    const e = await einsatz(mandant, o, vonStunden, bisStunden);
    await zuordnung(mandant, e, anstellung, f.fatima);
    return o;
  }

  it('ein Objekt mit eigener Einteilung steht in der Liste', async () => {
    const o = await eingeteilt(f.reinigung, f.fatimaReinigung, 'Treppenhaus Nord', 1, 9);
    const liste = await alsPerson(async (k) => listeEigeneObjekte(k));
    expect(liste.map((x) => x.objektId)).toContain(o);
  });

  it('ein Objekt OHNE eigene Einteilung nicht — und einzeln ebenfalls nicht', async () => {
    const fremd = await objekt(f.reinigung, 'Fremdes Haus');
    const liste = await alsPerson(async (k) => listeEigeneObjekte(k));
    expect(liste.map((x) => x.objektId)).not.toContain(fremd);
    // 404 statt 403: ein fremdes Objekt ist fuer diese Anmeldung nicht da.
    expect(await alsPerson(async (k) => findeEigenesObjekt(k, fremd))).toBeNull();
  });

  it('`aktuellEingeteilt` ist wahr vor Schichtende und falsch danach', async () => {
    /**
     * **Die Grenze, an der alles haengt.** `app.ist_eingesetzt_auf_objekt`
     * verlangt `e.ende_zeitpunkt >= now()`. Ein Objekt der Vergangenheit
     * bleibt in der Liste — der Weg von vorletzter Woche ist nachschlagbar —,
     * aber es ist nicht mehr „aktuell".
     */
    const kommend = await eingeteilt(f.reinigung, f.fatimaReinigung, 'Kommend', 1, 9);
    const vergangen = await eingeteilt(f.reinigung, f.fatimaReinigung, 'Vergangen', -9, -1);
    const liste = await alsPerson(async (k) => listeEigeneObjekte(k));

    const a = liste.find((x) => x.objektId === kommend);
    const b = liste.find((x) => x.objektId === vergangen);
    expect(a?.aktuellEingeteilt).toBe(true);
    expect(b).toBeDefined();
    expect(b!.aktuellEingeteilt).toBe(false);
  });

  it('die laufenden stehen oben', async () => {
    await eingeteilt(f.reinigung, f.fatimaReinigung, 'Vergangen', -9, -1);
    const kommend = await eingeteilt(f.reinigung, f.fatimaReinigung, 'Kommend', 1, 9);
    const liste = await alsPerson(async (k) => listeEigeneObjekte(k));
    expect(liste[0]?.objektId).toBe(kommend);
  });

  it('K-05: die Nutzlast fuehrt GENAU die festgeschriebenen Felder', async () => {
    const o = await eingeteilt(f.reinigung, f.fatimaReinigung, 'Treppenhaus', 1, 9);
    const zeile = await alsPerson(async (k) => findeEigenesObjekt(k, o));
    expect(zeile).not.toBeNull();
    expect(Object.keys(zeile!).sort()).toEqual([...EIGENES_OBJEKT_FELDER].sort());
  });

  it('und die Zeile nennt weder Kunde noch Zutritt', async () => {
    const o = await eingeteilt(f.reinigung, f.fatimaReinigung, 'Treppenhaus', 1, 9);
    const zeile = await alsPerson(async (k) => findeEigenesObjekt(k, o));
    const schluessel = Object.keys(zeile!);
    for (const verboten of ['kundeId', 'kundeName', 'zutrittHinweis', 'bemerkung']) {
      expect(schluessel, verboten).not.toContain(verboten);
    }
  });

  it('beide Gesellschaften in EINER Liste (EMP-14, D-09)', async () => {
    const r = await eingeteilt(f.reinigung, f.fatimaReinigung, 'Reinigungsobjekt', 1, 9);
    const s = await eingeteilt(f.security, f.fatimaSecurity, 'Wachobjekt', 2, 10);
    const liste = await alsPerson(async (k) => listeEigeneObjekte(k));
    const ids = liste.map((x) => x.objektId);
    expect(ids).toContain(r);
    expect(ids).toContain(s);
    expect(liste.find((x) => x.objektId === r)?.mandantSlug).toBe('reinigung');
    expect(liste.find((x) => x.objektId === s)?.mandantSlug).toBe('security');
  });
});

describe('(2b) „Meine Schichten hier" — dieselbe Projektion wie die Schichtliste', () => {
  it('die kommenden stehen oben, die vergangenen darunter', async () => {
    /**
     * Die Reihenfolge ist die Frage, die jemand vor dem Objekt hat: wann bin
     * ich hier das naechste Mal. Eine rein absteigende Liste beantwortet sie
     * nicht — sie beginnt mit der letzten Schicht des Vorjahres.
     */
    const o = await objekt(f.reinigung, 'Treppenhaus Nord');
    const alt = await einsatz(f.reinigung, o, -30, -22);
    const neu = await einsatz(f.reinigung, o, 4, 12);
    await zuordnung(f.reinigung, alt, f.fatimaReinigung, f.fatima);
    await zuordnung(f.reinigung, neu, f.fatimaReinigung, f.fatima);

    const liste = await alsPerson(async (k) => listeEigeneSchichtenAufObjekt(k, o));
    expect(liste.length).toBe(2);
    expect(liste[0]!.einsatzId).toBe(neu);
    expect(liste[0]!.beendet).toBe(false);
    expect(liste[1]!.einsatzId).toBe(alt);
    expect(liste[1]!.beendet).toBe(true);
  });

  it('und keine Schicht eines anderen Objekts', async () => {
    const o = await objekt(f.reinigung, 'Treppenhaus Nord');
    const anderes = await objekt(f.reinigung, 'Anderes Haus');
    const e1 = await einsatz(f.reinigung, o, 4, 12);
    const e2 = await einsatz(f.reinigung, anderes, 4, 12);
    await zuordnung(f.reinigung, e1, f.fatimaReinigung, f.fatima);
    await zuordnung(f.reinigung, e2, f.fatimaReinigung, f.fatima);

    const liste = await alsPerson(async (k) => listeEigeneSchichtenAufObjekt(k, o));
    expect(liste.map((z) => z.einsatzId)).toEqual([e1]);
  });

  it('die Grenze schneidet ab — und zwar die aeltesten', async () => {
    const o = await objekt(f.reinigung, 'Treppenhaus Nord');
    for (const stunde of [-40, -30, -20, 4]) {
      const e = await einsatz(f.reinigung, o, stunde, stunde + 8);
      await zuordnung(f.reinigung, e, f.fatimaReinigung, f.fatima);
    }
    const liste = await alsPerson(async (k) => listeEigeneSchichtenAufObjekt(k, o, 2));
    expect(liste.length).toBe(2);
    // Die kommende zuerst, dann die juengste vergangene.
    expect(liste[0]!.beendet).toBe(false);
    expect(liste[1]!.beendet).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Der Zutritt — der heikle Teil
// ---------------------------------------------------------------------------

describe('(3) der Zutrittshinweis gehoert dem, der eingeteilt IST (0360, SEC-05)', () => {
  async function mitSchicht(
    name: string, vonStunden: number, bisStunden: number, opts: ObjektOpts = {},
  ): Promise<string> {
    const o = await objekt(f.reinigung, name, opts);
    const e = await einsatz(f.reinigung, o, vonStunden, bisStunden);
    await zuordnung(f.reinigung, e, f.fatimaReinigung, f.fatima);
    return o;
  }

  it('waehrend der Einteilung kommt er heraus', async () => {
    const o = await mitSchicht('Treppenhaus', 1, 9);
    const z = await alsPerson(async (k) => leseObjektZugang(k, o));
    expect(z).not.toBeNull();
    expect(z!.zutrittHinweis).toContain('4711');
  });

  it('NACH der letzten Schicht nicht mehr — das Objekt bleibt, der Code geht', async () => {
    /**
     * Die Zusage dieses ganzen Stapels, in einem Fall: ein Schluessel- oder
     * Alarmcode gehoert dem, der dort eingeteilt IST, und nur, solange er es
     * ist. Das Objekt selbst bleibt lesbar — sonst verloere die Kraft auch die
     * Anschrift ihrer letzten Woche.
     */
    const o = await mitSchicht('Treppenhaus', -9, -1);
    expect(await alsPerson(async (k) => leseObjektZugang(k, o))).toBeNull();
    expect(await alsPerson(async (k) => findeEigenesObjekt(k, o))).not.toBeNull();
  });

  it('auf einem Objekt ohne jede eigene Einteilung erst recht nicht', async () => {
    const fremd = await objekt(f.reinigung, 'Fremdes Haus');
    expect(await alsPerson(async (k) => leseObjektZugang(k, fremd))).toBeNull();
  });

  it('der Ansprechpartner kommt mit — Name und Telefon, sonst nichts', async () => {
    const o = await mitSchicht('Treppenhaus', 1, 9,
      { kontakt: { nachname: 'Meyer', telefon: '+49 30 23125 174' } });
    const z = await alsPerson(async (k) => leseObjektZugang(k, o));
    expect(z!.ansprechpartnerName).toBe('Anna Meyer');
    expect(z!.ansprechpartnerTelefon).toBe('+49 30 23125 174');
    expect(Object.keys(z!).sort()).toEqual([...OBJEKT_ZUGANG_FELDER].sort());
  });

  it('ein AUSGESCHIEDENER Ansprechpartner kommt nicht mit', async () => {
    /**
     * Wer nicht mehr da ist, hilft an der Tuer niemandem — und ein Name, der
     * aus dem Bestand genommen wurde, soll nicht ueber einen zweiten Lesepfad
     * zurueckkommen.
     */
    const o = await mitSchicht('Treppenhaus', 1, 9, {
      kontakt: { nachname: 'Weg', telefon: '+49 30 23125 175' },
      kontaktAusgeschieden: true,
    });
    const z = await alsPerson(async (k) => leseObjektZugang(k, o));
    expect(z).not.toBeNull();
    expect(z!.ansprechpartnerName).toBeNull();
    expect(z!.ansprechpartnerTelefon).toBeNull();
  });

  it('„eingeteilt, aber nichts hinterlegt" ist eine ANDERE Antwort als „nicht eingeteilt"', async () => {
    /**
     * Beides waere auf dem Bildschirm ein leeres Feld, und die zwei Saetze
     * darunter sagen Gegenteiliges. Die Datenbank unterscheidet sie: eine
     * ZEILE mit lauter NULL gegen GAR KEINE Zeile.
     */
    const o = await mitSchicht('Ohne Hinweis', 1, 9, { zutritt: null });
    const z = await alsPerson(async (k) => leseObjektZugang(k, o));
    expect(z).not.toBeNull();
    expect(z!.zutrittHinweis).toBeNull();
  });

  it('die SPALTE selbst ist `cse_app` entzogen — der Definer ist der einzige Weg (K-05)', async () => {
    /**
     * Ohne diesen Fall bewiese nichts, dass die Funktion ueberhaupt gebraucht
     * wird: eine Seite koennte die Spalte direkt lesen und die ganze
     * Zeitgrenze umgehen. 0021 entzieht sie — und der Versuch scheitert hart
     * und sichtbar statt still.
     */
    await expect(alsApp(
      { scope: 'person', personId: f.fatima, benutzerId: fatimaKonto },
      async (tx) => tx.unsafe(`select zutritt_hinweis from objekt limit 1`),
    )).rejects.toThrow(/permission denied/iu);
  });

  it('ausserhalb des Mitarbeiterportals antwortet die Funktion NICHTS (K-04)', async () => {
    /**
     * Ein Definer erbt die Portaldecke nicht — er muss sie selbst pruefen.
     * Im internen Portal gibt es `app.objekt_notiz_lesen` mit `objekt.lesen`;
     * ein zweiter Weg daran vorbei waere genau der, den niemand bemerkt.
     */
    const o = await mitSchicht('Treppenhaus', 1, 9);
    const leitung = await konto();
    await mitglied(leitung, f.reinigung, 'leitung');
    const zeilen = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, mandantIds: [f.reinigung],
        benutzerId: leitung, portal: 'intern' },
      async (tx) => tx.unsafe(
        `select zutritt_hinweis from app.mein_objekt_zugang($1::uuid)`, [o]),
    );
    expect(zeilen.length).toBe(0);
  });

  it('und eine NULL-Kennung ergibt keine Zeile statt eines dreiwertigen Ergebnisses', async () => {
    // Eine Schicht ohne Objekt (Veranstaltung, Springerdienst) traegt
    // `objekt_id` NULL — der haeufigste Aufruf, nicht der seltenste.
    const zeilen = await alsApp(
      { scope: 'person', personId: f.fatima, benutzerId: fatimaKonto },
      async (tx) => tx.unsafe(
        `select zutritt_hinweis from app.mein_objekt_zugang(null::uuid)`),
    );
    expect(zeilen.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Die Abrufspur — DOC-03, SEC-A6, Art. 15 DSGVO
// ---------------------------------------------------------------------------

describe('(4) jeder Abruf hinterlaesst eine Zeile (0361, DOC-03)', () => {
  /** Der M1-Scope des Portals: Mandant AUS dem Dokument, Portal bleibt `mitarbeiter`. */
  async function alsPersonImMandanten<T>(
    mandant: string, fn: (tx: postgres.TransactionSql) => Promise<T>,
  ): Promise<T> {
    return alsApp(
      { scope: 'mandant', mandantId: mandant, mandantIds: [mandant],
        benutzerId: fatimaKonto, personId: f.fatima, portal: 'mitarbeiter',
        readonly: false },
      fn,
    );
  }

  it('die Abrufroute findet Ablageort und Mandant im Personen-Scope', async () => {
    /**
     * Die EXAKTE Abfrage aus `api/mein/dokumente/[id]/datei`. Sie steht hier,
     * weil sie drei Spalten liest, die keine Seite je anfasst — `bucket` und
     * `objekt_schluessel` sind der Ablageort (K-05: die Projektion der Liste
     * gibt sie ausdruecklich NICHT heraus). Waeren sie `cse_app` entzogen wie
     * `objekt.zutritt_hinweis`, scheiterte der Abruf an „permission denied for
     * column" — und zwar erst im Betrieb, an einem Knopf, den die Seite
     * anbietet.
     */
    const id = await dokument(f.reinigung, 'Betriebsanweisung');
    const [ort] = await alsPerson(async (k) => k.abfrage<{
      mandant_id: string; bucket: string; objekt_schluessel: string;
    }>(
      `select d.mandant_id, d.bucket, d.objekt_schluessel
         from dokument d where d.id = $1::uuid`, [id]));
    expect(ort).toBeDefined();
    expect(ort!.mandant_id).toBe(f.reinigung);
    expect(ort!.bucket).toBe('dokumente');
    expect(ort!.objekt_schluessel.endsWith('.pdf')).toBe(true);
  });

  it('und fuer eine NICHT freigegebene findet sie nichts — der Abruf endet in 404', async () => {
    const id = await dokument(f.reinigung, 'Kalkulation intern',
      { fuerMitarbeiter: false });
    const zeilen = await alsPerson(async (k) => k.abfrage(
      `select d.mandant_id from dokument d where d.id = $1::uuid`, [id]));
    expect(zeilen.length).toBe(0);
  });

  it('fuer eine freigegebene eigene Unterlage gelingt der Vermerk', async () => {
    const id = await dokument(f.reinigung, 'Betriebsanweisung');
    await alsPersonImMandanten(f.reinigung, async (tx) => tx.unsafe(
      `insert into dokument_zugriff (mandant_id, dokument_id, benutzer_id, art)
       values ($1::uuid, $2::uuid, app.aktueller_benutzer(), 'abruf')`,
      [f.reinigung, id]));
    const [z] = await sql.unsafe<{ anzahl: string }[]>(
      `select count(*)::text as anzahl from dokument_zugriff where dokument_id = $1`, [id]);
    expect(z!.anzahl).toBe('1');
  });

  it('fuer eine NICHT freigegebene scheitert er an der Policy', async () => {
    /**
     * Die Spur darf nicht mehr zulassen als die Dokumentdecke: sonst liesse
     * sich ueber sie herausfinden, welche Kennungen es gibt — und die Auskunft
     * nach Art. 15 stuende voller Abrufe, die niemand haette machen duerfen.
     */
    const id = await dokument(f.reinigung, 'Kalkulation intern',
      { fuerMitarbeiter: false });
    await expect(alsPersonImMandanten(f.reinigung, async (tx) => tx.unsafe(
      `insert into dokument_zugriff (mandant_id, dokument_id, benutzer_id, art)
       values ($1::uuid, $2::uuid, app.aktueller_benutzer(), 'abruf')`,
      [f.reinigung, id]))).rejects.toThrow(/row-level security|violates/iu);
  });

  it('und auf ein fremdes Konto laesst sich keine Spur schreiben', async () => {
    const id = await dokument(f.reinigung, 'Betriebsanweisung');
    const fremd = await konto();
    await expect(alsPersonImMandanten(f.reinigung, async (tx) => tx.unsafe(
      `insert into dokument_zugriff (mandant_id, dokument_id, benutzer_id, art)
       values ($1::uuid, $2::uuid, $3::uuid, 'abruf')`,
      [f.reinigung, id, fremd]))).rejects.toThrow(/row-level security|violates/iu);
  });

  it('im PERSONEN-Scope schreibt niemand — dort ist alles nur lesend', async () => {
    /**
     * Deshalb faehrt der Abruf ueber die PER->M1-Bruecke und nicht aus der
     * Seite heraus: `withPersonScope` bindet `app.readonly = 'on'`, und
     * `app.aktiver_mandant()` ist dort NULL (K-20).
     */
    const id = await dokument(f.reinigung, 'Betriebsanweisung');
    await expect(alsApp(
      { scope: 'person', personId: f.fatima, benutzerId: fatimaKonto },
      async (tx) => tx.unsafe(
        `insert into dokument_zugriff (mandant_id, dokument_id, benutzer_id, art)
         values ($1::uuid, $2::uuid, app.aktueller_benutzer(), 'abruf')`,
        [f.reinigung, id]),
    )).rejects.toThrow(/row-level security|violates/iu);
  });
});
