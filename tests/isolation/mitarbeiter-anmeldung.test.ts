/**
 * Die Anmeldung mit Telefon und Einmalcode — gegen eine echte Datenbank, als
 * `cse_app` (EMP-01, PR 20).
 *
 * **Warum hier und nicht unter `tests/kern`.** Jede Aussage dieser Datei ist
 * eine ueber RECHTE, nicht ueber Logik: dass die Anwendung keinen Codehash
 * sieht, dass sie ohne gebundenen Benutzer eine Sitzung ausstellen kann und
 * ohne gebundenen Benutzer eine beenden. Mit einem Mock waere jede davon
 * beweisbar und keine bewiesen.
 *
 * **Und als `cse_app`, nicht als Eigentuemer.** Genau darauf ist die erste
 * Fassung hereingefallen: `devSitzungAusstellen` schreibt direkt in
 * `benutzer_sitzung` und funktionierte auf der Entwicklungsadresse, weil die
 * als `postgres` verbindet. In einer Auslieferung, die richtigerweise als
 * `cse_app` laeuft, waere dieselbe Anmeldung tot gewesen — und zwar erst
 * dort.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { alsApp, alsRolle, schliessen, seed, sql, type Fixtur } from './harness.js';

let f: Fixtur;

const hash = (s: string): string => createHash('sha256').update(s).digest('hex');

const NUMMER = '+491701234567';
const FREMD = '+491709999999';

/** Ein Konto fuer einen Menschen — die Anmeldung braucht eines. */
async function konto(personId: string, email: string, opts: {
  status?: string; dienstkonto?: boolean;
} = {}): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email],
  );
  const id = u!.id;
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, person_id, ist_dienstkonto)
     values ($1,$2,$2,$3::benutzer_status,$4::uuid,$5)`,
    [id, email, opts.status ?? 'aktiv', personId, opts.dienstkonto ?? false] as never[],
  );
  return id;
}

async function zugang(personId: string, telefon: string): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into mitarbeiter_zugang (person_id, telefon_e164) values ($1,$2) returning id`,
    [personId, telefon],
  );
  return z!.id;
}

/** Fordert einen Code an — als `cse_app`, wie die Anmeldeseite es tut. */
async function anfordern(telefon: string, code: string): Promise<boolean> {
  return alsRolle('cse_app', async (tx) => {
    const [r] = await tx.unsafe<{ ok: boolean }[]>(
      `select app.zugang_code_anfordern($1, $2, now() + interval '10 minutes') as ok`,
      [telefon, hash(code)],
    );
    return r!.ok;
  });
}

async function einloesen(telefon: string, code: string): Promise<string | null> {
  return alsRolle('cse_app', async (tx) => {
    const [r] = await tx.unsafe<{ person_id: string | null }[]>(
      `select app.zugang_code_einloesen($1, $2) as person_id`, [telefon, hash(code)],
    );
    return r!.person_id;
  });
}

beforeEach(async () => { f = await seed(); });
afterAll(schliessen);

describe('anfordern verraet nicht, ob es die Nummer gibt', () => {
  beforeEach(async () => {
    await konto(f.fatima, 'fatima@prüfstand.test');
    await zugang(f.fatima, NUMMER);
  });

  it('bekannte Nummer: ein Code entsteht', async () => {
    expect(await anfordern(NUMMER, '111111')).toBe(true);
  });

  /**
   * `false`, aber die ANWENDUNG gibt beides als „angenommen" nach aussen —
   * siehe `codeAnfordern`. Hier steht nur, dass die Datenbank keinen Code
   * anlegt; das Orakel entsteht erst, wenn jemand diesen Wert durchreicht.
   */
  it('unbekannte Nummer: kein Code, und kein Fehler', async () => {
    expect(await anfordern(FREMD, '111111')).toBe(false);
  });

  it('gesperrter Zugang: kein Code', async () => {
    await sql.unsafe(
      `update mitarbeiter_zugang set gesperrt_am = now(), gesperrt_grund = 'Austritt'
        where telefon_e164 = $1`, [NUMMER],
    );
    expect(await anfordern(NUMMER, '111111')).toBe(false);
  });

  /**
   * **Die Bremse (O-82: Ausgabendeckel).** Drei offene Codes je Zugang
   * genuegen. Ohne sie flutet jemand mit der Nummer eines Kollegen dessen
   * Telefon in Sekunden mit SMS — und das kostet Geld.
   */
  it('der vierte offene Code wird nicht mehr angelegt', async () => {
    expect(await anfordern(NUMMER, '111111')).toBe(true);
    expect(await anfordern(NUMMER, '222222')).toBe(true);
    expect(await anfordern(NUMMER, '333333')).toBe(true);
    expect(await anfordern(NUMMER, '444444')).toBe(false);
  });

  /**
   * **Und die Gegenprobe zur Bremse**: sie zaehlt OFFENE Codes, nicht
   * angeforderte. Waere sie ein blosser Zaehler, koennte sich niemand mehr
   * anmelden, der sich am selben Tag dreimal vertippt hat.
   */
  it('ein verbrauchter Code zaehlt nicht mehr mit', async () => {
    await anfordern(NUMMER, '111111');
    await anfordern(NUMMER, '222222');
    await anfordern(NUMMER, '333333');
    // Der juengste wird eingeloest und ist damit verbraucht.
    expect(await einloesen(NUMMER, '333333')).toBe(f.fatima);
    expect(await anfordern(NUMMER, '444444')).toBe(true);
  });
});

describe('einloesen unterscheidet keinen Fehlschlag vom anderen', () => {
  beforeEach(async () => {
    await konto(f.fatima, 'fatima@prüfstand.test');
    await zugang(f.fatima, NUMMER);
    await anfordern(NUMMER, '123456');
  });

  it('richtiger Code: die person_id', async () => {
    expect(await einloesen(NUMMER, '123456')).toBe(f.fatima);
  });

  it('falscher Code: null', async () => {
    expect(await einloesen(NUMMER, '654321')).toBeNull();
  });

  it('unbekannte Nummer: null, wie ein falscher Code', async () => {
    expect(await einloesen(FREMD, '123456')).toBeNull();
  });

  /**
   * **Der Wiedereinloese-Angriff.** Stuende das Setzen von `verbraucht_am` in
   * der Anwendung, gaebe es ein Fenster zwischen Pruefen und Verbrauchen, in
   * dem derselbe Code zweimal gilt.
   */
  it('derselbe Code ein zweites Mal: null', async () => {
    expect(await einloesen(NUMMER, '123456')).toBe(f.fatima);
    expect(await einloesen(NUMMER, '123456')).toBeNull();
  });

  it('abgelaufener Code: null', async () => {
    await sql.unsafe(`update mitarbeiter_einmalcode set gueltig_bis = now() - interval '1 minute'`);
    expect(await einloesen(NUMMER, '123456')).toBeNull();
  });

  it('nach fuenf Fehlversuchen ist der Code tot, auch mit der richtigen Ziffernfolge', async () => {
    for (let i = 0; i < 5; i += 1) expect(await einloesen(NUMMER, '000000')).toBeNull();
    expect(await einloesen(NUMMER, '123456')).toBeNull();
  });

  it('letzter_login_am wird gesetzt — und nur bei Erfolg', async () => {
    const vorher = await sql.unsafe<{ letzter_login_am: Date | null }[]>(
      `select letzter_login_am from mitarbeiter_zugang where telefon_e164 = $1`, [NUMMER]);
    expect(vorher[0]!.letzter_login_am).toBeNull();

    await einloesen(NUMMER, '654321');
    const dazwischen = await sql.unsafe<{ letzter_login_am: Date | null }[]>(
      `select letzter_login_am from mitarbeiter_zugang where telefon_e164 = $1`, [NUMMER]);
    expect(dazwischen[0]!.letzter_login_am).toBeNull();

    await einloesen(NUMMER, '123456');
    const nachher = await sql.unsafe<{ letzter_login_am: Date | null }[]>(
      `select letzter_login_am from mitarbeiter_zugang where telefon_e164 = $1`, [NUMMER]);
    expect(nachher[0]!.letzter_login_am).not.toBeNull();
  });
});

describe('die Anwendung kommt an die Codetabelle nicht heran (K-05)', () => {
  beforeEach(async () => {
    await konto(f.fatima, 'fatima@prüfstand.test');
    await zugang(f.fatima, NUMMER);
    await anfordern(NUMMER, '123456');
  });

  /**
   * **Kein Recht UND keine Policy** — die Ausnahme ist damit eine Verengung
   * und kein Loch. Ein Weg, auf dem die Anwendung den Hash lesen koennte,
   * waere ein Weg, auf dem ein Fehler in einer Route ihn herausgibt.
   */
  it('cse_app darf mitarbeiter_einmalcode nicht lesen', async () => {
    await expect(alsRolle('cse_app', async (tx) =>
      tx.unsafe(`select code_hash from mitarbeiter_einmalcode`)))
      .rejects.toThrow(/permission denied/iu);
  });

  it('cse_app darf dort auch nicht schreiben', async () => {
    await expect(alsRolle('cse_app', async (tx) =>
      tx.unsafe(`update mitarbeiter_einmalcode set verbraucht_am = null`)))
      .rejects.toThrow(/permission denied/iu);
  });

  /**
   * **Die Gegenprobe, damit die beiden oben nicht aus dem falschen Grund
   * gruen sind.** Auf `mitarbeiter_zugang` HAT `cse_app` ein Leserecht — ohne
   * das waeren die drei Policies darauf tote Buchstaben, der Spiegel des
   * Befunds aus `0109`. Sichtbar wird die Zeile aber erst IN einer Sitzung:
   * `t_zugang_lesen` verlangt eine Beschaeftigung in einem sichtbaren
   * Mandanten oder den Menschen selbst. Ohne gebundene Sitzung — so wie die
   * beiden Verweigerungen oben laufen — sind es null Zeilen, und zwar aus
   * Policy und nicht aus fehlendem Recht. Beides gehoert getrennt gezeigt.
   */
  it('ohne Sitzung sieht cse_app auch auf mitarbeiter_zugang nichts', async () => {
    const zeilen = await alsRolle('cse_app', async (tx) =>
      tx.unsafe(`select telefon_e164 from mitarbeiter_zugang`));
    expect(zeilen.length).toBe(0);
  });

  it('in der Gesellschaft, in der die Person beschaeftigt ist, sehr wohl', async () => {
    const zeilen = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, mandantIds: [f.reinigung], portal: 'intern' },
      async (tx) => tx.unsafe(`select telefon_e164 from mitarbeiter_zugang`),
    );
    expect(zeilen.length).toBe(1);
  });

  it('die Person sieht ihren eigenen Zugang', async () => {
    const zeilen = await alsApp(
      { scope: 'person', personId: f.fatima },
      async (tx) => tx.unsafe(`select telefon_e164 from mitarbeiter_zugang`),
    );
    expect(zeilen.length).toBe(1);
  });

  /**
   * Und die Gegenrichtung: eine fremde Gesellschaft sieht den Zugang NICHT.
   * Ohne diese Zeile bewiese die vorige nur, dass ueberhaupt etwas sichtbar
   * ist — nicht, dass die Sichtbarkeit an der Beschaeftigung haengt.
   */
  it('eine Gesellschaft ohne diese Beschaeftigung sieht ihn nicht', async () => {
    const zeilen = await alsApp(
      { scope: 'mandant', mandantId: f.bau, mandantIds: [f.bau], portal: 'intern' },
      async (tx) => tx.unsafe(`select telefon_e164 from mitarbeiter_zugang`),
    );
    expect(zeilen.length).toBe(0);
  });
});

describe('die Sitzung entsteht ohne gebundenen Benutzer (0115)', () => {
  let benutzerId: string;

  beforeEach(async () => {
    benutzerId = await konto(f.fatima, 'fatima@prüfstand.test');
    await zugang(f.fatima, NUMMER);
    await anfordern(NUMMER, '123456');
  });

  async function ausstellen(personId: string, token: string): Promise<string | null> {
    return alsRolle('cse_app', async (tx) => {
      const [r] = await tx.unsafe<{ id: string | null }[]>(
        `select app.mitarbeiter_sitzung_ausstellen($1, $2) as id`, [personId, hash(token)],
      );
      return r!.id;
    });
  }

  /**
   * **Die Begruendung der ganzen Funktion, als Test.** `cse_app` hat auf
   * `benutzer_sitzung` kein INSERT, und die beiden Policies darauf lauten
   * `benutzer_id = app.aktueller_benutzer()` — gegen jemanden, der sich
   * gerade erst anmeldet, ist das nicht erfuellbar. Wer 0115 durch ein
   * direktes INSERT „vereinfacht", faellt hier.
   */
  it('ein direktes INSERT als cse_app scheitert', async () => {
    await expect(alsRolle('cse_app', async (tx) => tx.unsafe(
      `insert into benutzer_sitzung (benutzer_id, token_hash, ansicht, aal, ablauf_am)
       values ($1, $2, 'person', 'aal1', now() + interval '1 hour')`,
      [benutzerId, hash('x')],
    ))).rejects.toThrow(/permission denied|row-level security/iu);
  });

  it('ueber die Funktion geht es — und die Sitzung traegt person/aal1', async () => {
    const id = await ausstellen(f.fatima, 'tok-1');
    expect(id).not.toBeNull();
    const [s] = await sql.unsafe<{ ansicht: string; aal: string; m: string | null }[]>(
      `select ansicht::text, aal::text, aktiver_mandant_id as m from benutzer_sitzung where id = $1`,
      [id],
    );
    expect(s!.ansicht).toBe('person');
    // `aal2` waere gelogen: der Einmalcode IST der erste Faktor (AUT-02).
    expect(s!.aal).toBe('aal1');
    expect(s!.m).toBeNull();
  });

  /**
   * **Die Decke, nicht bloss ein Vorgabewert** (K-04). `ansicht = 'person'`
   * ergibt in `app.sitzung_aufloesen` das Portal `mitarbeiter` — auch fuer
   * ein Konto, das daneben eine Leitungsrolle haelt. Der leichte Weg (ein
   * Faktor) kann den schweren (zwei Faktoren) nicht ersetzen.
   */
  it('das aufgeloeste Portal ist mitarbeiter, egal welche Rolle das Konto haelt', async () => {
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id)
       select $1, $2, id from rolle where schluessel = 'leitung' and mandant_id is null`,
      [benutzerId, f.reinigung],
    );
    await ausstellen(f.fatima, 'tok-2');
    const [a] = await alsRolle('cse_app', async (tx) => tx.unsafe<{ portal: string }[]>(
      `select portal from app.sitzung_aufloesen($1)`, [hash('tok-2')],
    ));
    expect(a!.portal).toBe('mitarbeiter');
  });

  it('ohne benutzbares Konto: null statt einer Sitzung', async () => {
    await sql.unsafe(`update benutzer set status = 'gesperrt' where id = $1`, [benutzerId]);
    expect(await ausstellen(f.fatima, 'tok-3')).toBeNull();
  });

  /**
   * **Ein Dienstkonto kann diesen Weg gar nicht erreichen** — und der Grund
   * steht nicht in 0115, sondern in `benutzer_dienstkonto_ohne_mensch`:
   * `NOT ist_dienstkonto OR person_id IS NULL`. Ein Service Principal hat
   * keinen Menschen, und `mitarbeiter_sitzung_ausstellen` sucht ueber genau
   * diesen Menschen.
   *
   * Der erste Entwurf dieses Tests wollte ein vorhandenes Konto umschalten
   * und lief in den CHECK — der Riegel war da, nur an einer anderen Stelle
   * als vermutet. `not b.ist_dienstkonto` bleibt in 0115 trotzdem stehen: es
   * spiegelt `app.sitzung_aufloesen`, kostet nichts, und der CHECK, der die
   * Bedingung heute unerreichbar macht, wohnt in einer anderen Migration.
   */
  it('ein Dienstkonto kann keinen Menschen tragen — der Weg existiert nicht', async () => {
    await expect(sql.unsafe(
      `update benutzer set ist_dienstkonto = true where id = $1`, [benutzerId],
    )).rejects.toThrow(/benutzer_dienstkonto_ohne_mensch/u);
  });

  /**
   * **Die Abmeldung braucht denselben Weg.** `beendeSitzung` setzte
   * `beendet_am` frueher mit einem eigenen UPDATE; unter `cse_app` traf das
   * null Zeilen, meldete keinen Fehler, und die Sitzung blieb offen — eine
   * Abmeldung, die wie eine aussieht und keine ist.
   */
  it('beenden geht ueber die Funktion und wirkt', async () => {
    await ausstellen(f.fatima, 'tok-5');
    const beendet = await alsRolle('cse_app', async (tx) => {
      const [r] = await tx.unsafe<{ ok: boolean }[]>(
        `select app.sitzung_beenden($1) as ok`, [hash('tok-5')]);
      return r!.ok;
    });
    expect(beendet).toBe(true);

    const aufgeloest = await alsRolle('cse_app', async (tx) => tx.unsafe(
      `select benutzer_id from app.sitzung_aufloesen($1)`, [hash('tok-5')]));
    expect(aufgeloest.length).toBe(0);
  });

  it('ein direktes UPDATE als cse_app beendet dagegen nichts', async () => {
    await ausstellen(f.fatima, 'tok-6');
    await alsRolle('cse_app', async (tx) => tx.unsafe(
      `update benutzer_sitzung set beendet_am = now(), ende_grund = 'abmeldung'
        where token_hash = $1 and beendet_am is null`, [hash('tok-6')]));
    const [s] = await sql.unsafe<{ beendet_am: Date | null }[]>(
      `select beendet_am from benutzer_sitzung where token_hash = $1`, [hash('tok-6')]);
    expect(
      s!.beendet_am,
      'Das direkte UPDATE traf null Zeilen und meldete es nicht — genau deshalb '
      + 'laeuft die Abmeldung ueber app.sitzung_beenden.',
    ).toBeNull();
  });
});
