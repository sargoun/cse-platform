import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { LeseKontext, SchreibKontext } from '../../src/server/kontext/index.js';
import {
  AssistentFehler, beantworteFrage, leseFrage,
} from '../../src/server/services/agent/assistent.js';
import { entscheideFreigabe } from '../../src/server/services/freigabe/entscheiden.js';
import { vermerkeAnsicht } from '../../src/server/services/freigabe/laden.js';

/**
 * Jede Frage an den CEO-Assistenten ist eine Aufgabe mit einem Schritt
 * (AGT-04, AGT-07, V-229, D-723).
 *
 *  1. Eine beantwortete Frage hinterlässt Aufgabe und Schritt — Werkzeug,
 *     Eingabe, Ausgabe, kein Modell, null Tokens und Kosten, eine Dauer.
 *  2. Derselbe Formularschlüssel zweimal ist EINE Aufgabe.
 *  3. Ist das Werkzeug nicht freigeschaltet, steht die Abweisung im
 *     Protokoll — und es gibt keine Antwort.
 *  4. Eine Frage ausserhalb des Katalogs legt nichts an.
 *  5. Die Antwort liest nur die eigene Gesellschaft.
 *  6. „Ergebnis nur mit Freigabe" wirkt (V-270, D-763): die Antwort wartet im
 *     Posteingang, erscheint erst nach Genehmigung — durch das Tor in
 *     `policy.ts` —, nie nach einer Ablehnung und nie, wenn sie nach der
 *     Freigabe eine andere ist; wer Freigaben nicht entscheidet, legt die
 *     Antwort trotzdem vor (V-376) — entscheiden muss ein anderer.
 *
 * **`schalte` setzt die Freigabepflicht ausdrücklich.** Bis V-270 legten die
 * Fälle 1, 2 und 5 das Werkzeug MIT `erfordert_freigabe` an und erwarteten
 * trotzdem die sofortige Antwort — genau der Befund: der Schalter wirkte
 * nicht. Sie prüfen weiter die sofortige Antwort, jetzt für den Fall, für den
 * sie gilt: ohne eigene Freigabe.
 */

let f: Fixtur;
let chef = '';
let ceo = '';

const zufall = (): string => String(Math.random()).slice(2, 10);

async function konto(mandant: string, rolle: string): Promise<string> {
  const email = `assistent-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`,
    [u!.id, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1,$2,(select id from rolle where schluessel = $3 and mandant_id is null),true)`,
    [u!.id, mandant, rolle]);
  return u!.id;
}

beforeAll(async () => {
  f = await seed();
  chef = await konto(f.reinigung, 'admin');
  const [a] = await sql.unsafe<{ id: string }[]>(
    `select id from agent where kennung = 'ceo_assistent'`);
  ceo = a!.id;
});
beforeEach(async () => {
  await sql.unsafe(`delete from agent_werkzeug`);
  /*
   * Der Agent selbst muss eingeschaltet sein — die Datei stellt das her,
   * statt es vorauszusetzen. `agent` ist eine Referenztabelle und überlebt
   * seed(); agent-laufzeit.test.ts schaltet im selben Klon alle Agenten ab,
   * und danach scheiterte hier jede Frage an AgentInaktiv (AGT-01). So hält
   * es auch agent-lauf.test.ts und akquise-tatsachen.test.ts.
   */
  await sql.unsafe(`update agent set ist_aktiv = true where kennung = 'ceo_assistent'`);
});
afterAll(schliessen);

async function schalte(mandant: string, aktiv: boolean, mitFreigabe = false): Promise<void> {
  await sql.unsafe(
    `insert into agent_werkzeug (mandant_id, agent_id, werkzeug, ist_aktiv, erfordert_freigabe,
                                 erstellt_von_art)
     values ($1, $2, 'suche_bestand', $3, $4, 'system')`, [mandant, ceo, aktiv, mitFreigabe]);
}

function imKontext<T>(
  fn: (k: LeseKontext & SchreibKontext) => Promise<T>, wer = chef, mandant = f.reinigung,
): Promise<T> {
  return alsApp(
    {
      scope: 'mandant' as const, mandantId: mandant, benutzerId: wer,
      portal: 'intern' as const, readonly: false,
    },
    async (tx: postgres.TransactionSql) => {
      const fuehre = async <R,>(s: string, w?: readonly unknown[]): Promise<readonly R[]> =>
        tx.unsafe(s, (w ?? []) as never[]) as unknown as readonly R[];
      return fn({
        scope: 'mandant', portal: 'intern', benutzerId: wer,
        aktiverMandantId: mandant, mandantIds: [mandant],
        abfrage: fuehre, schreibe: fuehre,
      } satisfies LeseKontext & SchreibKontext);
    },
  ) as Promise<T>;
}

async function schritte(aufgabeId: string) {
  return sql.unsafe<{
    werkzeug: string | null; modell: string | null; status: string;
    tokens_eingabe: number; tokens_ausgabe: number; kosten: string; dauer_ms: number;
    eingabe: unknown; ausgabe: unknown;
  }[]>(
    `select werkzeug::text as werkzeug, modell, status::text as status, tokens_eingabe,
            tokens_ausgabe, kosten_mikrocent::text as kosten, dauer_ms, eingabe, ausgabe
       from agent_schritt where agent_aufgabe_id = $1 order by schritt_nr`, [aufgabeId]);
}

describe('(1) eine Frage ist eine Aufgabe mit einem protokollierten Schritt', () => {
  it('Werkzeug, Eingabe, Ausgabe, kein Modell, null Kosten, eine Dauer', async () => {
    await schalte(f.reinigung, true);
    const r = await imKontext((k) => beantworteFrage(k, {
      abfrageId: 'offene_rechnungen_anzahl', schluessel: zufall(), angefordertVon: chef,
    }));
    expect(r.bestand).toBe(false);

    const [a] = await sql.unsafe<{
      status: string; vorgang: string; titel: string; ausgeloest: string; von: string;
      schritte: number;
    }[]>(
      `select status::text as status, vorgang_typ::text as vorgang, titel,
              ausgeloest_durch::text as ausgeloest, angefordert_von::text as von,
              schritte_anzahl as schritte
         from agent_aufgabe where id = $1`, [r.aufgabeId]);
    expect(a).toMatchObject({
      status: 'abgeschlossen', vorgang: 'interner_hinweis', ausgeloest: 'mensch', von: chef,
      schritte: 1,
    });
    expect(a!.titel).toContain('Rechnungen');

    const [s] = await schritte(r.aufgabeId);
    expect(s).toMatchObject({
      werkzeug: 'suche_bestand', modell: null, status: 'erfolg',
      tokens_eingabe: 0, tokens_ausgabe: 0, kosten: '0',
      eingabe: { abfrageId: 'offene_rechnungen_anzahl' },
    });
    expect(s!.dauer_ms).toBeGreaterThanOrEqual(0);

    const gelesen = await imKontext((k) => leseFrage(k, r.aufgabeId));
    expect(gelesen?.antwort?.abfrageId).toBe('offene_rechnungen_anzahl');
    expect(gelesen?.antwort?.anzeige).toMatch(/\d/u);
    expect(s!.ausgabe).toMatchObject({ anzeige: gelesen!.antwort!.anzeige });
  });
});

describe('(2) derselbe Schlüssel zweimal ist eine Aufgabe', () => {
  it('ein Doppelklick legt keine zweite an', async () => {
    await schalte(f.reinigung, true);
    const schluessel = zufall();
    const eins = await imKontext((k) => beantworteFrage(k, {
      abfrageId: 'offene_rechnungen_anzahl', schluessel, angefordertVon: chef,
    }));
    const zwei = await imKontext((k) => beantworteFrage(k, {
      abfrageId: 'offene_rechnungen_anzahl', schluessel, angefordertVon: chef,
    }));
    expect(zwei).toEqual({ aufgabeId: eins.aufgabeId, bestand: true });
    expect(await schritte(eins.aufgabeId)).toHaveLength(1);
  });
});

describe('(3) ohne freigeschaltetes Werkzeug: protokolliert abgewiesen, keine Antwort', () => {
  it('die Aufgabe ist abgebrochen, der Schritt sagt warum', async () => {
    await schalte(f.reinigung, false);
    const r = await imKontext((k) => beantworteFrage(k, {
      abfrageId: 'offene_rechnungen_anzahl', schluessel: zufall(), angefordertVon: chef,
    }));
    const [s] = await schritte(r.aufgabeId);
    expect(s).toMatchObject({ werkzeug: 'suche_bestand', status: 'abgelehnt_richtlinie' });
    const gelesen = await imKontext((k) => leseFrage(k, r.aufgabeId));
    expect(gelesen).toMatchObject({ status: 'abgebrochen', antwort: null });
    expect(gelesen?.fehlerText).toContain('nicht freigeschaltet');
  });
});

describe('(4) eine Frage ausserhalb des Katalogs legt nichts an', () => {
  it('Abweisung vor der ersten Zeile', async () => {
    await schalte(f.reinigung, true);
    const [vorher] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from agent_aufgabe`);
    await expect(imKontext((k) => beantworteFrage(k, {
      abfrageId: 'select * from rechnung', schluessel: zufall(), angefordertVon: chef,
    }))).rejects.toBeInstanceOf(AssistentFehler);
    const [nachher] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from agent_aufgabe`);
    expect(nachher!.n).toBe(vorher!.n);
  });
});

describe('(5) die Antwort liest nur die eigene Gesellschaft', () => {
  it('eine Aufgabe der Reinigung ist im Bau nicht lesbar', async () => {
    await schalte(f.reinigung, true);
    const r = await imKontext((k) => beantworteFrage(k, {
      abfrageId: 'offene_rechnungen_anzahl', schluessel: zufall(), angefordertVon: chef,
    }));
    const bau = await konto(f.bau, 'admin');
    expect(await imKontext((k) => leseFrage(k, r.aufgabeId), bau, f.bau)).toBeNull();
  });
});

describe('(6) „Ergebnis nur mit Freigabe" wirkt — die Antwort geht über den Posteingang', () => {
  async function frage(wer = chef): Promise<string> {
    const r = await imKontext((k) => beantworteFrage(k, {
      abfrageId: 'offene_rechnungen_anzahl', schluessel: zufall(), angefordertVon: wer,
    }), wer);
    return r.aufgabeId;
  }

  async function freigabeZu(aufgabeId: string) {
    const [z] = await sql.unsafe<{
      id: string; aktion: string; status: string; vorschau: Record<string, unknown>;
      agent_aufgabe_id: string;
    }[]>(
      `select id, aktion, status::text as status, vorschau_payload as vorschau, agent_aufgabe_id
         from freigabe where agent_aufgabe_id = $1`, [aufgabeId]);
    return z;
  }

  /** Der echte Weg des Posteingangs: öffnen (APR-08), dann entscheiden. */
  async function entscheide(
    freigabeId: string, art: 'genehmigt' | 'abgelehnt', wer = chef,
  ): Promise<void> {
    await imKontext((k) => vermerkeAnsicht(k, freigabeId, 'web'), wer);
    await imKontext((k) => entscheideFreigabe(k, {
      freigabeId, art, begruendung: art === 'abgelehnt' ? 'Die Zahl gehört nicht an die Runde.' : null,
      ip: null, userAgent: null, codeVersion: 'test',
    }), wer);
  }

  it('die Antwort wartet: Aufgabe „wartet auf Freigabe", Freigabe offen, keine Antwort', async () => {
    await schalte(f.reinigung, true, true);
    const aufgabeId = await frage();

    const [a] = await sql.unsafe<{ status: string; ergebnis: Record<string, unknown> }[]>(
      `select status::text as status, ergebnis from agent_aufgabe where id = $1`, [aufgabeId]);
    expect(a!.status).toBe('wartet_auf_freigabe');

    const fz = await freigabeZu(aufgabeId);
    expect(fz).toMatchObject({ aktion: 'werkzeug_ergebnis', status: 'offen' });
    expect(fz!.vorschau).toMatchObject({
      agent: 'ceo_assistent', werkzeug: 'suche_bestand', abfrageId: 'offene_rechnungen_anzahl',
    });
    expect(String(fz!.vorschau['anzeige'])).toMatch(/\d/u);
    /* Die Aufgabe trägt nur die Kennung der Freigabe — nicht die Antwort. */
    expect(a!.ergebnis).toEqual({ freigabe_id: fz!.id });

    const gelesen = await imKontext((k) => leseFrage(k, aufgabeId));
    expect(gelesen).toMatchObject({ antwort: null, freigabe: 'wartet', freigabeId: fz!.id });

    /* Und das Protokoll nennt die Freigabe statt der Antwort. */
    const [s] = await schritte(aufgabeId);
    expect(s).toMatchObject({ werkzeug: 'suche_bestand', status: 'erfolg' });
    expect(s!.ausgabe).toEqual({ zurueckgehalten: 'erfordert_freigabe', freigabe_id: fz!.id });
    expect(JSON.stringify(s!.ausgabe)).not.toContain(String(fz!.vorschau['anzeige']));
  });

  it('genehmigt: die Aufgabe ist abgeschlossen, und die Antwort ist genau die freigegebene', async () => {
    await schalte(f.reinigung, true, true);
    const aufgabeId = await frage();
    const fz = await freigabeZu(aufgabeId);
    await entscheide(fz!.id, 'genehmigt');

    const gelesen = await imKontext((k) => leseFrage(k, aufgabeId));
    expect(gelesen).toMatchObject({ status: 'abgeschlossen', freigabe: 'geliefert' });
    expect(gelesen!.antwort).toEqual({
      frage: fz!.vorschau['frage'], anzeige: fz!.vorschau['anzeige'],
      stand: fz!.vorschau['stand'], abfrageId: 'offene_rechnungen_anzahl',
    });
  });

  it('abgelehnt: die Aufgabe bricht ab, und eine Antwort erscheint nie', async () => {
    await schalte(f.reinigung, true, true);
    const aufgabeId = await frage();
    const fz = await freigabeZu(aufgabeId);
    await entscheide(fz!.id, 'abgelehnt');

    const gelesen = await imKontext((k) => leseFrage(k, aufgabeId));
    expect(gelesen).toMatchObject({
      status: 'abgebrochen', antwort: null, freigabe: 'nicht_freigegeben',
    });
    expect(gelesen!.fehlerText).toContain('nicht erteilt');
  });

  /**
   * **Zwei Linien.** Die Datenbank verweigert die Änderung einer geöffneten
   * Vorschau selbst (APR-02). Wer an diesem Auslöser vorbeischreibt, bekommt
   * vom Tor trotzdem keine Antwort: der Abdruck ist nicht mehr der des
   * entschiedenen Kettenglieds.
   */
  it('nach der Freigabe verändert, ist es nicht mehr die freigegebene Antwort — das Tor hält sie zurück', async () => {
    await schalte(f.reinigung, true, true);
    const aufgabeId = await frage();
    const fz = await freigabeZu(aufgabeId);
    await entscheide(fz!.id, 'genehmigt');
    const aendern = `update freigabe
                        set vorschau_payload = jsonb_set(vorschau_payload, '{anzeige}', '"999"')
                      where id = $1`;
    await expect(sql.unsafe(aendern, [fz!.id])).rejects.toThrow(/APR-02/u);

    await sql.begin(async (tx) => {
      await tx.unsafe('set local session_replication_role = replica');
      await tx.unsafe(aendern, [fz!.id]);
    });
    const gelesen = await imKontext((k) => leseFrage(k, aufgabeId));
    expect(gelesen).toMatchObject({ antwort: null, freigabe: 'nicht_freigegeben' });
  });

  it('ohne eigene Freigabe: die Antwort kommt sofort, und es entsteht keine Freigabe', async () => {
    await schalte(f.reinigung, true, false);
    const aufgabeId = await frage();
    expect(await freigabeZu(aufgabeId)).toBeUndefined();
    const gelesen = await imKontext((k) => leseFrage(k, aufgabeId));
    expect(gelesen).toMatchObject({ status: 'abgeschlossen', freigabe: null });
    expect(gelesen!.antwort?.abfrageId).toBe('offene_rechnungen_anzahl');
  });

  /*
   * **Vorlegen und Entscheiden sind zwei Rechte** (V-376, D-819). Bis 0515
   * bekam, wer `freigabe.entscheiden` nicht hielt, eine abgewiesene Frage:
   * die Antwort konnte nicht in den Posteingang. Jetzt legt der Lauf sie vor
   * (sein Recht ist `agent.aufgabe_starten`), und entscheiden muss sie
   * jemand, der Freigaben entscheidet — der Fragende selbst kann es nicht.
   */
  it('wer Freigaben nicht entscheidet, legt die Antwort trotzdem vor — entscheiden muss ein anderer', async () => {
    await schalte(f.reinigung, true, true);
    const leitung = await konto(f.reinigung, 'leitung');
    await sql.unsafe(
      `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
       select r.id, b.id, $1, false
         from rolle r, berechtigung b
        where r.schluessel = 'leitung' and r.mandant_id is null
          and b.schluessel = 'freigabe.entscheiden'
       on conflict (rolle_id, berechtigung_id, mandant_id) do update set gewaehrt = false`,
      [f.reinigung]);
    try {
      const aufgabeId = await frage(leitung);
      const fz = await freigabeZu(aufgabeId);
      expect(fz).toMatchObject({ aktion: 'werkzeug_ergebnis', status: 'offen' });
      const [s] = await schritte(aufgabeId);
      expect(s).toMatchObject({ status: 'erfolg' });
      expect(s!.ausgabe).toEqual({ zurueckgehalten: 'erfordert_freigabe', freigabe_id: fz!.id });
      expect(await imKontext((k) => leseFrage(k, aufgabeId), leitung))
        .toMatchObject({ antwort: null, freigabe: 'wartet' });

      await expect(entscheide(fz!.id, 'genehmigt', leitung))
        .rejects.toThrow(/freigabe\.entscheiden fehlt/u);
      await entscheide(fz!.id, 'genehmigt');
      expect(await imKontext((k) => leseFrage(k, aufgabeId), leitung))
        .toMatchObject({ status: 'abgeschlossen', freigabe: 'geliefert' });
    } finally {
      await sql.unsafe(
        `delete from rolle_berechtigung
          where mandant_id = $1
            and rolle_id = (select id from rolle where schluessel = 'leitung' and mandant_id is null)
            and berechtigung_id = (select id from berechtigung where schluessel = 'freigabe.entscheiden')`,
        [f.reinigung]);
    }
  });
});
