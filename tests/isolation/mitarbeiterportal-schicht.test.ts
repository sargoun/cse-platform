/**
 * Die Schichtseiten des Mitarbeiterportals an echtem Postgres (0300–0304).
 *
 * **Warum das hier steht und nicht in einem Unit-Test.** Jede Zusage dieser
 * fuenf Migrationen ist eine Aussage ueber die DATENBANK und in TypeScript
 * nicht falsifizierbar:
 *
 *  - ob die Kraft ihre EIGENE Schicht im Mandantenscope sieht und keine
 *    fremde, entscheidet `einsatz.t_selbst_m1` (0300);
 *  - ob sie ihren Antrag zurueckziehen kann und sich nicht selbst genehmigen,
 *    entscheiden die zwei Haelften von `t_selbst_zurueckziehen` (0301);
 *  - ob die Uebergabe sichtbar wird, entscheidet eine Einstellung, die im
 *    Personen-Scope ueberhaupt erst lesbar wurde (0302);
 *  - ob eine Aufnahme entsteht, entscheidet `t_selbst_schichtmedien` (0303);
 *  - ob der Kunde unterschreiben kann, entscheiden vier Policies und eine
 *    Definer-Funktion (0304).
 *
 * Jeder Fall ist so gebaut, dass er OHNE die jeweilige Migration fehlschlaegt
 * — und die Gegenprobe steht daneben, weil eine Policy, die alles durchlaesst,
 * jeden Positivfall besteht.
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { schliessen, seed, sql, type Fixtur } from './harness.js';
import {
  withPersonScope, withTenant,
  type LeseKontext, type SchreibKontext, type Sitzung,
} from '../../src/server/kontext/index.js';
import { findeSchichtBezug } from '../../src/server/services/mitarbeiter/schicht-zugang.js';
import { leseSchichtbuch } from '../../src/server/services/mitarbeiter/schichtbuch.js';
import { listeSchichtMedien } from '../../src/server/services/mitarbeiter/medien.js';
import { legeSchichtMediumAb } from '../../src/server/services/zeit/medien.js';
import { schreibeEintrag } from '../../src/server/services/security/wachbuch.js';
import {
  bereiteUnterschriftVor, erstelleEntwurf, ladePositionen, ladeSignaturen,
  legeVor, signiere,
} from '../../src/server/services/reinigung/leistungsnachweis.js';
import {
  findeOderLegeBautagAn, heftePositionAn, lesePositionen,
} from '../../src/server/services/bau/bautagebuch.js';
import {
  findeAntrag, reicheAntragEin, zieheAntragZurueck,
} from '../../src/server/services/abwesenheit/antrag.js';

let f: Fixtur;
let fatimaKonto: string;
let jonasKonto: string;
const SITZUNG = '00000000-0000-0000-0000-0000000004a1';
const zufall = (): string => String(Math.random()).slice(2, 10);

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

async function konto(personId: string): Promise<string> {
  const email = `schicht-${zufall()}@cse.test`;
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

async function objekt(mandant: string, name = 'Buerohaus'): Promise<string> {
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, rechtsgrundlage,
                        rechtsgrundlage_quelle, rechtsgrundlage_erfasst_am, status)
     values ($1,$2,'Testkunde','bestandskunde','Vertrag 2026', now(), 'aktiv') returning id`,
    [mandant, `K-${zufall()}`]);
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
     values ($1,$2,$3,$4,'Kurfürstendamm 21','10719','Berlin') returning id`,
    [mandant, k!.id, `OBJ-${zufall()}`, name]);
  return o!.id;
}

/**
 * Eine Baustelle samt Auftrag, Kunde, Objekt und Gewerk.
 *
 * `projekt.auftrag_id` ist NOT NULL, `projekt_status` kennt kein „laufend",
 * und `einsatz.objekt_id` verlangt der Ausloeser `kern.einsatz_kunde_setzen`.
 * Alle drei sind hier einmal richtig hinterlegt — eine Fixtur, die an der
 * Schemabedingung scheitert, sieht aus wie ein Policy-Defekt.
 */
async function baustelle(mandant: string, benutzerId: string): Promise<{
  projekt: string; objekt: string; gewerk: string;
}> {
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, rechtsgrundlage,
                        rechtsgrundlage_quelle, rechtsgrundlage_erfasst_am, status)
     values ($1,$2,'Bautraeger','bestandskunde','Vertrag 2026', now(), 'aktiv') returning id`,
    [mandant, `K-${zufall()}`]);
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
     values ($1,$2,$3,'Baustelle Wedding','Müllerstr. 1','13353','Berlin') returning id`,
    [mandant, k!.id, `OBJ-${zufall()}`]);
  const [a] = await sql.unsafe<{ id: string }[]>(
    `insert into auftrag (mandant_id, auftragsnummer, kunde_id, art, bezeichnung,
                          verantwortlich_benutzer_id, start_datum)
     values ($1,$2,$3,'einzelauftrag','Neubau Wedding',$4, current_date) returning id`,
    [mandant, `A-${zufall()}`, k!.id, benutzerId] as never[]);
  const [p] = await sql.unsafe<{ id: string }[]>(
    `insert into projekt (mandant_id, auftrag_id, kunde_id, nummer, bezeichnung,
                          art, vertragsgrundlage, status)
     values ($1,$2,$3,$4,'Neubau Wedding','hochbau','vob_b','in_arbeit') returning id`,
    [mandant, a!.id, k!.id, `P-${zufall()}`] as never[]);
  const [g] = await sql.unsafe<{ id: string }[]>(
    `insert into gewerk (mandant_id, code, bezeichnung, sortierung, erstellt_von_art)
     values ($1,$2,'Rohbau',10,'system') returning id`,
    [mandant, `ROH-${zufall()}`] as never[]);
  return { projekt: p!.id, objekt: o!.id, gewerk: g!.id };
}

/**
 * Eine Schicht MORGEN — nicht heute und nicht gestern.
 *
 * `app.ist_eingesetzt_auf_objekt` verlangt `ende_zeitpunkt >= now()`; eine
 * Schicht von gestern waere fuer die halbe Suite unsichtbar, und der
 * Fehlschlag saehe aus wie ein Policy-Defekt.
 */
async function schicht(opts: {
  mandant: string; anstellung: string; person: string;
  objekt?: string | null; projekt?: string | null;
}): Promise<{ einsatz: string; zuordnung: string }> {
  const [e] = await sql.unsafe<{ id: string }[]>(
    `insert into einsatz (mandant_id, objekt_id, projekt_id, quelle, plan_datum,
                          beginn_zeitpunkt, ende_zeitpunkt,
                          beginn_lokal, ende_lokal, endet_am_folgetag, erstellt_von_art)
     values ($1,$2::uuid,$3::uuid,'manuell',(now() + interval '1 day')::date,
             now() + interval '1 day', now() + interval '1 day 8 hours',
             '06:00','14:00', false, 'system')
     returning id`,
    [opts.mandant, opts.objekt ?? null, opts.projekt ?? null] as never[]);
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into einsatz_zuordnung (mandant_id, einsatz_id, anstellung_id, person_id,
                                    beginn_zeitpunkt, ende_zeitpunkt, erstellt_von_art)
     select $1, e.id, $3, $4, e.beginn_zeitpunkt, e.ende_zeitpunkt, 'system'
       from einsatz e where e.id = $2
     returning id`,
    [opts.mandant, e!.id, opts.anstellung, opts.person] as never[]);
  return { einsatz: e!.id, zuordnung: z!.id };
}

/** Die Sitzung der Arbeiterin — genau die, die aus dem Cookie kaeme. */
function sitzungVon(benutzerId: string, personId: string, mandantId: string | null): Sitzung {
  return {
    benutzerId, personId, aktiverMandantId: mandantId,
    ansicht: mandantId === null ? 'person' : 'mandant',
    aal: 'aal1', portal: 'mitarbeiter', sitzungId: SITZUNG,
  };
}

/** Die PER->M1-Bruecke der Routen, in EINER Transaktion — wie `aufDerSchicht`. */
async function aufDerSchicht<T>(
  benutzerId: string, personId: string, zuordnungId: string,
  fn: (k: SchreibKontext, bezug: Awaited<ReturnType<typeof findeSchichtBezug>>) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx: postgres.TransactionSql) => {
    const sitzung = sitzungVon(benutzerId, personId, null);
    const bezug = await withPersonScope(tx, sitzung, async (k) =>
      findeSchichtBezug(k, zuordnungId));
    if (bezug === null) throw new Error('nicht_gefunden');
    return withTenant(tx, sitzungVon(benutzerId, personId, bezug.mandantId), async (k) =>
      fn(k, bezug));
  }) as Promise<T>;
}

/** Nur der Personen-Scope — was die SEITE sieht. */
async function imPersonenScope<T>(
  benutzerId: string, personId: string, fn: (k: LeseKontext) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx: postgres.TransactionSql) =>
    withPersonScope(tx, sitzungVon(benutzerId, personId, null), fn)) as Promise<T>;
}

beforeEach(async () => {
  f = await seed();
  fatimaKonto = await konto(f.fatima);
  await mitglied(fatimaKonto, f.reinigung, 'mitarbeiter');
  await mitglied(fatimaKonto, f.security, 'mitarbeiter');
  jonasKonto = await konto(f.jonas);
  await mitglied(jonasKonto, f.reinigung, 'mitarbeiter');
});

afterAll(async () => { await schliessen(); });

describe('0300 — die eigene Schicht im M1-Scope', () => {
  it('die Kraft sieht ihre Schicht, ihr Objekt und ihre Einteilung — und nur die', async () => {
    const o = await objekt(f.reinigung);
    const meine = await schicht({
      mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima, objekt: o,
    });
    const fremd = await schicht({
      mandant: f.reinigung, anstellung: f.jonasReinigung, person: f.jonas,
      objekt: await objekt(f.reinigung, 'Fremdhaus'),
    });

    const gesehen = await aufDerSchicht(fatimaKonto, f.fatima, meine.zuordnung,
      async (k) => ({
        einsaetze: (await k.abfrage<{ id: string }>(`select id from einsatz`)).map((z) => z.id),
        zuordnungen: (await k.abfrage<{ id: string }>(
          `select id from einsatz_zuordnung`)).map((z) => z.id),
        objekte: (await k.abfrage<{ id: string }>(`select id from objekt`)).length,
        /* Das Recht, das die Rolle NICHT haelt — die Policy ersetzt es nicht. */
        dienstplanLesen: (await k.abfrage<{ d: boolean }>(
          `select app.hat_recht('dienstplan.lesen', app.aktiver_mandant()) as d`))[0]?.d,
      }));

    expect(gesehen.einsaetze).toEqual([meine.einsatz]);
    expect(gesehen.einsaetze).not.toContain(fremd.einsatz);
    expect(gesehen.zuordnungen).toEqual([meine.zuordnung]);
    expect(gesehen.objekte).toBe(1);
    expect(gesehen.dienstplanLesen).toBe(false);
  });

  it('eine ENTFERNTE Einteilung traegt nichts mehr', async () => {
    const o = await objekt(f.reinigung);
    const s = await schicht({
      mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima, objekt: o,
    });
    await sql.unsafe(`update einsatz_zuordnung set entfernt_am = now() where id = $1`,
      [s.zuordnung] as never[]);

    await expect(aufDerSchicht(fatimaKonto, f.fatima, s.zuordnung, async () => 'nie'))
      .rejects.toThrow('nicht_gefunden');
  });

  it('die Kraft kann den Dienstplan NICHT schreiben', async () => {
    const o = await objekt(f.reinigung);
    const s = await schicht({
      mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima, objekt: o,
    });
    /*
     * **Ein UPDATE, das die RLS nicht durchlaesst, WIRFT nicht.** Es trifft
     * null Zeilen — `USING` filtert, `WITH CHECK` wirft. Die erste Fassung
     * erwartete hier eine Ausnahme und behauptete damit etwas ueber
     * PostgreSQL, das nicht stimmt. Geprueft wird deshalb die WIRKUNG: der
     * Wert steht danach unveraendert da.
     *
     * `einsatz.t_selbst_m1` (0300) ist `for select`; eine UPDATE-Policy hat
     * die Kraft auf `einsatz` nicht, also greift keine.
     */
    await aufDerSchicht(fatimaKonto, f.fatima, s.zuordnung, async (k) =>
      k.schreibe(`update einsatz set pause_geplant_minuten = 99 where id = $1::uuid`,
        [s.einsatz]));
    const [nachher] = await sql.unsafe<{ pause_geplant_minuten: number }[]>(
      `select pause_geplant_minuten from einsatz where id = $1`, [s.einsatz]);
    expect(nachher!.pause_geplant_minuten).not.toBe(99);
  });
});

describe('0301 — den eigenen Antrag zurueckziehen', () => {
  async function urlaubsantrag(): Promise<string> {
    /*
     * Die Kataloge sind GLOBAL: `antragsart` und `abwesenheitsart` tragen
     * `mandant_id is null`, solange eine Gesellschaft nichts Eigenes
     * hinterlegt hat. Die erste Fassung suchte nur nach `mandant_id = $1`,
     * fand nichts und starb an `undefined.id` — ein Fehlschlag, der wie ein
     * Policy-Defekt aussieht und keiner war.
     */
    const [art] = await sql.unsafe<{ id: string }[]>(
      `select id from antragsart
        where (mandant_id = $1 or mandant_id is null) and schluessel = 'urlaub'
        order by mandant_id nulls last limit 1`,
      [f.reinigung]);
    const [abw] = await sql.unsafe<{ id: string }[]>(
      `select id from abwesenheitsart
        where (mandant_id = $1 or mandant_id is null) and schluessel = 'urlaub'
        order by mandant_id nulls last limit 1`,
      [f.reinigung]);
    return sql.begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzungVon(fatimaKonto, f.fatima, f.reinigung), async (k) =>
        (await reicheAntragEin(k, {
          anstellungId: f.fatimaReinigung,
          antragsartId: art!.id,
          abwesenheitsartId: abw!.id,
          vonDatum: '2026-12-01',
          bisDatum: '2026-12-05',
        })).id)) as Promise<string>;
  }

  it('die Ruecknahme gelingt, solange niemand entschieden hat', async () => {
    const id = await urlaubsantrag();
    await sql.begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzungVon(fatimaKonto, f.fatima, f.reinigung), async (k) =>
        zieheAntragZurueck(k, id)));

    const status = await imPersonenScope(fatimaKonto, f.fatima, async (k) =>
      (await findeAntrag(k, id))?.status);
    expect(status).toBe('zurueckgezogen');
  });

  it('eine SELBSTgenehmigung weist die Policy ab — nicht der Ausloeser allein', async () => {
    const id = await urlaubsantrag();
    await expect(sql.begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzungVon(fatimaKonto, f.fatima, f.reinigung), async (k) =>
        k.schreibe(`update antrag set status = 'genehmigt' where id = $1::uuid`, [id]))))
      .rejects.toThrow(/row-level security/u);
  });

  it('ein FREMDER Antrag ist nicht zurueckziehbar', async () => {
    const id = await urlaubsantrag();
    await expect(sql.begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzungVon(jonasKonto, f.jonas, f.reinigung), async (k) =>
        zieheAntragZurueck(k, id)))).rejects.toThrow();
  });

  it('nach einer Entscheidung ist es keine Ruecknahme mehr', async () => {
    const id = await urlaubsantrag();
    /*
     * `an_entscheidung_paarweise` verlangt `entschieden_am` und
     * `entschieden_von` GEMEINSAM — eine Entscheidung ohne Entscheider ist
     * keine. Die erste Fassung setzte nur den Status und starb an der
     * Bedingung, nicht an der Policy.
     */
    await sql.unsafe(
      `update antrag
          set status = 'abgelehnt', entscheidung_kommentar = 'kein Grund',
              entschieden_am = now(), entschieden_von = $2
        where id = $1`, [id, jonasKonto] as never[]);
    await expect(sql.begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzungVon(fatimaKonto, f.fatima, f.reinigung), async (k) =>
        zieheAntragZurueck(k, id)))).rejects.toThrow();
  });
});

describe('0302 — die Uebergabe im Wachbuch', () => {
  /**
   * Das Fenster SETZT diese Datei selbst.
   *
   * Der Seed der Auslieferung legt `wachbuch.uebergabe_fenster` mit
   * `{"interval":"PT0S"}` an (0033); die Isolationsfixtur legt nur Mandanten
   * an und keine Einstellungen. Die erste Fassung schrieb ein `update` und
   * traf null Zeilen — die Probe behauptete danach, das Fenster sei zu, und
   * bewies damit nur, dass es die Zeile nicht gab.
   */
  async function setzeFenster(dauer: string): Promise<void> {
    /*
     * `jsonb_build_object` und NICHT `$2::jsonb`: der Treiber schickt eine
     * Zeichenkette als JSON-STRING, und `'"{\"interval\":\"PT12H\"}"'` ist
     * ein jsonb-String und kein Objekt. `->> 'interval'` gibt darauf NULL, das
     * Fenster faellt auf `interval '0'` — die Probe stand dann gruen auf „zu"
     * und bewies nichts. Gemessen: `app.einstellung(...)` lieferte
     * `"{\"interval\": \"PT12H\"}"` (mit Anfuehrungszeichen) statt
     * `{"interval": "PT12H"}`.
     */
    await sql.unsafe(
      `insert into mandant_einstellung (mandant_id, schluessel, wert)
       values ($1, 'wachbuch.uebergabe_fenster', jsonb_build_object('interval', $2::text))
       on conflict (mandant_id, schluessel) do update set wert = excluded.wert`,
      [f.reinigung, dauer] as never[]);
  }

  async function fremderEintrag(objektId: string, einsatzId: string): Promise<void> {
    /* Ein Eintrag der KOLLEGIN am selben Objekt — sie schreibt ihn selbst. */
    await sql.begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzungVon(jonasKonto, f.jonas, f.reinigung), async (k) =>
        schreibeEintrag(k, {
          objektId, einsatzId, art: 'rundgang',
          betreff: 'Rundgang 22:00', eintragstext: 'Alles unauffaellig.',
        })));
  }

  it('ohne eingestelltes Fenster sieht die Kraft nur ihre eigenen Seiten', async () => {
    const o = await objekt(f.reinigung);
    await schicht({
      mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima, objekt: o,
    });
    const seine = await schicht({
      mandant: f.reinigung, anstellung: f.jonasReinigung, person: f.jonas, objekt: o,
    });
    await fremderEintrag(o, seine.einsatz);
    /* Eingestellt und AUS — der Vorgabewert des Seeds (0033). */
    await setzeFenster('PT0S');

    const buch = await imPersonenScope(fatimaKonto, f.fatima, async (k) =>
      leseSchichtbuch(k, { objektId: o, mandantId: f.reinigung }));

    expect(buch.uebergabeOffen).toBe(false);
    expect(buch.eintraege).toHaveLength(0);
    /* Und das ist der Punkt: die Seite sagt WARUM, statt „keine Eintraege". */
    expect(buch.uebergabeFenster).not.toBeNull();
  });

  it('mit Fenster sieht sie die Uebergabe der Kollegin — an IHREM Objekt', async () => {
    const o = await objekt(f.reinigung);
    const fremdesObjekt = await objekt(f.reinigung, 'Fremdhaus');
    const meine = await schicht({
      mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima, objekt: o,
    });
    const seine = await schicht({
      mandant: f.reinigung, anstellung: f.jonasReinigung, person: f.jonas, objekt: o,
    });
    const seineWoanders = await schicht({
      mandant: f.reinigung, anstellung: f.jonasReinigung, person: f.jonas,
      objekt: fremdesObjekt,
    });
    await fremderEintrag(o, seine.einsatz);
    await fremderEintrag(fremdesObjekt, seineWoanders.einsatz);
    await setzeFenster('PT12H');

    const meins = await imPersonenScope(fatimaKonto, f.fatima, async (k) =>
      leseSchichtbuch(k, { objektId: o, mandantId: f.reinigung }));
    const fremd = await imPersonenScope(fatimaKonto, f.fatima, async (k) =>
      leseSchichtbuch(k, { objektId: fremdesObjekt, mandantId: f.reinigung }));

    expect(meins.uebergabeOffen).toBe(true);
    expect(meins.eintraege).toHaveLength(1);
    /*
     * **Und der Name der Kollegin bleibt weg.** `leseBuch` verband `person`
     * bis 0304 als INNER JOIN; im Mitarbeiterportal ist deren `person`-Zeile
     * unsichtbar (`p_ma_ceiling` auf `anstellung`), und damit fiel die GANZE
     * Zeile aus dem Ergebnis: die Seite zeigte „keine Eintraege", obwohl das
     * Fenster offen war — genau die Falschaussage, gegen die 0302 geschrieben
     * wurde. Der LEFT JOIN bringt die Zeile und laesst den Namen weg
     * (EMP-13); `urheber` ist deshalb `null` und nicht ein Name.
     */
    expect(meins.eintraege[0]!.urheber).toBeNull();
    expect(meins.eintraege[0]!.betreff).not.toBe('');
    /* Auf dem Objekt, auf dem sie NICHT eingesetzt ist, bleibt es leer. */
    expect(fremd.eintraege).toHaveLength(0);
    expect(meine.zuordnung).not.toBe(seine.zuordnung);
  });

  it('der Praesenznachweis braucht den EIGENEN Kontrollpunkt (SEC-05)', async () => {
    /**
     * Der Kontrollpunkt kommt aus dem Formular, also wird er serverseitig
     * gegen das Objekt der Schicht gehalten (K-02) — `schreibeEintrag` tut das
     * fuer Posten, Veranstaltung und Einsatz schon, und seit 0304 auch hier.
     *
     * Damit die Pruefung im M1-Scope ueberhaupt etwas SIEHT, traegt 0300
     * `kontrollpunkt.t_selbst_m1`: `t_mandant` verlangt `security.lesen`, ein
     * Recht der Leitung, und ohne die Zeile wiese die Vorpruefung den EIGENEN
     * Kontrollpunkt als fremd ab (AUT-05).
     */
    const o = await objekt(f.reinigung);
    const fremdesObjekt = await objekt(f.reinigung, 'Fremdhaus');
    const s = await schicht({
      mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima, objekt: o,
    });
    const kp = async (objektId: string): Promise<string> => {
      const [z] = await sql.unsafe<{ id: string }[]>(
        `insert into kontrollpunkt (mandant_id, objekt_id, bezeichnung, kurzzeichen,
                                    nachweisart, reihenfolge, erstellt_von_art)
         values ($1,$2,'Haupteingang',$3,'manuell',10,'system') returning id`,
        [f.reinigung, objektId, `KP-${zufall()}`] as never[]);
      return z!.id;
    };
    const meiner = await kp(o);
    const fremder = await kp(fremdesObjekt);

    /* Die Seite bietet genau die Kontrollpunkte DIESES Objekts an. */
    const buch = await imPersonenScope(fatimaKonto, f.fatima, async (k) =>
      leseSchichtbuch(k, { objektId: o, mandantId: f.reinigung }));
    expect(buch.kontrollpunkte.map((x) => x.id)).toEqual([meiner]);

    const id = await aufDerSchicht(fatimaKonto, f.fatima, s.zuordnung,
      async (k, bezug) => schreibeEintrag(k, {
        objektId: bezug!.objektId!, einsatzId: bezug!.einsatzId,
        art: 'rundgang', betreff: 'Kontrollgang', eintragstext: 'Tuer verschlossen.',
        kontrollpunktId: meiner, praesenzBestaetigt: true,
      }));
    expect(id).toMatch(/^[0-9a-f-]{36}$/u);

    /* Ein Kontrollpunkt aus Haus B gehoert nicht in die Kette von Haus A. */
    await expect(aufDerSchicht(fatimaKonto, f.fatima, s.zuordnung,
      async (k, bezug) => schreibeEintrag(k, {
        objektId: bezug!.objektId!, einsatzId: bezug!.einsatzId,
        art: 'rundgang', betreff: 'Kontrollgang', eintragstext: 'Tuer verschlossen.',
        kontrollpunktId: fremder, praesenzBestaetigt: true,
      }))).rejects.toThrow();

    /* Und „Praesenz" ohne Kontrollpunkt weist der Dienst ab. */
    await expect(aufDerSchicht(fatimaKonto, f.fatima, s.zuordnung,
      async (k, bezug) => schreibeEintrag(k, {
        objektId: bezug!.objektId!, einsatzId: bezug!.einsatzId,
        art: 'rundgang', betreff: 'Kontrollgang', eintragstext: 'Tuer verschlossen.',
        praesenzBestaetigt: true,
      }))).rejects.toThrow();
  });

  it('die Kraft schreibt ihre Seite — mit dem Einsatz als Bezug', async () => {
    const o = await objekt(f.reinigung);
    const s = await schicht({
      mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima, objekt: o,
    });
    const id = await aufDerSchicht(fatimaKonto, f.fatima, s.zuordnung,
      async (k, bezug) => schreibeEintrag(k, {
        objektId: bezug!.objektId!, einsatzId: bezug!.einsatzId, art: 'vorkommnis',
        betreff: 'Tuer offen', eintragstext: 'Seitentuer stand offen, verschlossen.',
      }));

    const eigene = await imPersonenScope(fatimaKonto, f.fatima, async (k) =>
      leseSchichtbuch(k, { objektId: o, mandantId: f.reinigung }));
    expect(eigene.eintraege.map((e) => e.id)).toContain(id);
  });
});

describe('0303 — Aufnahme und Bautagebuch auf der eigenen Schicht', () => {
  const ABLAGE = {
    art: 'foto' as const,
    bucket: 'einsatz-medien' as const,
    mimeTyp: 'image/jpeg',
    groesseBytes: 1234,
    sha256: 'a'.repeat(64),
    exifEntfernt: true as const,
    aufgenommenAmGeraet: null,
    beschreibung: 'Treppenhaus',
  };

  it('die Aufnahme haengt an der eigenen Schicht — und ist danach lesbar', async () => {
    const o = await objekt(f.reinigung);
    const s = await schicht({
      mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima, objekt: o,
    });
    const medienId = await aufDerSchicht(fatimaKonto, f.fatima, s.zuordnung,
      async (k, bezug) => legeSchichtMediumAb(k, {
        einsatzId: bezug!.einsatzId,
        ablage: { ...ABLAGE, pfad: `${f.reinigung}/${crypto.randomUUID()}` },
      }));

    const meine = await imPersonenScope(fatimaKonto, f.fatima, async (k) =>
      listeSchichtMedien(k, s.einsatz));
    expect(meine.map((m) => m.id)).toContain(medienId);

    /* Die Kollegin sieht die Aufnahme NICHT — sie gehoert der Dokumentation
     * der Person, die sie gemacht hat (p_ma_decke). */
    const seine = await imPersonenScope(jonasKonto, f.jonas, async (k) =>
      listeSchichtMedien(k, s.einsatz));
    expect(seine).toHaveLength(0);
  });

  it('an einer FREMDEN Schicht entsteht keine Aufnahme', async () => {
    const o = await objekt(f.reinigung);
    const meine = await schicht({
      mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima, objekt: o,
    });
    const fremd = await schicht({
      mandant: f.reinigung, anstellung: f.jonasReinigung, person: f.jonas, objekt: o,
    });
    await expect(aufDerSchicht(fatimaKonto, f.fatima, meine.zuordnung,
      async (k) => legeSchichtMediumAb(k, {
        einsatzId: fremd.einsatz,
        ablage: { ...ABLAGE, pfad: `${f.reinigung}/${crypto.randomUUID()}` },
      }))).rejects.toThrow();
  });

  it('die Kolonne traegt eine Position im Bautagebuch ein — und storniert nur die eigene', async () => {
    await mitglied(fatimaKonto, f.bau, 'mitarbeiter');
    const b = await baustelle(f.bau, fatimaKonto);
    const [anstellung] = await sql.unsafe<{ id: string }[]>(
      `insert into anstellung (mandant_id, person_id, personalnummer, eintritt, status)
       values ($1,$2,$3, current_date - 30, 'aktiv') returning id`,
      [f.bau, f.fatima, `B-${zufall()}`] as never[]);
    const s = await schicht({
      mandant: f.bau, anstellung: anstellung!.id, person: f.fatima,
      objekt: b.objekt, projekt: b.projekt,
    });
    const p = b.projekt;

    const zeileId = await aufDerSchicht(fatimaKonto, f.fatima, s.zuordnung,
      async (k, bezug) => {
        const tag = await findeOderLegeBautagAn(k, bezug!.projektId!, bezug!.vonDatum);
        return heftePositionAn(k, {
          bautagebuchId: tag, art: 'lieferung', bezeichnung: 'Bewehrung',
          menge: '3.000', einheit: 't', lieferscheinNummer: '4711',
        });
      });

    const zeilen = await imPersonenScope(fatimaKonto, f.fatima, async (k) => {
      const [tag] = await k.abfrage<{ id: string }>(
        `select id from bautagebuch where projekt_id = $1::uuid`, [p]);
      return lesePositionen(k, tag!.id);
    });
    expect(zeilen.map((z) => z.id)).toContain(zeileId);

    /*
     * Kein Abschluss: den Tag schliesst die Bauleitung mit `bau.schreiben`.
     * Auch hier WIRFT die RLS nicht — sie trifft nichts. Gemessen wird die
     * Wirkung, nicht eine Ausnahme, die PostgreSQL gar nicht wirft.
     */
    await aufDerSchicht(fatimaKonto, f.fatima, s.zuordnung, async (k) =>
      k.schreibe(`update bautagebuch set abgeschlossen_am = now() where projekt_id = $1::uuid`,
        [p]));
    const [tagNachher] = await sql.unsafe<{ abgeschlossen_am: Date | null }[]>(
      `select abgeschlossen_am from bautagebuch where projekt_id = $1`, [p]);
    expect(tagNachher!.abgeschlossen_am).toBeNull();
  });
});

describe('0304 — der Leistungsnachweis auf der Schicht', () => {
  it('Entwurf, Vorlage und Unterschrift des Kunden laufen durch', async () => {
    const o = await objekt(f.reinigung);
    const s = await schicht({
      mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima, objekt: o,
    });

    const ergebnis = await aufDerSchicht(fatimaKonto, f.fatima, s.zuordnung,
      async (k, bezug) => {
        const [obj] = await k.abfrage<{ kunde_id: string }>(
          `select kunde_id from objekt where id = $1::uuid`, [bezug!.objektId]);
        const id = await erstelleEntwurf(k, {
          objektId: bezug!.objektId!,
          kundeId: obj!.kunde_id,
          von: bezug!.vonDatum,
          bis: bezug!.bisDatum,
          positionen: [{
            bezeichnung: 'Unterhaltsreinigung', menge: '1.000', einheit: 'Durchgang',
            quelle: 'manuell', einzelpreisCent: null,
          }],
        });
        const positionen = await ladePositionen(k, id);
        await legeVor(k, id);
        const vorschau = await bereiteUnterschriftVor(k, id);
        const sig = await signiere(k, {
          nachweisId: id, rolle: 'auftraggeber', unterzeichnerName: 'Frau Meier',
          bestaetigtePruefsumme: vorschau.pruefsumme,
        });
        return { id, positionen: positionen.length, kunde: vorschau.kopf.kunde, sig };
      });

    /* Ohne 0304 waere `positionen` 0 und die Pruefsumme eine ueber nichts. */
    expect(ergebnis.positionen).toBe(1);
    expect(ergebnis.kunde).toBe('Testkunde');
    expect(ergebnis.sig.snapshotHash).toMatch(/^[0-9a-f]{64}$/u);

    /* Die Kraft sieht die Unterschrift, die SIE aufgenommen hat. */
    const gesehen = await imPersonenScope(fatimaKonto, f.fatima, async (k) =>
      ladeSignaturen(k, ergebnis.id));
    expect(gesehen.map((x) => x.rolle)).toEqual(['auftraggeber']);

    /* Die Kollegin sieht sie NICHT — sie hat sie nicht aufgenommen (0066 §5.8). */
    const fremd = await imPersonenScope(jonasKonto, f.jonas, async (k) =>
      ladeSignaturen(k, ergebnis.id));
    expect(fremd).toHaveLength(0);
  });

  it('das Unterschriftsblatt traegt auch im PERSONEN-Scope — mit Kundennamen', async () => {
    /**
     * **Der Fall, den die Probe oben nicht sah.** `bereiteUnterschriftVor` lief
     * dort nur in `aufDerSchicht`, also im M1-Scope, wo
     * `app.aktiver_mandant()` gesetzt ist. Die SEITE laeuft aber im
     * Personen-Scope, und dort ist er NULL (K-20): die einzige permissive
     * SELECT-Policy von `cse_definer` auf `kunde` (`d_kunde_pflichtfeld`,
     * 0033) haengt daran, also gab `app.leistungsnachweis_kopf_schicht` null
     * Zeilen zurueck — `NachweisNichtGefunden` auf ein Blatt, das die Kraft
     * gerade selbst vorgelegt hat (AUT-05). Auf dem Bildschirm stand dann
     * wieder das Anlegeformular, und jeder Klick erzeugte einen WEITEREN
     * vorgelegten Nachweis.
     *
     * 0304 traegt dafuer `d_kunde_nachweis_kopf` — eng auf denselben drei
     * Bedingungen wie die Funktion selbst.
     */
    const o = await objekt(f.reinigung);
    const s = await schicht({
      mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima, objekt: o,
    });
    const id = await aufDerSchicht(fatimaKonto, f.fatima, s.zuordnung,
      async (k, bezug) => {
        const [obj] = await k.abfrage<{ kunde_id: string }>(
          `select kunde_id from objekt where id = $1::uuid`, [bezug!.objektId]);
        const neu = await erstelleEntwurf(k, {
          objektId: bezug!.objektId!, kundeId: obj!.kunde_id,
          von: bezug!.vonDatum, bis: bezug!.bisDatum,
          positionen: [{
            bezeichnung: 'Unterhaltsreinigung', menge: '1.000', einheit: 'Durchgang',
            quelle: 'manuell', einzelpreisCent: null,
          }],
        });
        await legeVor(k, neu);
        return neu;
      });

    const vorschau = await imPersonenScope(fatimaKonto, f.fatima, async (k) =>
      bereiteUnterschriftVor(k, id));
    expect(vorschau.kopf.kunde).toBe('Testkunde');
    expect(vorschau.positionen).toHaveLength(1);
    expect(vorschau.pruefsumme).toMatch(/^[0-9a-f]{64}$/u);

    /*
     * Die Gegenprobe: die Kollegin ist auf diesem Objekt nicht eingesetzt.
     * Fuer sie bleibt es null Zeilen — also 404 und nicht 403 (AUT-06).
     */
    await expect(imPersonenScope(jonasKonto, f.jonas, async (k) =>
      bereiteUnterschriftVor(k, id))).rejects.toThrow(/nicht/iu);
  });

  it('der Nachweis der Schicht bekommt eine NUMMER — wie der aus dem Buero', async () => {
    /*
     * Der Kreis gehoert zur Fixtur: die Isolationsfixtur legt Mandanten an und
     * keine Nummernkreise. `ist_platzhalter = false` ist die Bedingung, unter
     * der `vergebeNummer` ueberhaupt zieht; `zuruecksetzung` ist dann Pflicht
     * (`nk_bestaetigt_hat_ruecksetzung`).
     */
    await sql.unsafe(
      `insert into nummernkreis (mandant_id, kreis_typ, jahr, bezeichnung, lueckenlos,
                                 format_maske, zuruecksetzung, ist_platzhalter,
                                 geoeffnet_am, erstellt_von_art, erstellt_von_dienst)
       values ($1,'leistungsnachweis',0,'Leistungsnachweise',false,
               'LN-{nr:5}','nie',false, now(),'system','fixtur')`,
      [f.reinigung] as never[]);

    /**
     * `nummernkreis.p_nk_intern_ceiling` war USING `app.portal() = 'intern'`;
     * im Mitarbeiterportal war die Tabelle damit unsichtbar, `vergebeNummer`
     * meldete `kein_kreis`, und `legeVor` gab das still als `nummerOffen`
     * zurueck. Derselbe Vorgang aus dem Buero bekam eine Nummer — und die
     * Nummer steht im Abzug, ueber den die Pruefsumme laeuft.
     */
    const o = await objekt(f.reinigung);
    const s = await schicht({
      mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima, objekt: o,
    });
    const ergebnis = await aufDerSchicht(fatimaKonto, f.fatima, s.zuordnung,
      async (k, bezug) => {
        const [obj] = await k.abfrage<{ kunde_id: string }>(
          `select kunde_id from objekt where id = $1::uuid`, [bezug!.objektId]);
        const neu = await erstelleEntwurf(k, {
          objektId: bezug!.objektId!, kundeId: obj!.kunde_id,
          von: bezug!.vonDatum, bis: bezug!.bisDatum,
          positionen: [{
            bezeichnung: 'Unterhaltsreinigung', menge: '1.000', einheit: 'Durchgang',
            quelle: 'manuell', einzelpreisCent: null,
          }],
        });
        return legeVor(k, neu);
      });
    expect(ergebnis.nummerOffen).toBeNull();
    expect(ergebnis.nummer).not.toBeNull();
  });

  it('eine veraltete Anzeige wird NICHT unterschrieben', async () => {
    const o = await objekt(f.reinigung);
    const s = await schicht({
      mandant: f.reinigung, anstellung: f.fatimaReinigung, person: f.fatima, objekt: o,
    });
    await expect(aufDerSchicht(fatimaKonto, f.fatima, s.zuordnung,
      async (k, bezug) => {
        const [obj] = await k.abfrage<{ kunde_id: string }>(
          `select kunde_id from objekt where id = $1::uuid`, [bezug!.objektId]);
        const id = await erstelleEntwurf(k, {
          objektId: bezug!.objektId!, kundeId: obj!.kunde_id,
          von: bezug!.vonDatum, bis: bezug!.bisDatum,
          positionen: [{
            bezeichnung: 'Unterhaltsreinigung', menge: '1.000', einheit: 'Durchgang',
            quelle: 'manuell',
          }],
        });
        await legeVor(k, id);
        return signiere(k, {
          nachweisId: id, rolle: 'auftraggeber', unterzeichnerName: 'Frau Meier',
          bestaetigtePruefsumme: 'b'.repeat(64),
        });
      })).rejects.toThrow(/nicht mehr die aktuellen/u);
  });
});
