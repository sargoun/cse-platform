import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import {
  aendereProjekt, archiviereProjekt, auftraegeOhneProjekt, legeProjektAn, ProjektFehler,
} from '../../src/server/services/bau/projekt.js';

/**
 * Ein Bauvorhaben anlegen, ändern und archivieren (V-003, OPS-05, BAU-01).
 *
 * **Warum diese Datei entsteht.** Zwanzig gebaute Projektseiten —
 * Leistungsverzeichnis, Aufmass, Nachträge, Bautagebuch,
 * Behinderungsanzeige, Abnahme — hingen an einer Zeile, die ausschliesslich
 * im Seed entstand.
 *
 * Vier Dinge fallen leise aus, und die prüft diese Datei:
 *
 *  1. **`projekt_auftrag_uk`.** Genau ein Projekt je Auftrag. Käme die
 *     Abweisung erst aus dem eindeutigen Index, läse sie sich als
 *     `duplicate key value violates unique constraint`.
 *  2. **Kunde und Nummer kommen aus dem AUFTRAG**, nicht aus dem Formular.
 *     Ein zweites Feld daneben liesse beide auseinanderlaufen — und das
 *     fiele erst auf der Rechnung auf.
 *  3. **Die Vertragsgrundlage hat keinen Vorgabewert.** VOB/B und BGB
 *     unterscheiden Fristen, Abnahme und Nachträge; eine stille
 *     Voreinstellung wäre eine Rechtswahl, die niemand getroffen hat.
 *  4. **Geld bleibt ganzzahlig** (Invariante 1) und der Einbehalt steht in
 *     Basispunkten — `5` sind fünf Hundertstel Prozent, nicht fünf Prozent.
 */

let f: Fixtur;
let benutzer: string;
let kundeBau: string;
let auftragA: string;
let auftragB: string;

beforeAll(async () => {
  f = await seed();
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ('bauleitung@cse.test') returning id`);
  benutzer = u!.id;
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [benutzer]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, globale_rolle_id)
     values ($1, 'bauleitung@cse.test', 'Bauleitung', 'aktiv',
             (select id from rolle where schluessel = 'super_admin' and mandant_id is null))`,
    [benutzer]);
  for (const m of [f.bau, f.security]) {
    await sql.unsafe(
      `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
       values ($1, $2, (select id from rolle where schluessel = 'admin' and mandant_id is null),
               $3)`,
      [benutzer, m, m === f.bau]);
  }

  /*
   * Zwei Auftraege ohne Bauakte — einer fuer den Normalfall, einer fuer die
   * Pruefung, dass ein zweites Projekt am SELBEN Auftrag abgewiesen wird.
   * Sie entstehen hier roh, weil die Anlegewege von Kunde und Auftrag
   * eigene Pruefstuecke haben und diese Datei das Projekt prueft.
   */
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, status)
     values ($1, 'K-TEST-BAU', 'Bauherr Testallee GmbH', 'aktiv') returning id`, [f.bau]);
  kundeBau = k!.id;
  for (const nummer of ['AU-TEST-0001', 'AU-TEST-0002']) {
    const [a] = await sql.unsafe<{ id: string }[]>(
      `insert into auftrag (mandant_id, auftragsnummer, kunde_id, art, status, bezeichnung,
                            verantwortlich_benutzer_id, start_datum)
       values ($1, $2, $3, 'projekt', 'aktiv', $4, $5, app.berlin_heute()) returning id`,
      [f.bau, nummer, kundeBau, `Vorhaben ${nummer}`, benutzer]);
    if (nummer === 'AU-TEST-0001') auftragA = a!.id; else auftragB = a!.id;
  }
});
afterAll(schliessen);

type Abfrager = { unsafe(s: string, w?: readonly unknown[]): Promise<readonly unknown[]> };

function kontextAus(tx: Abfrager, mandantId: string) {
  return {
    aktiverMandantId: mandantId,
    benutzerId: benutzer,
    abfrage: async <T,>(s: string, w: readonly unknown[] = []) =>
      (await tx.unsafe(s, w)) as readonly T[],
    schreibe: async <T,>(s: string, w: readonly unknown[] = []) =>
      (await tx.unsafe(s, w)) as readonly T[],
  } as never;
}

function sitzung(mandantId = f.bau) {
  return { scope: 'mandant' as const, mandantId, benutzerId: benutzer,
           readonly: false, portal: 'intern' as const };
}

const GRUND = {
  bezeichnung: 'Ausbau Dachgeschoss', art: 'ausbau', vertragsgrundlage: 'vob_b',
} as const;

describe('§1 ein Projekt ist ein Auftrag mit Bauakte', () => {
  it('übernimmt Nummer, Kunde und Objekt aus dem Auftrag', async () => {
    const a = await alsApp(sitzung(), (tx) => legeProjektAn(kontextAus(tx, f.bau), {
      ...GRUND, auftragId: auftragA,
    }));
    expect(a.nummer).toBe('AU-TEST-0001');
    const [z] = await sql.unsafe<{ kunde_id: string; auftrag_id: string; status: string }[]>(
      `select kunde_id, auftrag_id, status from projekt where id = $1`, [a.id]);
    expect(z!.kunde_id).toBe(kundeBau);
    expect(z!.auftrag_id).toBe(auftragA);
    /* `projekt_status` steht ohne Angabe auf `geplant` — der Vorgabewert der Spalte. */
    expect(z!.status).toBe('geplant');
  });

  it('WEIST ein zweites Projekt am selben Auftrag ab — mit einem Satz', async () => {
    await expect(alsApp(sitzung(), (tx) => legeProjektAn(kontextAus(tx, f.bau), {
      ...GRUND, auftragId: auftragA, bezeichnung: 'Zweites Vorhaben',
    }))).rejects.toThrow(/bereits ein Bauprojekt/u);
  });

  it('nennt in der Auswahlliste nur Aufträge OHNE Bauakte', async () => {
    const liste = await alsApp(sitzung(), (tx) =>
      auftraegeOhneProjekt(kontextAus(tx, f.bau)));
    const nummern = liste.map((a) => a.auftragsnummer);
    expect(nummern).toContain('AU-TEST-0002');
    expect(nummern).not.toContain('AU-TEST-0001');
  });

  it('WEIST eine unbekannte Auftragskennung ab', async () => {
    await expect(alsApp(sitzung(), (tx) => legeProjektAn(kontextAus(tx, f.bau), {
      ...GRUND, auftragId: '00000000-0000-0000-0000-000000000000',
    }))).rejects.toThrow(ProjektFehler);
  });
});

describe('§2 die Vertragsgrundlage ist eine Wahl, keine Voreinstellung', () => {
  it('WEIST eine fehlende Vertragsgrundlage ab', async () => {
    await expect(alsApp(sitzung(), (tx) => legeProjektAn(kontextAus(tx, f.bau), {
      ...GRUND, auftragId: auftragB, vertragsgrundlage: '',
    }))).rejects.toThrow(/VOB\/B oder BGB/u);
  });

  it('WEIST eine erfundene Vertragsgrundlage ab', async () => {
    await expect(alsApp(sitzung(), (tx) => legeProjektAn(kontextAus(tx, f.bau), {
      ...GRUND, auftragId: auftragB, vertragsgrundlage: 'handschlag',
    }))).rejects.toThrow(ProjektFehler);
  });

  it('WEIST eine erfundene Bauart ab', async () => {
    await expect(alsApp(sitzung(), (tx) => legeProjektAn(kontextAus(tx, f.bau), {
      ...GRUND, auftragId: auftragB, art: 'tiefbau',
    }))).rejects.toThrow(ProjektFehler);
  });
});

describe('§3 Geld ist ganzzahlig, der Einbehalt steht in Basispunkten', () => {
  it('WEIST eine Auftragssumme mit Komma ab', async () => {
    await expect(alsApp(sitzung(), (tx) => legeProjektAn(kontextAus(tx, f.bau), {
      ...GRUND, auftragId: auftragB, auftragssummeNettoCent: '87704,07',
    }))).rejects.toThrow(/ganzen Cent/u);
  });

  it('WEIST einen Einbehalt ausserhalb 0…10000 ab', async () => {
    await expect(alsApp(sitzung(), (tx) => legeProjektAn(kontextAus(tx, f.bau), {
      ...GRUND, auftragId: auftragB, sicherheitseinbehaltBp: '10001',
    }))).rejects.toThrow(ProjektFehler);
  });

  it('deutet einen Prozentwert NICHT um — 5 bleiben 5 Basispunkte', async () => {
    const a = await alsApp(sitzung(), (tx) => legeProjektAn(kontextAus(tx, f.bau), {
      ...GRUND, auftragId: auftragB, sicherheitseinbehaltBp: '5',
      auftragssummeNettoCent: '8770407',
    }));
    const [z] = await sql.unsafe<
      { sicherheitseinbehalt_bp: number; auftragssumme_netto_cent: string }[]>(
        `select sicherheitseinbehalt_bp, auftragssumme_netto_cent
           from projekt where id = $1`, [a.id]);
    expect(z!.sicherheitseinbehalt_bp).toBe(5);
    expect(String(z!.auftragssumme_netto_cent)).toBe('8770407');
  });
});

describe('§4 die Gesellschaftsgrenze (Invariante 3)', () => {
  it('ein Auftrag der Bau-Gesellschaft ist aus der Security nicht bebaubar', async () => {
    await expect(alsApp(sitzung(f.security), (tx) =>
      legeProjektAn(kontextAus(tx, f.security), {
        ...GRUND, auftragId: auftragB, bezeichnung: 'Übernahmeversuch',
      }))).rejects.toThrow(ProjektFehler);
  });
});

describe('§5 ändern und archivieren', () => {
  it('ändert Bezeichnung, Art und Zustand', async () => {
    const [a] = await sql.unsafe<{ id: string }[]>(
      `insert into auftrag (mandant_id, auftragsnummer, kunde_id, art, status, bezeichnung,
                            verantwortlich_benutzer_id, start_datum)
       values ($1, 'AU-TEST-0010', $2, 'projekt', 'aktiv', 'Änderbar', $3, app.berlin_heute())
       returning id`,
      [f.bau, kundeBau, benutzer]);
    const p = await alsApp(sitzung(), (tx) => legeProjektAn(kontextAus(tx, f.bau), {
      ...GRUND, auftragId: a!.id,
    }));
    await alsApp(sitzung(), (tx) => aendereProjekt(kontextAus(tx, f.bau), {
      id: p.id, bezeichnung: 'Umbenannt', art: 'rueckbau',
      vertragsgrundlage: 'bgb', status: 'in_arbeit',
    }));
    const [z] = await sql.unsafe<
      { bezeichnung: string; art: string; vertragsgrundlage: string; status: string }[]>(
        `select bezeichnung, art, vertragsgrundlage, status from projekt where id = $1`,
        [p.id]);
    expect(z!.bezeichnung).toBe('Umbenannt');
    expect(z!.art).toBe('rueckbau');
    expect(z!.vertragsgrundlage).toBe('bgb');
    expect(z!.status).toBe('in_arbeit');
  });

  it('lässt Auftrag und Nummer beim Ändern stehen', async () => {
    const [a] = await sql.unsafe<{ id: string }[]>(
      `insert into auftrag (mandant_id, auftragsnummer, kunde_id, art, status, bezeichnung,
                            verantwortlich_benutzer_id, start_datum)
       values ($1, 'AU-TEST-0011', $2, 'projekt', 'aktiv', 'Nummerfest', $3, app.berlin_heute())
       returning id`,
      [f.bau, kundeBau, benutzer]);
    const p = await alsApp(sitzung(), (tx) => legeProjektAn(kontextAus(tx, f.bau), {
      ...GRUND, auftragId: a!.id,
    }));
    await alsApp(sitzung(), (tx) => aendereProjekt(kontextAus(tx, f.bau), {
      id: p.id, bezeichnung: 'Anders', art: 'ausbau', vertragsgrundlage: 'vob_b',
    }));
    const [z] = await sql.unsafe<{ nummer: string; auftrag_id: string }[]>(
      `select nummer, auftrag_id from projekt where id = $1`, [p.id]);
    expect(z!.nummer).toBe('AU-TEST-0011');
    expect(z!.auftrag_id).toBe(a!.id);
  });

  it('archiviert, setzt den Zustand mit und LÖSCHT nichts (Invariante 8)', async () => {
    const [a] = await sql.unsafe<{ id: string }[]>(
      `insert into auftrag (mandant_id, auftragsnummer, kunde_id, art, status, bezeichnung,
                            verantwortlich_benutzer_id, start_datum)
       values ($1, 'AU-TEST-0012', $2, 'projekt', 'aktiv', 'Archivierbar', $3, app.berlin_heute())
       returning id`,
      [f.bau, kundeBau, benutzer]);
    const p = await alsApp(sitzung(), (tx) => legeProjektAn(kontextAus(tx, f.bau), {
      ...GRUND, auftragId: a!.id,
    }));
    await alsApp(sitzung(), (tx) => archiviereProjekt(kontextAus(tx, f.bau), p.id));
    const [z] = await sql.unsafe<
      { archiviert_am: string | null; archiviert_von: string | null; status: string }[]>(
        `select archiviert_am, archiviert_von, status from projekt where id = $1`, [p.id]);
    expect(z!.archiviert_am).not.toBeNull();
    /* `projekt_archiv_paarweise` verlangt beide Stempel zusammen. */
    expect(z!.archiviert_von).not.toBeNull();
    expect(z!.status).toBe('archiviert');
  });

  it('WEIST ein zweites Archivieren ab', async () => {
    const [a] = await sql.unsafe<{ id: string }[]>(
      `insert into auftrag (mandant_id, auftragsnummer, kunde_id, art, status, bezeichnung,
                            verantwortlich_benutzer_id, start_datum)
       values ($1, 'AU-TEST-0013', $2, 'projekt', 'aktiv', 'Einmal', $3, app.berlin_heute())
       returning id`,
      [f.bau, kundeBau, benutzer]);
    const p = await alsApp(sitzung(), (tx) => legeProjektAn(kontextAus(tx, f.bau), {
      ...GRUND, auftragId: a!.id,
    }));
    await alsApp(sitzung(), (tx) => archiviereProjekt(kontextAus(tx, f.bau), p.id));
    await expect(alsApp(sitzung(), (tx) =>
      archiviereProjekt(kontextAus(tx, f.bau), p.id))).rejects.toThrow(ProjektFehler);
  });
});
