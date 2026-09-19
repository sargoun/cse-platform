/**
 * Die Riegel aus `0290` gegen eine echte Datenbank (AGT-03, Invariante 7).
 *
 * **Was `0290` schliesst.** `0012` liess `angebot_senden` nicht automatisch
 * hinaus (`agent_richtlinie_kein_auto_angebot`). Seither sind zwei weitere
 * Aktionen dazugekommen, die `gate()` genauso hart sperrt —
 * `nachtrag_einreichen` (§ 2 Abs. 6 VOB/B) und `behinderung_senden`
 * (§ 6 Abs. 1 VOB/B) —, und die TABELLE nahm sie mit `auto_erlaubt = true`.
 * Nichts wäre hinausgegangen (`gate()` weist ab), aber in der Zeile stand
 * eine Erlaubnis: wer später belegen soll, was diese Gesellschaft eingestellt
 * HATTE, liest sie als eine. Genau darum ist die Datenbank hier die zweite
 * Linie und nicht nur der Code.
 *
 * **Und der Wertebereich.** `aktion` ist blankes `text`; ein Tippfehler legte
 * eine Zeile an, die `gate()` nie nachschlägt — sie greift nicht und fällt
 * nicht auf.
 *
 * **Zwei Ebenen, beide geprüft:** `setzeRichtlinie` weist mit einem SATZ ab
 * (das sieht der Mensch), die Datenbank mit einem `check_violation` (das
 * fängt jeden anderen Schreiber — einen Job, eine künftige Route, ein
 * `psql`). Ein Test nur auf der oberen Ebene liesse offen, ob die untere
 * überhaupt existiert.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import {
  RichtlinieFehler, ladeRichtlinie, setzeRichtlinie,
} from '../../src/server/services/agent/richtlinie.js';
import { IM_CODE_GESPERRT } from '../../src/server/services/agent/richtlinie.js';
import { AKTIONEN } from '../../src/server/agent/policy.js';

let f: Fixtur;
let benutzer: string;

const zufall = (): string => String(Math.random()).slice(2, 10);

async function legeAdministrationAn(mandantId: string): Promise<string> {
  const email = `riegel-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,'Richtlinienpflege','aktiv')`,
    [u!.id, email] as never[]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id)
     values ($1, $2, (select id from rolle where schluessel = 'admin' and mandant_id is null))`,
    [u!.id, mandantId] as never[]);
  return u!.id;
}

function kontext(tx: postgres.TransactionSql): SchreibKontext {
  const abfrage = async <T>(a: string, w?: readonly unknown[]): Promise<readonly T[]> =>
    (await tx.unsafe(a, (w ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId: benutzer,
    aktiverMandantId: f.reinigung, mandantIds: [f.reinigung],
    abfrage, schreibe: abfrage,
  };
}

async function imBereich<T>(fn: (k: SchreibKontext) => Promise<T>): Promise<T> {
  return alsApp(
    { scope: 'mandant', mandantId: f.reinigung, benutzerId: benutzer,
      portal: 'intern', readonly: false },
    (tx) => fn(kontext(tx)),
  );
}

beforeEach(async () => {
  f = await seed();
  benutzer = await legeAdministrationAn(f.reinigung);
});

afterAll(async () => {
  await schliessen();
});

describe('(1) der Wertebereich von `aktion`', () => {
  it('nimmt jede der acht AKTIONEN an', async () => {
    /*
     * Die Gegenrichtung des Riegels und der Grund, warum er die Liste aus
     * `policy.ts` tragen MUSS: eine Aktion, die der Code kennt und die
     * Datenbank nicht, liesse sich nicht konfigurieren — die Seite zeigte sie,
     * und das Speichern scheiterte.
     */
    const angenommen = await imBereich(async (k) => {
      let zahl = 0;
      for (const aktion of AKTIONEN) {
        await k.schreibe(
          `insert into agent_richtlinie (mandant_id, aktion, auto_erlaubt)
           values (app.aktiver_mandant(), $1, false)
           on conflict (mandant_id, aktion) do nothing`, [aktion]);
        zahl += 1;
      }
      return zahl;
    });
    expect(angenommen).toBe(AKTIONEN.length);
    const [z] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from agent_richtlinie where mandant_id = $1`,
      [f.reinigung]);
    expect(z?.n).toBe(String(AKTIONEN.length));
  });

  it('weist eine unbekannte Aktion ab — auch am Dienst vorbei', async () => {
    await expect(sql.unsafe(
      `insert into agent_richtlinie (mandant_id, aktion, auto_erlaubt)
       values ($1, 'email_sender', false)`, [f.reinigung] as never[],
    )).rejects.toThrow(/agent_richtlinie_aktion_bekannt/u);
  });

  it('und der Dienst weist sie schon vorher ab, mit einem Satz', async () => {
    await expect(imBereich((k) => setzeRichtlinie(k, {
      aktion: 'email_sender' as never, autoErlaubt: false, istAktiv: true,
      maxBetragCent: null, begruendung: null,
    }))).rejects.toThrow(RichtlinieFehler);
  });
});

describe('(2) keine Automatik für die drei Willenserklärungen', () => {
  it.each([...IM_CODE_GESPERRT])(
    'die Datenbank weist `%s` mit auto_erlaubt ab — auch am Dienst vorbei',
    async (aktion) => {
      await expect(sql.unsafe(
        `insert into agent_richtlinie (mandant_id, aktion, auto_erlaubt)
         values ($1, $2, true)`, [f.reinigung, aktion] as never[],
      )).rejects.toThrow(/agent_richtlinie_kein_auto_willenserklaerung/u);
    });

  it.each([...IM_CODE_GESPERRT])(
    '`%s` ohne Automatik geht durch — gesperrt ist die Erlaubnis, nicht die Zeile',
    async (aktion) => {
      /*
       * Die Zeile selbst muss anlegbar bleiben: sie traegt die Begruendung,
       * warum diese Aktion eine eigene ist, und ihr `ist_aktiv`/`begruendung`
       * ist die Dokumentation der Konfiguration. Verboten ist nur das `true`.
       */
      await imBereich((k) => setzeRichtlinie(k, {
        aktion, autoErlaubt: false, istAktiv: true, maxBetragCent: null,
        begruendung: 'Geht nie ohne einen Menschen hinaus.',
      }));
      const [z] = await sql.unsafe<{ auto_erlaubt: boolean }[]>(
        `select auto_erlaubt from agent_richtlinie where mandant_id = $1 and aktion = $2`,
        [f.reinigung, aktion] as never[]);
      expect(z?.auto_erlaubt).toBe(false);
    });

  it.each([...IM_CODE_GESPERRT])(
    'ein UPDATE auf auto_erlaubt scheitert ebenso (`%s`)',
    async (aktion) => {
      /*
       * Der Riegel steht auf der ZEILE, nicht auf dem INSERT. Waere er nur
       * beim Anlegen geprueft, koennte jemand die Zeile harmlos anlegen und
       * danach umstellen — und genau das ist der Weg, den eine Oberflaeche
       * nimmt.
       */
      await sql.unsafe(
        `insert into agent_richtlinie (mandant_id, aktion, auto_erlaubt)
         values ($1, $2, false)`, [f.reinigung, aktion] as never[]);
      await expect(sql.unsafe(
        `update agent_richtlinie set auto_erlaubt = true
          where mandant_id = $1 and aktion = $2`, [f.reinigung, aktion] as never[],
      )).rejects.toThrow(/agent_richtlinie_kein_auto_willenserklaerung/u);
    });

  it('der Dienst weist die Erlaubnis mit dem GRUND ab, nicht mit einem Code', async () => {
    try {
      await imBereich((k) => setzeRichtlinie(k, {
        aktion: 'nachtrag_einreichen', autoErlaubt: true, istAktiv: true,
        maxBetragCent: null, begruendung: 'egal',
      }));
      throw new Error('hätte werfen müssen');
    } catch (fehler) {
      expect(fehler).toBeInstanceOf(RichtlinieFehler);
      expect((fehler as RichtlinieFehler).grund).toBe('im_code_gesperrt');
      expect((fehler as Error).message).toContain('policy.ts');
    }
  });

  it('eine erlaubte Aktion darf automatisch hinausgehen', async () => {
    /*
     * Der Gegenbeweis: der Riegel sperrt DREI Aktionen und nicht die Tabelle.
     * Ohne diesen Fall koennte die Bedingung versehentlich alles sperren, und
     * jeder Test oben waere weiter gruen.
     */
    await imBereich((k) => setzeRichtlinie(k, {
      aktion: 'email_senden', autoErlaubt: true, istAktiv: true,
      maxBetragCent: null, begruendung: 'Routineantworten dürfen raus.',
    }));
    const [z] = await sql.unsafe<{ auto_erlaubt: boolean }[]>(
      `select auto_erlaubt from agent_richtlinie
        where mandant_id = $1 and aktion = 'email_senden'`, [f.reinigung]);
    expect(z?.auto_erlaubt).toBe(true);
  });
});

describe('(3) `ladeRichtlinie` — eine Zeile nach ihrer Kennung', () => {
  it('findet die Zeile und leitet die Wirkung ab', async () => {
    await imBereich((k) => setzeRichtlinie(k, {
      aktion: 'mahnung_senden', autoErlaubt: true, istAktiv: true,
      maxBetragCent: null, begruendung: 'Mahnstufe 1 darf raus.',
    }));
    const [zeile] = await sql.unsafe<{ id: string }[]>(
      `select id from agent_richtlinie where mandant_id = $1 and aktion = 'mahnung_senden'`,
      [f.reinigung]);
    const blick = await imBereich((k) => ladeRichtlinie(k, zeile!.id));
    expect(blick?.aktion).toBe('mahnung_senden');
    expect(blick?.wirkung).toBe('automatisch');
    expect(blick?.unbekannteAktion).toBe(false);
    expect(blick?.imCodeGesperrt).toBe(false);
  });

  it('nennt eine im Code gesperrte Zeile als solche — nicht „Freigabe nötig"', async () => {
    await imBereich((k) => setzeRichtlinie(k, {
      aktion: 'angebot_senden', autoErlaubt: false, istAktiv: true,
      maxBetragCent: null, begruendung: '§ 145 BGB.',
    }));
    const [zeile] = await sql.unsafe<{ id: string }[]>(
      `select id from agent_richtlinie where mandant_id = $1 and aktion = 'angebot_senden'`,
      [f.reinigung]);
    const blick = await imBereich((k) => ladeRichtlinie(k, zeile!.id));
    expect(blick?.imCodeGesperrt).toBe(true);
    expect(blick?.grund).toContain('§ 145 BGB');
  });

  it('gibt für eine Zeile eines fremden Bereichs null (Invariante 3)', async () => {
    await sql.unsafe(
      `insert into agent_richtlinie (mandant_id, aktion, auto_erlaubt)
       values ($1, 'email_senden', false)`, [f.bau] as never[]);
    const [fremd] = await sql.unsafe<{ id: string }[]>(
      `select id from agent_richtlinie where mandant_id = $1`, [f.bau]);
    /*
     * Nicht „leere Felder", sondern `null`: die Seite macht daraus 404 —
     * nach aussen dasselbe wie „gibt es nicht" (AUT-06).
     */
    expect(await imBereich((k) => ladeRichtlinie(k, fremd!.id))).toBeNull();
  });

  it('gibt für eine unbekannte Kennung null', async () => {
    expect(await imBereich(
      (k) => ladeRichtlinie(k, '00000000-0000-0000-0000-000000000000'))).toBeNull();
  });
});

/**
 * **Die Begründung ist Pflicht, sobald die Automatik eingeschaltet wird** —
 * und zwar im Dienst, nicht nur im Browser (Befund der Prüfrunde,
 * Invariante 7).
 *
 * Die Bearbeitungsseite beschriftete das Feld mit „(Pflicht)" und setzte
 * `required`; durchgesetzt war das damit nur dort, wo ein Browser mitspielt.
 * Schlimmer: dasselbe Feld der Schwesterseite
 * `einstellungen/agent-richtlinien` geht OHNE `required` durch denselben
 * Handler — wer dort eine Betragsgrenze änderte, löschte die auf der
 * Detailseite geschuldete Erklärung still weg, weil der Upsert
 * `begruendung = excluded.begruendung` schrieb.
 */
describe('(4) ohne Begründung keine Automatik', () => {
  it('weist `auto_erlaubt` ohne Begründung ab — mit eigenem Grund', async () => {
    try {
      await imBereich((k) => setzeRichtlinie(k, {
        aktion: 'email_senden', autoErlaubt: true, istAktiv: true,
        maxBetragCent: null, begruendung: null,
      }));
      throw new Error('hätte werfen müssen');
    } catch (fehler) {
      expect(fehler).toBeInstanceOf(RichtlinieFehler);
      expect((fehler as RichtlinieFehler).grund).toBe('begruendung_fehlt');
    }
  });

  it('und eine zu kurze zählt nicht als eine', async () => {
    await expect(imBereich((k) => setzeRichtlinie(k, {
      aktion: 'email_senden', autoErlaubt: true, istAktiv: true,
      maxBetragCent: null, begruendung: 'ok',
    }))).rejects.toThrow(RichtlinieFehler);
  });

  it('schreibt dabei GAR NICHTS — keine halbe Zeile', async () => {
    await expect(imBereich((k) => setzeRichtlinie(k, {
      aktion: 'email_senden', autoErlaubt: true, istAktiv: true,
      maxBetragCent: null, begruendung: null,
    }))).rejects.toThrow(RichtlinieFehler);
    const [z] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from agent_richtlinie
        where mandant_id = $1 and aktion = 'email_senden'`, [f.reinigung]);
    expect(z?.n).toBe('0');
  });

  it('ohne Automatik braucht es keine — eine neue Zeile entsteht fail-closed', async () => {
    /*
     * Das Anlegeformular der Liste schickt nur die Aktion: aktiv, ohne
     * Automatik, ohne Begruendung. Wer nichts ohne Menschen hinauslaesst,
     * schuldet auch keine Erklaerung dafuer.
     */
    await imBereich((k) => setzeRichtlinie(k, {
      aktion: 'email_senden', autoErlaubt: false, istAktiv: true,
      maxBetragCent: null, begruendung: null,
    }));
    const [z] = await sql.unsafe<{ auto_erlaubt: boolean }[]>(
      `select auto_erlaubt from agent_richtlinie
        where mandant_id = $1 and aktion = 'email_senden'`, [f.reinigung]);
    expect(z?.auto_erlaubt).toBe(false);
  });

  it('ein leeres Feld LÖSCHT eine vorhandene Begründung nicht', async () => {
    await imBereich((k) => setzeRichtlinie(k, {
      aktion: 'email_senden', autoErlaubt: true, istAktiv: true,
      maxBetragCent: null, begruendung: 'Routineantworten dürfen raus.',
    }));
    /* Die Schwesterseite speichert nur eine Betragsgrenze — ihr Formular
       traegt dasselbe Feld, aber leer. */
    await imBereich((k) => setzeRichtlinie(k, {
      aktion: 'email_senden', autoErlaubt: true, istAktiv: true,
      maxBetragCent: 50_000n as never, begruendung: null,
    }));
    const [z] = await sql.unsafe<{ begruendung: string | null; max_betrag_cent: string }[]>(
      `select begruendung, max_betrag_cent::text from agent_richtlinie
        where mandant_id = $1 and aktion = 'email_senden'`, [f.reinigung]);
    expect(z?.begruendung).toBe('Routineantworten dürfen raus.');
    expect(z?.max_betrag_cent).toBe('50000');
  });

  it('und die vorhandene erfüllt die Pflicht — die Automatik bleibt an', async () => {
    /*
     * Sonst waere das Ergebnis absurd: die Zeile TRAEGT eine Begruendung, der
     * Dienst weist sie aber ab, weil das Formular sie nicht noch einmal
     * mitschickt.
     */
    await imBereich((k) => setzeRichtlinie(k, {
      aktion: 'email_senden', autoErlaubt: true, istAktiv: true,
      maxBetragCent: null, begruendung: 'Routineantworten dürfen raus.',
    }));
    await imBereich((k) => setzeRichtlinie(k, {
      aktion: 'email_senden', autoErlaubt: true, istAktiv: true,
      maxBetragCent: null, begruendung: null,
    }));
    const [z] = await sql.unsafe<{ auto_erlaubt: boolean }[]>(
      `select auto_erlaubt from agent_richtlinie
        where mandant_id = $1 and aktion = 'email_senden'`, [f.reinigung]);
    expect(z?.auto_erlaubt).toBe(true);
  });
});
