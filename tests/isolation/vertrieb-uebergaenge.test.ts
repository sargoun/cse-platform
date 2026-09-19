/**
 * Die Uebergaenge der Vertriebsroute gegen eine ECHTE Datenbank — Auftrag,
 * Dokument, Katalog (0296, 0297, 0298, 0299).
 *
 * **Warum das vier Migrationen und ein Test sind.** Bei allen vier lautet der
 * Befund gleich: die RLS setzt das GENERISCHE Schreibrecht durch, nicht das
 * Uebergangsrecht. `t_mandant` auf `auftrag` prueft `auftrag.schreiben`, nicht
 * `auftrag.abschliessen` und nicht `referenz.kundenfreigabe_erfassen`;
 * `t_mandant` auf `dokument` prueft `dokument.schreiben`, das auch die Rolle
 * `mitarbeiter` haelt, nicht `dokument.kunde_freigeben`. Wo die Rollenmengen
 * sich heute decken, faellt nichts um — und genau das ist der Grund, es zu
 * pruefen: eine Zusage, die nur gilt, solange zwei Listen zufaellig gleich
 * sind, ist keine.
 *
 * Jeder Test geht den ROHEN Schreibweg, nicht den Dienst. Der Dienst ist die
 * erste Linie; hier steht die zweite, und sie muss ohne ihn halten.
 */
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';

let f: Fixtur;
const zufall = (): string => String(Math.random()).slice(2, 10);

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

/** Ein Konto mit genau dieser Rolle in genau dieser Gesellschaft. */
async function konto(mandant: string, rolle: string): Promise<string> {
  const email = `uebergang-${zufall()}@cse.test`;
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

async function kunde(mandant: string, name = 'Hausverwaltung'): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, rechtsgrundlage,
                        rechtsgrundlage_quelle, rechtsgrundlage_erfasst_am, status)
     values ($1,$2,$3,'bestandskunde','Vertrag', now(), 'aktiv') returning id`,
    [mandant, `K-${zufall()}`, name]);
  return z!.id;
}

/**
 * Ein Auftrag — als EIGENTUEMER angelegt, mit abgeschalteten Ausloesern.
 *
 * `session_replication_role = replica` stellt jeden Ausloeser ab; die Fixtur
 * soll den Zustand HERSTELLEN, nicht die Uebergaenge pruefen. Ohne das liefe
 * schon das Anlegen durch `kern.auftrag_05_freigabe_anlegen`, und ein Test,
 * dessen Aufbau die geprueften Wachen durchlaeuft, prueft seinen eigenen
 * Aufbau.
 */
async function auftrag(mandant: string, kundeId: string, chef: string): Promise<string> {
  return sql.begin(async (tx) => {
    await tx.unsafe(`set local session_replication_role = replica`);
    const [z] = await tx.unsafe<{ id: string }[]>(
      `insert into auftrag (mandant_id, auftragsnummer, kunde_id, art, bezeichnung,
                            verantwortlich_benutzer_id, start_datum, status)
       values ($1,$2,$3,'rahmenvertrag','Unterhaltsreinigung',$4,current_date,'aktiv')
       returning id`,
      [mandant, `AU-${zufall()}`, kundeId, chef]);
    return z!.id;
  }) as Promise<string>;
}

async function dokument(
  mandant: string, opts: { kundeId?: string | null; frei?: boolean } = {},
): Promise<string> {
  return sql.begin(async (tx) => {
    await tx.unsafe(`set local session_replication_role = replica`);
    const [z] = await tx.unsafe<{ id: string }[]>(
      `insert into dokument
         (mandant_id, kategorie, titel, kunde_id, bucket, objekt_schluessel, mime_typ,
          mime_verifiziert, groesse_bytes, exif_entfernt, sichtbar_fuer_kunde,
          entstanden_am)
       values ($1,'kunde','Kundenschreiben',$2,'dokumente',$3,'application/pdf',
               true, 1024, true, $4, current_date)
       returning id`,
      [mandant, opts.kundeId ?? null, `t/${zufall()}.pdf`, opts.frei ?? false]);
    return z!.id;
  }) as Promise<string>;
}

/**
 * Eine interne Sitzung in dieser Gesellschaft — SCHREIBEND.
 *
 * `readonly: false` ist Pflicht: jede `with check`-Bedingung im Haus traegt
 * `not app.ist_readonly()`, und ein Schreibvorgang hinter einer lesenden
 * Bindung faellt in die RLS statt in die geprueft Wache — „new row violates
 * row-level security policy" statt des Satzes, den dieser Test erwartet.
 */
const als = <T>(
  mandant: string, benutzer: string,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> =>
  alsApp({ scope: 'mandant', mandantId: mandant, benutzerId: benutzer,
           portal: 'intern', readonly: false }, fn);

beforeEach(async () => { f = await seed(); });
afterAll(schliessen);

/* ========================================================================== */
describe('(1) Der Auftragsabschluss ist an auftrag.abschliessen gebunden (0296)', () => {
  /**
   * Heute halten `auftrag.schreiben` und `auftrag.abschliessen` dieselben
   * Rollen — der Test faellt also nicht um, wenn die Bindung fehlt. Er faellt
   * um, sobald jemand `auftrag.schreiben` an die Disposition bindet: dann
   * koennte sie Auftraege abschliessen, und damit die FIN-18-Warnung im
   * Rechnungsweg scharf stellen (D-366). Deshalb prueft er das RECHT und
   * nicht die Rolle.
   */
  it('eine Rolle ohne das Recht schliesst nicht ab — auch nicht per UPDATE', async () => {
    const chef = await konto(f.reinigung, 'leitung');
    const k = await kunde(f.reinigung);
    const a = await auftrag(f.reinigung, k, chef);

    // Das Recht wird der Rolle `leitung` in DIESER Gesellschaft entzogen.
    await sql.unsafe(
      `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
       select $1, b.id, $2, false from berechtigung b
        where b.schluessel = 'auftrag.abschliessen'`,
      [await rolleId('leitung'), f.reinigung]);

    await expect(als(f.reinigung, chef, (tx) => tx.unsafe(
      `update auftrag set status = 'abgeschlossen' where id = $1`, [a])))
      .rejects.toThrow(/auftrag\.abschliessen fehlt/u);

    const [z] = await sql.unsafe<{ status: string }[]>(
      `select status::text as status from auftrag where id = $1`, [a]);
    expect(z!.status).toBe('aktiv');
  });

  it('mit dem Recht schliesst er ab — und das Datum kommt aus der SERVERUHR', async () => {
    const chef = await konto(f.reinigung, 'leitung');
    const k = await kunde(f.reinigung);
    const a = await auftrag(f.reinigung, k, chef);
    const vorher = new Date();

    await als(f.reinigung, chef, (tx) => tx.unsafe(`update auftrag set status = 'abgeschlossen' where id = $1`, [a]));

    const [z] = await sql.unsafe<{ status: string; am: Date }[]>(
      `select status::text as status, abgeschlossen_am as am from auftrag where id = $1`,
      [a]);
    expect(z!.status).toBe('abgeschlossen');
    expect(z!.am).not.toBeNull();
    expect(z!.am.getTime()).toBeGreaterThanOrEqual(vorher.getTime() - 2000);
  });

  /**
   * **Wer nur `abgeschlossen_am` schreibt, meint den Abschluss.** Der CHECK
   * `auftrag_abschluss_datiert` verlangt die Gegenrichtung (Status ohne Datum
   * ist verboten), nicht diese. Ohne das Nachziehen entstuende eine Zeile mit
   * Abschlussdatum und Status `aktiv` — und FIN-18 laese sie als
   * abgeschlossen, waehrend die Liste sie als laufend zeigte.
   */
  it('nur das Datum zu setzen zieht den Status MIT', async () => {
    const chef = await konto(f.reinigung, 'leitung');
    const k = await kunde(f.reinigung);
    const a = await auftrag(f.reinigung, k, chef);

    await als(f.reinigung, chef, (tx) => tx.unsafe(`update auftrag set abgeschlossen_am = now() where id = $1`, [a]));

    const [z] = await sql.unsafe<{ status: string }[]>(
      `select status::text as status from auftrag where id = $1`, [a]);
    expect(z!.status).toBe('abgeschlossen');
  });

  /** Einwegig (O-734) — sonst entschaerfte ein Zurueckdrehen FIN-18 ohne Spur. */
  it('das Abschlussdatum ist danach unveraenderlich', async () => {
    const chef = await konto(f.reinigung, 'leitung');
    const k = await kunde(f.reinigung);
    const a = await auftrag(f.reinigung, k, chef);
    await als(f.reinigung, chef, (tx) =>
      tx.unsafe(`update auftrag set status = 'abgeschlossen' where id = $1`, [a]));
    await expect(als(f.reinigung, chef, (tx) => tx.unsafe(
      `update auftrag set abgeschlossen_am = now() - interval '5 days' where id = $1`, [a])))
      .rejects.toThrow(/unveraenderlich/u);
  });

  it('und ein abgeschlossener Auftrag wird nicht wieder geoeffnet', async () => {
    const chef = await konto(f.reinigung, 'leitung');
    const k = await kunde(f.reinigung);
    const a = await auftrag(f.reinigung, k, chef);
    await als(f.reinigung, chef, (tx) =>
      tx.unsafe(`update auftrag set status = 'abgeschlossen' where id = $1`, [a]));
    await expect(als(f.reinigung, chef, (tx) =>
      tx.unsafe(`update auftrag set status = 'aktiv' where id = $1`, [a])))
      .rejects.toThrow(/nicht wieder geoeffnet \(O-734\)/u);
  });
});

/* ========================================================================== */
describe('(2) Die Kundenfreigabe am Auftrag (PRO-05, 0296)', () => {
  it('verlangt referenz.kundenfreigabe_erfassen, nicht auftrag.schreiben', async () => {
    const chef = await konto(f.reinigung, 'leitung');
    const k = await kunde(f.reinigung);
    const a = await auftrag(f.reinigung, k, chef);
    await sql.unsafe(
      `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
       select $1, b.id, $2, false from berechtigung b
        where b.schluessel = 'referenz.kundenfreigabe_erfassen'`,
      [await rolleId('leitung'), f.reinigung]);

    await expect(als(f.reinigung, chef, (tx) => tx.unsafe(
      `update auftrag set freigabe_text = 'Kunde hat zugestimmt' where id = $1`, [a])))
      .rejects.toThrow(/referenz\.kundenfreigabe_erfassen fehlt/u);
  });

  /**
   * Auch der INSERT — `kern.auftrag_freigabe_stempeln` stempelt beim Anlegen
   * ebenfalls, ein `insert … freigegeben_vom_kunden = true` waere also eine
   * Kundenfreigabe an der Route vorbei.
   */
  it('und auch ein Auftrag entsteht nicht bereits freigegeben', async () => {
    const chef = await konto(f.reinigung, 'leitung');
    const k = await kunde(f.reinigung);
    await sql.unsafe(
      `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
       select $1, b.id, $2, false from berechtigung b
        where b.schluessel = 'referenz.kundenfreigabe_erfassen'`,
      [await rolleId('leitung'), f.reinigung]);

    await expect(als(f.reinigung, chef, (tx) => tx.unsafe(
      `insert into auftrag (mandant_id, auftragsnummer, kunde_id, art, bezeichnung,
                            verantwortlich_benutzer_id, start_datum,
                            freigegeben_vom_kunden)
       values (app.aktiver_mandant(), $1, $2, 'rahmenvertrag', 'Mit Freigabe', $3,
               current_date, true)`,
      [`AU-${zufall()}`, k, chef])))
      .rejects.toThrow(/referenz\.kundenfreigabe_erfassen fehlt/u);
  });

  /**
   * Die drei Pflichtangaben — der CHECK, der das hinterlegte Schreiben zur
   * Pflicht macht. Ohne es scheitert das UPDATE, und genau deshalb steht das
   * Dokumentfeld auf der Seite nicht als Beiwerk.
   */
  it('gilt nur vollstaendig: Datum, Ansprechpartner UND Schreiben', async () => {
    const chef = await konto(f.reinigung, 'leitung');
    const k = await kunde(f.reinigung);
    const a = await auftrag(f.reinigung, k, chef);

    await expect(als(f.reinigung, chef, (tx) => tx.unsafe(
      `update auftrag set freigegeben_vom_kunden = true where id = $1`, [a])))
      .rejects.toThrow(/auftrag_referenzfreigabe_vollstaendig/u);
  });
});

/* ========================================================================== */
describe('(3) Die Kundenfreigabe am Dokument (DOC-04, 0297)', () => {
  /**
   * **Hier fallen die Rollenmengen wirklich auseinander.**
   * `dokument.schreiben` haelt auch `mitarbeiter`, `dokument.kunde_freigeben`
   * nicht. Erreichbar ist heute der INSERT: `t_mandant` verlangt LESEND
   * `dokument.lesen`, das `mitarbeiter` fehlt, ein UPDATE trifft also null
   * Zeilen. Der INSERT dagegen fragt nur das Schreibrecht.
   */
  it('mitarbeiter legt KEIN schon freigegebenes Dokument an', async () => {
    const ma = await konto(f.reinigung, 'mitarbeiter');
    const k = await kunde(f.reinigung);

    await expect(als(f.reinigung, ma, (tx) => tx.unsafe(
      `insert into dokument
         (mandant_id, kategorie, titel, kunde_id, bucket, objekt_schluessel, mime_typ,
          mime_verifiziert, groesse_bytes, exif_entfernt, sichtbar_fuer_kunde,
          entstanden_am)
       values (app.aktiver_mandant(),'kunde','Geschmuggelt',$1,'dokumente',$2,
               'application/pdf', true, 1024, true, true, current_date)`,
      [k, `t/${zufall()}.pdf`])))
      .rejects.toThrow(/dokument\.kunde_freigeben fehlt/u);
  });

  it('ohne die Freigabe darf er es anlegen — der Upload bleibt offen', async () => {
    const ma = await konto(f.reinigung, 'mitarbeiter');
    const k = await kunde(f.reinigung);

    await expect(als(f.reinigung, ma, (tx) => tx.unsafe(
      `insert into dokument
         (mandant_id, kategorie, titel, kunde_id, bucket, objekt_schluessel, mime_typ,
          mime_verifiziert, groesse_bytes, exif_entfernt, entstanden_am)
       values (app.aktiver_mandant(),'kunde','Nachweis',$1,'dokumente',$2,
               'application/pdf', true, 1024, true, current_date)`,
      [k, `t/${zufall()}.pdf`]))).resolves.toBeDefined();
  });

  /** Und der Umschalter in BEIDE Richtungen — latent, aber gedeckt. */
  it('ein UPDATE an der Route vorbei wird abgewiesen', async () => {
    const chef = await konto(f.reinigung, 'leitung');
    const k = await kunde(f.reinigung);
    const d = await dokument(f.reinigung, { kundeId: k });
    await sql.unsafe(
      `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
       select $1, b.id, $2, false from berechtigung b
        where b.schluessel = 'dokument.kunde_freigeben'`,
      [await rolleId('leitung'), f.reinigung]);

    await expect(als(f.reinigung, chef, (tx) => tx.unsafe(
      `update dokument set sichtbar_fuer_kunde = true where id = $1`, [d])))
      .rejects.toThrow(/dokument\.kunde_freigeben fehlt/u);
  });

  /**
   * **Die fehlende Haelfte der Kundendecke.** `p_kunde_ceiling` (0009) prueft
   * die Freigabe und kennt kein `kunde_id`; gemessen gegen die lebende
   * Datenbank sah ein Kundenkonto mit Zugang nur auf Kunde A das freigegebene
   * Dokument von Kunde B. `p_kunde_dokument_zuordnung` (0297) schliesst das.
   */
  it('ein Kundenkonto sieht nur die Dokumente SEINES Kunden', async () => {
    const kundeA = await kunde(f.reinigung, 'Kunde A');
    const kundeB = await kunde(f.reinigung, 'Kunde B');
    const konteninhaber = await konto(f.reinigung, 'kunde');
    await sql.unsafe(
      `insert into kunde_zugang (mandant_id, kunde_id, benutzer_id) values ($1,$2,$3)`,
      [f.reinigung, kundeA, konteninhaber]);

    await dokument(f.reinigung, { kundeId: kundeA, frei: true });
    await dokument(f.reinigung, { kundeId: kundeB, frei: true });
    await dokument(f.reinigung, { kundeId: null, frei: true });

    /**
     * Gemessen wird die KENNUNG, nicht der Name aus `kunde`.
     *
     * Ein `left join kunde` sieht von hier aus nichts: die Sitzung ist
     * `scope = 'mandant'` mit `portal = 'kunde'`, also greift `t_kunde`
     * (verlangt `scope = 'kunde'`) nicht und `t_mandant` verlangt `crm.lesen`,
     * das ein Kundenkonto nicht haelt. Der Name kam deshalb als NULL zurueck —
     * richtig so, und als Zusicherung wertlos: sie haette denselben NULL-Wert
     * gemeldet, wenn das falsche Dokument sichtbar gewesen waere. Die
     * `kunde_id` steht in der Dokumentzeile selbst und sagt genau das, worum
     * es hier geht.
     */
    const sichtbar = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: konteninhaber,
        portal: 'kunde', readonly: true },
      async (tx) => {
        const [z] = await tx.unsafe<{ n: string; welche: string | null }[]>(
          `select count(*) n,
                  string_agg(d.kunde_id::text, ',' order by d.kunde_id::text) welche
             from dokument d`);
        return { n: Number(z!.n), welche: z!.welche };
      });

    expect(sichtbar.n).toBe(1);
    expect(sichtbar.welche).toBe(kundeA);
    expect(sichtbar.welche).not.toBe(kundeB);
  });

  it('und ein Dokument OHNE Kundenzuordnung erreicht kein Kundenkonto', async () => {
    const k = await kunde(f.reinigung);
    const konteninhaber = await konto(f.reinigung, 'kunde');
    await sql.unsafe(
      `insert into kunde_zugang (mandant_id, kunde_id, benutzer_id) values ($1,$2,$3)`,
      [f.reinigung, k, konteninhaber]);
    await dokument(f.reinigung, { kundeId: null, frei: true });

    const n = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: konteninhaber,
        portal: 'kunde', readonly: true },
      async (tx) => {
        const [z] = await tx.unsafe<{ n: string }[]>(`select count(*) n from dokument`);
        return Number(z!.n);
      });
    expect(n).toBe(0);
  });

  /** Der INTERNE Blick bleibt unberuehrt — die Decke gilt nur dem Kundenportal. */
  it('intern bleibt alles sichtbar — die Decke greift nur bei portal = kunde', async () => {
    const chef = await konto(f.reinigung, 'leitung');
    const kundeA = await kunde(f.reinigung, 'Kunde A');
    await dokument(f.reinigung, { kundeId: kundeA, frei: true });
    await dokument(f.reinigung, { kundeId: null, frei: false });

    const n = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: chef,
        portal: 'intern', readonly: true },
      async (tx) => {
        const [z] = await tx.unsafe<{ n: string }[]>(`select count(*) n from dokument`);
        return Number(z!.n);
      });
    expect(n).toBe(2);
  });
});

/* ========================================================================== */
describe('(4) Der Lebenslauf einer Katalogfassung (0298)', () => {
  async function fassung(
    mandant: string, schluessel: string, version: number, status: string,
    gueltigAb = 'current_date',
  ): Promise<string> {
    return sql.begin(async (tx) => {
      await tx.unsafe(`set local session_replication_role = replica`);
      const [z] = await tx.unsafe<{ id: string }[]>(
        `insert into leistungskatalog
           (mandant_id, schluessel, bezeichnung, version, status, gueltig_ab)
         values ($1,$2,$3,$4,$5::katalog_status, ${gueltigAb}) returning id`,
        [mandant, schluessel, `${schluessel} v${String(version)}`, version, status]);
      return z!.id;
    }) as Promise<string>;
  }

  it('eine zweite aktive Fassung wird BENANNT abgewiesen, nicht als 23505', async () => {
    const chef = await konto(f.reinigung, 'admin');
    await fassung(f.reinigung, 'unterhalt', 1, 'aktiv');
    const zwei = await fassung(f.reinigung, 'unterhalt', 2, 'entwurf');

    await expect(als(f.reinigung, chef, (tx) => tx.unsafe(
      `update leistungskatalog set status = 'aktiv' where id = $1`, [zwei])))
      .rejects.toThrow(/gilt bereits eine aktive Fassung \(Version 1\)/u);
  });

  it('nach dem Archivieren der ersten geht die zweite — und die erste endet', async () => {
    const chef = await konto(f.reinigung, 'admin');
    const eins = await fassung(f.reinigung, 'unterhalt', 1, 'aktiv');
    const zwei = await fassung(f.reinigung, 'unterhalt', 2, 'entwurf');

    await als(f.reinigung, chef, (tx) => tx.unsafe(
      `update leistungskatalog set status = 'archiviert' where id = $1`, [eins]));
    await als(f.reinigung, chef, (tx) => tx.unsafe(
      `update leistungskatalog set status = 'aktiv' where id = $1`, [zwei]));

    const [a] = await sql.unsafe<{ status: string; bis: string | null }[]>(
      `select status::text as status, gueltig_bis::text as bis
         from leistungskatalog where id = $1`, [eins]);
    expect(a!.status).toBe('archiviert');
    /**
     * `gueltig_bis` setzt der AUSLOESER, nicht der Dienst — sonst waere die
     * Regel nur auf einem Weg wahr. Eine archivierte Fassung mit offener
     * Gueltigkeit stuende in jeder Stichtagsabfrage als geltend, obwohl ihre
     * Positionen eingefroren sind.
     */
    expect(a!.bis).not.toBeNull();
  });

  /**
   * Eine Fassung, die erst spaeter gilt und heute archiviert wird, bekaeme mit
   * `app.berlin_heute()` ein `gueltig_bis` VOR ihrem `gueltig_ab` — und
   * `leistungskatalog_zeitraum_stimmig` wiese sie mit einer Meldung ueber
   * einen Zeitraum ab, von dem niemand gesprochen hat.
   */
  it('eine erst kuenftig geltende Fassung endet an ihrem eigenen Beginn', async () => {
    const chef = await konto(f.reinigung, 'admin');
    const kuenftig = await fassung(
      f.reinigung, 'zukunft', 1, 'entwurf', "current_date + 40");

    await als(f.reinigung, chef, (tx) => tx.unsafe(
      `update leistungskatalog set status = 'archiviert' where id = $1`, [kuenftig]));

    const [z] = await sql.unsafe<{ ab: string; bis: string | null }[]>(
      `select gueltig_ab::text as ab, gueltig_bis::text as bis
         from leistungskatalog where id = $1`, [kuenftig]);
    expect(z!.bis).toBe(z!.ab);
  });

  it('und archiviert ist ENDSTATION — sonst taute das Einfrieren wieder auf', async () => {
    const chef = await konto(f.reinigung, 'admin');
    const eins = await fassung(f.reinigung, 'unterhalt', 1, 'aktiv');
    await als(f.reinigung, chef, (tx) => tx.unsafe(
      `update leistungskatalog set status = 'archiviert' where id = $1`, [eins]));

    for (const ziel of ['entwurf', 'aktiv']) {
      await expect(als(f.reinigung, chef, (tx) => tx.unsafe(
        `update leistungskatalog set status = $2::katalog_status where id = $1`,
        [eins, ziel])), ziel).rejects.toThrow(/nicht wieder geoeffnet/u);
    }
  });
});

/* ========================================================================== */
describe('(5) Die Pruefliste vor dem Abschluss ist eine DEFINER-Zahl (0299)', () => {
  it('sie verlangt auftrag.abschliessen — nicht zeit.lesen', async () => {
    const chef = await konto(f.reinigung, 'leitung');
    const k = await kunde(f.reinigung);
    const a = await auftrag(f.reinigung, k, chef);

    /**
     * `zeit.lesen` wird ENTZOGEN — und die Funktion antwortet trotzdem. Genau
     * das ist ihr Zweck: eine direkte Zaehlung bekaeme hier null Zeilen und
     * meldete „nichts offen", also einen falschen FREISPRUCH (AUT-05, D-366).
     */
    await sql.unsafe(
      `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
       select $1, b.id, $2, false from berechtigung b where b.schluessel = 'zeit.lesen'`,
      [await rolleId('leitung'), f.reinigung]);

    const [z] = await als(f.reinigung, chef, (tx) => tx.unsafe<{
      zeit_ohne_freigabe: string; erfasste_minuten: string;
    }[]>(`select * from fin.auftrag_abschluss_befunde($1::uuid)`, [a]));
    expect(z).toBeDefined();
    expect(Number(z!.erfasste_minuten)).toBe(0);
  });

  it('ohne das Recht antwortet sie NICHT — security definer heisst anderes Recht', async () => {
    const chef = await konto(f.reinigung, 'leitung');
    const k = await kunde(f.reinigung);
    const a = await auftrag(f.reinigung, k, chef);
    await sql.unsafe(
      `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
       select $1, b.id, $2, false from berechtigung b
        where b.schluessel = 'auftrag.abschliessen'`,
      [await rolleId('leitung'), f.reinigung]);

    await expect(als(f.reinigung, chef, (tx) => tx.unsafe(
      `select * from fin.auftrag_abschluss_befunde($1::uuid)`, [a])))
      .rejects.toThrow(/auftrag\.abschliessen fehlt/u);
  });

  /** Invariante 3: ein fremder Auftrag ist ein Zugriffsversuch, kein Nullwert. */
  it('ein Auftrag einer anderen Gesellschaft wird abgewiesen', async () => {
    const chefReinigung = await konto(f.reinigung, 'leitung');
    const chefBau = await konto(f.bau, 'leitung');
    const kBau = await kunde(f.bau);
    const fremder = await auftrag(f.bau, kBau, chefBau);

    await expect(als(f.reinigung, chefReinigung, (tx) => tx.unsafe(
      `select * from fin.auftrag_abschluss_befunde($1::uuid)`, [fremder])))
      .rejects.toThrow(/gehoert nicht zum aktiven Mandanten/u);
  });

  it('und ein Auftrag, den es nicht gibt, ebenso', async () => {
    const chef = await konto(f.reinigung, 'leitung');
    await expect(als(f.reinigung, chef, (tx) => tx.unsafe(
      `select * from fin.auftrag_abschluss_befunde($1::uuid)`,
      ['99999999-9999-9999-9999-999999999999'])))
      .rejects.toThrow(/existiert nicht/u);
  });

  it('alle neun Zahlen kommen zurueck, und keine ist NULL', async () => {
    const chef = await konto(f.reinigung, 'leitung');
    const k = await kunde(f.reinigung);
    const a = await auftrag(f.reinigung, k, chef);

    const [z] = await als(f.reinigung, chef, (tx) =>
      tx.unsafe<Record<string, string>[]>(
        `select * from fin.auftrag_abschluss_befunde($1::uuid)`, [a]));
    const erwartet = [
      'zeit_ohne_freigabe', 'zeit_ohne_abrechnung', 'erfasste_minuten',
      'nachweise_ohne_rechnung', 'rechnungen_entwurf', 'aufmasse_offen',
      'nachtraege_offen', 'leistungen_laufend', 'ohne_abrechnungsart',
    ];
    for (const spalte of erwartet) {
      expect(z![spalte], spalte).not.toBeUndefined();
      expect(z![spalte], spalte).not.toBeNull();
    }
  });
});
