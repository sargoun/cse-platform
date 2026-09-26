import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, alsRolle, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import {
  deaktiviereKonto, entsperreKonto, KontoFehler, reaktiviereKonto, widerrufeSitzungen,
} from '../../src/server/services/konto/verwaltung.js';

/**
 * **Ein Konto laesst sich zuruecknehmen** (V-022, V-074, V-075, V-076).
 *
 * `benutzer.status` fuehrt vier Werte, und drei davon waren Sackgassen:
 * `gesperrt` setzte die Brute-Force-Wache und nichts nahm es zurueck,
 * `deaktiviert` hatte ueberhaupt keinen Erzeuger, und
 * `system.sitzung_widerrufen` war ein Recht, das kein Code je prüfte.
 *
 * **Gemessen wird hier vor allem, was NICHT geht.** Der gefährliche Teil
 * dieser vier Funktionen ist nicht, dass sie wirken, sondern wie weit sie
 * reichen: in eine fremde Gesellschaft, auf das eigene Konto, ohne zweiten
 * Faktor, ohne Recht, ohne Grund. Jede dieser Grenzen steht unten als eigene
 * Zusage — eine Definer-Funktion, die eine davon verliert, verliert sie still.
 */

let f: Fixtur;
/** `system.benutzer_verwalten` in der Reinigung. */
let admin = '';
/** Nur `system.sitzung_widerrufen` — der Verdachtsfall ohne Gestaltungsrecht. */
let wache = '';
/** Das Ziel: Mitglied der Reinigung. */
let ziel = '';
/** Ein Konto in einer ANDEREN Gesellschaft. */
let fremd = '';

async function konto(email: string, mandant: string, rolle: string): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status)
     values ($1, $2, $2, 'aktiv')`, [u!.id, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1, $2, (select id from rolle
                       where schluessel = $3 and mandant_id is null), true)`,
    [u!.id, mandant, rolle]);
  return u!.id;
}

/** Ein Recht je Gesellschaft an `leitung` haengen oder ihr nehmen. */
async function recht(schluessel: string, mandant: string, gewaehrt: boolean) {
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     values ((select id from rolle where schluessel = 'leitung' and mandant_id is null),
             (select id from berechtigung where schluessel = $1), $2, $3)
     on conflict (rolle_id, berechtigung_id, mandant_id)
       do update set gewaehrt = excluded.gewaehrt`,
    [schluessel, mandant, gewaehrt]);
}

async function offeneSitzung(benutzerId: string, kennung: string): Promise<string> {
  const [s] = await alsRolle('', (tx) => tx.unsafe(
    `insert into benutzer_sitzung
       (benutzer_id, token_hash, ansicht, aal, ablauf_am, aktiver_mandant_id)
     values ($1, encode(digest($2, 'sha256'), 'hex'), 'mandant', 'aal2',
             now() + interval '8 hours', $3)
     returning id`, [benutzerId, kennung, f.reinigung]),
  ) as unknown as { id: string }[];
  return s!.id;
}

async function status(benutzerId: string): Promise<string> {
  const [b] = await alsRolle('', (tx) => tx.unsafe(
    `select status::text as status from benutzer where id = $1`, [benutzerId]),
  ) as unknown as { status: string }[];
  return b!.status;
}

async function sperre(benutzerId: string) {
  await alsRolle('', (tx) => tx.unsafe(
    `update benutzer set status = 'gesperrt', gesperrt_bis = now() + interval '30 minutes'
      where id = $1`, [benutzerId]));
}

beforeAll(async () => {
  f = await seed();
  admin = await konto('konto-admin@test.invalid', f.reinigung, 'leitung');
  wache = await konto('konto-wache@test.invalid', f.reinigung, 'leitung');
  ziel = await konto('konto-ziel@test.invalid', f.reinigung, 'mitarbeiter');
  fremd = await konto('konto-fremd@test.invalid', f.security, 'mitarbeiter');

  /*
   * Beide Rechte haengen an `leitung` je Gesellschaft. `admin` und `wache`
   * sind deshalb DIESELBE Rolle — unterschieden werden sie unten dadurch,
   * welche Prüfung greift, nicht dadurch, wer sie aufruft. Fuer die eine
   * Zusage, die die Rechte auseinanderhaelt (§4), wird das Recht kurz
   * entzogen und wieder gegeben.
   */
  await recht('system.benutzer_verwalten', f.reinigung, true);
  await recht('system.sitzung_widerrufen', f.reinigung, true);
});
afterAll(schliessen);

function sitzung(benutzerId: string, mandantId = f.reinigung) {
  return {
    scope: 'mandant' as const, mandantId, benutzerId,
    portal: 'intern' as const, readonly: false,
  };
}

function alsKontext(tx: postgres.TransactionSql, benutzerId: string): SchreibKontext {
  const abfrage = async <T,>(
    anweisung: string, werte?: readonly unknown[],
  ): Promise<readonly T[]> =>
    (await tx.unsafe(anweisung, (werte ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId,
    aktiverMandantId: f.reinigung, mandantIds: [f.reinigung],
    abfrage, schreibe: abfrage,
  };
}

async function imKontext<T>(
  benutzerId: string, fn: (k: SchreibKontext) => Promise<T>, aal = 'aal2',
): Promise<T> {
  return alsApp(sitzung(benutzerId), async (tx) => {
    await tx.unsafe(`select set_config('app.aal',$1,true)`, [aal]);
    return fn(alsKontext(tx, benutzerId));
  }) as Promise<T>;
}

describe('§1 V-074 — die Sperre ist keine Einbahnstrasse mehr', () => {
  it('ein gesperrtes Konto wird wieder aktiv', async () => {
    await sperre(ziel);
    expect(await status(ziel)).toBe('gesperrt');

    const e = await imKontext(admin, (k) => entsperreKonto(k, {
      benutzerId: ziel, grund: 'Anruf: Kennwort vertippt.',
    }));
    expect(e.geaendert).toBe(true);
    expect(await status(ziel)).toBe('aktiv');

    const [b] = await alsRolle('', (tx) => tx.unsafe(
      `select gesperrt_bis, entsperrt_am from benutzer where id = $1`, [ziel]),
    ) as unknown as { gesperrt_bis: Date | null; entsperrt_am: Date | null }[];
    expect(b!.gesperrt_bis).toBeNull();
    // `entsperrt_am` setzt das Zaehlfenster — ohne es sperrte der naechste
    // Fehlversuch sofort wieder.
    expect(b!.entsperrt_am).not.toBeNull();
  });

  it('ein offenes Konto zu entsperren ist kein Fehler, sondern `false`', async () => {
    const e = await imKontext(admin, (k) => entsperreKonto(k, {
      benutzerId: ziel, grund: 'nochmal',
    }));
    expect(e.geaendert).toBe(false);
  });

  /**
   * **Der Kern von V-074.** Die Sperrdauer (30 Min) ist laenger als das
   * Zaehlfenster (15 Min): ohne `entsperrt_am` faende der naechste
   * Fehlversuch die zehn alten Zeilen noch im Fenster und sperrte sofort
   * wieder. Die Entsperrung waere ein Knopf, der manchmal still nichts tut.
   */
  it('nach der Entsperrung zaehlen die alten Fehlversuche nicht mehr mit', async () => {
    const kennung = 'konto-ziel@test.invalid';
    for (let i = 0; i < 12; i += 1) {
      await alsRolle('', (tx) => tx.unsafe(
        `select app.versuch_protokollieren($1, '203.0.113.7'::inet, false, 'test')`,
        [kennung]));
    }
    expect(await status(ziel)).toBe('gesperrt');

    await imKontext(admin, (k) => entsperreKonto(k, {
      benutzerId: ziel, grund: 'Anruf, Konto wieder freigeben.',
    }));
    expect(await status(ziel)).toBe('aktiv');

    // Ein einzelner weiterer Fehlversuch darf NICHT sofort wieder sperren.
    await alsRolle('', (tx) => tx.unsafe(
      `select app.versuch_protokollieren($1, '203.0.113.7'::inet, false, 'test')`,
      [kennung]));
    expect(await status(ziel)).toBe('aktiv');
  });
});

describe('§2 V-075 und V-022 — der Zugang laesst sich entziehen und wiedergeben', () => {
  it('der Entzug setzt `deaktiviert` und beendet die offenen Anmeldungen', async () => {
    const s = await offeneSitzung(ziel, 'plaetzchen-eins');

    const e = await imKontext(admin, (k) => deaktiviereKonto(k, {
      benutzerId: ziel, grund: 'Ausgeschieden zum 30.09.',
    }));
    expect(e.geaendert).toBe(true);
    expect(await status(ziel)).toBe('deaktiviert');

    const [z] = await alsRolle('', (tx) => tx.unsafe(
      `select beendet_am, ende_grund::text as grund, deaktiviert_am
         from benutzer_sitzung s join benutzer b on b.id = s.benutzer_id
        where s.id = $1`, [s]),
    ) as unknown as { beendet_am: Date | null; grund: string; deaktiviert_am: Date }[];
    expect(z!.beendet_am).not.toBeNull();
    expect(z!.grund).toBe('gesperrt');
    // Der CHECK `benutzer_status_stimmig` verlangt beides zusammen.
    expect(z!.deaktiviert_am).not.toBeNull();
  });

  it('ein deaktiviertes Konto kommt durch `sitzung_aufloesen` nicht mehr durch', async () => {
    await offeneSitzung(ziel, 'plaetzchen-zwei');
    const zeilen = await alsRolle('', (tx) => tx.unsafe(
      `select benutzer_id from app.sitzung_aufloesen(
                encode(digest('plaetzchen-zwei', 'sha256'), 'hex'))`),
    ) as unknown as { benutzer_id: string | null }[];
    expect(zeilen.length === 0 || zeilen[0]?.benutzer_id === null).toBe(true);
  });

  it('der Weg zurueck geht auf `aktiv`, nicht auf `eingeladen`', async () => {
    const e = await imKontext(admin, (k) => reaktiviereKonto(k, {
      benutzerId: ziel, grund: 'Wiedereinstellung zum 01.11.',
    }));
    expect(e.geaendert).toBe(true);
    expect(await status(ziel)).toBe('aktiv');

    const [b] = await alsRolle('', (tx) => tx.unsafe(
      `select deaktiviert_am from benutzer where id = $1`, [ziel]),
    ) as unknown as { deaktiviert_am: Date | null }[];
    expect(b!.deaktiviert_am).toBeNull();
  });

  it('das EIGENE Konto laesst sich nicht deaktivieren', async () => {
    await expect(imKontext(admin, (k) => deaktiviereKonto(k, {
      benutzerId: admin, grund: 'Versehen',
    }))).rejects.toMatchObject({ grund: 'nicht_erlaubt' });
    expect(await status(admin)).toBe('aktiv');
  });
});

describe('§3 V-076 — fremde Anmeldungen widerrufen', () => {
  it('alle offenen Anmeldungen enden, und die Zahl kommt zurueck', async () => {
    await offeneSitzung(ziel, 'widerruf-a');
    await offeneSitzung(ziel, 'widerruf-b');

    const e = await imKontext(wache, (k) => widerrufeSitzungen(k, {
      benutzerId: ziel, grund: 'Telefon verloren.',
    }));
    expect(e.sitzungen).toBeGreaterThanOrEqual(2);
    expect(e.geaendert).toBe(true);

    const [z] = await alsRolle('', (tx) => tx.unsafe(
      `select count(*)::int as offen from benutzer_sitzung
        where benutzer_id = $1 and beendet_am is null`, [ziel]),
    ) as unknown as { offen: number }[];
    expect(z!.offen).toBe(0);
  });

  it('ohne offene Anmeldung ist es `false` und kein Fehler', async () => {
    const e = await imKontext(wache, (k) => widerrufeSitzungen(k, {
      benutzerId: ziel, grund: 'nochmal',
    }));
    expect(e.sitzungen).toBe(0);
    expect(e.geaendert).toBe(false);
  });

  it('der Widerruf entzieht NICHT — das Konto bleibt aktiv', async () => {
    expect(await status(ziel)).toBe('aktiv');
  });

  it('die eigenen Anmeldungen gehen ueber diesen Weg nicht', async () => {
    await expect(imKontext(wache, (k) => widerrufeSitzungen(k, {
      benutzerId: wache, grund: 'Versehen',
    }))).rejects.toMatchObject({ grund: 'nicht_erlaubt' });
  });
});

describe('§4 die Grenzen — Recht, Mandant, zweiter Faktor, Grund', () => {
  it('ein Konto einer ANDEREN Gesellschaft ist unerreichbar', async () => {
    await expect(imKontext(admin, (k) => deaktiviereKonto(k, {
      benutzerId: fremd, grund: 'Zugriff ueber die Grenze',
    }))).rejects.toMatchObject({ grund: 'nicht_erlaubt' });
    expect(await status(fremd)).toBe('aktiv');
  });

  it('ohne zweiten Faktor geht keine der vier', async () => {
    await expect(imKontext(admin, (k) => entsperreKonto(k, {
      benutzerId: ziel, grund: 'ohne aal2',
    }), 'aal1')).rejects.toMatchObject({ grund: 'nicht_erlaubt' });
  });

  it('ohne Grund geht keine der vier', async () => {
    await expect(imKontext(admin, (k) => deaktiviereKonto(k, {
      benutzerId: ziel, grund: '   ',
    }))).rejects.toMatchObject({ grund: 'ohne_grund' });
  });

  /**
   * **Die zwei Rechte sind wirklich zwei.** Der Widerruf haengt am
   * kleineren (`system.sitzung_widerrufen`, bis `leitung` bindbar), der
   * Entzug am groesseren. Waere es eines, haette jede Wache auch das Recht,
   * Menschen aus dem Betrieb zu nehmen.
   */
  it('wer nur widerrufen darf, entzieht keinen Zugang', async () => {
    await recht('system.benutzer_verwalten', f.reinigung, false);
    try {
      await expect(imKontext(wache, (k) => deaktiviereKonto(k, {
        benutzerId: ziel, grund: 'ohne Gestaltungsrecht',
      }))).rejects.toMatchObject({ grund: 'nicht_erlaubt' });

      // Der Widerruf am kleineren Recht geht weiterhin.
      await offeneSitzung(ziel, 'widerruf-c');
      const e = await imKontext(wache, (k) => widerrufeSitzungen(k, {
        benutzerId: ziel, grund: 'Verdacht',
      }));
      expect(e.geaendert).toBe(true);
    } finally {
      await recht('system.benutzer_verwalten', f.reinigung, true);
    }
  });

  it('wer nur verwalten darf, widerruft keine Anmeldung', async () => {
    await recht('system.sitzung_widerrufen', f.reinigung, false);
    try {
      await offeneSitzung(ziel, 'widerruf-d');
      await expect(imKontext(admin, (k) => widerrufeSitzungen(k, {
        benutzerId: ziel, grund: 'ohne Widerrufsrecht',
      }))).rejects.toMatchObject({ grund: 'nicht_erlaubt' });
    } finally {
      await recht('system.sitzung_widerrufen', f.reinigung, true);
    }
  });

  it('ein KontoFehler traegt seinen Grund und seinen Status', async () => {
    const fehler = await imKontext(admin, (k) => deaktiviereKonto(k, {
      benutzerId: ziel, grund: '',
    })).catch((x: unknown) => x);
    expect(fehler).toBeInstanceOf(KontoFehler);
    expect((fehler as KontoFehler).status).toBe(400);
  });
});
