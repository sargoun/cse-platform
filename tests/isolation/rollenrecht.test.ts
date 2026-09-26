import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, alsRolle, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import {
  RollenrechtFehler, setzeRollenrechte, zelleBindbar,
} from '../../src/server/services/system/rollenrecht.js';

/**
 * **Die Rechtematrix ist bedienbar** (V-023, AUT-03).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `0008` baut alles: `mandant_id` an der Bindungszeile, `gewaehrt` als
 * BOOLEAN statt blosser Existenz, die Auflösung „mandantenspezifisch vor
 * Plattformvorgabe" in `app.hat_recht`, drei Policies und ein `aal2`-Gate.
 * Die Seitenkarte nennt die Matrix wörtlich „editable per mandant", und das
 * Rollenblatt beschriftet je Recht die Quelle. **Keine Oberfläche erzeugte je
 * eine Abweichung** — das Beispiel aus dem Tabellenkopf von `0008`
 * („`finanzen.lesen` der `leitung` in `bau` zu entziehen darf in `reinigung`
 * nichts ändern") war nicht durchführbar.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Warum das gegen eine echte Datenbank gehört — und nur dorthin.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Die Zusage ist nicht „eine Zeile entsteht", sondern „`app.hat_recht`
 * antwortet danach anders, und zwar NUR hier". Das lässt sich ausschliesslich
 * am echten Auflöser zeigen: eine zweite Gesellschaft, dieselbe Rolle,
 * dieselbe Person — und zwei verschiedene Antworten. Ein Mock sagte zu jeder
 * Behauptung ja.
 *
 * Und die Selbstaussperrung ebenso: der Dienst denkt sie nicht nach, er fragt
 * nach dem Schreiben denselben Auflöser noch einmal. Das geht nur in einer
 * Transaktion, die die eigene Änderung schon sieht.
 */

let f: Fixtur;
let admin = '';
let leitungIn = '';
let adminRolle = '';
let leitungRolle = '';
let superRolle = '';
let mitarbeiterRolle = '';

const zufall = (): string => Math.random().toString(36).slice(2, 10);

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

/** Ein Konto mit zweitem Faktor — ohne ihn schreibt an dieser Tabelle niemand. */
async function konto(mandant: string, rolle: string): Promise<string> {
  const email = `rr-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,'Rechtepflege','aktiv')`,
    [u!.id, email] as never[]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1,$2,$3,true)`, [u!.id, mandant, await rolleId(rolle)] as never[]);
  return u!.id;
}

function kontext(
  tx: postgres.TransactionSql, mandantId: string, benutzerId: string,
): SchreibKontext {
  const lauf = async <T>(a: string, w?: readonly unknown[]): Promise<readonly T[]> =>
    (await tx.unsafe(a, (w ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId,
    aktiverMandantId: mandantId, mandantIds: [mandantId],
    abfrage: lauf, schreibe: lauf,
  };
}

/** Eine Sitzung MIT zweitem Faktor — die Vorgabe der Harness ist `aal1`. */
async function alsWer<T>(
  benutzerId: string, fn: (k: SchreibKontext) => Promise<T>,
  o: { readonly mandantId?: string; readonly aal?: 'aal1' | 'aal2';
       readonly readonly?: boolean } = {},
): Promise<T> {
  const mandantId = o.mandantId ?? f.reinigung;
  return alsApp(
    { scope: 'mandant', mandantId, benutzerId, portal: 'intern',
      readonly: o.readonly ?? false, aal: o.aal ?? 'aal2' },
    (tx) => fn(kontext(tx, mandantId, benutzerId)),
  );
}

/** Was `app.hat_recht` sagt — der ECHTE Auflöser, nicht ein Nachbau. */
async function hatRecht(
  benutzerId: string, recht: string, mandantId: string,
): Promise<boolean> {
  const [z] = await alsApp(
    { scope: 'mandant', mandantId, benutzerId, portal: 'intern',
      readonly: true, aal: 'aal2' },
    (tx) => tx.unsafe(`select app.hat_recht($1, app.aktiver_mandant()) as darf`,
                      [recht] as never[]),
  ) as unknown as { darf: boolean }[];
  return z?.darf === true;
}

async function abweichung(
  rolle: string, recht: string, mandantId: string,
): Promise<boolean | null> {
  const [z] = await sql.unsafe<{ gewaehrt: boolean }[]>(
    `select rb.gewaehrt from rolle_berechtigung rb
       join berechtigung b on b.id = rb.berechtigung_id
      where rb.rolle_id = $1 and b.schluessel = $2 and rb.mandant_id = $3`,
    [rolle, recht, mandantId] as never[]);
  return z === undefined ? null : z.gewaehrt;
}

beforeEach(async () => {
  f = await seed();
  adminRolle = await rolleId('admin');
  leitungRolle = await rolleId('leitung');
  superRolle = await rolleId('super_admin');
  mitarbeiterRolle = await rolleId('mitarbeiter');
  admin = await konto(f.reinigung, 'admin');
  leitungIn = await konto(f.reinigung, 'leitung');
  /*
   * `system.rolle_verwalten` ist für `admin` BINDBAR, nicht gebunden — der
   * Katalog gibt es per Vorgabe nur `super_admin`. Ohne diese Zeile käme
   * keine einzige Prüfung unten durch das Tor, und zwar zu Recht.
   */
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     select $1, b.id, $2, true from berechtigung b
      where b.schluessel = 'system.rolle_verwalten'
     on conflict (rolle_id, berechtigung_id, mandant_id) do update set gewaehrt = true`,
    [adminRolle, f.reinigung] as never[]);
});
afterAll(schliessen);

describe('§1 die Abweichung wirkt — und NUR hier', () => {
  it('entzieht der `leitung` ein Recht in DIESER Gesellschaft', async () => {
    /* Der Fall aus dem Tabellenkopf von `0008`, wörtlich. */
    expect(await hatRecht(leitungIn, 'finanzen.lesen', f.reinigung)).toBe(true);

    const n = await alsWer(admin, (k) => setzeRollenrechte(k, leitungRolle, [
      { recht: 'finanzen.lesen', wunsch: 'entziehen' },
    ]));
    expect(n).toBe(1);

    expect(await hatRecht(leitungIn, 'finanzen.lesen', f.reinigung)).toBe(false);
    expect(await abweichung(leitungRolle, 'finanzen.lesen', f.reinigung)).toBe(false);
  });

  it('und lässt eine ANDERE Gesellschaft unberührt (Invariante 3, AUT-03)', async () => {
    const imBau = await konto(f.bau, 'leitung');
    await alsWer(admin, (k) => setzeRollenrechte(k, leitungRolle, [
      { recht: 'finanzen.lesen', wunsch: 'entziehen' },
    ]));
    /*
     * Dieselbe Rolle, dasselbe Recht, eine andere Gesellschaft — und die
     * Antwort ist eine andere. Genau das ist AUT-03, und genau das kann kein
     * Mock behaupten.
     */
    expect(await hatRecht(imBau, 'finanzen.lesen', f.bau)).toBe(true);
    expect(await abweichung(leitungRolle, 'finanzen.lesen', f.bau)).toBeNull();
  });

  it('gewährt umgekehrt ein Recht, das die Vorgabe nicht gibt', async () => {
    /*
     * `crm_entgelt.lesen` ist für `leitung` BINDBAR (`○`) und nicht gebunden:
     * die Vorgabe gibt es nur `super_admin` und `admin`. Vorher also nein,
     * nachher ja — ohne dass irgendwo eine Vorgabe geändert wurde.
     */
    const n = await alsWer(admin, (k) => setzeRollenrechte(k, leitungRolle, [
      { recht: 'crm_entgelt.lesen', wunsch: 'gewaehren' },
    ]));
    expect(n).toBe(1);
    expect(await hatRecht(leitungIn, 'crm_entgelt.lesen', f.reinigung)).toBe(true);
  });

  it('setzt mehrere Zellen in EINEM Zug und zählt nur die echten Änderungen', async () => {
    const n = await alsWer(admin, (k) => setzeRollenrechte(k, leitungRolle, [
      { recht: 'finanzen.lesen', wunsch: 'entziehen' },
      { recht: 'crm_entgelt.lesen', wunsch: 'gewaehren' },
    ]));
    expect(n).toBe(2);
    /* Dasselbe noch einmal: nichts ändert sich, also zählt nichts. */
    const zweimal = await alsWer(admin, (k) => setzeRollenrechte(k, leitungRolle, [
      { recht: 'finanzen.lesen', wunsch: 'entziehen' },
      { recht: 'crm_entgelt.lesen', wunsch: 'gewaehren' },
    ]));
    expect(zweimal).toBe(0);
  });

  it('schreibt je geänderter Zelle eine Protokollzeile mit Vorher und Nachher', async () => {
    await alsWer(admin, (k) => setzeRollenrechte(k, leitungRolle, [
      { recht: 'finanzen.lesen', wunsch: 'entziehen' },
    ]));
    const [z] = await sql.unsafe<{
      vorher: Record<string, unknown> | null; nachher: Record<string, unknown> | null;
    }[]>(
      `select vorher, nachher from audit_log
        where aktion = 'system.rollenrecht_gesetzt' and mandant_id = $1
        order by id desc limit 1`, [f.reinigung] as never[]);
    /* Vorher gab es KEINE Abweichung — das ist `null`, nicht `false`. */
    expect(z?.vorher?.['gewaehrt']).toBeNull();
    expect(z?.nachher?.['gewaehrt']).toBe(false);
    expect(z?.nachher?.['recht']).toBe('finanzen.lesen');
    expect(z?.nachher?.['rolle']).toBe('leitung');
  });

  it('ein Zurückstellen ist wieder eine Abweichung, keine Rückkehr zur Vorgabe', async () => {
    await alsWer(admin, (k) => setzeRollenrechte(k, leitungRolle, [
      { recht: 'finanzen.lesen', wunsch: 'entziehen' },
    ]));
    await alsWer(admin, (k) => setzeRollenrechte(k, leitungRolle, [
      { recht: 'finanzen.lesen', wunsch: 'gewaehren' },
    ]));
    expect(await hatRecht(leitungIn, 'finanzen.lesen', f.reinigung)).toBe(true);
    /*
     * Die ZEILE bleibt — `0008` erteilt `cse_app` kein `delete`. Wer „wie die
     * Vorgabe" will, setzt den Wert, den die Vorgabe heute hat, und bleibt
     * darauf stehen. Die Seite sagt das hin; hier steht, dass es stimmt.
     */
    expect(await abweichung(leitungRolle, 'finanzen.lesen', f.reinigung)).toBe(true);
  });
});

describe('§2 die Wand gegen die eigene Tür', () => {
  it('nimmt NICHTS zurück, wenn die Sitzung sich selbst aussperren würde', async () => {
    /*
     * Der Fall, der ohne Prüfung eine Gesellschaft verwaist: `admin` entzieht
     * der eigenen Rolle `system.rolle_verwalten` — danach kann in dieser
     * Gesellschaft niemand mehr eine Rechtezeile setzen, und es gibt keinen
     * Weg zurück ausser über die Datenbank.
     */
    await expect(alsWer(admin, (k) => setzeRollenrechte(k, adminRolle, [
      { recht: 'system.rolle_verwalten', wunsch: 'entziehen' },
    ]))).rejects.toMatchObject({ grund: 'selbstaussperrung' });
    expect(await hatRecht(admin, 'system.rolle_verwalten', f.reinigung)).toBe(true);
  });

  it('und rollt dabei auch die ANDEREN Zellen desselben Absendens zurück', async () => {
    /*
     * Die halbe Zusage wäre wertlos: bliebe die erste Zelle stehen, hätte ein
     * abgewiesenes Absenden die Matrix trotzdem verändert — und niemand
     * wüsste, welche Hälfte gilt.
     */
    await expect(alsWer(admin, (k) => setzeRollenrechte(k, adminRolle, [
      { recht: 'finanzen.lesen', wunsch: 'entziehen' },
      { recht: 'system.rolle_verwalten', wunsch: 'entziehen' },
    ]))).rejects.toThrow(RollenrechtFehler);
    expect(await abweichung(adminRolle, 'finanzen.lesen', f.reinigung)).toBeNull();
  });

  it('einer ANDEREN Rolle darf das Recht entzogen werden', async () => {
    /*
     * Die Wand ist gegen die eigene Tür gerichtet, nicht gegen die Handlung.
     * `leitung` hält `system.rolle_verwalten` ohnehin nicht — hier wird es
     * ausdrücklich verweigert, und das ist erlaubt, weil der Handelnde
     * danach selbst noch hineinkommt.
     */
    const n = await alsWer(admin, (k) => setzeRollenrechte(k, leitungRolle, [
      { recht: 'system.rolle_lesen', wunsch: 'entziehen' },
    ]));
    expect(n).toBe(1);
    expect(await hatRecht(admin, 'system.rolle_verwalten', f.reinigung)).toBe(true);
  });
});

describe('§3 die Wände der Matrix', () => {
  it('weist `super_admin` ab — das ist die Rolle der Plattform', async () => {
    await expect(alsWer(admin, (k) => setzeRollenrechte(k, superRolle, [
      { recht: 'finanzen.lesen', wunsch: 'entziehen' },
    ]))).rejects.toMatchObject({ grund: 'rolle_nicht_editierbar' });
    expect(await abweichung(superRolle, 'finanzen.lesen', f.reinigung)).toBeNull();
  });

  it('weist ein `nur_global`-Recht ab — eine Abweichung darauf bewirkt nichts', async () => {
    /*
     * `app.hat_recht` verlässt die Auflösung für ein solches Recht VOR der
     * Mitgliedschaftsrolle (Stufe 4). Eine Abweichung wäre eine Zeile ohne
     * Wirkung, und das Rollenblatt zeigte „gilt: ja" über ein Recht, das die
     * Plattform verweigert.
     */
    await expect(alsWer(admin, (k) => setzeRollenrechte(k, adminRolle, [
      { recht: 'system.mandant_verwalten', wunsch: 'gewaehren' },
    ]))).rejects.toMatchObject({ grund: 'nur_global' });
    expect(await abweichung(adminRolle, 'system.mandant_verwalten', f.reinigung))
      .toBeNull();
  });

  it('weist eine Zelle ab, die in der Matrix leer steht', async () => {
    /*
     * `zeit.abrechnung_freigeben` ist für `mitarbeiter` weder gebunden noch
     * bindbar. Sie hier zu füllen hiesse, die Matrix aus 03-AUTH §12 an einem
     * zweiten Ort umzuschreiben — und der zweite gewinnt beim ersten
     * Widerspruch, ohne dass ihn jemand sieht.
     */
    expect(zelleBindbar('mitarbeiter', 'zeit.abrechnung_freigeben')).toBe(false);
    await expect(alsWer(admin, (k) => setzeRollenrechte(k, mitarbeiterRolle, [
      { recht: 'zeit.abrechnung_freigeben', wunsch: 'gewaehren' },
    ]))).rejects.toMatchObject({ grund: 'nicht_in_der_matrix' });
  });

  it('weist einen unbekannten Rechteschlüssel ab (K-19)', async () => {
    await expect(alsWer(admin, (k) => setzeRollenrechte(k, leitungRolle, [
      { recht: 'finanzen.alles', wunsch: 'gewaehren' },
    ]))).rejects.toMatchObject({ grund: 'unbekanntes_recht' });
  });

  it('weist eine leere Auswahl ab statt still nichts zu tun', async () => {
    await expect(alsWer(admin, (k) => setzeRollenrechte(k, leitungRolle, [])))
      .rejects.toMatchObject({ grund: 'nichts_gewaehlt' });
  });

  it('weist eine eigene Rolle dieser Gesellschaft ab — O-904', async () => {
    const [r] = await sql.unsafe<{ id: string }[]>(
      `insert into rolle (mandant_id, schluessel, bezeichnung, geltungsbereich, portal)
       values ($1, $2, 'Hauswart', 'mandant', 'intern') returning id`,
      [f.reinigung, `hauswart_${zufall()}`] as never[]);
    await expect(alsWer(admin, (k) => setzeRollenrechte(k, r!.id, [
      { recht: 'objekt.lesen', wunsch: 'gewaehren' },
    ]))).rejects.toMatchObject({ grund: 'rolle_nicht_editierbar' });
  });

  it('eine Rolle einer FREMDEN Gesellschaft gibt es nicht (AUT-06)', async () => {
    const [r] = await sql.unsafe<{ id: string }[]>(
      `insert into rolle (mandant_id, schluessel, bezeichnung, geltungsbereich, portal)
       values ($1, $2, 'Fremd', 'mandant', 'intern') returning id`,
      [f.bau, `fremd_${zufall()}`] as never[]);
    await expect(alsWer(admin, (k) => setzeRollenrechte(k, r!.id, [
      { recht: 'objekt.lesen', wunsch: 'gewaehren' },
    ]))).rejects.toMatchObject({ grund: 'unbekannte_rolle', status: 404 });
  });
});

describe('§4 die Wände der Datenbank', () => {
  it('ohne zweiten Faktor schreibt niemand (K-15, `p_rb_aal2`)', async () => {
    /*
     * Die restriktive Policy gilt für JEDEN Schreibweg, auch für den Dienst.
     * Sie ist die zweite Linie: die Route fragt `erfordert2fa` vorher, damit
     * ein Mensch einen Satz bekommt — fiele sie weg, hielte diese hier.
     */
    await expect(alsWer(admin, (k) => setzeRollenrechte(k, leitungRolle, [
      { recht: 'finanzen.lesen', wunsch: 'entziehen' },
    ]), { aal: 'aal1' })).rejects.toThrow();
    expect(await abweichung(leitungRolle, 'finanzen.lesen', f.reinigung)).toBeNull();
  });

  it('ohne `system.rolle_verwalten` schreibt niemand', async () => {
    /*
     * Die Zelle ist mit Absicht eine BINDBARE: läge sie ausserhalb der
     * Matrix, wiese schon der Katalog ab, und diese Prüfung wäre aus dem
     * falschen Grund grün — der klassische Fehlalarm einer Rechteprüfung.
     */
    expect(zelleBindbar('leitung', 'crm_entgelt.lesen')).toBe(true);
    await expect(alsWer(leitungIn, (k) => setzeRollenrechte(k, leitungRolle, [
      { recht: 'crm_entgelt.lesen', wunsch: 'gewaehren' },
    ]))).rejects.toThrow();
    expect(await abweichung(leitungRolle, 'crm_entgelt.lesen', f.reinigung)).toBeNull();
  });

  it('in der Nur-Lese-Bindung geschieht nichts', async () => {
    await expect(alsWer(admin, (k) => setzeRollenrechte(k, leitungRolle, [
      { recht: 'finanzen.lesen', wunsch: 'entziehen' },
    ]), { readonly: true })).rejects.toThrow();
    expect(await abweichung(leitungRolle, 'finanzen.lesen', f.reinigung)).toBeNull();
  });

  it('und die Gruppenansicht kann die Zeile gar nicht anlegen (Invariante 10)', async () => {
    /*
     * **Es fällt am TRIGGER, nicht an der Policy — und das ist die schärfere
     * Wand.** `kern.rolle_berechtigung_pruefen` (0008) steht VOR der Zeile
     * und fragt `app.hat_recht('system.rolle_verwalten', …)`; in der
     * Gruppenansicht antwortet der Auflöser auf alles ausser Lesen mit
     * `false` (Invariante 10), also kommt es gar nicht erst bis zur Policy.
     * Die Prüfung nennt deshalb die Meldung, die wirklich kommt — eine, die
     * auf `row-level security` bestünde, wäre grün, sobald der Trigger
     * verschwände.
     */
    const [b] = await alsRolle('', (tx) => tx.unsafe(
      `select id from berechtigung where schluessel = 'finanzen.lesen'`,
    )) as unknown as { id: string }[];
    await expect(alsApp(
      { scope: 'gruppe', mandantIds: [f.reinigung, f.bau], benutzerId: admin,
        readonly: true, aal: 'aal2' },
      (tx) => tx.unsafe(
        `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
         values ($1, $2, $3, false)`,
        [leitungRolle, b!.id, f.reinigung] as never[]),
    )).rejects.toThrow(/system\.rolle_verwalten fehlt/u);
  });

  it('gelöscht wird eine Abweichung von niemandem — `cse_app` hat kein `delete`', async () => {
    await alsWer(admin, (k) => setzeRollenrechte(k, leitungRolle, [
      { recht: 'finanzen.lesen', wunsch: 'entziehen' },
    ]));
    await expect(alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: admin, portal: 'intern',
        readonly: false, aal: 'aal2' },
      (tx) => tx.unsafe(
        `delete from rolle_berechtigung where rolle_id = $1 and mandant_id = $2`,
        [leitungRolle, f.reinigung] as never[]),
    )).rejects.toThrow();
    expect(await abweichung(leitungRolle, 'finanzen.lesen', f.reinigung)).toBe(false);
  });
});

/**
 * **SEC-A3 — der Editor ist keine Rechteerweiterung.**
 *
 * `kern.rolle_berechtigung_pruefen` (0008) verlangt vom Vergebenden, dass er
 * das Recht SELBST hält. Ohne diese Bedingung gäbe sich jeder, der Rollen
 * verwalten darf, über eine beliebige Rolle jedes andere Recht — und AUT-03
 * wäre eine Hintertür statt einer Verwaltung.
 *
 * Der Dienst baut die Regel NICHT nach; er übersetzt ihre Meldung. Ein
 * zweiter Nachbau ginge beim ersten Unterschied auseinander, und dann gälte
 * die bequemere der beiden Fassungen.
 */
describe('§5 was man selbst nicht hält, gibt man nicht weiter', () => {
  it('weist die Vergabe eines Rechts ab, das die Sitzung selbst nicht hat', async () => {
    /*
     * `angebot.preis_freigeben`: Vorgabe für `super_admin` und `leitung`,
     * für `admin` nur BINDBAR. Die handelnde Administration hält es also
     * nicht — und kann es deshalb auch nicht vergeben.
     */
    expect(await hatRecht(admin, 'angebot.preis_freigeben', f.reinigung)).toBe(false);
    expect(zelleBindbar('leitung', 'angebot.preis_freigeben')).toBe(true);

    await expect(alsWer(admin, (k) => setzeRollenrechte(k, leitungRolle, [
      { recht: 'angebot.preis_freigeben', wunsch: 'gewaehren' },
    ]))).rejects.toMatchObject({ grund: 'nicht_selbst_gehalten' });
    expect(await abweichung(leitungRolle, 'angebot.preis_freigeben', f.reinigung))
      .toBeNull();
  });

  it('ENTZIEHEN geht auch ohne das Recht — es erweitert nichts', async () => {
    /*
     * Der Trigger prüft die Bedingung nur bei `new.gewaehrt`. Das ist kein
     * Versehen: ein Entzug gibt niemandem etwas, und wer Rollen verwaltet,
     * soll ein Recht auch abstellen können, das er selbst nie hatte.
     */
    const n = await alsWer(admin, (k) => setzeRollenrechte(k, leitungRolle, [
      { recht: 'angebot.preis_freigeben', wunsch: 'entziehen' },
    ]));
    expect(n).toBe(1);
    expect(await hatRecht(leitungIn, 'angebot.preis_freigeben', f.reinigung)).toBe(false);
  });
});

describe('§6 `zelleBindbar` sagt dasselbe wie der Dienst', () => {
  it('kennt `✔` und `○` und sonst nichts', () => {
    /*
     * `✔` für `leitung` — eine GEBUNDENE Zelle ist bewegbar, und das ist der
     * Kern von AUT-03: der Fall aus `0008` ist das ENTZIEHEN einer Vorgabe.
     */
    expect(zelleBindbar('leitung', 'finanzen.lesen')).toBe(true);
    /* `○` für `leitung`: der Katalog führt es als bindbar. */
    expect(zelleBindbar('leitung', 'crm_entgelt.lesen')).toBe(true);
    /* Leer für `mitarbeiter`: weder gebunden noch bindbar. */
    expect(zelleBindbar('mitarbeiter', 'finanzen.lesen')).toBe(false);
    /* `super_admin` steht draussen — die Rolle der Plattform. */
    expect(zelleBindbar('super_admin', 'finanzen.lesen')).toBe(false);
    /* `nur_global` steht draussen. */
    expect(zelleBindbar('admin', 'system.mandant_verwalten')).toBe(false);
    /* Ein Tippfehler ist nicht bindbar (K-19). */
    expect(zelleBindbar('admin', 'finanzen.alles')).toBe(false);
  });
});
