/**
 * Aufgaben gegen echte Rechte und echte Policies (OPS-11, DSH-01, SPEC §14,
 * Invariante 3, Invariante 8).
 *
 * **Die Sätze, die diese Datei beweist:**
 *
 *  1. Eine Aufgabe der Reinigung ist im Bau nicht sichtbar — auch nicht für
 *     eine Leitung mit allen Rechten (Invariante 3).
 *  2. Ohne `aufgabe.lesen` ist die Liste LEER, nicht fehlerhaft.
 *  3. Ein Mitarbeiterkonto sieht seine eigene Aufgabe und die seines Teams —
 *     und keine fremde (`t_aufgabe_eigene` + `p_zustaendig`).
 *  4. Der Kundenzugang sieht nichts (`p_aufgabe_kunde_decke`).
 *  5. Ein Wächter, der zweimal denselben gegenstandslosen Befund meldet,
 *     erzeugt EINE Aufgabe — das ist die `NULLS NOT DISTINCT`-Zusage, und sie
 *     ist der Grund, warum dieser Index so geschrieben ist.
 *  6. Erledigt und abgebrochen brauchen ihren Beleg; gelöscht wird nie.
 *  7. Die Gruppenansicht liest und schreibt nicht (Invariante 10).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';

let f: Fixtur;
const zufall = (): string => Math.random().toString(36).slice(2, 10);

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

/** Entzieht einer Rolle ein Recht in genau einem Bereich. */
async function entziehe(rolle: string, recht: string, mandant: string): Promise<void> {
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     select $1, b.id, $2, false from berechtigung b where b.schluessel = $3`,
    [await rolleId(rolle), mandant, recht]);
}

async function legeKontoAn(
  mandantId: string, rolle = 'leitung', personId: string | null = null,
): Promise<string> {
  const email = `auf-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, person_id)
     values ($1, $2, $3, 'aktiv', $4)`,
    [u!.id, email, rolle === 'leitung' ? 'Leitung' : 'Konto', personId]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1, $2, (select id from rolle where schluessel = $3 and mandant_id is null), true)`,
    [u!.id, mandantId, rolle]);
  return u!.id;
}

/** Eine Aufgabe, als Eigentümer geschrieben — der Weg, den der Dienst nimmt. */
async function legeAufgabeAn(
  mandantId: string, titel: string,
  z: {
    zugewiesenAn?: string | null; teamId?: string | null; erstelltVon?: string | null;
    quelle?: string; quelleJob?: string | null; faelligDatum?: string | null;
  } = {},
): Promise<string> {
  const [a] = await sql.unsafe<{ id: string }[]>(
    `insert into aufgabe (mandant_id, titel, zugewiesen_an, zugewiesen_team_id,
                          erstellt_von, quelle, quelle_job, faellig_datum)
     values ($1::uuid, $2, $3::uuid, $4::uuid, $5::uuid, coalesce($6::ausloeser, 'mensch'),
             $7, $8::date)
     returning id`,
    [mandantId, titel, z.zugewiesenAn ?? null, z.teamId ?? null, z.erstelltVon ?? null,
     z.quelle ?? null, z.quelleJob ?? null, z.faelligDatum ?? null]);
  return a!.id;
}

async function legeTeamAn(mandantId: string, name: string): Promise<string> {
  const [t] = await sql.unsafe<{ id: string }[]>(
    `insert into team (mandant_id, name) values ($1::uuid, $2) returning id`,
    [mandantId, name]);
  return t!.id;
}

async function mitgliedschaft(
  mandantId: string, teamId: string, anstellungId: string, personId: string,
): Promise<void> {
  await sql.unsafe(
    `insert into team_mitglied (mandant_id, team_id, anstellung_id, person_id)
     values ($1::uuid, $2::uuid, $3::uuid, $4::uuid)`,
    [mandantId, teamId, anstellungId, personId]);
}

async function titelIm(
  scope: 'mandant' | 'gruppe' | 'person' | 'kunde',
  z: {
    mandantId?: string; mandantIds?: readonly string[];
    benutzerId?: string; personId?: string;
    portal?: 'intern' | 'mitarbeiter' | 'kunde';
  },
): Promise<readonly string[]> {
  const zeilen = await alsApp(
    { scope, readonly: true, ...z },
    async (tx: postgres.TransactionSql) =>
      tx.unsafe(`select titel from aufgabe where geloescht_am is null order by titel`),
  ) as readonly { titel: string }[];
  return zeilen.map((r) => r.titel);
}

beforeEach(async () => { f = await seed(); });
afterAll(schliessen);

describe('(1) die Mandantengrenze gilt auch für Aufgaben', () => {
  it('eine Aufgabe der Reinigung erscheint nicht im Bau', async () => {
    const wR = await legeKontoAn(f.reinigung);
    const wB = await legeKontoAn(f.bau);
    await legeAufgabeAn(f.reinigung, 'Schlüssel nachbestellen');

    expect(await titelIm('mandant',
      { mandantId: f.reinigung, benutzerId: wR, portal: 'intern' }))
      .toContain('Schlüssel nachbestellen');
    expect(await titelIm('mandant',
      { mandantId: f.bau, benutzerId: wB, portal: 'intern' }))
      .not.toContain('Schlüssel nachbestellen');
  });
});

describe('(2) ohne Aufgabenrecht ist die Liste leer statt fehlerhaft', () => {
  /**
   * **`aufgabe.schreiben` öffnet das Lesen mit — und das ist Absicht.**
   *
   * `t_aufgabe_schreiben` ist `for all`, und die `USING`-Bedingung einer
   * `for all`-Policy gilt auch für `select`. Wer eine Aufgabe bearbeiten darf,
   * darf sie ansehen; das Gegenteil wäre ein Bildschirm, auf dem man einen
   * Zustand setzen kann, den man nicht sieht. Dasselbe Paar steht auf
   * `kalender_eintrag` (0160).
   *
   * Die Prüfung nennt das ausdrücklich, statt es zu übersehen: entzogen
   * werden BEIDE Rechte, und erst dann ist die Liste leer. Eine Prüfung, die
   * nur `lesen` entzieht und Leere erwartet, wäre grün geworden, wenn jemand
   * die Schreibpolicy versehentlich zu weit gefasst hätte.
   */
  it('mit `aufgabe.schreiben` und ohne `aufgabe.lesen` bleibt sie sichtbar', async () => {
    const w = await legeKontoAn(f.reinigung);
    await legeAufgabeAn(f.reinigung, 'Revierbegehung planen');
    await entziehe('leitung', 'aufgabe.lesen', f.reinigung);

    expect(await titelIm('mandant',
      { mandantId: f.reinigung, benutzerId: w, portal: 'intern' }))
      .toEqual(['Revierbegehung planen']);
  });

  it('ohne beide Rechte sieht eine Leitung keine Aufgabe — und keinen Fehler', async () => {
    const w = await legeKontoAn(f.reinigung);
    await legeAufgabeAn(f.reinigung, 'Revierbegehung planen');
    await entziehe('leitung', 'aufgabe.lesen', f.reinigung);
    await entziehe('leitung', 'aufgabe.schreiben', f.reinigung);

    const titel = await titelIm('mandant',
      { mandantId: f.reinigung, benutzerId: w, portal: 'intern' });
    // Leer, nicht "permission denied": RLS antwortet mit null Zeilen, und das
    // ist von "gibt es nicht" ununterscheidbar (AUT-06).
    expect(titel).toEqual([]);
  });

  it('und die eigene Aufgabe bleibt trotzdem sichtbar (`t_aufgabe_eigene`)', async () => {
    const w = await legeKontoAn(f.reinigung);
    await legeAufgabeAn(f.reinigung, 'Fremde Aufgabe');
    await legeAufgabeAn(f.reinigung, 'Meine Aufgabe', { zugewiesenAn: w });
    await entziehe('leitung', 'aufgabe.lesen', f.reinigung);
    await entziehe('leitung', 'aufgabe.schreiben', f.reinigung);

    // Ein Recht davor hiesse, dass jemandem etwas zugewiesen wird, das er
    // nicht ansehen darf.
    expect(await titelIm('mandant',
      { mandantId: f.reinigung, benutzerId: w, portal: 'intern' }))
      .toEqual(['Meine Aufgabe']);
  });
});

describe('(3) das Mitarbeiterportal sieht das EIGENE', () => {
  it('die eigene Aufgabe ja, die fremde nein — ohne Modulrecht', async () => {
    const chef = await legeKontoAn(f.reinigung);
    const ich = await legeKontoAn(f.reinigung, 'mitarbeiter', f.fatima);
    const andere = await legeKontoAn(f.reinigung, 'mitarbeiter');

    await legeAufgabeAn(f.reinigung, 'Meine Aufgabe', { zugewiesenAn: ich });
    await legeAufgabeAn(f.reinigung, 'Fremde Aufgabe', { zugewiesenAn: andere });
    await legeAufgabeAn(f.reinigung, 'Chefsache', { erstelltVon: chef });

    const titel = await titelIm('person', {
      mandantIds: [f.reinigung], benutzerId: ich, personId: f.fatima,
    });
    expect(titel).toEqual(['Meine Aufgabe']);
  });

  it('eine TEAMaufgabe erreicht jedes Mitglied — über `team_mitglied`', async () => {
    const ich = await legeKontoAn(f.reinigung, 'mitarbeiter', f.fatima);
    const team = await legeTeamAn(f.reinigung, `Nordteam ${zufall()}`);
    await mitgliedschaft(f.reinigung, team, f.fatimaReinigung, f.fatima);
    await legeAufgabeAn(f.reinigung, 'Teamaufgabe', { teamId: team });

    /*
     * Der eigentliche Punkt: die Decke `p_zustaendig` fragt nach den Teams
     * DIESER Person, und dafür muss `team_mitglied` im Mitarbeiterportal
     * lesbar sein (`t_tm_eigene`). Fehlte diese Policy, liefe die
     * Unterabfrage auf die leere Menge — und eine Teamaufgabe erreichte
     * niemanden ausser der Leitung.
     */
    expect(await titelIm('person', {
      mandantIds: [f.reinigung], benutzerId: ich, personId: f.fatima,
    })).toEqual(['Teamaufgabe']);
  });

  it('das Team einer FREMDEN Person öffnet nichts', async () => {
    const jonas = await legeKontoAn(f.reinigung, 'mitarbeiter', f.jonas);
    const team = await legeTeamAn(f.reinigung, `Südteam ${zufall()}`);
    await mitgliedschaft(f.reinigung, team, f.fatimaReinigung, f.fatima);
    await legeAufgabeAn(f.reinigung, 'Nur für Fatimas Team', { teamId: team });

    expect(await titelIm('person', {
      mandantIds: [f.reinigung], benutzerId: jonas, personId: f.jonas,
    })).toEqual([]);
  });

  /**
   * **Ein Mitarbeiterkonto ERLEDIGT seine Aufgabe — schreibend.**
   *
   * Der Satz, der hier fehlte und deshalb einen Defekt verdeckte: alle
   * Mitarbeiterfälle darüber laufen mit `readonly: true`, prüfen also nur das
   * Lesen. `p_aufgabe_kunde_decke` trug einmal `with check (app.portal() =
   * 'intern')`, und weil eine restriktive WITH-CHECK-Bedingung bei JEDEM
   * Schreibvorgang wahr sein muss, wies sie jedes Erledigen durch ein
   * Mitarbeiterkonto ab — obwohl 03-AUTH-BERECHTIGUNGEN.md:2441 der Rolle
   * `mitarbeiter` genau `aufgabe.schreiben` gibt. Kein Lesetest hätte das je
   * gesehen.
   */
  it('und erledigt sie auch — `aufgabe.schreiben` gilt für das Portal', async () => {
    const ich = await legeKontoAn(f.reinigung, 'mitarbeiter', f.fatima);
    const id = await legeAufgabeAn(f.reinigung, 'Fenster im 2. OG', { zugewiesenAn: ich });

    await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, mandantIds: [f.reinigung],
        benutzerId: ich, personId: f.fatima, portal: 'mitarbeiter', readonly: false },
      async (tx: postgres.TransactionSql) => tx.unsafe(
        `update aufgabe set status = 'erledigt', erledigt_am = now(), erledigt_von = $2::uuid
          where id = $1::uuid`, [id, ich] as never[]),
    );

    const [z] = await sql.unsafe<{ status: string }[]>(
      `select status::text from aufgabe where id = $1`, [id]);
    expect(z!.status).toBe('erledigt');
  });

  it('eine FREMDE Aufgabe erledigt es nicht (`p_zustaendig` als WITH CHECK)', async () => {
    const ich = await legeKontoAn(f.reinigung, 'mitarbeiter', f.fatima);
    const andere = await legeKontoAn(f.reinigung, 'mitarbeiter');
    const id = await legeAufgabeAn(f.reinigung, 'Nicht meine', { zugewiesenAn: andere });

    // Die Decke bleibt eine Decke: `<> 'kunde'` öffnet das Portal, verengt
    // aber nichts — das leistet `p_zustaendig`, dessen USING bei einer
    // `for all`-Policy ohne eigenes WITH CHECK auch als WITH CHECK gilt.
    const betroffen = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, mandantIds: [f.reinigung],
        benutzerId: ich, personId: f.fatima, portal: 'mitarbeiter', readonly: false },
      async (tx: postgres.TransactionSql) => tx.unsafe(
        `update aufgabe set status = 'in_arbeit' where id = $1::uuid returning id`,
        [id] as never[]),
    ) as readonly unknown[];
    expect(betroffen).toHaveLength(0);

    const [z] = await sql.unsafe<{ status: string }[]>(
      `select status::text from aufgabe where id = $1`, [id]);
    expect(z!.status).toBe('offen');
  });

  it('die eigene Mitgliedschaft ja, die fremde nein (`p_tm_ma_decke`)', async () => {
    const ich = await legeKontoAn(f.reinigung, 'mitarbeiter', f.fatima);
    const team = await legeTeamAn(f.reinigung, `Team ${zufall()}`);
    await mitgliedschaft(f.reinigung, team, f.fatimaReinigung, f.fatima);
    await mitgliedschaft(f.reinigung, team, f.jonasReinigung, f.jonas);

    const zeilen = await alsApp(
      { scope: 'person', mandantIds: [f.reinigung], benutzerId: ich, personId: f.fatima,
        readonly: true },
      async (tx: postgres.TransactionSql) =>
        tx.unsafe(`select person_id from team_mitglied`),
    ) as readonly { person_id: string }[];
    // Eine Teamzeile trägt eine `anstellung_id`, und darunter liegt der Lohn.
    expect(zeilen.map((z) => z.person_id)).toEqual([f.fatima]);
  });
});

describe('(4) der Kundenzugang hat in der Aufgabenliste nichts zu suchen', () => {
  it('im Kundenportal ist sie leer — auch mit zugewiesener Aufgabe', async () => {
    const kunde = await legeKontoAn(f.reinigung, 'kunde');
    await legeAufgabeAn(f.reinigung, 'Nicht für Kunden', { zugewiesenAn: kunde });

    expect(await titelIm('kunde', {
      mandantIds: [f.reinigung], benutzerId: kunde,
    })).toEqual([]);
  });
});

describe('(5) der Wächter erzeugt EINE Aufgabe, nicht dreissig', () => {
  it('derselbe Job ohne Bezug kollidiert mit sich selbst (NULLS NOT DISTINCT)', async () => {
    const job = `waechter:postfach_stumm_${zufall()}`;
    await legeAufgabeAn(f.reinigung, 'Postfach stumm seit 3 Tagen',
                        { quelle: 'zeitplan', quelleJob: job });

    // Der zweite Lauf: `on conflict do nothing`, wie der Job es tut.
    const eingefuegt = await sql.unsafe(
      `insert into aufgabe (mandant_id, titel, quelle, quelle_job)
       values ($1::uuid, 'Postfach stumm seit 4 Tagen', 'zeitplan', $2)
       on conflict do nothing
       returning id`, [f.reinigung, job]);
    expect(eingefuegt).toHaveLength(0);

    const [z] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from aufgabe where quelle_job = $1`, [job]);
    expect(z!.n).toBe('1');
  });

  it('aber jede GESELLSCHAFT bekommt ihre eigene Zeile', async () => {
    const job = `waechter:job_ausfall_${zufall()}`;
    await legeAufgabeAn(f.reinigung, 'Job fiel aus', { quelle: 'zeitplan', quelleJob: job });
    await legeAufgabeAn(f.bau, 'Job fiel aus', { quelle: 'zeitplan', quelleJob: job });
    const [z] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from aufgabe where quelle_job = $1`, [job]);
    expect(z!.n).toBe('2');
  });

  it('und nach dem Erledigen darf der Befund wiederkommen', async () => {
    // Der Index gilt nur für `offen` und `in_arbeit`: eine geschlossene
    // Aufgabe soll die nächste Meldung nicht für immer unterdrücken.
    const job = `waechter:frist_${zufall()}`;
    const ersteId = await legeAufgabeAn(f.reinigung, 'Frist läuft',
                                        { quelle: 'zeitplan', quelleJob: job });
    const w = await legeKontoAn(f.reinigung);
    await sql.unsafe(
      `update aufgabe set status = 'erledigt', erledigt_am = now(), erledigt_von = $2
        where id = $1`, [ersteId, w]);
    const wieder = await sql.unsafe(
      `insert into aufgabe (mandant_id, titel, quelle, quelle_job)
       values ($1::uuid, 'Frist läuft wieder', 'zeitplan', $2)
       on conflict do nothing returning id`, [f.reinigung, job]);
    expect(wieder).toHaveLength(1);
  });
});

describe('(6) Zustände brauchen ihren Beleg; gelöscht wird nie', () => {
  it('`erledigt` ohne Zeitpunkt und Menschen ist nicht speicherbar', async () => {
    await expect(sql.unsafe(
      `insert into aufgabe (mandant_id, titel, status) values ($1::uuid, 'x', 'erledigt')`,
      [f.reinigung])).rejects.toThrow(/aufgabe_erledigt_belegt/u);
  });

  it('`abgebrochen` ohne Grund ebenso', async () => {
    await expect(sql.unsafe(
      `insert into aufgabe (mandant_id, titel, status) values ($1::uuid, 'x', 'abgebrochen')`,
      [f.reinigung])).rejects.toThrow(/aufgabe_abbruch_begruendet/u);
  });

  it('zwei Fristarten gleichzeitig sind zwei Wahrheiten — abgewiesen', async () => {
    await expect(sql.unsafe(
      `insert into aufgabe (mandant_id, titel, faellig_am, faellig_datum)
       values ($1::uuid, 'x', now(), current_date)`,
      [f.reinigung])).rejects.toThrow(/aufgabe_eine_frist/u);
  });

  it('ein Bezug ist ein PAAR — ein Typ ohne Id zeigt nirgendwohin', async () => {
    await expect(sql.unsafe(
      `insert into aufgabe (mandant_id, titel, bezug_typ) values ($1::uuid, 'x', 'lead')`,
      [f.reinigung])).rejects.toThrow(/aufgabe_bezug_paarweise/u);
  });

  it('`delete` greift nicht — auch nicht für den Eigentümer der Tabelle', async () => {
    const id = await legeAufgabeAn(f.reinigung, 'Bleibt stehen');
    // Der Auslöser aus 0230; für `cse_app` fehlt zusätzlich das Recht.
    await expect(sql.unsafe(`delete from aufgabe where id = $1`, [id]))
      .rejects.toThrow();
    const [z] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from aufgabe where id = $1`, [id]);
    expect(z!.n).toBe('1');
  });

  it('und `truncate` auch nicht', async () => {
    await expect(sql.unsafe(`truncate table aufgabe`)).rejects.toThrow();
  });
});

describe('(7) die Gruppenansicht liest und schreibt nicht (Invariante 10)', () => {
  it('sie liest über die Gesellschaften hinweg', async () => {
    const chefin = await legeKontoAn(f.reinigung);
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
       values ($1, $2, (select id from rolle where schluessel='leitung' and mandant_id is null), false)`,
      [chefin, f.bau]);
    await sql.unsafe(
      `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
       select $1, b.id, null, true from berechtigung b
        where b.schluessel = 'gruppe.aufgabe.lesen'`,
      [await rolleId('leitung')]);

    await legeAufgabeAn(f.reinigung, 'Reinigung: Nachweis fehlt');
    await legeAufgabeAn(f.bau, 'Bau: Nachtrag offen');

    const titel = await titelIm('gruppe', {
      mandantIds: [f.reinigung, f.bau], benutzerId: chefin,
    });
    expect(titel).toEqual(['Bau: Nachtrag offen', 'Reinigung: Nachweis fehlt']);
  });

  it('und sie kann nichts anlegen', async () => {
    const chefin = await legeKontoAn(f.reinigung);
    await expect(alsApp(
      { scope: 'gruppe', mandantIds: [f.reinigung], benutzerId: chefin, readonly: true },
      async (tx: postgres.TransactionSql) => tx.unsafe(
        `insert into aufgabe (mandant_id, titel) values ($1::uuid, 'Von der Gruppe')`,
        [f.reinigung] as never[]),
    )).rejects.toThrow();
  });
});

describe('(8) ein Team gehört EINER Gesellschaft', () => {
  it('eine Aufgabe der Reinigung kann kein Team des Baus tragen', async () => {
    const teamBau = await legeTeamAn(f.bau, `Bauteam ${zufall()}`);
    await expect(sql.unsafe(
      `insert into aufgabe (mandant_id, titel, zugewiesen_team_id)
       values ($1::uuid, 'Falsch verdrahtet', $2::uuid)`,
      [f.reinigung, teamBau])).rejects.toThrow(/aufgabe_team_fk/u);
  });

  it('und eine Mitgliedschaft keine Anstellung einer anderen Gesellschaft', async () => {
    const team = await legeTeamAn(f.reinigung, `Team ${zufall()}`);
    await expect(sql.unsafe(
      `insert into team_mitglied (mandant_id, team_id, anstellung_id, person_id)
       values ($1::uuid, $2::uuid, $3::uuid, $4::uuid)`,
      [f.reinigung, team, f.fatimaSecurity, f.fatima]))
      .rejects.toThrow(/tm_anstellung_fk/u);
  });

  it('die denormalisierte `person_id` lässt sich nicht verbiegen', async () => {
    const team = await legeTeamAn(f.reinigung, `Team ${zufall()}`);
    await expect(sql.unsafe(
      `insert into team_mitglied (mandant_id, team_id, anstellung_id, person_id)
       values ($1::uuid, $2::uuid, $3::uuid, $4::uuid)`,
      [f.reinigung, team, f.fatimaReinigung, f.jonas]))
      .rejects.toThrow(/tm_person_fk/u);
  });
});
