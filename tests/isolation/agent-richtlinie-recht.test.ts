/**
 * `agent_richtlinie` und das Recht der Seite (AGT-03, APR-01, Invariante 3,
 * 0203).
 *
 * **Der stille Fehler, den diese Datei einfriert.** `0012` bewachte die
 * Tabelle mit `versand.lesen` und `versand.freigeben`; die Route
 * `/einstellungen/agent-richtlinien` wird mit `agent.richtlinie_verwalten`
 * bewacht. Eine Sitzung mit genau diesem Recht kam durch das Tor und bekam
 * von der Datenbank NULL ZEILEN und eine abgewiesene Schreibung. Das sah
 * nicht wie ein Rechtefehler aus: der Bildschirm sagte „keine Richtlinie
 * hinterlegt", und das heisst nach Invariante 7 „Freigabe noetig" — also wie
 * eine besonders vorsichtige Konfiguration.
 *
 * **Erreichbar ist der Fall ueber die BINDUNG je Bereich UND die
 * MODUL-Schnittmenge — beide Wege nennt 0203, und es braucht beide.**
 * `agent.richtlinie_verwalten` haelt nach der Plattform-Vorgabe (§12) nur
 * `super_admin`; bei `admin` steht dort `○` — „nicht per Vorgabe gewaehrt;
 * eine Bindung kann in der Oberflaeche angelegt werden" (AUT-03: eine
 * `rolle_berechtigung`-Zeile MIT `mandant_id`). Und `super_admin` traegt
 * `geltungsbereich = global`, was `benutzer_mandant` gar nicht annimmt
 * (0007). Ohne die Bindung gibt es also keine Sitzung, die das Recht der
 * Seite haelt und in der Modul-Schnittmenge sitzt — der Test prueft die
 * Policy dann an einem Konto, das sie nie erreicht, und war genau daran rot.
 *
 * Darueber die Schnittmenge: `app.hat_recht_fuer` schneidet mit
 * `benutzer_mandant.module` (`split_part(schluessel, '.', 1) = any
 * (bm.module)`). Eine Administration MIT der Bindung und `module = {agent}`
 * haelt `agent.richtlinie_verwalten` und kein `versand.*` — ohne dass jemand
 * eine Rolle erfindet oder die Vorgabe fuer alle vier Gesellschaften
 * verschiebt.
 *
 * **Beide Rechte bleiben gueltig.** `services/bau/nachtrag.ts` liest die
 * Zeile unter den Rechten des Versandwegs; ihm das Lesen zu nehmen hiesse,
 * dass `gate()` dort `null` bekommt — fail-closed, aber eine Konfiguration,
 * die es gibt und die niemand sieht.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';

let f: Fixtur;
const zufall = (): string => String(Math.random()).slice(2, 10);

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

/**
 * Eine Administration mit einer MODULBUCHUNG — die Schnittmenge aus 0008.
 * `module = null` heisst „keine Einschraenkung"; eine Liste heisst „nur diese".
 */
async function konto(mandant: string, module: readonly string[] | null): Promise<string> {
  const email = `richtlinie-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`,
    [u!.id, email] as never[]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, module)
     values ($1,$2,$3,$4::text[])`,
    [u!.id, mandant, await rolleId('admin'),
      module === null ? null : `{${module.join(',')}}`] as never[]);
  return u!.id;
}

/**
 * Die Bindung aus der Oberflaeche (AUT-03): eine `rolle_berechtigung`-Zeile
 * MIT `mandant_id`. Sie uebersteuert die Plattform-Vorgabe fuer genau diese
 * Gesellschaft — `finanzen.lesen` der `leitung` in `bau` zu binden oder zu
 * entziehen aendert in `reinigung` nichts, und kostet kein Deployment. Genau
 * diese Zeile schreibt der Rechte-Editor, und genau sie macht aus dem `○` in
 * §12 ein gehaltenes Recht.
 */
async function bindeRecht(mandant: string, rolle: string, recht: string): Promise<void> {
  await sql.unsafe(
    `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
     select $1::uuid, b.id, $2::uuid, true
       from berechtigung b where b.schluessel = $3`,
    [await rolleId(rolle), mandant, recht] as never[]);
}

async function richtlinie(mandant: string, aktion: string): Promise<void> {
  await sql.unsafe(
    `insert into agent_richtlinie (mandant_id, aktion, auto_erlaubt, begruendung)
     values ($1, $2, false, 'Platzhalter')
     on conflict (mandant_id, aktion) do nothing`,
    [mandant, aktion] as never[]);
}

beforeEach(async () => {
  f = await seed();
  /*
   * Die Bindung steht NUR in der Reinigung. Der Bau bleibt auf der
   * Plattform-Vorgabe — das ist unten die Gegenprobe, die zeigt, dass diese
   * Zeile und nicht ein Zufall der Fixtur den Unterschied macht.
   */
  await bindeRecht(f.reinigung, 'admin', 'agent.richtlinie_verwalten');
  await richtlinie(f.reinigung, 'email_senden');
  await richtlinie(f.bau, 'email_senden');
});

afterAll(async () => {
  await schliessen();
});

describe('Das Recht der Seite genuegt (0203)', () => {
  it('eine Sitzung mit nur agent.richtlinie_verwalten SIEHT die Zeilen', async () => {
    const benutzer = await konto(f.reinigung, ['agent']);
    const befund = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: benutzer,
        portal: 'intern', readonly: false },
      async (tx) => {
        const [r] = await tx.unsafe(
          `select app.hat_recht('agent.richtlinie_verwalten') as agent,
                  app.hat_recht('versand.lesen') as versand`) as
          { agent: boolean; versand: boolean }[];
        const zeilen = await tx.unsafe(
          `select aktion from agent_richtlinie`) as { aktion: string }[];
        return { recht: r!, zeilen };
      },
    );
    /* Die Lage, die den Fehler erreichbar macht: das eine ja, das andere nein. */
    expect(befund.recht.agent).toBe(true);
    expect(befund.recht.versand).toBe(false);
    /* Und trotzdem sichtbar — das ist 0203. */
    expect(befund.zeilen.map((z) => z.aktion)).toEqual(['email_senden']);
  });

  it('und sie DARF schreiben — anlegen und aendern', async () => {
    const benutzer = await konto(f.reinigung, ['agent']);
    const befund = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: benutzer,
        portal: 'intern', readonly: false },
      async (tx) => {
        const geaendert = await tx.unsafe(
          `update agent_richtlinie set auto_erlaubt = true
            where aktion = 'email_senden' returning aktion`) as unknown[];
        const angelegt = await tx.unsafe(
          `insert into agent_richtlinie (mandant_id, aktion, auto_erlaubt)
           values (app.aktiver_mandant(), 'mahnung_senden', false) returning aktion`,
        ) as unknown[];
        return { geaendert, angelegt };
      },
    );
    expect(befund.geaendert).toHaveLength(1);
    expect(befund.angelegt).toHaveLength(1);
  });

  it('und die Gegenprobe: OHNE die Bindung haelt dieselbe Rolle das Recht nicht', async () => {
    /*
     * Im Bau steht die Bindung nicht — dort gilt die Plattform-Vorgabe, und
     * die gibt `agent.richtlinie_verwalten` nur `super_admin`. Ohne diesen
     * Fall waere oben nicht zu sehen, ob das `true` von der Bindung kommt
     * oder die Fixtur ohnehin alles darf; und er haelt zugleich fest, dass
     * die Vorgabe selbst unangetastet ist: gebunden wird je Bereich, nicht
     * fuer alle vier Gesellschaften auf einmal.
     */
    const benutzer = await konto(f.bau, ['agent']);
    const befund = await alsApp(
      { scope: 'mandant', mandantId: f.bau, benutzerId: benutzer,
        portal: 'intern', readonly: false },
      async (tx) => {
        const [r] = await tx.unsafe(
          `select app.hat_recht('agent.richtlinie_verwalten') as agent`) as
          { agent: boolean }[];
        const zeilen = await tx.unsafe(`select aktion from agent_richtlinie`) as unknown[];
        return { recht: r!, zeilen };
      },
    );
    expect(befund.recht.agent).toBe(false);
    expect(befund.zeilen).toHaveLength(0);
  });
});

describe('Das Recht des Versandwegs bleibt (keine Regression)', () => {
  it('eine Sitzung mit nur versand.* sieht die Zeilen weiter', async () => {
    /*
     * `services/bau/nachtrag.ts` liest die Zeile unter diesen Rechten. Faende
     * es sie nicht, bekaeme `gate()` dort `null` — fail-closed, aber eine
     * Konfiguration, die es gibt und die niemand sieht.
     */
    const benutzer = await konto(f.reinigung, ['versand']);
    const befund = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: benutzer,
        portal: 'intern', readonly: false },
      async (tx) => {
        const [r] = await tx.unsafe(
          `select app.hat_recht('agent.richtlinie_verwalten') as agent,
                  app.hat_recht('versand.lesen') as versand`) as
          { agent: boolean; versand: boolean }[];
        const zeilen = await tx.unsafe(`select aktion from agent_richtlinie`) as unknown[];
        return { recht: r!, zeilen };
      },
    );
    expect(befund.recht.agent).toBe(false);
    expect(befund.recht.versand).toBe(true);
    expect(befund.zeilen).toHaveLength(1);
  });
});

describe('Die Mandantenwand und die Gruppenansicht', () => {
  it('ohne eines der beiden Rechte: nichts', async () => {
    const benutzer = await konto(f.reinigung, ['objekt']);
    const zeilen = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: benutzer,
        portal: 'intern', readonly: false },
      (tx) => tx.unsafe(`select aktion from agent_richtlinie`),
    ) as unknown[];
    expect(zeilen).toHaveLength(0);
  });

  it('die Richtlinie eines fremden Bereichs bleibt unsichtbar (Invariante 3)', async () => {
    const benutzer = await konto(f.reinigung, ['agent']);
    const zeilen = await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: benutzer,
        portal: 'intern', readonly: false },
      (tx) => tx.unsafe(`select aktion from agent_richtlinie where mandant_id = $1`,
        [f.bau] as never[]),
    ) as unknown[];
    expect(zeilen).toHaveLength(0);
  });

  it('in der Gruppenansicht wird nichts geschrieben (Invariante 10)', async () => {
    const benutzer = await konto(f.reinigung, ['agent']);
    const ergebnis = await alsApp(
      { scope: 'gruppe', mandantIds: [f.reinigung, f.bau], benutzerId: benutzer,
        readonly: true },
      (tx) => tx.unsafe(
        `update agent_richtlinie set auto_erlaubt = true returning aktion`),
    ) as unknown[];
    expect(ergebnis).toHaveLength(0);
  });
});

describe('Die Spur einer Aenderung (0203)', () => {
  it('eine geaenderte Richtlinie steht im Protokoll — mit Vorher und Nachher', async () => {
    const benutzer = await konto(f.reinigung, ['agent']);
    await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: benutzer,
        portal: 'intern', readonly: false },
      (tx) => tx.unsafe(
        `update agent_richtlinie set auto_erlaubt = true where aktion = 'email_senden'`),
    );
    const [zeile] = await sql.unsafe<{
      aktion: string; vorher: Record<string, unknown> | null;
      nachher: Record<string, unknown> | null;
    }[]>(
      `select aktion, vorher, nachher from audit_log
        where objekt_typ = 'agent_richtlinie' and mandant_id = $1
        order by id desc limit 1`, [f.reinigung]);
    /*
     * Vor 0203 trug die Tabelle KEINEN Trigger: eine Aenderung an der Regel,
     * die entscheidet, ob eine Mail ohne Menschen hinausgeht, liess keine
     * Spur. Bei einer Invariante-7-Konfiguration ist das der teuerste denkbare
     * fehlende Trigger.
     */
    expect(zeile, 'kein Auditeintrag zur Richtlinie').toBeDefined();
    expect(zeile?.vorher).not.toBeNull();
    expect(zeile?.nachher).not.toBeNull();
  });

  it('geaendert_am und geaendert_von werden gesetzt', async () => {
    const benutzer = await konto(f.reinigung, ['agent']);
    await alsApp(
      { scope: 'mandant', mandantId: f.reinigung, benutzerId: benutzer,
        portal: 'intern', readonly: false },
      (tx) => tx.unsafe(
        `update agent_richtlinie set auto_erlaubt = true, geaendert_von = $1
          where aktion = 'email_senden'`, [benutzer] as never[]),
    );
    const [zeile] = await sql.unsafe<{ geaendert_am: Date | null; geaendert_von: string | null }[]>(
      `select geaendert_am, geaendert_von from agent_richtlinie
        where mandant_id = $1 and aktion = 'email_senden'`, [f.reinigung]);
    expect(zeile?.geaendert_am).not.toBeNull();
    expect(zeile?.geaendert_von).toBe(benutzer);
  });
});

describe('Kein DELETE (Invariante 8)', () => {
  it('abgeschaltet wird ueber ist_aktiv, nicht durch Loeschen', async () => {
    await expect(sql.unsafe(
      `delete from agent_richtlinie where mandant_id = $1`, [f.reinigung] as never[],
    )).rejects.toThrow();
    const [g] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from information_schema.table_privileges
        where table_name = 'agent_richtlinie' and grantee = 'cse_app'
          and privilege_type in ('DELETE', 'TRUNCATE')`);
    expect(g?.n).toBe('0');
  });
});
