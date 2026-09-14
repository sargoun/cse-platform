/**
 * Die Werkzeugtabellen gegen eine echte Datenbank (AGT-02, 0150).
 *
 *  1. **Invariante 7 als CHECK**: `sende_email` ohne Freigabepflicht ist in
 *     der Datenbank unmöglich — auch per direktem UPDATE.
 *  2. **Der Entwurfsinhalt hängt an `agent.protokoll_lesen`**, nicht an
 *     `agent.lesen`: dass ein Entwurf entstand, darf jeder sehen, der den
 *     Agenten sieht; WAS drinsteht, nicht.
 *  3. **`berechne_preis` rechnet mit derselben Funktion wie die
 *     Angebotsseite** — und gibt gebundene Werte zurück, keine nackten Zahlen.
 *  4. **`suche_bestand` sagt „kein Ergebnis"**, wenn die Frage nicht im
 *     Katalog steht (AGT-07), statt etwas Ähnliches zu liefern.
 *  5. Die Wände: eine fremde Gesellschaft sieht die Werkzeugzeile nicht.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, alsRolle, schliessen, seed, sql, type Fixtur } from './harness.js';
import { HandleTresor } from '../../src/server/agent/tools/handles.js';
import { Wertregister } from '../../src/server/agent/tools/register.js';
import { berechnePreis } from '../../src/server/agent/tools/berechne-preis.js';
import { KATALOG, sucheBestand } from '../../src/server/agent/tools/suche-bestand.js';

let f: Fixtur;
let benutzer: string;
let agentId: string;

const zufall = (): string => Math.random().toString(36).slice(2, 10);

async function legeKontoAn(mandantId: string, rolle = 'admin'): Promise<string> {
  const mail = `aw-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [mail]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,'Werkzeugtest','aktiv')`,
    [u!.id, mail]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id)
     values ($1,$2,(select id from rolle where schluessel = $3 and mandant_id is null))`,
    [u!.id, mandantId, rolle]);
  return u!.id;
}

function sitzung(mandantId?: string, benutzerId?: string) {
  return {
    scope: 'mandant' as const, mandantId: mandantId ?? f.reinigung,
    benutzerId: benutzerId ?? benutzer, portal: 'intern' as const, readonly: false,
  };
}

/** Der Lesekontext über einer schon gebundenen Transaktion. */
function kontext(tx: postgres.TransactionSql) {
  return {
    abfrage: async <T>(a: string, w?: readonly unknown[]): Promise<readonly T[]> =>
      (await tx.unsafe(a, (w ?? []) as never[])) as unknown as readonly T[],
  };
}

beforeEach(async () => {
  f = await seed();
  benutzer = await legeKontoAn(f.reinigung);
  const [a] = await sql.unsafe<{ id: string }[]>(
    `select id from agent where kennung = 'akquise'`);
  agentId = a!.id;
  await sql.unsafe(`delete from agent_artefakt`);
  await sql.unsafe(`delete from agent_werkzeug`);
});

afterAll(schliessen);

describe('(1) Invariante 7 steht als CHECK in der Datenbank', () => {
  it('`sende_email` ohne Freigabepflicht ist unmoeglich', async () => {
    await expect(sql.unsafe(
      `insert into agent_werkzeug (mandant_id, agent_id, werkzeug, ist_aktiv, erfordert_freigabe,
                                   erstellt_von_art)
       values ($1,$2,'sende_email',true,false,'system')`, [f.reinigung, agentId]))
      .rejects.toThrow(/aw_versand_immer_freigabe/u);
  });

  it('auch ein spaeteres UPDATE kommt nicht daran vorbei', async () => {
    const [w] = await sql.unsafe<{ id: string }[]>(
      `insert into agent_werkzeug (mandant_id, agent_id, werkzeug, erstellt_von_art)
       values ($1,$2,'sende_email','system') returning id`, [f.reinigung, agentId]);
    await expect(sql.unsafe(
      `update agent_werkzeug set erfordert_freigabe = false where id = $1`, [w!.id]))
      .rejects.toThrow(/aw_versand_immer_freigabe/u);
  });

  it('bei den uebrigen acht darf eine Gesellschaft lockern', async () => {
    const [w] = await sql.unsafe<{ id: string }[]>(
      `insert into agent_werkzeug (mandant_id, agent_id, werkzeug, erfordert_freigabe,
                                   erstellt_von_art)
       values ($1,$2,'suche_bestand',false,'system') returning id`, [f.reinigung, agentId]);
    expect(w?.id).toBeDefined();
  });
});

describe('(2) Der Entwurfsinhalt haengt am Protokollrecht', () => {
  async function legeArtefaktAn(): Promise<string> {
    const [auf] = await sql.unsafe<{ id: string }[]>(
      `insert into agent_aufgabe (mandant_id, agent_id, titel, vorgang_typ, status,
                                  erstellt_von_art, erstellt_von_agent_id)
       values ($1,$2,'Testlauf','angebot_erstellen','wartend','agent',$2) returning id`,
      [f.reinigung, agentId]);
    const [art] = await sql.unsafe<{ id: string }[]>(
      `insert into agent_artefakt (mandant_id, agent_aufgabe_id, art, inhalt, inhalt_hash,
                                   erstellt_von_art)
       values ($1,$2,'textentwurf', $3::jsonb, 'hash', 'agent') returning id`,
      [f.reinigung, auf!.id, { text: 'Sehr geehrte Damen und Herren' }]);
    return art!.id;
  }

  it('cse_app sieht die ZEILE, aber nicht die Spalte `inhalt`', async () => {
    const id = await legeArtefaktAn();
    const zeilen = await alsApp(sitzung(), async (tx: postgres.TransactionSql) =>
      tx.unsafe(`select id, art::text as art from agent_artefakt where id = $1`, [id]));
    expect(zeilen, 'dass ein Entwurf entstand, ist sichtbar').toHaveLength(1);

    await expect(alsApp(sitzung(), async (tx: postgres.TransactionSql) =>
      tx.unsafe(`select inhalt from agent_artefakt where id = $1`, [id])))
      .rejects.toThrow(/permission denied|Berechtigung/iu);
  });

  it('der Leser gibt ohne `agent.protokoll_lesen` null zurueck — keinen Fehler', async () => {
    const id = await legeArtefaktAn();
    /* Eine Leitung haelt `agent.lesen`, aber nicht `agent.protokoll_lesen`. */
    const leitung = await legeKontoAn(f.reinigung, 'leitung');
    const [z] = await alsApp(sitzung(f.reinigung, leitung),
      async (tx: postgres.TransactionSql) =>
        tx.unsafe(`select app.agent_artefakt_lesen($1::uuid) as inhalt`, [id]),
    ) as readonly { inhalt: unknown }[];
    expect(z!.inhalt, 'kein roter Kasten — eine Auskunft').toBeNull();
  });
});

describe('(3) berechne_preis rechnet mit der getesteten Funktion', () => {
  it('gibt gebundene Werte zurueck, keine nackten Zahlen', async () => {
    const [o] = await sql.unsafe<{ id: string }[]>(
      `select id from objekt where mandant_id = $1 order by objektnummer limit 1`, [f.reinigung]);
    if (o === undefined) return;   // Die Fixtur hat kein Objekt — dann prueft der Fall nichts.

    const tresor = new HandleTresor();
    const register = new Wertregister();
    const handle = tresor.praege('objekt', o.id);

    const e = await alsApp(sitzung(), async (tx: postgres.TransactionSql) => berechnePreis(
      kontext(tx), tresor, register,
      { objekt: handle, turnus: '5_pro_woche', gewerk: 'reinigung' },
      new Date('2026-09-14T00:00:00Z'), f.reinigung,
    ));

    if (!e.ok) {
      /* Ohne Raumbuch gibt es keinen Preis — und genau das sagt es (AGT-07). */
      expect(e.fehler.code).toBe('kein_ergebnis');
      return;
    }
    expect(e.daten.nettoToken).toMatch(/^z[0-9]+$/u);
    const netto = register.lies(e.daten.nettoToken);
    expect(netto.art).toBe('geld');
    expect(typeof netto.betragCent, 'Geld ist ganzzahlige Cent').toBe('bigint');
    expect(netto.anzeige, 'deutsch formatiert').toMatch(/€/u);
    expect(netto.quelle.art, 'die Herkunft ist gerechnet, nicht geraten').toBe('berechnet');
    expect(e.daten.istPlatzhalter, 'O-16 und O-56 sind offen').toBe(true);
  });

  it('ein Handle aus einem anderen Lauf gibt `nicht_gefunden`', async () => {
    const tresor = new HandleTresor();
    const e = await alsApp(sitzung(), async (tx: postgres.TransactionSql) => berechnePreis(
      kontext(tx), tresor, new Wertregister(),
      { objekt: 'objekt_1', turnus: '5_pro_woche', gewerk: 'reinigung' },
      new Date('2026-09-14T00:00:00Z'), f.reinigung,
    ));
    expect(e.ok).toBe(false);
    if (!e.ok) expect(e.fehler.code).toBe('nicht_gefunden');
  });

  it('ein unbekannter Turnus bekommt KEINEN Ersatzwert', async () => {
    const [o] = await sql.unsafe<{ id: string }[]>(
      `select id from objekt where mandant_id = $1 limit 1`, [f.reinigung]);
    if (o === undefined) return;
    const tresor = new HandleTresor();
    const handle = tresor.praege('objekt', o.id);
    const e = await alsApp(sitzung(), async (tx: postgres.TransactionSql) => berechnePreis(
      kontext(tx), tresor, new Wertregister(),
      { objekt: handle, turnus: 'alle_jubeljahre', gewerk: 'reinigung' },
      new Date('2026-09-14T00:00:00Z'), f.reinigung,
    ));
    expect(e.ok).toBe(false);
    if (!e.ok) {
      expect(['ungueltige_eingabe', 'kein_ergebnis']).toContain(e.fehler.code);
    }
  });
});

describe('(4) suche_bestand antwortet aus dem Katalog — oder gar nicht', () => {
  it('beantwortet eine Katalogfrage gegen die echten Daten', async () => {
    const e = await alsApp(sitzung(), async (tx: postgres.TransactionSql) =>
      sucheBestand(kontext(tx), f.reinigung, 'mitarbeiter_heute_im_einsatz',
        new Wertregister()));
    expect(e.ok).toBe(true);
    if (e.ok) {
      expect(e.daten.frage).toContain('arbeite');
      /*
       * **Die Zahl kommt als Token, nicht als Zahl** (AGT-02): der gebundene
       * Wert traegt sie mit Herkunft, und der Antworttext des Modells kann
       * sie nur ueber den Token zitieren. Eine rohe Zahl im Ergebnis liesse
       * sich von einer erfundenen nicht unterscheiden.
       */
      const antwort = e.werte?.find((w) => w.token === e.daten.antwortToken);
      expect(antwort, 'die Antwort steht im Wertregister').toBeDefined();
      expect(Number(antwort!.wert)).not.toBeNaN();
      const stand = e.werte?.find((w) => w.token === e.daten.standToken);
      expect(stand?.anzeige, 'mit Stand, damit niemand eine alte Zahl weiterreicht')
        .toMatch(/\d{2}\.\d{2}\.\d{4}/u);
    }
  });

  it('eine Frage ausserhalb des Katalogs bekommt `kein_ergebnis`', async () => {
    const e = await alsApp(sitzung(), async (tx: postgres.TransactionSql) =>
      sucheBestand(kontext(tx), f.reinigung, 'wie_hoch_ist_unsere_marge',
        new Wertregister()));
    expect(e.ok).toBe(false);
    if (!e.ok) {
      expect(e.fehler.code).toBe('kein_ergebnis');
      expect(e.fehler.nachricht, 'sie sagt, was beantwortbar ist').toContain('Katalog');
    }
  });

  it('jede Katalogabfrage traegt die Mandantengrenze IM SQL', () => {
    for (const k of KATALOG) {
      expect(k.sql, `${k.id} ohne Mandantengrenze`).toMatch(/\$1::uuid/u);
    }
  });
});

describe('(5) Die Waende', () => {
  it('eine fremde Gesellschaft sieht die Werkzeugzeile nicht', async () => {
    await sql.unsafe(
      `insert into agent_werkzeug (mandant_id, agent_id, werkzeug, erstellt_von_art)
       values ($1,$2,'suche_bestand','system')`, [f.reinigung, agentId]);
    const fremder = await legeKontoAn(f.security);
    const zeilen = await alsApp(sitzung(f.security, fremder),
      async (tx: postgres.TransactionSql) => tx.unsafe(`select id from agent_werkzeug`));
    expect(zeilen).toHaveLength(0);
  });

  it('das Kundenportal sieht keine Werkzeuge', async () => {
    await sql.unsafe(
      `insert into agent_werkzeug (mandant_id, agent_id, werkzeug, erstellt_von_art)
       values ($1,$2,'suche_bestand','system')`, [f.reinigung, agentId]);
    const zeilen = await alsRolle('cse_app', async (tx: postgres.TransactionSql) => {
      await tx.unsafe(`select set_config('app.scope','mandant',true)`);
      await tx.unsafe(`select set_config('app.mandant_id',$1,true)`, [f.reinigung]);
      await tx.unsafe(`select set_config('app.benutzer_id',$1,true)`, [benutzer]);
      await tx.unsafe(`select set_config('app.portal','kunde',true)`);
      await tx.unsafe(`select set_config('app.readonly','off',true)`);
      return tx.unsafe(`select id from agent_werkzeug`);
    });
    expect(zeilen).toHaveLength(0);
  });
});
