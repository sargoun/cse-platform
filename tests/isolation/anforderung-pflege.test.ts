/**
 * Verlangte Nachweise werden eingetragen — und dann greift SEC-04 (V-179,
 * D-673, SEC-01, SEC-04, SEC-08).
 *
 * **Der Befund.** `einsatzanforderung` hatte keinen Schreibweg. Die Tests,
 * die die §34a-Sperre pruefen (`security-posten.test.ts` §2), schrieben ihre
 * Anforderung als rohes INSERT — sie bewiesen das Tor, nicht dass jemand es
 * je fuettern konnte. Hier entsteht jede Anforderung ueber den Dienst, als
 * `cse_app` mit der Sitzung der Sicherheitsleitung.
 *
 * Und die zweite Haelfte (0465): eine neue Anforderung zieht die KUENFTIGEN
 * Schichten ihres Bereichs nach — eine schon eingeteilte Wache ohne Nachweis
 * steht danach als „falsch gemischt" im Plan —, eine begonnene Schicht bleibt
 * bei dem, was damals verlangt war (V-129).
 *
 * **Nachgeschaerft nach der Pruefung der Gruppe** (V-179): „ohne Recht
 * schreibt die Datenbank nicht" lief als Leitung MIT `security.schreiben` und
 * scheiterte nur an `readonly` — es prueft jetzt eine Rolle, die das Recht
 * wirklich nicht haelt, neben einer Gegenprobe mit ihm; der „fremde Posten"
 * war die Null-Kennung, jetzt ist es der Posten einer anderen Gesellschaft,
 * mit Grund und Status; und der Weg ueber die Veranstaltung samt den drei
 * uebrigen Zweigen des Nachzugs (Veranstaltung, Objekt, Gesellschaft) stand in
 * keiner Zeile (4).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import {
  AnforderungFehler, archiviereAnforderung, legeAnforderungAn, leseAnforderungen,
  type AnforderungEingabe,
} from '../../src/server/services/security/anforderung.js';
import { besetzeEinsatz } from '../../src/server/services/dienstplan/einteilung.js';
import { QualifikationFehlt } from '../../src/server/services/nachweis/tor.js';
import { erzeugeVeranstaltungsschicht } from '../../src/server/services/security/eventbesetzung.js';

let f: Fixtur;
let chef = '';
const zufall = (): string => String(Math.random()).slice(2, 10);

/** Weit in der Zukunft — kein anderer Test legt dort Schichten an. */
const TAG = '2030-06-12';

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function konto(): Promise<string> {
  const email = `anforderung-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`, [u!.id, email]);
  return u!.id;
}

async function objekt(): Promise<{ objektId: string; kundeId: string }> {
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name) values ($1, $2, 'Wachkunde')
     returning id`, [f.security, `K-${zufall()}`]);
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
     values ($1, $2, $3, 'Werkstor', 'Teststr. 1', '10115', 'Berlin') returning id`,
    [f.security, k!.id, `O-${zufall()}`]);
  return { objektId: o!.id, kundeId: k!.id };
}

async function posten(objektId: string): Promise<string> {
  const [p] = await sql.unsafe<{ id: string }[]>(
    `insert into posten (mandant_id, objekt_id, bezeichnung, min_besetzung, soll_besetzung,
                         gueltig_ab, erstellt_von_art)
     values ($1,$2,'Torwache',1,1,'2030-01-01','system') returning id`, [f.security, objektId]);
  return p!.id;
}

/** Eine Postenschicht 22:00–04:00 an `tag` — oder, mit `beginnVorbei`, vor einer Stunde. */
async function schicht(
  objektId: string, kundeId: string, postenId: string, opts: { beginnVorbei?: boolean } = {},
): Promise<string> {
  if (opts.beginnVorbei === true) {
    /* Hat vor einer Stunde begonnen — ihr Schnappschuss ist eingefroren (0394). */
    const [e] = await sql.unsafe<{ id: string }[]>(
      `insert into einsatz (mandant_id, quelle, quell_schluessel, plan_datum,
                            beginn_zeitpunkt, ende_zeitpunkt, zeitzone,
                            beginn_lokal, ende_lokal, endet_am_folgetag,
                            objekt_id, kunde_id, posten_id, soll_besetzung, min_besetzung,
                            pause_geplant_minuten, erstellt_von_art, status)
       select $1,'posten',$2,((now() - interval '1 hour') at time zone 'Europe/Berlin')::date,
              now() - interval '1 hour', now() + interval '5 hours', 'Europe/Berlin',
              ((now() - interval '1 hour') at time zone 'Europe/Berlin')::time,
              ((now() + interval '5 hours') at time zone 'Europe/Berlin')::time,
              ((now() + interval '5 hours') at time zone 'Europe/Berlin')::date
                > ((now() - interval '1 hour') at time zone 'Europe/Berlin')::date,
              $3,$4,$5,1,1,0,'system','geplant'
       returning id`,
      [f.security, `anf:${zufall()}`, objektId, kundeId, postenId]);
    return e!.id;
  }
  const [e] = await sql.unsafe<{ id: string }[]>(
    `insert into einsatz (mandant_id, quelle, quell_schluessel, plan_datum,
                          beginn_zeitpunkt, ende_zeitpunkt, zeitzone,
                          beginn_lokal, ende_lokal, endet_am_folgetag,
                          objekt_id, kunde_id, posten_id, soll_besetzung, min_besetzung,
                          pause_geplant_minuten, erstellt_von_art, status)
     values ($1,'posten',$2,$3::date,
             (select zeitpunkt from app.loese_ortszeit($3::date, '22:00', 'Europe/Berlin')),
             (select zeitpunkt from app.loese_ortszeit($3::date + 1, '04:00', 'Europe/Berlin')),
             'Europe/Berlin','22:00','04:00',true,$4,$5,$6,1,1,0,'system','geplant')
     returning id`,
    [f.security, `anf:${zufall()}`, TAG, objektId, kundeId, postenId]);
  return e!.id;
}

/** Eine Veranstaltung am `TAG`, mit Objekt oder — ein Veranstaltungsort als Text — ohne. */
async function veranstaltung(kundeId: string, objektId: string | null): Promise<string> {
  const [v] = await sql.unsafe<{ id: string }[]>(
    `insert into veranstaltung (mandant_id, objekt_id, veranstaltungsort_text, kunde_id,
                                bezeichnung, beginn, ende, soll_besetzung, erstellt_von_art)
     values ($1,$2,$3,$4,'Werksfest',
             (select zeitpunkt from app.loese_ortszeit($5::date,'18:00','Europe/Berlin')),
             (select zeitpunkt from app.loese_ortszeit($5::date + 1,'02:00','Europe/Berlin')),
             1,'system')
     returning id`,
    [f.security, objektId, objektId === null ? 'Festwiese Nord' : null, kundeId, TAG]);
  return v!.id;
}

/** Eine Rolle DIESER Gesellschaft mit genau diesen Rechten. */
async function rolleMit(rechte: readonly string[]): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `insert into rolle (mandant_id, schluessel, bezeichnung, geltungsbereich, portal)
     values ($1, $2, $2, 'mandant', 'intern') returning id`,
    [f.security, `anf_${zufall()}`]);
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     select $1, b.id, $2, true from berechtigung b where b.schluessel = any($3::text[])`,
    [r!.id, f.security, [...rechte]]);
  return r!.id;
}

async function qualifikation(): Promise<string> {
  const [q] = await sql.unsafe<{ id: string }[]>(
    `insert into qualifikation (mandant_id, schluessel, bezeichnung, kategorie,
                                rechtsgrundlage, laeuft_ab, blockiert_einsatz)
     values (null, $1, 'Sachkundeprüfung §34a', 'gesetzlich', '§34a GewO', true, true)
     returning id`, [`34a_${zufall()}`]);
  return q!.id;
}

async function nachweis(personId: string, q: string, bis: string): Promise<void> {
  await sql.unsafe(
    `insert into nachweis (person_id, qualifikation_id, gueltig_ab, gueltig_bis,
                           status, erfasst_von_mandant_id)
     values ($1,$2,'2020-01-01',$3::date,'gueltig',$4)`, [personId, q, bis, f.security]);
}

function alsChef<T>(fn: (k: SchreibKontext) => Promise<T>): Promise<T> {
  return alsApp(
    { scope: 'mandant', mandantId: f.security, benutzerId: chef, portal: 'intern', readonly: false },
    async (tx) => {
      const abfrage = async <R,>(s: string, w: readonly unknown[] = []) =>
        (await tx.unsafe(s, w as never[])) as readonly R[];
      return fn({
        scope: 'mandant', portal: 'intern', benutzerId: chef,
        aktiverMandantId: f.security, mandantIds: [f.security],
        abfrage, schreibe: abfrage,
      });
    },
  );
}

function sperre(postenId: string, q: string, mehr: Partial<AnforderungEingabe> = {}):
AnforderungEingabe {
  return {
    herkunft: { art: 'posten', id: postenId },
    bereich: 'posten',
    qualifikationId: q,
    zwingend: true,
    geltung: 'jeder',
    mindestanzahl: 1,
    bewacherregisterPflicht: false,
    gueltigAb: null,
    rechtsgrundlage: '§ 34a Abs. 1a GewO',
    bestaetigt: false,
    ...mehr,
  };
}

async function stand(e: string): Promise<{ n: number; erfuellt: boolean | null }> {
  const [z] = await sql.unsafe<{ n: number; erfuellt: boolean | null }[]>(
    `select jsonb_array_length(anforderung_snapshot)::int as n, anforderung_erfuellt as erfuellt
       from einsatz where id = $1`, [e]);
  return z!;
}

beforeEach(async () => {
  f = await seed();
  chef = await konto();
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [chef, f.security, await rolleId('leitung')]);
});
afterAll(schliessen);

describe('(1) eintragen ueber den Dienst — und die §34a-Sperre greift', () => {
  it('eine eingetragene Sperre laesst die Zuweisung mit abgelaufener Sachkunde scheitern',
    async () => {
      const { objektId, kundeId } = await objekt();
      const p = await posten(objektId);
      const q = await qualifikation();
      await nachweis(f.fatima, q, '2030-03-01');
      const e = await schicht(objektId, kundeId, p);

      const { id } = await alsChef((k) => legeAnforderungAn(k, sperre(p, q)));
      const [zeile] = await sql.unsafe<{ ist_platzhalter: boolean; erstellt_von: string }[]>(
        `select ist_platzhalter, erstellt_von from einsatzanforderung where id = $1`, [id]);
      /* Nicht als bestaetigt eingetragen → unbestaetigt (O-342, §1.16). */
      expect(zeile).toEqual({ ist_platzhalter: true, erstellt_von: chef });

      const fehler = await alsChef((k) =>
        besetzeEinsatz(k, { einsatzId: e, anstellungId: f.fatimaSecurity })
          .then(() => null, (x: unknown) => x));
      expect(fehler).toBeInstanceOf(QualifikationFehlt);
      expect((fehler as QualifikationFehlt).befund.fehlend.map((x) => x.qualifikationId))
        .toContain(q);
    });

  it('dieselbe Zuweisung geht ohne Anforderung durch — das war der Zustand vorher',
    async () => {
      const { objektId, kundeId } = await objekt();
      const p = await posten(objektId);
      const q = await qualifikation();
      await nachweis(f.fatima, q, '2030-03-01');
      const e = await schicht(objektId, kundeId, p);
      const befund = await alsChef((k) =>
        besetzeEinsatz(k, { einsatzId: e, anstellungId: f.fatimaSecurity }));
      expect(befund.qualifikation.anforderungenGefunden).toBe(0);
    });

  it('die Objektanforderung haengt am Objekt DES POSTENS — nie an einer Kennung aus der Anfrage',
    async () => {
      const { objektId } = await objekt();
      const p = await posten(objektId);
      const q = await qualifikation();
      const { id } = await alsChef((k) => legeAnforderungAn(k, sperre(p, q, {
        bereich: 'objekt', zwingend: false, bestaetigt: true,
      })));
      const [z] = await sql.unsafe<{
        geltungsbereich: string; objekt_id: string; posten_id: string | null;
        ist_platzhalter: boolean;
      }[]>(
        `select geltungsbereich::text, objekt_id, posten_id, ist_platzhalter
           from einsatzanforderung where id = $1`, [id]);
      expect(z).toEqual({
        geltungsbereich: 'objekt', objekt_id: objektId, posten_id: null, ist_platzhalter: false,
      });
      const liste = await alsChef((k) =>
        leseAnforderungen(k, { art: 'posten', id: p, objektId }));
      expect(liste.map((a) => a.bereich)).toEqual(['objekt']);
    });
});

describe('(2) was abgewiesen wird — mit einem Grund', () => {
  it('eine Sperre mit „mindestens eine Person" (ea_geltung_zwischenstand)', async () => {
    const { objektId } = await objekt();
    const p = await posten(objektId);
    const q = await qualifikation();
    await expect(alsChef((k) => legeAnforderungAn(k, sperre(p, q, {
      geltung: 'mindestens_einer', mindestanzahl: 2,
    })))).rejects.toMatchObject({ grund: 'sperre_nur_jeder' });
  });

  it('dieselbe Qualifikation zweimal fuer denselben Bereich', async () => {
    const { objektId } = await objekt();
    const p = await posten(objektId);
    const q = await qualifikation();
    await alsChef((k) => legeAnforderungAn(k, sperre(p, q)));
    await expect(alsChef((k) => legeAnforderungAn(k, sperre(p, q))))
      .rejects.toMatchObject({ grund: 'doppelt', status: 409 });
  });

  it('ein fremder Posten ist nicht vorhanden, nicht verboten (AUT-06)', async () => {
    /*
     * Ein ECHTER Posten einer anderen Gesellschaft — nicht die Null-Kennung,
     * die es nirgends gibt: die Frage ist, ob die Grenze des Mandanten traegt.
     */
    const [k] = await sql.unsafe<{ id: string }[]>(
      `insert into kunde (mandant_id, kundennummer, name) values ($1, $2, 'Fremdkunde')
       returning id`, [f.reinigung, `K-${zufall()}`]);
    const [o] = await sql.unsafe<{ id: string }[]>(
      `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
       values ($1, $2, $3, 'Fremdobjekt', 'Teststr. 9', '10115', 'Berlin') returning id`,
      [f.reinigung, k!.id, `O-${zufall()}`]);
    const [fremd] = await sql.unsafe<{ id: string }[]>(
      `insert into posten (mandant_id, objekt_id, bezeichnung, min_besetzung, soll_besetzung,
                           gueltig_ab, erstellt_von_art)
       values ($1,$2,'Fremdwache',1,1,'2030-01-01','system') returning id`, [f.reinigung, o!.id]);
    const q = await qualifikation();
    const fehler = await alsChef((kx) => legeAnforderungAn(kx, sperre(fremd!.id, q)))
      .then(() => null, (x: unknown) => x);
    expect(fehler).toBeInstanceOf(AnforderungFehler);
    expect(fehler).toMatchObject({ grund: 'nicht_gefunden', status: 404 });
    const [n] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from einsatzanforderung where posten_id = $1`, [fremd!.id]);
    expect(n!.n).toBe(0);
  });

  it('ohne security.schreiben schreibt die Datenbank nicht (zweite Linie) — mit ihm schon',
    async () => {
      const { objektId } = await objekt();
      const p = await posten(objektId);
      const q = await qualifikation();
      const einfuegen = (benutzer: string) => alsApp(
        { scope: 'mandant', mandantId: f.security, benutzerId: benutzer, portal: 'intern',
          readonly: false },
        (tx) => tx.unsafe(
          `insert into einsatzanforderung (mandant_id, geltungsbereich, posten_id, qualifikation_id)
           values ($1, 'posten', $2, $3)`, [f.security, p, q]),
      );
      /* Eine Rolle, die lesen darf und NICHT schreiben — nicht nur-lesend gebunden. */
      const leser = await konto();
      await sql.unsafe(
        `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
        [leser, f.security, await rolleMit(['security.lesen'])]);
      await expect(einfuegen(leser)).rejects.toThrow(/row-level security/u);
      /* Die Gegenprobe: dieselbe Anweisung mit dem Recht geht durch. */
      await expect(einfuegen(chef)).resolves.toBeDefined();
    });

  it('eine nur-lesende Sitzung schreibt nicht, auch mit dem Recht', async () => {
    const { objektId } = await objekt();
    const p = await posten(objektId);
    const q = await qualifikation();
    await expect(alsApp(
      { scope: 'mandant', mandantId: f.security, benutzerId: chef, portal: 'intern', readonly: true },
      (tx) => tx.unsafe(
        `insert into einsatzanforderung (mandant_id, geltungsbereich, posten_id, qualifikation_id)
         values ($1, 'posten', $2, $3)`, [f.security, p, q]),
    )).rejects.toThrow(/row-level security/u);
  });
});

describe('(3) die Schichten ziehen nach — die Vergangenheit nicht (0465, V-129)', () => {
  it('eine eingeteilte kuenftige Schicht steht nach der neuen Sperre als falsch gemischt',
    async () => {
      const { objektId, kundeId } = await objekt();
      const p = await posten(objektId);
      const q = await qualifikation();
      const e = await schicht(objektId, kundeId, p);
      await alsChef((k) => besetzeEinsatz(k, { einsatzId: e, anstellungId: f.fatimaSecurity }));
      expect(await stand(e)).toEqual({ n: 0, erfuellt: true });

      const { id } = await alsChef((k) => legeAnforderungAn(k, sperre(p, q)));
      /* Sofort — nicht erst bei der naechsten Einteilung. */
      expect(await stand(e)).toEqual({ n: 1, erfuellt: false });

      await alsChef((k) => archiviereAnforderung(k, id));
      expect(await stand(e)).toEqual({ n: 0, erfuellt: true });
    });

  it('eine begonnene Schicht behaelt, was damals verlangt war', async () => {
    const { objektId, kundeId } = await objekt();
    const p = await posten(objektId);
    const q = await qualifikation();
    const e = await schicht(objektId, kundeId, p, { beginnVorbei: true });
    const vorher = await stand(e);
    await alsChef((k) => legeAnforderungAn(k, sperre(p, q)));
    expect(await stand(e)).toEqual(vorher);
  });

  it('archivieren zweimal wird abgewiesen, geloescht wird nie', async () => {
    const { objektId } = await objekt();
    const p = await posten(objektId);
    const q = await qualifikation();
    const { id } = await alsChef((k) => legeAnforderungAn(k, sperre(p, q)));
    await alsChef((k) => archiviereAnforderung(k, id));
    await expect(alsChef((k) => archiviereAnforderung(k, id)))
      .rejects.toMatchObject({ grund: 'schon_archiviert' });
    const [z] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from einsatzanforderung where id = $1`, [id]);
    expect(z!.n).toBe(1);
  });
});

describe('(4) von der Veranstaltung aus — und die uebrigen Zweige des Nachzugs (0465)', () => {
  function vonVeranstaltung(
    v: string, q: string, bereich: AnforderungEingabe['bereich'],
  ): AnforderungEingabe {
    return {
      ...sperre('', q), herkunft: { art: 'veranstaltung', id: v }, bereich,
      zwingend: false, geltung: 'jeder',
    };
  }

  it('Bereich Veranstaltung: die Zeile haengt an ihr, und ihre kuenftige Schicht zieht nach',
    async () => {
      const { objektId, kundeId } = await objekt();
      const v = await veranstaltung(kundeId, objektId);
      const q = await qualifikation();
      const { einsatzId } = await alsChef((k) => erzeugeVeranstaltungsschicht(k, v));
      expect((await stand(einsatzId)).n).toBe(0);

      const { id } = await alsChef((k) => legeAnforderungAn(k, vonVeranstaltung(v, q, 'veranstaltung')));
      const [z] = await sql.unsafe<{
        geltungsbereich: string; veranstaltung_id: string; posten_id: string | null;
        objekt_id: string | null;
      }[]>(
        `select geltungsbereich::text, veranstaltung_id, posten_id, objekt_id
           from einsatzanforderung where id = $1`, [id]);
      expect(z).toEqual({
        geltungsbereich: 'veranstaltung', veranstaltung_id: v, posten_id: null, objekt_id: null,
      });
      expect((await stand(einsatzId)).n).toBe(1);
      const liste = await alsChef((k) =>
        leseAnforderungen(k, { art: 'veranstaltung', id: v, objektId }));
      expect(liste.map((a) => a.bereich)).toEqual(['veranstaltung']);
    });

  it('eine Veranstaltung ohne Objekt: eine Objektanforderung hat keinen Ort (kein_objekt)',
    async () => {
      const { kundeId } = await objekt();
      const v = await veranstaltung(kundeId, null);
      const q = await qualifikation();
      await expect(alsChef((k) => legeAnforderungAn(k, vonVeranstaltung(v, q, 'objekt'))))
        .rejects.toMatchObject({ grund: 'kein_objekt', status: 422 });
      /* Fuer die Veranstaltung selbst geht es. */
      await expect(alsChef((k) => legeAnforderungAn(k, vonVeranstaltung(v, q, 'veranstaltung'))))
        .resolves.toMatchObject({ herkunft: { art: 'veranstaltung', id: v } });
    });

  it('Bereich Objekt: ueber die Veranstaltung eingetragen, zieht auch die Postenschicht am Objekt nach',
    async () => {
      const { objektId, kundeId } = await objekt();
      const v = await veranstaltung(kundeId, objektId);
      const p = await posten(objektId);
      const q = await qualifikation();
      const postenschicht = await schicht(objektId, kundeId, p);
      const { einsatzId } = await alsChef((k) => erzeugeVeranstaltungsschicht(k, v));

      const { id } = await alsChef((k) => legeAnforderungAn(k, vonVeranstaltung(v, q, 'objekt')));
      const [z] = await sql.unsafe<{ objekt_id: string; veranstaltung_id: string | null }[]>(
        `select objekt_id, veranstaltung_id from einsatzanforderung where id = $1`, [id]);
      expect(z).toEqual({ objekt_id: objektId, veranstaltung_id: null });
      expect((await stand(postenschicht)).n).toBe(1);
      expect((await stand(einsatzId)).n).toBe(1);
    });

  it('Bereich Gesellschaft: jede kuenftige Schicht zieht nach — eine fremde nicht', async () => {
    const { objektId, kundeId } = await objekt();
    const p = await posten(objektId);
    const q = await qualifikation();
    const e = await schicht(objektId, kundeId, p);
    await alsChef((k) => legeAnforderungAn(k, sperre(p, q, {
      bereich: 'mandant', zwingend: false, bestaetigt: true,
    })));
    expect((await stand(e)).n).toBe(1);
    const [fremd] = await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from einsatz
        where mandant_id <> $1 and jsonb_array_length(anforderung_snapshot) > 0`, [f.security]);
    expect(fremd!.n).toBe(0);
  });
});
