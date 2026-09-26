import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import { KeineOffeneAnfrage, fuelleTatsachen } from '../../src/server/agent/auftraege.js';

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
 *  4. Von Hand erfasst: fehlt die Bedarfsbeschreibung, ist SIE die Lücke.
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
): Promise<void> {
  const [d] = await sql.unsafe<{ id: string }[]>(
    `insert into formular_definition (mandant_id, schluessel, titel, felder,
                                      datenschutz_hinweis_version)
     values ($1, $2, 'Anfrage', $3::jsonb, 'v1') returning id`,
    /* Das OBJEKT, nicht sein JSON-Text: ein Text würde als jsonb-Zeichenkette
       gespeichert (D-467), und das Formular hätte keine Felder. */
    [f.reinigung, `akq_${zufall()}`, FELDER] as never[]);
  const [e] = await sql.unsafe<{ id: string }[]>(
    `insert into formular_eingang (mandant_id, formular_definition_id, daten,
                                   datenschutz_hinweis_bestaetigt, datenschutz_hinweis_version)
     values ($1, $2, $3::jsonb, true, 'v1') returning id`,
    [f.reinigung, d!.id, daten] as never[]);
  await sql.unsafe(
    `insert into lead (mandant_id, leadnummer, quelle, formular_eingang_id, firma_name, betreff,
                       status, besitzer_benutzer_id, verloren_grund, erstellt_am)
     values ($1, $2, 'webformular', $3, $4, 'Unterhaltsreinigung', $5::lead_status, $6,
             case when $5 in ('verloren','kein_bedarf') then 'Mitbewerber' end,
             now() - make_interval(days => $7::int))`,
    [f.reinigung, `L-${zufall()}`, e!.id, String(daten['firma'] ?? 'Web GmbH'), status,
      benutzer, tage]);
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

describe('(4) von Hand erfasst: die Bedarfsbeschreibung ist die einzige erkennbare Lücke', () => {
  it('fehlt sie, wird sie genannt; steht sie da, gibt es keine Lücke', async () => {
    await handAnfrage(null, 'neu', 1);
    expect((await tatsachen())['offen']).toBe('eine Beschreibung Ihres Bedarfs');

    /* Keine Löschung (trg_lead_kein_hard_delete): die erste wird archiviert. */
    await sql.unsafe(`update lead set archiviert_am = now() where mandant_id = $1`,
      [f.reinigung]);
    await handAnfrage('Fensterfront, zweimal im Jahr.', 'neu', 1);
    expect(await tatsachen()).not.toHaveProperty('offen');
  });
});
