/**
 * PR 6 Akzeptanz (1)–(4) — 2FA, 404-statt-403, Sperre und das gefälschte Cookie.
 *
 * Alle vier sind Aussagen über die Datenbank und über das, was ein Angreifer
 * aus einer Antwort ablesen kann. Ein Mock bewiese, dass der Mock schweigt.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { alsApp, alsRolle, schliessen, seed, sql, type Fixtur } from './harness.js';
import { authorize, type Akteur } from '../../src/server/auth/authorize.js';
import {
  NichtAngemeldetFehler,
  NichtGefundenFehler,
  ZweiterFaktorFehler,
} from '../../src/server/auth/fehler.js';

let f: Fixtur;

const hash = (s: string): string => createHash('sha256').update(s).digest('hex');

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel],
  );
  return r!.id;
}

/** Legt ein Konto an. `faktor` hinterlegt einen zweiten Faktor. */
async function konto(opts: {
  email: string; name?: string; rolle?: string; faktor?: boolean;
  status?: string; personId?: string | null; dienstkonto?: boolean;
}): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [opts.email],
  );
  const id = u!.id;
  if (opts.faktor === true) {
    await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [id]);
  }
  await sql.unsafe(
    `insert into benutzer (id, email, name, globale_rolle_id, status, person_id, ist_dienstkonto)
     values ($1,$2,$3,$4,$5::benutzer_status,$6::uuid,$7)`,
    [id, opts.email, opts.name ?? opts.email, opts.rolle === undefined ? null : await rolleId(opts.rolle),
     opts.status ?? 'aktiv', opts.personId ?? null, opts.dienstkonto ?? false],
  );
  return id;
}

async function mitgliedschaft(benutzer: string, mandant: string, rolle: string): Promise<void> {
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id) values ($1,$2,$3)`,
    [benutzer, mandant, await rolleId(rolle)],
  );
}

/** Erzeugt eine Sitzung und gibt den ROHEN Token zurück. */
async function sitzung(
  benutzer: string,
  opts: { mandant?: string | null; ansicht?: string; aal?: string } = {},
): Promise<string> {
  const roh = randomBytes(32).toString('hex');
  await sql.unsafe(
    `insert into benutzer_sitzung (benutzer_id, token_hash, aktiver_mandant_id, ansicht, aal, ablauf_am)
     values ($1,$2,$3::uuid,$4::sitzung_ansicht,$5::sitzung_aal, now() + interval '8 hours')`,
    [benutzer, hash(roh), opts.mandant ?? null, opts.ansicht ?? 'mandant', opts.aal ?? 'aal1'],
  );
  return roh;
}

interface AufgeloesteSitzung {
  benutzer_id: string; person_id: string | null; aktiver_mandant_id: string | null;
  ansicht: string; aal: string; portal: string; sitzung_id: string;
}

async function aufloesen(token: string): Promise<AufgeloesteSitzung | undefined> {
  const zeilen = await sql.unsafe<AufgeloesteSitzung[]>(
    `select * from app.sitzung_aufloesen($1)`, [hash(token)],
  );
  return zeilen[0];
}

/** Der Prüfer, den `authorize` benutzt — dieselbe Funktion wie RLS. */
const pruefer = {
  async hatRecht(schluessel: string, mandantId: string | null): Promise<boolean> {
    const [z] = await sql.unsafe<{ hat: boolean }[]>(
      `select app.hat_recht($1, $2::uuid) hat`, [schluessel, mandantId],
    );
    return z!.hat;
  },
};

/** Ein Prüfer, der jedes Recht gewährt — für die Fälle, die NICHT das Recht testen. */
const alleRechte = { hatRecht: async (): Promise<boolean> => true };

beforeEach(async () => {
  // `seed()` leert `auth.users` und setzt die fünf Systemrollen neu.
  f = await seed();
  await sql.unsafe(`truncate auth.mfa_factors`);
});
afterAll(schliessen);

describe('(1) ein admin ohne zweiten Faktor wird an der API abgewiesen, nicht in der UI', () => {
  it('das Konto wird gar nicht erst aktiv (AUT-02, zweite Linie)', async () => {
    const [u] = await sql.unsafe<{ id: string }[]>(
      `insert into auth.users (email) values ('admin@cse.test') returning id`,
    );
    await expect(
      sql.unsafe(
        `insert into benutzer (id, email, name, globale_rolle_id, status)
         values ($1,'admin@cse.test','Admin',$2,'aktiv')`,
        [u!.id, await rolleId('super_admin')],
      ),
    ).rejects.toThrow(/zweiten Faktor/u);
  });

  it('und selbst mit hinterlegtem Faktor gilt eine aal1-SITZUNG nicht als super_admin', async () => {
    // Der zweite Faktor ist eine Eigenschaft der ANMELDUNG, nicht des Kontos.
    // Ein Konto, das ihn besitzt, ihn aber in dieser Sitzung nicht vorgezeigt
    // hat, ist aal1 — und aal1 ist nicht Super-Admin.
    const admin = await konto({ email: 'sa@cse.test', rolle: 'super_admin', faktor: true });
    for (const [aal, erwartet] of [['aal1', false], ['aal2', true]] as const) {
      const ist = await alsApp(
        { scope: 'gruppe', benutzerId: admin, portal: 'intern', readonly: true },
        async (tx) => {
          await tx.unsafe(`select set_config('app.aal',$1,true)`, [aal]);
          const zeilen = await tx.unsafe<{ ist: boolean }[]>(`select app.ist_super_admin() ist`);
          return zeilen[0]!.ist;
        },
      );
      expect(ist, aal).toBe(erwartet);
    }
  });

  it('authorize verweigert eine aal1-Sitzung auf einer 2FA-Ressource — mit 403, nicht 404', async () => {
    const akteur: Akteur = {
      benutzerId: 'b', personId: null, aktiverMandantId: f.reinigung,
      ansicht: 'mandant', aal: 'aal1', portal: 'intern', sitzungId: 's',
    };
    await expect(
      authorize(akteur, { recht: 'system.benutzer_verwalten', erfordert2fa: true }, alleRechte),
    ).rejects.toBeInstanceOf(ZweiterFaktorFehler);
    // Hier ist 403 richtig: die Existenz des eigenen Kontos ist bekannt, und
    // ein 404 hiesse "melde dich neu an" statt "zeig den zweiten Faktor".
    await expect(
      authorize({ ...akteur, aal: 'aal2' },
        { recht: 'system.benutzer_verwalten', erfordert2fa: true }, alleRechte),
    ).resolves.toMatchObject({ aal: 'aal2' });
  });
});

describe('(2) ein fremder Datensatz antwortet 404 — byte-gleich mit einem fehlenden', () => {
  const akteur: Akteur = {
    benutzerId: 'b', personId: null, aktiverMandantId: null,
    ansicht: 'mandant', aal: 'aal2', portal: 'intern', sitzungId: 's',
  };

  it('fremder Mandant: NichtGefunden, nicht Verboten', async () => {
    const meiner = { ...akteur, aktiverMandantId: f.reinigung };
    await expect(
      authorize(meiner, { recht: 'crm.lesen', mandantId: f.security }, alleRechte),
    ).rejects.toBeInstanceOf(NichtGefundenFehler);
  });

  it('fehlendes Recht: dieselbe Klasse, dieselbe Antwort', async () => {
    const meiner = { ...akteur, aktiverMandantId: f.reinigung };
    const fremd = await authorize(meiner, { recht: 'crm.lesen', mandantId: f.security }, alleRechte)
      .catch((e: unknown) => e);
    const ohneRecht = await authorize(meiner, { recht: 'crm.lesen' }, pruefer)
      .catch((e: unknown) => e);

    // DER Punkt von AUT-06: die zwei Fälle sind von aussen ununterscheidbar.
    // Wären sie es nicht, liesse sich durch Probieren fremder IDs auslesen,
    // welche existieren — der Statuscode wäre das Orakel.
    expect((fremd as NichtGefundenFehler).status).toBe(404);
    expect((ohneRecht as NichtGefundenFehler).status).toBe(404);
    expect((fremd as Error).message).toBe((ohneRecht as Error).message);
  });

  it('ohne Sitzung: 401 — hier wird nichts über eine Ressource verraten', async () => {
    await expect(authorize(null, { recht: 'crm.lesen' }, alleRechte))
      .rejects.toBeInstanceOf(NichtAngemeldetFehler);
  });

  it('ein Schreibzugriff ohne genau einen aktiven Mandanten ist 404 (Invariante 10)', async () => {
    const gruppe: Akteur = { ...akteur, ansicht: 'gruppe', aktiverMandantId: null };
    await expect(
      authorize(gruppe, { recht: 'crm.schreiben', schreibend: true }, alleRechte),
    ).rejects.toBeInstanceOf(NichtGefundenFehler);
  });
});

describe('(3) elf Fehlversuche sperren das Konto — und der zwölfte scheitert trotzdem', () => {
  it('zehn zählen, der elfte sperrt, der zwölfte scheitert mit richtigem Passwort', async () => {
    const b = await konto({ email: 'opfer@cse.test' });

    const ergebnisse: boolean[] = [];
    for (let i = 0; i < 11; i += 1) {
      const [z] = await alsRolle('cse_anon', (tx) => tx.unsafe<{ ok: boolean }[]>(
        `select app.versuch_protokollieren('opfer@cse.test','203.0.113.9',false,'passwort_falsch') ok`,
      )) as unknown as { ok: boolean }[];
      ergebnisse.push(z!.ok);
    }

    // Die ersten zehn dürfen weiterprobieren, der elfte nicht mehr.
    expect(ergebnisse.slice(0, 9).every((x) => x)).toBe(true);
    expect(ergebnisse.at(-1)).toBe(false);

    const [k] = await sql.unsafe<{ gesperrt_bis: Date | null; status: string }[]>(
      `select gesperrt_bis, status from benutzer where id = $1`, [b],
    );
    expect(k!.status).toBe('gesperrt');
    expect(k!.gesperrt_bis).not.toBeNull();

    // Der zwölfte, MIT richtigem Passwort: die Sitzung löst trotzdem nicht auf.
    const token = await sitzung(b, { mandant: null, ansicht: 'gruppe' });
    expect(await aufloesen(token)).toBeUndefined();
  });

  it('elf Zeilen in kern.anmeldeversuch, und die Kennung nur als Hash (AUT-08)', async () => {
    for (let i = 0; i < 11; i += 1) {
      await alsRolle('cse_anon', (tx) => tx.unsafe(
        `select app.versuch_protokollieren('spur@cse.test','203.0.113.10',false,'passwort_falsch')`,
      ));
    }
    const zeilen = await sql.unsafe<{ kennung_hash: string }[]>(
      `select kennung_hash from kern.anmeldeversuch where kennung_hash = $1`,
      [hash('spur@cse.test')],
    );
    expect(zeilen).toHaveLength(11);
    // Nie im Klartext — auch nicht für ein Konto, das es gar nicht gibt.
    const klartext = await sql.unsafe<unknown[]>(
      `select 1 from kern.anmeldeversuch where kennung_hash like '%spur@cse.test%'`,
    );
    expect(klartext).toHaveLength(0);
  });

  it('Versuche gegen ein NICHT existierendes Konto werden ebenso gebremst', async () => {
    // Genau der Enumerationsfall, für den AUT-07 existiert und den ein Zähler
    // je Benutzer nicht abdecken kann: das Konto gibt es nicht, also gibt es
    // auch keine Zeile, auf der ein Zähler stünde.
    let letzte = true;
    for (let i = 0; i < 11; i += 1) {
      const [z] = await alsRolle('cse_anon', (tx) => tx.unsafe<{ ok: boolean }[]>(
        `select app.versuch_protokollieren('gibtsnicht@cse.test','203.0.113.11',false,'unbekannt') ok`,
      )) as unknown as { ok: boolean }[];
      letzte = z!.ok;
    }
    expect(letzte).toBe(false);
  });

  it('cse_app kann kern.anmeldeversuch nicht direkt lesen — nur die Definer-Funktion', async () => {
    await expect(
      alsApp({ scope: 'gruppe', portal: 'intern', readonly: true },
        (tx) => tx.unsafe(`select * from kern.anmeldeversuch`)),
    ).rejects.toThrow(/permission denied|berechtigung/iu);
  });
});

describe('(4) ein gefälschtes Cookie mit fremdem Bereich wird abgewiesen', () => {
  it('die Sitzung lässt sich gar nicht erst auf einen fremden Mandanten setzen', async () => {
    const b = await konto({ email: 'nur-reinigung@cse.test' });
    await mitgliedschaft(b, f.reinigung, 'leitung');

    // Der eigene Bereich: geht.
    const token = await sitzung(b, { mandant: f.reinigung });
    expect((await aufloesen(token))?.aktiver_mandant_id).toBe(f.reinigung);

    // Der fremde: der Trigger wirft, bevor eine Zeile entsteht.
    await expect(sitzung(b, { mandant: f.security }))
      .rejects.toThrow(/keinen Zugang zu diesem Bereich/u);
  });

  it('und ein Wechsel auf einen fremden Bereich scheitert ebenso', async () => {
    const b = await konto({ email: 'wechsler@cse.test' });
    await mitgliedschaft(b, f.reinigung, 'leitung');
    const token = await sitzung(b, { mandant: f.reinigung });
    const s = (await aufloesen(token))!.sitzung_id;

    await expect(
      sql.unsafe(`update benutzer_sitzung set aktiver_mandant_id = $1 where id = $2`,
        [f.bau, s]),
    ).rejects.toThrow(/keinen Zugang/u);
  });

  it('ein erlaubter Wechsel landet im audit_log — ZWEIMAL, gespiegelt (TEN-09)', async () => {
    /**
     * §4.4 Schritt 6: zwei Spiegelzeilen, eine auf den alten Mandanten
     * gekeyt, eine auf den neuen.
     *
     * Der Grund steht daneben: ein Wechsel spannt per Definition ueber zwei
     * Gesellschaften, und eine einzelne Zeile ist in der Pruefspur der
     * ANDEREN unsichtbar. Bis 0018 schrieb der Ausloeser nur die neue Seite —
     * beim Eintritt in die Gruppenansicht ist die NULL, und in der
     * verlassenen Gesellschaft stand dann gar nichts.
     */
    const b = await konto({ email: 'zwei@cse.test' });
    await mitgliedschaft(b, f.reinigung, 'leitung');
    await mitgliedschaft(b, f.security, 'leitung');
    const token = await sitzung(b, { mandant: f.reinigung });
    const s = (await aufloesen(token))!.sitzung_id;

    await sql.unsafe(`update benutzer_sitzung set aktiver_mandant_id = $1 where id = $2`,
      [f.security, s]);

    const zeilen = await sql.unsafe<{
      aktion: string; mandant_id: string | null;
      vorher: Record<string, unknown>; nachher: Record<string, unknown>;
    }[]>(
      `select aktion, mandant_id, vorher, nachher from audit_log
        where objekt_typ = 'benutzer_sitzung' and objekt_id = $1
        order by mandant_id`,
      [s],
    );
    expect(zeilen).toHaveLength(2);
    expect(zeilen.map((z) => z.aktion)).toEqual(
      ['sitzung.mandant_gewechselt', 'sitzung.mandant_gewechselt'],
    );
    expect([...zeilen.map((z) => z.mandant_id)].sort())
      .toEqual([f.reinigung, f.security].sort());
    // Das Paar reist IN vorher/nachher — audit_log führt dafür keine eigenen
    // Spalten mandant_id_alt/neu (K-21).
    for (const z of zeilen) {
      expect(z.vorher['mandant_id']).toBe(f.reinigung);
      expect(z.nachher['mandant_id']).toBe(f.security);
    }
  });

  it('der Eintritt in die Gruppenansicht heisst so — und protokolliert die verlassene Seite',
    async () => {
      // §4.4: "Group entry sets ansicht = 'gruppe', aktiver_mandant_id = NULL,
      // and is audited as sitzung.gruppenansicht_geoeffnet." Ein anderer Name
      // waere nicht kosmetisch: es wird kein Mandant aktiv, es wird einer
      // aufgegeben.
      const b = await konto({ email: 'gruppe-eintritt@cse.test' });
      await mitgliedschaft(b, f.reinigung, 'leitung');
      await mitgliedschaft(b, f.security, 'leitung');
      const token = await sitzung(b, { mandant: f.reinigung });
      const s = (await aufloesen(token))!.sitzung_id;

      await sql.unsafe(
        `update benutzer_sitzung
            set aktiver_mandant_id = null, ansicht = 'gruppe' where id = $1`, [s],
      );

      const zeilen = await sql.unsafe<{ aktion: string; mandant_id: string | null }[]>(
        `select aktion, mandant_id from audit_log
          where objekt_typ = 'benutzer_sitzung' and objekt_id = $1`, [s],
      );
      /**
       * EINE Zeile, nicht zwei: es gibt keine zweite Seite. Der Wechsel gibt
       * einen Bereich auf und betritt keinen.
       *
       * Eine Zeile mit `p_mandant = null` waere hier auch keine
       * Plattformzeile: `app.protokolliere` faellt auf
       * `app.aktiver_mandant()` zurueck, und im Anwendungspfad ist der beim
       * Auditzeitpunkt noch der ALTE. Es stuenden dann zwei gleiche Eintraege
       * in derselben Gesellschaft.
       */
      expect(zeilen).toHaveLength(1);
      expect(zeilen[0]!.aktion).toBe('sitzung.gruppenansicht_geoeffnet');
      expect(zeilen[0]!.mandant_id).toBe(f.reinigung);
    });

  it('ein Dienstkonto meldet sich nie interaktiv an', async () => {
    const dienst = await konto({ email: 'jobs@cse.test', dienstkonto: true });
    const token = await sitzung(dienst, { mandant: null, ansicht: 'gruppe' });
    expect(await aufloesen(token)).toBeUndefined();
  });

  it('eine abgelaufene, eine beendete und eine unbekannte Sitzung: alle drei null Zeilen', async () => {
    const b = await konto({ email: 'abgelaufen@cse.test' });
    const t1 = await sitzung(b, { mandant: null, ansicht: 'gruppe' });
    await sql.unsafe(`update benutzer_sitzung set ablauf_am = now() - interval '1 hour'
                       where token_hash = $1`, [hash(t1)]);
    expect(await aufloesen(t1)).toBeUndefined();

    const t2 = await sitzung(b, { mandant: null, ansicht: 'gruppe' });
    await sql.unsafe(`update benutzer_sitzung set beendet_am = now(), ende_grund = 'abmeldung'
                       where token_hash = $1`, [hash(t2)]);
    expect(await aufloesen(t2)).toBeUndefined();

    expect(await aufloesen('unbekannt')).toBeUndefined();
  });

  it('das Portal kommt aus der ROLLE, nicht aus dem Cookie (K-04)', async () => {
    const arbeiter = await konto({ email: 'arbeiter@cse.test' });
    await mitgliedschaft(arbeiter, f.reinigung, 'mitarbeiter');
    const t = await sitzung(arbeiter, { mandant: f.reinigung });
    expect((await aufloesen(t))?.portal).toBe('mitarbeiter');

    const leitung = await konto({ email: 'chef@cse.test' });
    await mitgliedschaft(leitung, f.reinigung, 'leitung');
    const t2 = await sitzung(leitung, { mandant: f.reinigung });
    expect((await aufloesen(t2))?.portal).toBe('intern');
  });

  it('eine mandantenübergreifende Ansicht hat per Konstruktion keinen aktiven Mandanten', async () => {
    const b = await konto({ email: 'gruppe@cse.test' });
    await mitgliedschaft(b, f.reinigung, 'leitung');
    // Der CHECK lässt die Kombination gar nicht zu — nicht nur die
    // Gruppenansicht, sondern jede der drei (K-18, Invariante 10).
    await expect(sitzung(b, { mandant: f.reinigung, ansicht: 'gruppe' }))
      .rejects.toThrow(/sitzung_ansicht_stimmig/u);
  });
});
