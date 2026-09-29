import type postgres from 'postgres';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import {
  KeineOffeneAnfrage, fuelleTatsachen, starteLaufAufKnopfdruck,
} from '../../src/server/agent/auftraege.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';

/**
 * Die Tatsachen des Akquise-Entwurfs gegen echte Zeilen (§17 „names gaps",
 * Invariante 6/7, V-230, D-724).
 *
 *  1. Die Lücke kommt aus den Daten: zwei Anfragen mit verschiedenen leeren
 *     Feldern ergeben verschiedene Lücken; eine vollständige keine.
 *  2. Keine interne Zahl: `zusammenfassung` nennt kein Anfragevolumen, und
 *     `offene_anfragen` gibt es nicht mehr.
 *  3. Nur eine offene Anfrage: eine jüngere gewonnene oder verlorene wird
 *     übergangen, und ohne offene gibt es keinen Entwurf.
 *  4. Nur, wo jemand gefragt hat (V-271, D-764): von Hand erfasste,
 *     recherchierte und aus dem Radar übernommene Leads bekommen keinen
 *     Dank für eine Anfrage — auch nicht, wenn sie jünger sind. Bis V-271
 *     stand hier „von Hand erfasst: die Bedarfsbeschreibung ist die Lücke";
 *     das war der Entwurf an einen Lead, hinter dem keine belegte Anfrage
 *     steht.
 *  5. Kein interner Betreff: der Text nennt den öffentlichen Titel des
 *     Formulars, nie `lead.betreff`.
 *  6. Kein Lauf ohne Anfrage (V-271, D-724 Nr. 1): der Weg der Laufroute
 *     (`starteLaufAufKnopfdruck`) legt ohne offene Anfrage KEINE Aufgabe an
 *     und antwortet `KEINE_ANFRAGE`; mit einer entsteht die Aufgabe.
 */

let f: Fixtur;
let benutzer = '';
const zufall = (): string => Math.random().toString(36).slice(2, 10);

const FELDER = [
  { typ: 'text', schluessel: 'firma', label: 'Firma', pflicht: true, sortierung: 1,
    fehlermeldung: 'Bitte angeben.' },
  { typ: 'dezimal', schluessel: 'flaeche_qm', label: 'Fläche in m²', pflicht: false,
    sortierung: 2, nachkommastellen: 2, fehlermeldung: 'Bitte angeben.' },
  { typ: 'auswahl', schluessel: 'frequenz', label: 'Reinigungsfrequenz', pflicht: false,
    sortierung: 3, optionen: [{ wert: 'woechentlich', label: 'wöchentlich' }],
    fehlermeldung: 'Bitte wählen.' },
  { typ: 'textarea', schluessel: 'nachricht', label: 'Ihre Nachricht', pflicht: false,
    sortierung: 4, fehlermeldung: 'Bitte kürzen.' },
];

async function konto(): Promise<string> {
  const email = `akquise-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,$2,'aktiv')`,
    [u!.id, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1,$2,(select id from rolle where schluessel = 'admin' and mandant_id is null),true)`,
    [u!.id, f.reinigung]);
  return u!.id;
}

/** Eine Webanfrage mit genau diesen Daten, eingegangen vor `tage` Tagen. */
async function webAnfrage(
  daten: Record<string, unknown>, status: string, tage: number,
  titel = 'Anfrage', betreff = 'Unterhaltsreinigung',
): Promise<void> {
  const [d] = await sql.unsafe<{ id: string }[]>(
    `insert into formular_definition (mandant_id, schluessel, titel, felder,
                                      datenschutz_hinweis_version)
     values ($1, $2, $3, $4::jsonb, 'v1') returning id`,
    /* Das OBJEKT, nicht sein JSON-Text: ein Text würde als jsonb-Zeichenkette
       gespeichert (D-467), und das Formular hätte keine Felder. */
    [f.reinigung, `akq_${zufall()}`, titel, FELDER] as never[]);
  const [e] = await sql.unsafe<{ id: string }[]>(
    `insert into formular_eingang (mandant_id, formular_definition_id, daten,
                                   datenschutz_hinweis_bestaetigt, datenschutz_hinweis_version)
     values ($1, $2, $3::jsonb, true, 'v1') returning id`,
    [f.reinigung, d!.id, daten] as never[]);
  await sql.unsafe(
    `insert into lead (mandant_id, leadnummer, quelle, formular_eingang_id, firma_name, betreff,
                       status, besitzer_benutzer_id, verloren_grund, erstellt_am)
     values ($1, $2, 'webformular', $3, $4, $8, $5::lead_status, $6,
             case when $5 in ('verloren','kein_bedarf') then 'Mitbewerber' end,
             now() - make_interval(days => $7::int))`,
    [f.reinigung, `L-${zufall()}`, e!.id, String(daten['firma'] ?? 'Web GmbH'), status,
      benutzer, tage, betreff]);
}

/** Ein Lead ohne Einsendung: recherchiert oder aus dem Vergaberadar übernommen. */
async function leadOhneAnfrage(
  quelle: 'akquise' | 'vergabe_radar', firma: string, tage: number,
): Promise<void> {
  let ausschreibung: string | null = null;
  if (quelle === 'vergabe_radar') {
    const [a] = await sql.unsafe<{ id: string }[]>(
      `insert into ausschreibung (quelle, quell_id, titel, rohdaten_hash, quell_status)
       values ('oeffentlichevergabe', $1, 'Rückbau', $1, 'aktiv') returning id`,
      [`akq-${zufall()}`]);
    ausschreibung = a!.id;
  }
  await sql.unsafe(
    `insert into lead (mandant_id, leadnummer, quelle, ausschreibung_id, firma_name, betreff,
                       status, besitzer_benutzer_id, erstellt_am)
     values ($1, $2, $3::lead_quelle, $4, $5, $6, 'neu', $7,
             now() - make_interval(days => $8::int))`,
    [f.reinigung, `L-${zufall()}`, quelle, ausschreibung, firma,
      quelle === 'akquise' ? `Akquise: ${firma}` : 'Rückbau', benutzer, tage]);
}

async function handAnfrage(bedarf: string | null, status: string, tage: number): Promise<void> {
  await sql.unsafe(
    `insert into lead (mandant_id, leadnummer, quelle, firma_name, betreff,
                       bedarf_zusammenfassung, status, besitzer_benutzer_id, erstellt_am)
     values ($1, $2, 'manuell', 'Hand GmbH', 'Glasreinigung', $3, $4::lead_status, $5,
             now() - make_interval(days => $6::int))`,
    [f.reinigung, `L-${zufall()}`, bedarf, status, benutzer, tage]);
}

function tatsachen(): Promise<Readonly<Record<string, string>>> {
  return alsApp({
    scope: 'mandant', mandantId: f.reinigung, benutzerId: benutzer,
    portal: 'intern', readonly: true,
  }, async (tx: postgres.TransactionSql) => fuelleTatsachen({
    abfrage: async <T>(a: string, w?: readonly unknown[]): Promise<readonly T[]> =>
      (await tx.unsafe(a, (w ?? []) as never[])) as unknown as readonly T[],
  }, 'akquise')) as Promise<Readonly<Record<string, string>>>;
}

beforeEach(async () => {
  f = await seed();
  benutzer = await konto();
});
afterAll(schliessen);

describe('(1) die Lücke kommt aus den Daten der Anfrage', () => {
  it('fehlt die Frequenz, ist sie die Lücke', async () => {
    await webAnfrage({ firma: 'Nord GmbH', flaeche_qm: 1200 }, 'neu', 1);
    const t = await tatsachen();
    expect(t['offen']).toBe('Reinigungsfrequenz');
    expect(t['empfaenger']).toBe('Nord GmbH');
  });

  it('fehlt die Fläche, ist SIE die Lücke — eine andere Anfrage, ein anderer Satz', async () => {
    await webAnfrage({ firma: 'Süd GmbH', frequenz: 'woechentlich' }, 'in_bearbeitung', 1);
    expect((await tatsachen())['offen']).toBe('Fläche in m²');
  });

  it('eine vollständige Anfrage hat keine Lücke — und keine Personenzahl', async () => {
    await webAnfrage({ firma: 'Ost GmbH', flaeche_qm: 800, frequenz: 'woechentlich' }, 'neu', 1);
    const t = await tatsachen();
    expect(t).not.toHaveProperty('offen');
    expect(JSON.stringify(t)).not.toContain('Personenzahl');
  });
});

describe('(2) keine interne Zahl im Text an den Interessenten', () => {
  it('weder ein Anfragevolumen noch der Schlüssel dafür', async () => {
    await webAnfrage({ firma: 'Nord GmbH' }, 'neu', 1);
    await handAnfrage('Fenster', 'neu', 3);
    await handAnfrage('Treppenhaus', 'in_bearbeitung', 4);
    const t = await tatsachen();
    expect(t).not.toHaveProperty('offene_anfragen');
    expect(t['zusammenfassung']).not.toMatch(/\d/u);
    expect(t['zusammenfassung']).not.toMatch(/bearbeiten wir/u);
  });
});

describe('(3) nur eine offene Anfrage bekommt einen Entwurf', () => {
  it('eine jüngere gewonnene und eine jüngere verlorene werden übergangen', async () => {
    await webAnfrage({ firma: 'Alt GmbH', flaeche_qm: 500 }, 'neu', 10);
    await webAnfrage({ firma: 'Gewonnen GmbH' }, 'gewonnen', 1);
    await webAnfrage({ firma: 'Verloren GmbH' }, 'verloren', 2);
    expect((await tatsachen())['empfaenger']).toBe('Alt GmbH');
  });

  it('ohne offene Anfrage gibt es keinen Entwurf', async () => {
    await webAnfrage({ firma: 'Gewonnen GmbH' }, 'gewonnen', 1);
    await expect(tatsachen()).rejects.toBeInstanceOf(KeineOffeneAnfrage);
  });
});

describe('(4) nur, wo jemand gefragt hat — Radar, Recherche und Handerfassung bekommen keinen Dank', () => {
  it('jüngere Leads ohne Einsendung werden übergangen, geantwortet wird der Webanfrage', async () => {
    await webAnfrage({ firma: 'Web GmbH', flaeche_qm: 300, frequenz: 'woechentlich' }, 'neu', 9);
    await handAnfrage('Fensterfront, zweimal im Jahr.', 'neu', 1);
    await leadOhneAnfrage('akquise', 'Recherchiert AG', 2);
    await leadOhneAnfrage('vergabe_radar', 'Berliner Immobilienmanagement GmbH', 3);
    expect((await tatsachen())['empfaenger']).toBe('Web GmbH');
  });

  it('ohne Einsendung kein Entwurf — auch nicht mit Bedarfsbeschreibung', async () => {
    await handAnfrage(null, 'neu', 1);
    await handAnfrage('Fensterfront, zweimal im Jahr.', 'in_bearbeitung', 2);
    await leadOhneAnfrage('akquise', 'Recherchiert AG', 3);
    await leadOhneAnfrage('vergabe_radar', 'Berliner Immobilienmanagement GmbH', 4);
    await expect(tatsachen()).rejects.toBeInstanceOf(KeineOffeneAnfrage);
  });
});

describe('(5) kein interner Betreff im Text an den Anfragenden', () => {
  it('der Arbeitstitel des Leads steht nirgends, der öffentliche Titel des Formulars schon', async () => {
    await webAnfrage({ firma: 'Nord GmbH', flaeche_qm: 1200, frequenz: 'woechentlich' }, 'neu', 1,
      'Angebot für Gebäudereinigung anfragen', 'Anfrage angebot_reinigung');
    const t = await tatsachen();
    expect(t).not.toHaveProperty('betreff');
    expect(JSON.stringify(t)).not.toContain('angebot_reinigung');
    expect(t['zusammenfassung']).toBe(
      'Ihre Anfrage über unser Formular „Angebot für Gebäudereinigung anfragen" ist bei uns '
      + 'aufgenommen.');
  });
});

describe('(6) der Weg der Laufroute: ohne offene Anfrage kein Lauf und keine Zeile', () => {
  async function aufgaben(): Promise<number> {
    const [z] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from agent_aufgabe a join agent g on g.id = a.agent_id
        where a.mandant_id = $1 and g.kennung = 'akquise'`, [f.reinigung]);
    return Number(z?.n ?? '-1');
  }

  function knopfdruck(schluessel: string): Promise<{ lauf: unknown; code: string | null }> {
    return alsApp({
      scope: 'mandant', mandantId: f.reinigung, benutzerId: benutzer,
      portal: 'intern', readonly: false,
    }, async (tx: postgres.TransactionSql) => {
      const abfrage = async <T>(a: string, w?: readonly unknown[]): Promise<readonly T[]> =>
        (await tx.unsafe(a, (w ?? []) as never[])) as unknown as readonly T[];
      const kontext: SchreibKontext = {
        scope: 'mandant', portal: 'intern', benutzerId: benutzer,
        aktiverMandantId: f.reinigung, mandantIds: [f.reinigung], abfrage, schreibe: abfrage,
      };
      return starteLaufAufKnopfdruck(kontext, {
        agent: 'akquise', schluessel, angefordertVon: benutzer, codeVersion: 'test',
      });
    }) as Promise<{ lauf: unknown; code: string | null }>;
  }

  /* Eingeschaltet — sonst hielte schon der abgeschaltete Agent den Lauf auf
     (D-435), und die Prüfung bewiese nichts über die Anfrage. `agent` gehört
     keinem Mandanten und wird von `seed()` nicht zurückgesetzt: der Stand
     davor kommt danach wieder. */
  let vorherAktiv = false;
  beforeEach(async () => {
    const [a] = await sql.unsafe<{ ist_aktiv: boolean }[]>(
      `select ist_aktiv from agent where kennung = 'akquise'`);
    vorherAktiv = a?.ist_aktiv ?? false;
    await sql.unsafe(`update agent set ist_aktiv = true where kennung = 'akquise'`);
  });
  afterEach(async () => {
    await sql.unsafe(`update agent set ist_aktiv = $1 where kennung = 'akquise'`,
      [vorherAktiv]);
  });

  it('nur eine gewonnene Anfrage: KEINE_ANFRAGE, und es entsteht keine Aufgabe', async () => {
    await webAnfrage({ firma: 'Gewonnen GmbH' }, 'gewonnen', 1);
    await leadOhneAnfrage('akquise', 'Recherchiert AG', 2);
    const vorher = await aufgaben();
    expect(await knopfdruck(`k-${zufall()}`)).toEqual({ lauf: null, code: 'KEINE_ANFRAGE' });
    expect(await aufgaben()).toBe(vorher);
  });

  it('mit einer offenen Anfrage entsteht die Aufgabe — derselbe Weg, dieselbe Funktion', async () => {
    await webAnfrage({ firma: 'Offen GmbH', flaeche_qm: 400 }, 'neu', 1);
    const vorher = await aufgaben();
    const ergebnis = await knopfdruck(`k-${zufall()}`);
    expect(ergebnis.code).toBeNull();
    expect(ergebnis.lauf).not.toBeNull();
    /* Ob der Lauf vorlegt oder mangels Modell und Budget gestört endet, ist
       hier nicht die Frage — die Aufgabe entsteht in beiden Fällen. */
    expect(await aufgaben()).toBe(vorher + 1);
  });
});
