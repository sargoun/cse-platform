/**
 * Die Anmeldung gegen eine echte Datenbank (AUT-01, AUT-02, AUT-04, AUT-07, 0155).
 *
 * **Der Satz, den diese Datei beweist:** der Weg vom Kennwort bis zum
 * zweiten Faktor trägt, und jede Abzweigung davon endet.
 *
 *  1. **Der Hash verlässt die Datenbank nicht** — `cse_app` kommt an
 *     `kern.zugangsdaten` gar nicht heran, und `app.kennwort_anmelden` gibt
 *     ihn nicht zurück.
 *  2. **Ein falsches Kennwort und eine unbekannte Adresse sind dasselbe
 *     Wort** (`'falsch'`) — sonst wäre die Anmeldung ein Adressverzeichnis.
 *  3. **Zu viele Fehlversuche sperren** (AUT-07), und die Sperre gilt auch
 *     dem, der danach das RICHTIGE Kennwort tippt.
 *  4. **Die Sitzung ist immer `aal1`** — auch ohne 2FA-Pflicht. `aal2` heisst
 *     „in dieser Anmeldung vorgezeigt".
 *  5. **Derselbe TOTP-Code gilt kein zweites Mal** — Wiedereinspielung ist
 *     ausgeschlossen, und das entscheidet die Datenbank.
 *  6. **Ein unbestätigter Faktor zählt nicht** — sonst sperrte ein
 *     abgebrochenes Einrichten das Konto aus.
 *  7. **Ein Zurücksetzungstoken gilt einmal** und beendet jede offene Sitzung.
 *  8. **Ein fremder Anbieter hält hier kein Geheimnis** (CHECK).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { Transaktion } from '../../src/server/kontext/index.js';
import {
  aendereKennwort, bestaetigeFaktorMitToken, gibWiederherstellungscodesAus, hebeAufAal2,
  legeKennwortTokenAn, leseKennwortToken, loeseKennwortTokenEin,
  loeseWiederherstellungscodeEin, meldeAnMitKennwort, offeneWiederherstellungscodes,
  pruefeFaktor, richteFaktorEin, richteFaktorMitTokenEin, sichererRueckweg, wegNachAnmeldung,
} from '../../src/server/auth/kennwort-anmeldung.js';
import { codeFuer, schritt } from '../../src/lib/totp.js';
import { tokenHash } from '../../src/server/auth/sitzung.js';

let f: Fixtur;

const zufall = (): string => Math.random().toString(36).slice(2, 10);
const KENNWORT = 'ein-langes-kennwort-2026';

interface Konto { id: string; email: string }

/** Ein Konto mit Kennwort — über denselben Weg wie der Seed. */
async function legeKontoAn(opts: {
  mandantId?: string | null; rolle?: string; kennwort?: string | null; status?: string;
} = {}): Promise<Konto> {
  const email = `login-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1, $2, 'Verwaltung', $3)`,
    [u!.id, email, opts.status ?? 'aktiv']);
  if (opts.mandantId !== null) {
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
       values ($1, $2, (select id from rolle where schluessel = $3 and mandant_id is null), true)`,
      [u!.id, opts.mandantId ?? f.reinigung, opts.rolle ?? 'admin']);
  }
  const kennwort = opts.kennwort === undefined ? KENNWORT : opts.kennwort;
  if (kennwort !== null) {
    await sql.unsafe(`select app.demo_kennwort_setzen($1::uuid, $2)`, [u!.id, kennwort]);
  }
  return { id: u!.id, email };
}

/** Frei von der Bremse anfangen: die Fixtur ist geteilt. */
async function bremseLoeschen(): Promise<void> {
  await sql.unsafe(`delete from kern.anmeldeversuch`);
}

async function anmelden(email: string, kennwort: string, ip = '10.0.0.1') {
  return alsApp({ scope: 'gruppe', portal: 'intern', readonly: false },
    async (tx: postgres.TransactionSql) =>
      meldeAnMitKennwort(tx as unknown as Transaktion, email, kennwort, ip, 'vitest'),
  ) as ReturnType<typeof meldeAnMitKennwort>;
}

/** Als das gerade angemeldete Konto arbeiten — `app.aktueller_benutzer()` gebunden. */
async function alsKonto<T>(
  konto: Konto, mandantId: string | null, fn: (tx: Transaktion) => Promise<T>,
): Promise<T> {
  return alsApp(
    mandantId === null
      ? { scope: 'gruppe', benutzerId: konto.id, portal: 'intern', readonly: false }
      : { scope: 'mandant', mandantId, benutzerId: konto.id, portal: 'intern', readonly: false },
    async (tx: postgres.TransactionSql) => fn(tx as unknown as Transaktion),
  ) as Promise<T>;
}

/** Ohne gebundene Sitzung — der Ausweis ist der Token, nicht der Benutzer. */
async function ohneSitzung<T>(fn: (tx: Transaktion) => Promise<T>): Promise<T> {
  return alsApp({ scope: 'gruppe', portal: 'intern', readonly: false },
    async (tx: postgres.TransactionSql) => fn(tx as unknown as Transaktion)) as Promise<T>;
}

beforeEach(async () => {
  f = await seed();
  await bremseLoeschen();
});

afterAll(schliessen);

describe('(1) der Hash bleibt, wo er hingehört', () => {
  it('cse_app kann kern.zugangsdaten nicht lesen', async () => {
    await legeKontoAn();
    await expect(
      alsApp({ scope: 'gruppe', portal: 'intern', readonly: true },
        async (tx: postgres.TransactionSql) => tx.unsafe(`select * from kern.zugangsdaten`)),
    ).rejects.toThrow(/permission denied|keine Berechtigung/u);
  });

  it('das Anmelden gibt kein Feld zurück, das wie ein Hash aussieht', async () => {
    const k = await legeKontoAn();
    const e = await anmelden(k.email, KENNWORT);
    expect(e.ergebnis).toBe('ok');
    expect(JSON.stringify(e)).not.toMatch(/\$2[aby]\$/u);
  });
});

describe('(2) falsch ist falsch, ganz gleich woran es lag', () => {
  it('unbekannte Adresse und falsches Kennwort geben dasselbe Wort', async () => {
    const k = await legeKontoAn();
    const unbekannt = await anmelden(`gibtsnicht-${zufall()}@cse.test`, KENNWORT);
    await bremseLoeschen();
    const falsch = await anmelden(k.email, 'etwas-ganz-anderes-2026');

    expect(unbekannt.ergebnis).toBe('falsch');
    expect(falsch.ergebnis).toBe('falsch');
    expect(unbekannt.benutzerId).toBeNull();
    expect(falsch.benutzerId).toBeNull();
  });

  it('ein Konto ohne Kennwort meldet sich mit keinem an', async () => {
    const k = await legeKontoAn({ kennwort: null });
    expect((await anmelden(k.email, '')).ergebnis).toBe('falsch');
    await bremseLoeschen();
    expect((await anmelden(k.email, KENNWORT)).ergebnis).toBe('falsch');
  });

  it('ein Dienstkonto meldet sich nie interaktiv an', async () => {
    const k = await legeKontoAn();
    await sql.unsafe(`update benutzer set ist_dienstkonto = true, person_id = null where id = $1`,
      [k.id]);
    expect((await anmelden(k.email, KENNWORT)).ergebnis).toBe('falsch');
  });

  it('ein noch nicht aktiviertes Konto erfährt das erst NACH dem richtigen Kennwort', async () => {
    const k = await legeKontoAn({ status: 'eingeladen' });
    expect((await anmelden(k.email, KENNWORT)).ergebnis).toBe('gesperrt');
    await bremseLoeschen();
    expect((await anmelden(k.email, 'falsch-falsch-falsch')).ergebnis).toBe('falsch');
  });
});

describe('(3) die Bremse greift vor der Prüfung (AUT-07)', () => {
  it('nach zehn Fehlversuchen ist auch das richtige Kennwort zu spät', async () => {
    const k = await legeKontoAn();
    for (let i = 0; i < 10; i += 1) {
      await anmelden(k.email, `daneben-${String(i)}`);
    }
    const jetzt = await anmelden(k.email, KENNWORT);
    expect(jetzt.ergebnis).toBe('gebremst');

    const [b] = await sql.unsafe<{ status: string; gesperrt_bis: Date | null }[]>(
      `select status, gesperrt_bis from benutzer where id = $1`, [k.id]);
    expect(b!.status).toBe('gesperrt');
    expect(b!.gesperrt_bis).not.toBeNull();
  });

  it('Versuche gegen eine nicht existierende Adresse zählen mit', async () => {
    const nie = `niemand-${zufall()}@cse.test`;
    for (let i = 0; i < 10; i += 1) await anmelden(nie, 'egal');
    expect((await anmelden(nie, 'egal')).ergebnis).toBe('gebremst');
  });
});

describe('(4) die Sitzung entsteht als aal1', () => {
  it('auch ohne Pflicht zum zweiten Faktor', async () => {
    // `leitung` und nicht `admin`: die Administration traegt `erfordert_2fa`
    // seit 0007 — sie ist der Gegenfall und steht im naechsten Test.
    const k = await legeKontoAn({ rolle: 'leitung' });
    const e = await anmelden(k.email, KENNWORT);
    expect(e.ergebnis).toBe('ok');

    const [s] = await sql.unsafe<{ aal: string; ansicht: string }[]>(
      `select aal, ansicht from benutzer_sitzung where id = $1`, [e.sitzungId]);
    expect(s!.aal).toBe('aal1');
    expect(s!.ansicht).toBe('mandant');

    /**
     * **AUT-08, und der Grund, warum es hier steht.** `benutzer` trägt RLS
     * mit `force`; ohne eine UPDATE-Policy für `cse_definer` traf dieses
     * UPDATE null Zeilen und meldete keinen Fehler. Eine Anmeldung, die
     * nirgends vermerkt ist, fällt niemandem auf — ausser hier.
     */
    const [b] = await sql.unsafe<{ letzter_login_am: Date | null; letzte_ip: string | null }[]>(
      `select letzter_login_am, letzte_ip from benutzer where id = $1`, [k.id]);
    expect(b!.letzter_login_am).not.toBeNull();
    expect(b!.letzte_ip).toBe('10.0.0.1');
  });

  it('ohne Mitgliedschaft in die Gruppenansicht — nicht in einen CHECK', async () => {
    const k = await legeKontoAn({ mandantId: null });
    const e = await anmelden(k.email, KENNWORT);
    expect(e.ergebnis).toBe('ok');
    const [s] = await sql.unsafe<{ ansicht: string; aktiver_mandant_id: string | null }[]>(
      `select ansicht, aktiver_mandant_id from benutzer_sitzung where id = $1`, [e.sitzungId]);
    expect(s!.ansicht).toBe('gruppe');
    expect(s!.aktiver_mandant_id).toBeNull();
  });

  it('eine Rolle mit erfordert_2fa führt zum Einrichten, nicht ins Portal', async () => {
    /**
     * Ein aktives Administrationskonto OHNE Faktor kann es eigentlich nicht
     * geben — `kern.benutzer_2fa_pflicht` verhindert es. Der Fall entsteht
     * trotzdem: wenn der Faktor NACH dem Aktivieren entfernt wird (genau die
     * Lücke, wegen der der Trigger die zweite und nicht die einzige
     * Verteidigungslinie ist). Hier wird er hergestellt, indem die
     * Mitgliedschaft erst nach dem Aktivieren dazukommt.
     */
    const k = await legeKontoAn({ mandantId: null });
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
       values ($1, $2, (select id from rolle where schluessel = 'admin' and mandant_id is null), true)`,
      [k.id, f.reinigung]);

    const e = await anmelden(k.email, KENNWORT);
    expect(e.ergebnis).toBe('ok');
    expect(e.brauchtFaktor).toBe(true);
    expect(e.faktorVorhanden).toBe(false);
    expect(wegNachAnmeldung(e, null)).toBe('/auth/zwei-faktor/einrichten');
  });
});

describe('(5) TOTP: ein Code, ein Mal', () => {
  it('einrichten, bestätigen, und derselbe Code gilt nicht noch einmal', async () => {
    const k = await legeKontoAn();

    const ein = await alsKonto(k, f.reinigung, (tx) => richteFaktorEin(tx, k.email));
    expect(ein).not.toBeNull();
    expect(ein!.adresse).toContain('otpauth://totp/');

    const [jetzt] = await sql.unsafe<{ t: Date }[]>(`select now() as t`);
    const code = codeFuer(ein!.geheimnis, schritt(new Date(jetzt!.t)));

    // Unbestätigt zählt der Faktor noch nicht.
    const [vorher] = await sql.unsafe<{ ok: boolean }[]>(
      `select app.hat_zweiten_faktor($1::uuid) as ok`, [k.id]);
    expect(vorher!.ok).toBe(false);

    expect(await alsKonto(k, f.reinigung, (tx) => pruefeFaktor(tx, code, false))).toBe(true);

    const [nachher] = await sql.unsafe<{ ok: boolean }[]>(
      `select app.hat_zweiten_faktor($1::uuid) as ok`, [k.id]);
    expect(nachher!.ok).toBe(true);

    // Derselbe Code im selben Fenster: abgewiesen.
    expect(await alsKonto(k, f.reinigung, (tx) => pruefeFaktor(tx, code, true))).toBe(false);
  });

  it('ein fremder Code hebt keine Sitzung', async () => {
    const k = await legeKontoAn();
    await alsKonto(k, f.reinigung, (tx) => richteFaktorEin(tx, k.email));
    expect(await alsKonto(k, f.reinigung, (tx) => pruefeFaktor(tx, '000000', false))).toBe(false);
  });

  it('ein zweiter Faktor lässt sich nicht still über einen bestätigten legen', async () => {
    const k = await legeKontoAn();
    const ein = await alsKonto(k, f.reinigung, (tx) => richteFaktorEin(tx, k.email));
    const [jetzt] = await sql.unsafe<{ t: Date }[]>(`select now() as t`);
    await alsKonto(k, f.reinigung, (tx) =>
      pruefeFaktor(tx, codeFuer(ein!.geheimnis, schritt(new Date(jetzt!.t))), false));

    expect(await alsKonto(k, f.reinigung, (tx) => richteFaktorEin(tx, k.email))).toBeNull();
  });

  it('aal2 gilt genau der Sitzung, in der der Faktor vorgezeigt wurde', async () => {
    const k = await legeKontoAn();
    const eins = await anmelden(k.email, KENNWORT);
    await bremseLoeschen();
    const zwei = await anmelden(k.email, KENNWORT);
    expect(eins.token).not.toBeNull();
    expect(zwei.token).not.toBeNull();

    await alsKonto(k, f.reinigung, (tx) => hebeAufAal2(tx, eins.token!));

    const stufen = await sql.unsafe<{ id: string; aal: string }[]>(
      `select id, aal from benutzer_sitzung where benutzer_id = $1 order by erstellt_am`, [k.id]);
    expect(stufen.find((s) => s.id === eins.sitzungId)!.aal).toBe('aal2');
    expect(stufen.find((s) => s.id === zwei.sitzungId)!.aal).toBe('aal1');
  });
});

describe('(6) Wiederherstellungscodes', () => {
  it('zehn Stück, jeder einmal, und der Klartext steht nirgends', async () => {
    const k = await legeKontoAn();
    const codes = await alsKonto(k, f.reinigung, (tx) => gibWiederherstellungscodesAus(tx, 10));
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);

    const gespeichert = await sql.unsafe<{ code_hash: string }[]>(
      `select code_hash from kern.wiederherstellungscode where benutzer_id = $1`, [k.id]);
    expect(gespeichert).toHaveLength(10);
    for (const z of gespeichert) expect(codes).not.toContain(z.code_hash);

    expect(await alsKonto(k, f.reinigung, (tx) =>
      loeseWiederherstellungscodeEin(tx, codes[0]!))).toBe(true);
    expect(await alsKonto(k, f.reinigung, (tx) =>
      loeseWiederherstellungscodeEin(tx, codes[0]!))).toBe(false);
    expect(await alsKonto(k, f.reinigung, (tx) => offeneWiederherstellungscodes(tx))).toBe(9);
  });

  it('ein neuer Satz ersetzt den alten vollständig', async () => {
    const k = await legeKontoAn();
    const alt = await alsKonto(k, f.reinigung, (tx) => gibWiederherstellungscodesAus(tx, 10));
    await alsKonto(k, f.reinigung, (tx) => gibWiederherstellungscodesAus(tx, 10));
    expect(await alsKonto(k, f.reinigung, (tx) =>
      loeseWiederherstellungscodeEin(tx, alt[0]!))).toBe(false);
  });

  it('ein fremder Code eines anderen Kontos gilt nicht', async () => {
    const a = await legeKontoAn();
    const b = await legeKontoAn();
    const codesA = await alsKonto(a, f.reinigung, (tx) => gibWiederherstellungscodesAus(tx, 10));
    expect(await alsKonto(b, f.reinigung, (tx) =>
      loeseWiederherstellungscodeEin(tx, codesA[0]!))).toBe(false);
  });
});

describe('(7) Einladung und Zurücksetzung', () => {
  it('ein Token gilt einmal, setzt das Kennwort und beendet jede offene Sitzung', async () => {
    const k = await legeKontoAn();
    const e = await anmelden(k.email, KENNWORT);
    expect(e.ergebnis).toBe('ok');

    const token = await ohneSitzung((tx) => legeKennwortTokenAn(tx, k.email, 'zuruecksetzen'));
    const inhalt = await ohneSitzung((tx) => leseKennwortToken(tx, token));
    expect(inhalt?.benutzerId).toBe(k.id);
    expect(inhalt?.zweck).toBe('zuruecksetzen');

    const neu = 'ganz-neues-kennwort-2026';
    const wer = await ohneSitzung((tx) => loeseKennwortTokenEin(tx, token, neu, null));
    expect(wer?.benutzerId).toBe(k.id);
    expect(wer?.brauchtFaktor).toBe(false);

    const [offen] = await sql.unsafe<{ n: string }[]>(
      `select count(*) as n from benutzer_sitzung
        where benutzer_id = $1 and beendet_am is null`, [k.id]);
    expect(Number(offen!.n)).toBe(0);

    // Zweites Einlösen: nichts.
    expect(await ohneSitzung((tx) => loeseKennwortTokenEin(tx, token, neu, null))).toBeNull();

    await bremseLoeschen();
    expect((await anmelden(k.email, neu)).ergebnis).toBe('ok');
    await bremseLoeschen();
    expect((await anmelden(k.email, KENNWORT)).ergebnis).toBe('falsch');
  });

  it('eine Einladung ohne 2FA-Pflicht aktiviert das Konto sofort', async () => {
    const k = await legeKontoAn({ kennwort: null, status: 'eingeladen', rolle: 'leitung' });
    const token = await ohneSitzung((tx) => legeKennwortTokenAn(tx, k.email, 'einladung'));

    const e = await ohneSitzung((tx) =>
      loeseKennwortTokenEin(tx, token, 'mein-eigenes-kennwort', null));
    expect(e?.brauchtFaktor).toBe(false);

    const [b] = await sql.unsafe<{ status: string }[]>(
      `select status from benutzer where id = $1`, [k.id]);
    expect(b!.status).toBe('aktiv');
    expect((await anmelden(k.email, 'mein-eigenes-kennwort')).ergebnis).toBe('ok');
  });

  /**
   * **Der Fall, der den Einladungsweg fast unbrauchbar gemacht hätte.**
   *
   * `kern.benutzer_2fa_pflicht` (0007) lässt ein Konto mit einer Rolle, die
   * `erfordert_2fa` trägt, nicht `aktiv` werden, solange kein Faktor
   * hinterlegt ist — und das ist JEDE Administration. Ein Einlösen, das
   * einfach aktiviert hätte, wäre in die Ausnahme des Triggers gelaufen und
   * hätte sie der eingeladenen Person gezeigt.
   *
   * Der Token bleibt deshalb offen, bis der Faktor steht; erst
   * `app.token_faktor_bestaetigen` aktiviert und verbraucht ihn zusammen.
   */
  it('eine Administration richtet den zweiten Faktor MIT demselben Token ein', async () => {
    const k = await legeKontoAn({ kennwort: null, status: 'eingeladen', rolle: 'admin' });
    const token = await ohneSitzung((tx) => legeKennwortTokenAn(tx, k.email, 'einladung'));

    const e = await ohneSitzung((tx) => loeseKennwortTokenEin(tx, token, 'mein-eigenes-kennwort', null));
    expect(e?.brauchtFaktor).toBe(true);

    // Noch nicht aktiv — und der Token ist NICHT verbraucht.
    const [vorher] = await sql.unsafe<{ status: string }[]>(
      `select status from benutzer where id = $1`, [k.id]);
    expect(vorher!.status).toBe('eingeladen');
    const [t] = await sql.unsafe<{ eingeloest_am: Date | null }[]>(
      `select eingeloest_am from kern.kennwort_token where token_hash = $1`, [tokenHash(token)]);
    expect(t!.eingeloest_am).toBeNull();

    // Anmelden geht noch nicht: das Konto ist nicht aktiv.
    expect((await anmelden(k.email, 'mein-eigenes-kennwort')).ergebnis).toBe('gesperrt');
    await bremseLoeschen();

    const ein = await ohneSitzung((tx) => richteFaktorMitTokenEin(tx, token, k.email));
    expect(ein).not.toBeNull();

    const [jetzt] = await sql.unsafe<{ t: Date }[]>(`select now() as t`);
    const code = codeFuer(ein!.geheimnis, schritt(new Date(jetzt!.t)));
    expect(await ohneSitzung((tx) => bestaetigeFaktorMitToken(tx, token, code, null))).toBe(k.id);

    const [nachher] = await sql.unsafe<{ status: string }[]>(
      `select status from benutzer where id = $1`, [k.id]);
    expect(nachher!.status).toBe('aktiv');

    const e2 = await anmelden(k.email, 'mein-eigenes-kennwort');
    expect(e2.ergebnis).toBe('ok');
    expect(e2.brauchtFaktor).toBe(true);
    expect(e2.faktorVorhanden).toBe(true);

    // Der Token ist jetzt verbraucht.
    expect(await ohneSitzung((tx) => leseKennwortToken(tx, token))).toBeNull();
  });

  it('ein zu kurzes Kennwort verbraucht den Token nicht', async () => {
    const k = await legeKontoAn();
    const token = await ohneSitzung((tx) => legeKennwortTokenAn(tx, k.email, 'zuruecksetzen'));

    expect(await ohneSitzung((tx) => loeseKennwortTokenEin(tx, token, 'kurz', null))).toBeNull();

    // Immer noch gültig.
    const [z] = await sql.unsafe<{ eingeloest_am: Date | null }[]>(
      `select eingeloest_am from kern.kennwort_token where token_hash = $1`, [tokenHash(token)]);
    expect(z!.eingeloest_am).toBeNull();
  });

  it('eine unbekannte Adresse gibt dieselbe Antwort und legt nichts an', async () => {
    const vorher = await sql.unsafe<{ n: string }[]>(
      `select count(*) as n from kern.kennwort_token`);
    await ohneSitzung((tx) => legeKennwortTokenAn(tx, `weg-${zufall()}@cse.test`, 'zuruecksetzen'));
    const nachher = await sql.unsafe<{ n: string }[]>(
      `select count(*) as n from kern.kennwort_token`);
    expect(nachher[0]!.n).toBe(vorher[0]!.n);
  });

  it('das eigene Kennwort ändern verlangt das alte', async () => {
    const k = await legeKontoAn();
    expect(await alsKonto(k, f.reinigung, (tx) =>
      aendereKennwort(tx, 'stimmt-nicht', 'noch-ein-langes-2026'))).toBe(false);
    expect(await alsKonto(k, f.reinigung, (tx) =>
      aendereKennwort(tx, KENNWORT, 'noch-ein-langes-2026'))).toBe(true);
  });
});

describe('(8) die Regeln stehen in der Tabelle, nicht in der Anwendung', () => {
  it('ein fremder Anbieter darf hier kein Geheimnis halten', async () => {
    const k = await legeKontoAn();
    await expect(sql.unsafe(
      `update kern.zugangsdaten set anbieter = 'supabase' where benutzer_id = $1`, [k.id],
    )).rejects.toThrow(/zd_fremder_anbieter_ohne_hash/u);
  });

  it('ein Hash ohne Zeitpunkt ist keiner', async () => {
    const k = await legeKontoAn();
    await expect(sql.unsafe(
      `update kern.zugangsdaten set kennwort_gesetzt_am = null where benutzer_id = $1`, [k.id],
    )).rejects.toThrow(/zd_hash_hat_zeitpunkt/u);
  });

  it('ein Konto beim fremden Anbieter meldet sich hier nicht an', async () => {
    const k = await legeKontoAn({ kennwort: null });
    await sql.unsafe(
      `insert into kern.zugangsdaten (benutzer_id, anbieter) values ($1, 'supabase')`, [k.id]);
    expect((await anmelden(k.email, KENNWORT)).ergebnis).toBe('fremd');
  });
});

describe('(9) der Rückweg aus der Abfrage wird geprüft (D-504)', () => {
  it.each([
    ['//boese.example', null],
    ['/\\boese.example', null],
    ['https://boese.example', null],
    ['portal', null],
    ['', null],
    ['/portal/reinigung/auftraege', '/portal/reinigung/auftraege'],
  ])('%s → %s', (roh, erwartet) => {
    expect(sichererRueckweg(roh)).toBe(erwartet);
  });

  it('ein offener Rückweg landet nicht in wegNachAnmeldung', () => {
    const ohne = {
      ergebnis: 'ok' as const, token: 't', sitzungId: 's', benutzerId: 'b',
      brauchtFaktor: false, faktorVorhanden: false, mussWechseln: false,
    };
    expect(wegNachAnmeldung(ohne, '//boese.example')).toBe('/portal');
    expect(wegNachAnmeldung(ohne, '/portal/reinigung')).toBe('/portal/reinigung');
  });
});

/**
 * **(9) Die zwei neuen Bremsen — und der Fehler, den nur ein echter Aufruf fand.**
 *
 * Beide Funktionen gehören `cse_definer` (K-08), und diese Rolle hatte auf
 * `kern.anmeldeversuch` weder Zuteilung noch Policy. Unter FORCE RLS ist ein
 * `grant` ohne `policy` keine Erlaubnis, sondern null Zeilen — hier war nicht
 * einmal die Zuteilung da, und der Aufruf endete mit
 * `permission denied for table anmeldeversuch`. Kein Test rief die Funktionen
 * AUF, also fiel es erst im Browserlauf auf. Diese Prüfungen rufen sie auf.
 */
describe('(9) Bremse für Zurücksetzung und zweiten Faktor (AUT-07, AUT-02)', () => {
  const reset = async (email: string, ip = '10.0.0.9'): Promise<boolean> =>
    ohneSitzung(async (tx) => {
      const z = (await tx.unsafe(
        `select app.kennwort_reset_gebremst($1, $2::inet) as gebremst`, [email, ip],
      )) as readonly { gebremst: boolean }[];
      return z[0]!.gebremst;
    });

  const faktor = async (benutzerId: string, erfolg: boolean): Promise<boolean> =>
    ohneSitzung(async (tx) => {
      const z = (await tx.unsafe(
        `select app.faktor_versuch($1::uuid, $2) as gebremst`, [benutzerId, erfolg],
      )) as readonly { gebremst: boolean }[];
      return z[0]!.gebremst;
    });

  it('die Zurücksetzung bremst nach drei Anforderungen je Adresse', async () => {
    const email = `bremse-${zufall()}@cse.test`;
    expect(await reset(email), 'die erste geht durch').toBe(false);
    expect(await reset(email)).toBe(false);
    expect(await reset(email)).toBe(false);
    expect(await reset(email), 'die vierte nicht mehr').toBe(true);

    /* Eine ANDERE Adresse ist davon unberührt — gezählt wird je Kennung. */
    expect(await reset(`frei-${zufall()}@cse.test`, '10.0.0.10')).toBe(false);
  });

  /**
   * **Und sie sperrt kein Konto.** Die Bremse der Anmeldung tut das; auf einem
   * öffentlichen Weg ohne Kennwort wäre dasselbe eine Einladung, ein fremdes
   * Konto durch blosses Anfordern auszusperren.
   */
  it('die Zurücksetzung sperrt kein Konto', async () => {
    const konto = await legeKontoAn();
    for (let i = 0; i < 6; i += 1) await reset(konto.email);

    const [b] = await sql.unsafe<{ status: string; gesperrt_bis: string | null }[]>(
      `select status::text as status, gesperrt_bis::text from benutzer where id = $1::uuid`,
      [konto.id]);
    expect(b!.status, 'das Konto bleibt aktiv').toBe('aktiv');
    expect(b!.gesperrt_bis).toBeNull();

    /* Und die Anmeldung damit auch — sie ist ein anderer Weg. */
    expect((await anmelden(konto.email, KENNWORT, '10.0.0.11')).ergebnis).toBe('ok');
  });

  it('der zweite Faktor bremst nach acht Fehlversuchen — und dann auch den richtigen', async () => {
    const konto = await legeKontoAn();
    for (let i = 0; i < 8; i += 1) {
      expect(await faktor(konto.id, false), `Versuch ${String(i + 1)}`).toBe(false);
    }
    /* Der neunte trifft die Bremse — auch mit `erfolg = true`. */
    expect(await faktor(konto.id, true), 'auch ein richtiger Code wird abgewiesen').toBe(true);

    /* Ein anderes Konto rät unabhängig davon. */
    const anderes = await legeKontoAn();
    expect(await faktor(anderes.id, false)).toBe(false);
  });
});
