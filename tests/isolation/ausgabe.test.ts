/**
 * `ausgabe`, `ausgabe_kategorie`, `ausgabe_steuer` gegen eine echte Datenbank
 * (0180; 05-FINANZEN.md §1.4, §1.5, §8.3, §8.5; FIN-14, FIN-17, ACC-03,
 * D-09, EMP-13, K-05, K-18, SEC-A3, Invariante 1, Invariante 8).
 *
 * **Keine dieser Aussagen ist mockbar.** „Eine Arbeiterin sieht nur ihre
 * eigenen Erstattungen" ist eine Aussage über vier Policies, „`anstellung_id`
 * ist nicht lesbar" eine über ein Spaltenrecht, „ohne Beleg keine Freigabe"
 * eine über einen CHECK, und „die Steuerzeilen müssen vor dem Buchen zum Kopf
 * passen" eine über einen zurückgestellten Constraint-Trigger. Ein Test ohne
 * Postgres bewiese davon nichts.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, alsRolle, schliessen, seed, sql, type Fixtur } from './harness.js';

let f: Fixtur;
let benutzer: string;
let kategorieId: string;
let belegId: string;

const zufall = (): string => Math.random().toString(36).slice(2, 10);

function buchhaltung() {
  return {
    scope: 'mandant' as const, mandantId: f.reinigung, benutzerId: benutzer,
    portal: 'intern' as const, readonly: false,
  };
}

async function legeBenutzerAn(email: string): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, globale_rolle_id)
     values ($1, $2, 'Buchhaltung', 'aktiv',
             (select id from rolle where schluessel = 'super_admin' and mandant_id is null))`,
    [u!.id, email]);
  return u!.id;
}

/** Ein Beleg mit Dokument und Version — ohne ihn gibt es keine Freigabe. */
async function legeBelegAn(mandantId: string): Promise<string> {
  const schluessel = `mandant/${mandantId}/beleg/${zufall()}.pdf`;
  const [d] = await sql.unsafe<{ id: string }[]>(
    `insert into dokument (mandant_id, kategorie, titel, objekt_schluessel, mime_typ,
                           mime_verifiziert, groesse_bytes, entstanden_am, exif_entfernt)
     values ($1,'buchhaltung','Tankbeleg',$2,'application/pdf',true,2048,'2026-03-04',true)
     returning id`, [mandantId, schluessel]);
  const hash = zufall().padEnd(8, 'a').slice(0, 8).repeat(8).slice(0, 64)
    .replace(/[^0-9a-f]/gu, 'a');
  const [v] = await sql.unsafe<{ id: string }[]>(
    `insert into dokument_version (mandant_id, dokument_id, version, objekt_schluessel,
                                   sha256, groesse_bytes, mime_typ)
     values ($1,$2,1,$3,$4,2048,'application/pdf') returning id`,
    [mandantId, d!.id, schluessel, hash]);
  const [b] = await sql.unsafe<{ id: string }[]>(
    `insert into beleg (mandant_id, belegnummer, typ, quelle, dokument_id,
                        dokument_version_id, datei_sha256, seiten, belegdatum,
                        betrag_brutto_cent, erstellt_von_art, erstellt_von)
     values ($1,$2,'kassenbeleg','scan',$3,$4,$5,1,'2026-03-04',11660,'mensch',$6)
     returning id`,
    [mandantId, `B-${zufall()}`, d!.id, v!.id, hash, benutzer]);
  return b!.id;
}

/**
 * Eine Ausgabe — als `postgres` und damit ohne Policy, weil die Fixtur den
 * Ausgangszustand herstellt und nicht den Schreibweg prüft. Was die Policies
 * zulassen, prüfen die Tests darunter ausdrücklich.
 */
async function legeAusgabeAn(
  mandantId: string,
  { anstellungId = null, status = 'erfasst', beleg = null, weiterberechenbar = false }: {
    anstellungId?: string | null;
    status?: 'erfasst' | 'freigegeben' | 'gebucht' | 'abgelehnt';
    beleg?: string | null;
    weiterberechenbar?: boolean;
  } = {},
): Promise<string> {
  const [a] = await sql.unsafe<{ id: string }[]>(
    `insert into ausgabe (mandant_id, kategorie_id, bezeichnung, ausgabedatum,
                          netto_cent, steuer_cent, brutto_cent, zahlungsmittel,
                          beleg_id, anstellung_id, weiterberechenbar, status,
                          freigegeben_von, freigegeben_am,
                          erstellt_von_art, erstellt_von)
     values ($1,$2,'Tankbeleg und Verpflegung','2026-03-04',
             10000,1660,11660,'karte',$3,$4,$5,$6::ausgabe_status,
             case when $6 in ('freigegeben','gebucht') then $7::uuid end,
             case when $6 in ('freigegeben','gebucht') then now() end,
             'mensch',$7)
     returning id`,
    [mandantId, kategorieId, beleg, anstellungId, weiterberechenbar, status, benutzer]);
  return a!.id;
}

async function legeSteuerzeilenAn(
  mandantId: string, ausgabeId: string,
  paare: readonly (readonly [string, bigint, bigint])[],
): Promise<void> {
  for (const [schluessel, netto, steuer] of paare) {
    await sql.unsafe(
      `insert into ausgabe_steuer (mandant_id, ausgabe_id, steuersatz_gruppe_id,
                                   satz_bp, kategorie, netto_cent, steuer_cent,
                                   erstellt_von_art, erstellt_von)
       select $1,$2,g.id,g.satz_bp,g.kategorie,$4,$5,'mensch',$6
         from steuersatz_gruppe g where g.schluessel = $3`,
      [mandantId, ausgabeId, schluessel, netto, steuer, benutzer] as never[]);
  }
}

beforeEach(async () => {
  f = await seed();
  benutzer = await legeBenutzerAn(`buchhaltung-${zufall()}@cse.test`);
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into ausgabe_kategorie (mandant_id, schluessel, bezeichnung,
                                    erstellt_von_art, erstellt_von)
     values ($1,'kraftstoff','Kraftstoff','mensch',$2) returning id`,
    [f.reinigung, benutzer]);
  kategorieId = k!.id;
  belegId = await legeBelegAn(f.reinigung);
});

afterAll(schliessen);

describe('K-05 — das Spaltenrecht auf anstellung_id', () => {
  it('lässt cse_app die Ausgabe lesen, aber nicht anstellung_id', async () => {
    const id = await legeAusgabeAn(f.reinigung, { anstellungId: f.fatimaReinigung });

    /* Die Ausgabe selbst: lesbar. */
    const sichtbar = await alsApp(buchhaltung(), async (tx) =>
      tx.unsafe(`select bezeichnung, brutto_cent::text from ausgabe where id = $1`, [id]));
    expect(sichtbar).toHaveLength(1);

    /*
     * Die gesperrte Spalte: `permission denied`. Ein `GRANT SELECT` auf die
     * Tabelle mit nachfolgendem `REVOKE SELECT (spalte)` wirkt in PostgreSQL
     * NICHT — deshalb fehlt die Spalte im GRANT von vornherein, und genau das
     * prüft diese Zeile.
     */
    await expect(alsApp(buchhaltung(), async (tx) =>
      tx.unsafe(`select anstellung_id from ausgabe where id = $1`, [id])))
      .rejects.toThrow(/permission denied/iu);
  });

  it('gibt die Erstattung über das schmale Tor heraus und protokolliert es', async () => {
    const id = await legeAusgabeAn(f.reinigung, { anstellungId: f.fatimaReinigung });
    const zeilen = await alsApp(buchhaltung(), async (tx) =>
      tx.unsafe<{ anstellung_id: string; person_id: string }[]>(
        `select anstellung_id, person_id from app.ausgabe_erstattung_lesen($1)`, [id]));
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]!.anstellung_id).toBe(f.fatimaReinigung);
    expect(zeilen[0]!.person_id).toBe(f.fatima);

    const [prot] = await sql.unsafe<{ anzahl: string }[]>(
      `select count(*)::text as anzahl from audit_log
        where aktion = 'ausgabe.erstattung_gelesen' and objekt_id = $1`, [id]);
    expect(Number(prot!.anzahl)).toBeGreaterThan(0);
  });

  it('gibt für eine Ausgabe OHNE Anstellung dasselbe zurück wie ohne Recht: nichts', async () => {
    /*
     * AUT-06: „keine Erstattung" und „darfst du nicht wissen" sind von
     * aussen nicht unterscheidbar. Ein eigener Rückgabewert für den zweiten
     * Fall wäre die Auskunft, die das Recht verweigert.
     */
    const id = await legeAusgabeAn(f.reinigung);
    const zeilen = await alsApp(buchhaltung(), async (tx) =>
      tx.unsafe(`select * from app.ausgabe_erstattung_lesen($1)`, [id]));
    expect(zeilen).toHaveLength(0);
  });
});

describe('K-04 und K-18 — das Mitarbeiterportal', () => {
  it('liest die eigene Erstattung und keine fremde Ausgabe (EMP-13)', async () => {
    const eigene = await legeAusgabeAn(f.reinigung, { anstellungId: f.fatimaReinigung });
    const fremde = await legeAusgabeAn(f.reinigung, { anstellungId: f.jonasReinigung });
    const derGesellschaft = await legeAusgabeAn(f.reinigung);

    const gesehen = await alsApp(
      { scope: 'person', personId: f.fatima, benutzerId: benutzer },
      async (tx) => tx.unsafe<{ id: string }[]>(`select id from ausgabe order by id`),
    );
    const ids = gesehen.map((z) => z.id);
    expect(ids).toContain(eigene);
    expect(ids).not.toContain(fremde);
    /*
     * Und ausdrücklich NICHT die Aufwendungen der Gesellschaft: eine
     * Arbeiterin sieht ihre Erstattung, nicht den Tankbeleg des Fuhrparks.
     */
    expect(ids).not.toContain(derGesellschaft);
  });

  it('liest die Steuerzeilen der eigenen Erstattung — über das Elternteil', async () => {
    const eigene = await legeAusgabeAn(f.reinigung, { anstellungId: f.fatimaReinigung });
    const fremde = await legeAusgabeAn(f.reinigung, { anstellungId: f.jonasReinigung });
    await legeSteuerzeilenAn(f.reinigung, eigene, [['ust_19', 10_000n, 1900n]]);
    await legeSteuerzeilenAn(f.reinigung, fremde, [['ust_19', 10_000n, 1900n]]);

    const gesehen = await alsApp(
      { scope: 'person', personId: f.fatima, benutzerId: benutzer },
      async (tx) => tx.unsafe<{ ausgabe_id: string }[]>(
        `select ausgabe_id from ausgabe_steuer`),
    );
    expect(gesehen.map((z) => z.ausgabe_id)).toEqual([eigene]);
  });

  it('liest die Steuerzeilen OHNE permission denied auf ausgabe', async () => {
    /*
     * Der Fehler, den dieser Test festhält: die erste Fassung der Policies
     * auf `ausgabe_steuer` prüfte `a.anstellung_id` in einer Unterabfrage auf
     * `ausgabe` — eine FREMDE Tabelle, deren Spaltenrechte PostgreSQL für den
     * Aufrufer prüft. Jeder Lesezugriff auf die Steuerzeilen endete mit
     * `permission denied for table ausgabe`, auch für eine Buchhaltung mit
     * allen Rechten.
     */
    const id = await legeAusgabeAn(f.reinigung);
    await legeSteuerzeilenAn(f.reinigung, id, [['ust_19', 8000n, 1520n], ['ust_07', 2000n, 140n]]);
    const zeilen = await alsApp(buchhaltung(), async (tx) =>
      tx.unsafe<{ satz_bp: number }[]>(
        `select satz_bp from ausgabe_steuer where ausgabe_id = $1 order by satz_bp desc`,
        [id]));
    expect(zeilen.map((z) => z.satz_bp)).toEqual([1900, 700]);
  });
});

describe('SEC-A3 — die Gruppenansicht sieht keinen Personenbezug', () => {
  it('liest null Zeilen mit anstellung_id und die übrigen vollständig', async () => {
    const erstattung = await legeAusgabeAn(f.reinigung, { anstellungId: f.fatimaReinigung });
    const sachaufwand = await legeAusgabeAn(f.reinigung);
    await legeSteuerzeilenAn(f.reinigung, erstattung, [['ust_19', 10_000n, 1900n]]);
    await legeSteuerzeilenAn(f.reinigung, sachaufwand, [['ust_19', 10_000n, 1900n]]);

    /*
     * Die Gruppensitzung braucht `gruppe.eingang.lesen`. Es hängt an der
     * globalen Rolle `super_admin`, die dieser Benutzer trägt — sonst wäre
     * der Test leer und sähe aus, als griffe die Decke.
     */
    const gruppe = {
      scope: 'gruppe' as const, mandantIds: [f.reinigung, f.security],
      benutzerId: benutzer,
    };
    const ausgaben = await alsApp(gruppe, async (tx) =>
      tx.unsafe<{ id: string }[]>(`select id from ausgabe`));
    const ids = ausgaben.map((z) => z.id);
    expect(ids).toContain(sachaufwand);
    expect(ids).not.toContain(erstattung);

    const steuer = await alsApp(gruppe, async (tx) =>
      tx.unsafe<{ ausgabe_id: string }[]>(`select ausgabe_id from ausgabe_steuer`));
    expect(steuer.map((z) => z.ausgabe_id)).toEqual([sachaufwand]);
  });
});

describe('Mandantengrenze', () => {
  it('zeigt einer Reinigungssitzung keine Security-Ausgabe (Invariante 3)', async () => {
    const [ks] = await sql.unsafe<{ id: string }[]>(
      `insert into ausgabe_kategorie (mandant_id, schluessel, bezeichnung,
                                      erstellt_von_art, erstellt_von)
       values ($1,'bewachung','Bewachungsmaterial','mensch',$2) returning id`,
      [f.security, benutzer]);
    const [fremd] = await sql.unsafe<{ id: string }[]>(
      `insert into ausgabe (mandant_id, kategorie_id, bezeichnung, ausgabedatum,
                            netto_cent, steuer_cent, brutto_cent, zahlungsmittel,
                            erstellt_von_art, erstellt_von)
       values ($1,$2,'Taschenlampen','2026-03-04',1000,190,1190,'karte','mensch',$3)
       returning id`, [f.security, ks!.id, benutzer]);

    const gesehen = await alsApp(buchhaltung(), async (tx) =>
      tx.unsafe<{ id: string }[]>(`select id from ausgabe`));
    expect(gesehen.map((z) => z.id)).not.toContain(fremd!.id);
  });
});

describe('ACC-03 — keine Buchung ohne Beleg', () => {
  it('weist die Freigabe ohne Beleg ab', async () => {
    const id = await legeAusgabeAn(f.reinigung);
    await expect(sql.unsafe(
      `update ausgabe set status = 'freigegeben', freigegeben_von = $2,
              freigegeben_am = now() where id = $1`, [id, benutzer]))
      .rejects.toThrow(/ausgabe_beleg_ab_freigabe/u);
  });

  it('lässt die Freigabe mit Beleg zu', async () => {
    const id = await legeAusgabeAn(f.reinigung, { beleg: belegId });
    await sql.unsafe(
      `update ausgabe set status = 'freigegeben', freigegeben_von = $2 where id = $1`,
      [id, benutzer]);
    const [z] = await sql.unsafe<{ status: string; freigegeben_am: string | null }[]>(
      `select status::text as status, freigegeben_am::text as freigegeben_am
         from ausgabe where id = $1`, [id]);
    expect(z!.status).toBe('freigegeben');
    /* Der Ausloeser stempelt den Zeitpunkt selbst — Serverzeit, nicht Eingabe. */
    expect(z!.freigegeben_am).not.toBeNull();
  });

  it('verlangt für eine Barausgabe eine Kasse (Kassensturzfähigkeit)', async () => {
    await expect(sql.unsafe(
      `insert into ausgabe (mandant_id, kategorie_id, bezeichnung, ausgabedatum,
                            netto_cent, steuer_cent, brutto_cent, zahlungsmittel,
                            erstellt_von_art, erstellt_von)
       values ($1,$2,'Parkgebühr','2026-03-04',500,0,500,'bar','mensch',$3)`,
      [f.reinigung, kategorieId, benutzer]))
      .rejects.toThrow(/ausgabe_bar_hat_kasse/u);
  });

  it('verlangt für eine Ablehnung einen Grund', async () => {
    const id = await legeAusgabeAn(f.reinigung);
    await expect(sql.unsafe(
      `update ausgabe set status = 'abgelehnt' where id = $1`, [id]))
      .rejects.toThrow(/ausgabe_ablehnung_begruendet/u);
    await sql.unsafe(
      `update ausgabe set status = 'abgelehnt',
              abgelehnt_grund = 'Privatausgabe, nicht betrieblich' where id = $1`, [id]);
  });
});

describe('Invariante 1 — die Steuerzeilen müssen zum Kopf passen', () => {
  it('weist das Buchen ab, wenn die Zeilen fehlen', async () => {
    const id = await legeAusgabeAn(f.reinigung, { beleg: belegId, status: 'freigegeben' });
    await expect(sql.unsafe(
      `update ausgabe set status = 'gebucht' where id = $1`, [id]))
      .rejects.toThrow(/Aufteilung je Steuersatzgruppe/u);
  });

  it('weist das Buchen ab, wenn die Zeilen um einen Cent abweichen', async () => {
    const id = await legeAusgabeAn(f.reinigung, { beleg: belegId, status: 'freigegeben' });
    await legeSteuerzeilenAn(f.reinigung, id,
      [['ust_19', 8000n, 1520n], ['ust_07', 2000n, 139n]]);
    await expect(sql.unsafe(
      `update ausgabe set status = 'gebucht' where id = $1`, [id]))
      .rejects.toThrow(/Die Steuerzeilen ergeben/u);
  });

  it('lässt das Buchen zu, wenn beide Summen stimmen — zwei Sätze auf einem Beleg', async () => {
    /*
     * Kraftstoff zu 19 % und Verpflegung zu 7 % auf einem Kassenbeleg ist der
     * gewöhnliche Fall. Mit einer einzigen Steuersatzgruppe je Ausgabe wäre er
     * nicht erfassbar — und die Oberfläche müsste aus dem Brutto einen
     * Mischsatz zurückrechnen.
     */
    const id = await legeAusgabeAn(f.reinigung, { beleg: belegId, status: 'freigegeben' });
    await legeSteuerzeilenAn(f.reinigung, id,
      [['ust_19', 8000n, 1520n], ['ust_07', 2000n, 140n]]);
    await sql.unsafe(`update ausgabe set status = 'gebucht' where id = $1`, [id]);
    const [z] = await sql.unsafe<{ status: string }[]>(
      `select status::text as status from ausgabe where id = $1`, [id]);
    expect(z!.status).toBe('gebucht');
  });

  it('verlangt, dass Brutto die Summe aus Netto und Steuer ist', async () => {
    await expect(sql.unsafe(
      `insert into ausgabe (mandant_id, kategorie_id, bezeichnung, ausgabedatum,
                            netto_cent, steuer_cent, brutto_cent, zahlungsmittel,
                            erstellt_von_art, erstellt_von)
       values ($1,$2,'Falsche Summe','2026-03-04',10000,1900,12000,'karte','mensch',$3)`,
      [f.reinigung, kategorieId, benutzer]))
      .rejects.toThrow(/ausgabe_summe_stimmt/u);
  });
});

describe('Die Zustandsfolge und die Unveränderlichkeit', () => {
  it('lässt erfasst → gebucht nicht zu — es gibt keinen Sprung über die Freigabe', async () => {
    const id = await legeAusgabeAn(f.reinigung, { beleg: belegId });
    await expect(sql.unsafe(
      `update ausgabe set status = 'gebucht' where id = $1`, [id]))
      .rejects.toThrow(/nicht vorgesehen/u);
  });

  it('macht eine gebuchte Ausgabe unveränderlich (ACC-06)', async () => {
    const id = await legeAusgabeAn(f.reinigung, { beleg: belegId, status: 'freigegeben' });
    await legeSteuerzeilenAn(f.reinigung, id,
      [['ust_19', 8000n, 1520n], ['ust_07', 2000n, 140n]]);
    await sql.unsafe(`update ausgabe set status = 'gebucht' where id = $1`, [id]);

    await expect(sql.unsafe(
      `update ausgabe set bezeichnung = 'nachträglich geändert' where id = $1`, [id]))
      .rejects.toThrow(/unveraenderlich/u);
    await expect(sql.unsafe(
      `update ausgabe set netto_cent = 1 where id = $1`, [id]))
      .rejects.toThrow(/unveraenderlich/u);
    /* Und der Zustand selbst geht nicht mehr weiter. */
    await expect(sql.unsafe(
      `update ausgabe set status = 'abgelehnt',
              abgelehnt_grund = 'doch nicht' where id = $1`, [id]))
      .rejects.toThrow(/wechselt nicht mehr/u);
  });

  it('friert die Steuerzeilen ab gebucht ein (§15 UStG)', async () => {
    const id = await legeAusgabeAn(f.reinigung, { beleg: belegId, status: 'freigegeben' });
    await legeSteuerzeilenAn(f.reinigung, id,
      [['ust_19', 8000n, 1520n], ['ust_07', 2000n, 140n]]);
    await sql.unsafe(`update ausgabe set status = 'gebucht' where id = $1`, [id]);

    await expect(sql.unsafe(
      `update ausgabe_steuer set netto_cent = 1 where ausgabe_id = $1`, [id]))
      .rejects.toThrow(/stehen fest/u);
    await expect(legeSteuerzeilenAn(f.reinigung, id, [['ust_0_4nr12', 0n, 0n]]))
      .rejects.toThrow(/stehen fest/u);
  });
});

describe('Invariante 8 — keine harte Löschung', () => {
  it('sperrt DELETE auf allen drei Tabellen, für jede Rolle', async () => {
    const id = await legeAusgabeAn(f.reinigung);
    await legeSteuerzeilenAn(f.reinigung, id, [['ust_19', 10_000n, 1900n]]);

    for (const tabelle of ['ausgabe_steuer', 'ausgabe', 'ausgabe_kategorie']) {
      /* Als Eigentümer: der Auslöser hält an. */
      await expect(sql.unsafe(`delete from ${tabelle}`))
        .rejects.toThrow(/Hard delete|gesperrt/iu);
      /* Als `cse_app`: schon das Recht fehlt. */
      await expect(alsRolle('cse_app', async (tx) =>
        tx.unsafe(`delete from ${tabelle}`)))
        .rejects.toThrow(/permission denied|Hard delete|gesperrt/iu);
    }
  });

  /**
   * **TRUNCATE, und zwar so, dass der Auslöser wirklich geprüft wird.**
   *
   * Diese Prüfung ist FORTGESCHRIEBEN und nicht aufgeweicht. Vorher stand sie
   * in der Schleife oben und erwartete für jede der drei Tabellen die Meldung
   * des Auslösers. Seit 0180 zeigen `rechnungsposition_quelle`, `buchungssatz`
   * und `konto_mapping` mit Fremdschlüsseln auf `ausgabe` und
   * `ausgabe_kategorie` — und PostgreSQL prüft die Fremdschlüssel VOR den
   * BEFORE-TRUNCATE-Auslösern. Für zwei der drei Tabellen kam deshalb
   * „cannot truncate a table referenced in a foreign key constraint", bevor
   * `kern.verhindere_loeschung` überhaupt zu Wort kam.
   *
   * Beides einfach in EIN Suchmuster zu werfen wäre die Abschwächung: der
   * Test bewiese dann nur noch, dass irgendetwas nein sagt — und die
   * Fremdschlüsselsperre fällt mit `CASCADE`. Geprüft wird deshalb beides
   * getrennt: die Sperre, die zuerst greift, UND der Auslöser dahinter, der
   * auch dann noch anhält, wenn `CASCADE` die erste umgeht.
   */
  it('sperrt TRUNCATE — und der Auslöser hält auch CASCADE an', async () => {
    const id = await legeAusgabeAn(f.reinigung);
    await legeSteuerzeilenAn(f.reinigung, id, [['ust_19', 10_000n, 1900n]]);

    /* Ohne fremde Verweise greift direkt der Auslöser. */
    await expect(sql.unsafe(`truncate table ausgabe_steuer`))
      .rejects.toThrow(/Hard delete|gesperrt/iu);

    for (const tabelle of ['ausgabe', 'ausgabe_kategorie']) {
      /* Erste Sperre: der Fremdschlüssel aus 0180. */
      await expect(sql.unsafe(`truncate table ${tabelle}`))
        .rejects.toThrow(/cannot truncate a table referenced in a foreign key/iu);
      /* Zweite Sperre: der Auslöser, den CASCADE nicht los wird. */
      await expect(sql.unsafe(`truncate table ${tabelle} cascade`))
        .rejects.toThrow(/Hard delete|gesperrt/iu);
    }
  });
});

describe('Die zwei Fremdschlüssel, die 0180 nachträgt', () => {
  it('verankert rechnungsposition_quelle.ausgabe_id', async () => {
    /*
     * Seit 0107 stand die Spalte ohne Fremdschlüssel. Eine Materialquelle
     * konnte auf eine Kennung zeigen, die es nicht gibt — auffallen würde das
     * erst dem Buchungsdienst.
     */
    const [fk] = await sql.unsafe<{ anzahl: string }[]>(
      `select count(*)::text as anzahl from pg_constraint
        where conname = 'rpq_ausgabe_fk' and contype = 'f'`);
    expect(Number(fk!.anzahl)).toBe(1);
  });

  it('verankert konto_mapping.ausgabe_kategorie_id und hebt die Sperre auf', async () => {
    const [fk] = await sql.unsafe<{ anzahl: string }[]>(
      `select count(*)::text as anzahl from pg_constraint
        where conname = 'km_ausgabe_kategorie_fk' and contype = 'f'`);
    expect(Number(fk!.anzahl)).toBe(1);

    /* `km_typ_hat_eltern` verbot den Typ; jetzt ist er möglich. */
    await sql.unsafe(
      `insert into konto_mapping (mandant_id, kontenrahmen, schluessel_typ,
                                  ausgabe_kategorie_id, konto, gueltig_von,
                                  ist_platzhalter, erstellt_von_art, erstellt_von)
       values ($1,'skr03','aufwand_kategorie',$2,'4530','2026-01-01',true,'mensch',$3)`,
      [f.reinigung, kategorieId, benutzer]);

    /* Und ein Verweis ins Leere bleibt abgewiesen. */
    await expect(sql.unsafe(
      `insert into konto_mapping (mandant_id, kontenrahmen, schluessel_typ,
                                  ausgabe_kategorie_id, konto, gueltig_von,
                                  ist_platzhalter, erstellt_von_art, erstellt_von)
       values ($1,'skr03','aufwand_kategorie',gen_random_uuid(),'4530','2026-01-01',
               true,'mensch',$2)`,
      [f.reinigung, benutzer]))
      .rejects.toThrow(/km_ausgabe_kategorie_fk/u);
  });

  it('lässt kassenbewegung als Buchungsherkunft weiter gesperrt', async () => {
    /*
     * Die Sperre wurde ENGER gefasst, nicht aufgehoben: `kassenbewegung` gibt
     * es weiterhin nicht, und eine Buchung darauf wäre ein Verweis ins Leere.
     */
    const [c] = await sql.unsafe<{ def: string }[]>(
      `select pg_get_constraintdef(oid) as def from pg_constraint
        where conname = 'bs_herkunft_hat_eltern'`);
    expect(c!.def).toContain('kassenbewegung');
    expect(c!.def).not.toContain("'ausgabe'");
  });
});

describe('Die Kategorie', () => {
  it('ist je Gesellschaft und Schlüssel eindeutig, solange sie nicht archiviert ist', async () => {
    await expect(sql.unsafe(
      `insert into ausgabe_kategorie (mandant_id, schluessel, bezeichnung,
                                      erstellt_von_art, erstellt_von)
       values ($1,'kraftstoff','Kraftstoff zweimal','mensch',$2)`,
      [f.reinigung, benutzer]))
      .rejects.toThrow(/ausgabe_kategorie_schluessel_uk/u);

    /* Archiviert gibt den Schlüssel wieder frei — aufgelöst wird über den Zustand. */
    await sql.unsafe(
      `update ausgabe_kategorie set archiviert_am = now() where id = $1`, [kategorieId]);
    await sql.unsafe(
      `insert into ausgabe_kategorie (mandant_id, schluessel, bezeichnung,
                                      erstellt_von_art, erstellt_von)
       values ($1,'kraftstoff','Kraftstoff neu','mensch',$2)`,
      [f.reinigung, benutzer]);
  });

  it('steht auf ist_platzhalter = true, solange O-05 offen ist', async () => {
    const [z] = await sql.unsafe<{ ist_platzhalter: boolean }[]>(
      `select ist_platzhalter from ausgabe_kategorie where id = $1`, [kategorieId]);
    expect(z!.ist_platzhalter).toBe(true);
  });
});
