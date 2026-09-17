/**
 * Jede Abfrage der sechs Bauseiten gegen die ECHTEN Spaltenrechte.
 *
 * **Warum diese Datei existiert.** Zwei Abfragen dieser Welle liefen im
 * Typsystem sauber, im Einheitstest sauber, und scheiterten gegen echtes
 * Postgres mit `permission denied` — fuer JEDEN Benutzer, nicht nur fuer den
 * ohne Preisrecht:
 *
 *  1. `findeLvPosition` las `lv_position.steuer_kennzeichen`. 0071 entzieht
 *     `cse_app` das `select` auf die Tabelle und erteilt eine erschoepfende
 *     Spaltenliste OHNE `einheitspreis_cent` und `steuer_kennzeichen`.
 *  2. `ladeNachtraegeJePosition` schrieb `select n.*` in drei
 *     Vereinigungszweigen. `n.*` expandiert auf ALLE Spalten — auch auf
 *     `betrag_netto_cent`, das 0080 genauso entzogen hat.
 *
 * Ein Spalten-GRANT maskiert nicht, er verweigert: die Seite antwortet mit
 * einem Fehler, nicht mit einer Luecke. Und keine Zusicherung ueber Inhalte
 * faengt das, weil die Abfrage gar nicht erst laeuft. Dieser Test ruft jeden
 * Leser der sechs Seiten einmal auf — mit Preisrecht und ohne.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import {
  ladeBauKennzahlen, ladeProjektMarge, tageOhneBautagebuch,
} from '../../src/server/services/bau/uebersicht.js';
import {
  bestaetigeLvPosition, findeLvPosition, findeProjektDetail, ladeAufmasseJePosition,
  ladeLvPfad, ladeNachtraegeJePosition,
} from '../../src/server/services/bau/lv.js';
import { listeAbnahmen } from '../../src/server/services/bau/abnahme.js';
import { listeLvImporte } from '../../src/server/services/bau/lv-import.js';
import type { LeseKontext, SchreibKontext } from '../../src/server/kontext/index.js';

let f: Fixtur;
const zufall = (): string => String(Math.random()).slice(2, 10);

interface Aufbau {
  readonly mandant: string;
  readonly projekt: string;
  readonly lv: string;
  readonly benutzer: string;
  /** Eine Position im HAUPT-LV — maschinell gelesen, ungeprueft. */
  readonly position: string;
  /** Eine Position im NACHTRAGS-LV — sie traegt den Bezug `nachtrags_lv`. */
  readonly nachtragsPosition: string;
}

/**
 * `readonly: false` ist Pflicht: die Harness setzt `app.readonly` auf `on`,
 * sobald das Feld fehlt (fail-closed), und jede `with check`-Bedingung
 * verlangt `not app.ist_readonly()`.
 */
const SITZUNG = (bau: Aufbau) => ({
  scope: 'mandant' as const, mandantId: bau.mandant, benutzerId: bau.benutzer,
  portal: 'intern' as const, readonly: false,
});

function kontextAus(tx: postgres.TransactionSql, bau: Aufbau): SchreibKontext {
  const fuehre = async <T>(s: string, w?: readonly unknown[]): Promise<readonly T[]> =>
    tx.unsafe(s, (w ?? []) as never[]) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId: bau.benutzer,
    aktiverMandantId: bau.mandant, mandantIds: [bau.mandant],
    abfrage: fuehre, schreibe: fuehre,
  } satisfies LeseKontext & SchreibKontext;
}

async function rolleId(schluessel: string): Promise<string> {
  const [r] = await sql.unsafe<{ id: string }[]>(
    `select id from rolle where schluessel = $1 and mandant_id is null`, [schluessel]);
  return r!.id;
}

/** Projekt, Haupt-LV, Nachtrag mit eigenem LV — der Aufbau beider Bezugswege. */
async function baueProjekt(mandant: string, rolle = 'leitung'): Promise<Aufbau> {
  const email = `seiten-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,'Bauleitung Probe','aktiv')`,
    [u!.id, email] as never[]);
  /*
   * **`gueltig_ab` ausdruecklich auf GESTERN — ein Befund, keine Vorsicht.**
   * Der Spaltenvorgabewert ist `app.berlin_heute()` (0169), `app.ist_mitglied`
   * hat aber `p_stichtag date default CURRENT_DATE`, und die
   * Zwei-Argument-Aufrufer (0025, 0146) nehmen genau diesen Vorgabewert.
   * Zwischen 22:00 UTC und Mitternacht ist `berlin_heute()` schon morgen und
   * `CURRENT_DATE` noch heute: die Mitgliedschaft gilt dann nicht, und das
   * Anlegen des Auftrags scheitert. Die Ursache gehoert nach 0169.
   */
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, gueltig_ab)
     values ($1,$2,$3, current_date - 1)`, [u!.id, mandant, await rolleId(rolle)] as never[]);

  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name)
     values ($1,$2,'Hausverwaltung Nord') returning id`, [mandant, `K-${zufall()}`]);
  const [a] = await sql.unsafe<{ id: string }[]>(
    `insert into auftrag (mandant_id, auftragsnummer, kunde_id, art, status, bezeichnung,
                          verantwortlich_benutzer_id, start_datum)
     values ($1,$2,$3,'projekt','aktiv','Dachgeschossausbau',$4,'2026-01-01') returning id`,
    [mandant, `AU-${zufall()}`, k!.id, u!.id] as never[]);
  const [p] = await sql.unsafe<{ id: string }[]>(
    `insert into projekt (mandant_id, auftrag_id, nummer, bezeichnung, kunde_id, art,
                          vertragsgrundlage, status, auftragssumme_netto_cent,
                          sicherheitseinbehalt_bp, verantwortlich_benutzer_id)
     values ($1,$2,$3,'Dachgeschossausbau',$4,'ausbau','vob_b','in_arbeit',
             4200000,500,$5) returning id`,
    [mandant, a!.id, `P-${zufall()}`, k!.id, u!.id] as never[]);
  const [lv] = await sql.unsafe<{ id: string }[]>(
    `insert into leistungsverzeichnis (mandant_id, projekt_id, art, bezeichnung)
     values ($1,$2,'hauptauftrag','LV Ausbau') returning id`, [mandant, p!.id] as never[]);

  const [titel] = await sql.unsafe<{ id: string }[]>(
    `insert into lv_position (mandant_id, leistungsverzeichnis_id, projekt_id, oz, pfad,
                              sortier_pfad, ebene, art, positionsart, kurztext)
     values ($1,$2,$3,'1','','',1,'titel','unbestimmt','Trockenbau') returning id`,
    [mandant, lv!.id, p!.id] as never[]);
  const [pos] = await sql.unsafe<{ id: string }[]>(
    `insert into lv_position (mandant_id, leistungsverzeichnis_id, projekt_id, eltern_id, oz,
                              pfad, sortier_pfad, ebene, art, positionsart, kurztext, langtext,
                              einheit, menge_vertrag, einheitspreis_cent, steuer_kennzeichen,
                              konfidenz, quelle_seite)
     values ($1,$2,$3,$4,'1.1','','',2,'position','normalposition','Ständerwand CW 75',
             'Nichttragende Trennwand in Metallständerbauweise.','m²','148.500',8650,
             'regelsatz','82.00',4) returning id`,
    [mandant, lv!.id, p!.id, titel!.id] as never[]);

  // Der Nachtrag mit eigenem Verzeichnis — der Bezugsweg `nachtrags_lv`.
  const [grundlage] = await sql.unsafe<{ id: string }[]>(
    `insert into nachtrag_grundlage (mandant_id, schluessel, bezeichnung, fundstelle,
                                     beschreibung, ankuendigung_erforderlich, reihenfolge,
                                     ist_platzhalter)
     values ($1,$2,'Geänderte Leistung','§ 2 Abs. 5 VOB/B',
             'Der Auftraggeber ändert den Bauentwurf.',false,1,true) returning id`,
    [mandant, `vob_b_2_5_${zufall()}`] as never[]);
  const [n] = await sql.unsafe<{ id: string }[]>(
    `insert into nachtrag (mandant_id, projekt_id, auftrag_id, nummer, titel, grundlage_id,
                           begruendung, status, angemeldet_am, betrag_netto_cent, erstellt_von)
     values ($1,$2,$3,'N-001','Schachtverkleidung F90',$4,
             'Der Auftraggeber hat den Abluftstrang nachträglich verlangt.',
             'angemeldet','2026-09-14',148000,$5) returning id`,
    [mandant, p!.id, a!.id, grundlage!.id, u!.id] as never[]);
  const [nlv] = await sql.unsafe<{ id: string }[]>(
    `insert into leistungsverzeichnis (mandant_id, projekt_id, nachtrag_id, art, bezeichnung)
     values ($1,$2,$3,'nachtrag','Nachtrags-LV N-001') returning id`,
    [mandant, p!.id, n!.id] as never[]);
  const [npos] = await sql.unsafe<{ id: string }[]>(
    `insert into lv_position (mandant_id, leistungsverzeichnis_id, projekt_id, oz, pfad,
                              sortier_pfad, ebene, art, positionsart, kurztext, einheit,
                              menge_vertrag, einheitspreis_cent)
     values ($1,$2,$3,'1','','',1,'position','normalposition',
             'Schachtverkleidung F90','m²','18.400',14250) returning id`,
    [mandant, nlv!.id, p!.id] as never[]);

  return {
    mandant, projekt: p!.id, lv: lv!.id, benutzer: u!.id,
    position: pos!.id, nachtragsPosition: npos!.id,
  };
}

beforeEach(async () => { f = await seed(); });
afterAll(async () => { await schliessen(); });

describe('ohne `bau.preis_lesen` (Rolle `leitung`) laeuft JEDE Abfrage', () => {
  it('Moduluebersicht: Kennzahlen und fehlende Bautage', async () => {
    const bau = await baueProjekt(f.bau);
    const d = await alsApp(SITZUNG(bau), async (tx) => {
      const kontext = kontextAus(tx, bau);
      return {
        kennzahlen: await ladeBauKennzahlen(kontext),
        luecken: await tageOhneBautagebuch(kontext, { tage: 7 }),
      };
    });
    expect(d.kennzahlen.projekte).toBe(1);
    expect(d.kennzahlen.nachtraege_offen).toBe(1);
    expect(d.kennzahlen.abnahmen).toBe(0);
    expect(Array.isArray(d.luecken)).toBe(true);
  });

  it('Projektdetail — und die Vertragssumme bleibt LEER, nie 0 € (0213)', async () => {
    const bau = await baueProjekt(f.bau);
    const p = await alsApp(SITZUNG(bau),
      async (tx) => findeProjektDetail(kontextAus(tx, bau), bau.projekt));
    expect(p?.bezeichnung).toBe('Dachgeschossausbau');
    expect(p?.vertragsgrundlage).toBe('vob_b');
    expect(p?.lv_anzahl).toBe(2);
    expect(p?.darf_preis_lesen).toBe(false);
    expect(p?.auftragssumme_cent).toBeNull();
    expect(p?.sicherheitseinbehalt_bp).toBeNull();
  });

  it('Positionsdetail, Pfad, Aufmasse und Nachtraege je Position', async () => {
    const bau = await baueProjekt(f.bau);
    const d = await alsApp(SITZUNG(bau), async (tx) => {
      const kontext = kontextAus(tx, bau);
      return {
        position: await findeLvPosition(kontext, bau.position),
        pfad: await ladeLvPfad(kontext, bau.position),
        aufmasse: await ladeAufmasseJePosition(kontext, bau.position),
        nachtraege: await ladeNachtraegeJePosition(kontext, bau.nachtragsPosition),
        abnahmen: await listeAbnahmen(kontext, { projektId: bau.projekt }),
        importe: await listeLvImporte(kontext, bau.projekt),
      };
    });
    expect(d.position?.oz).toBe('1.1');
    expect(d.position?.quelle_seite).toBe(4);
    expect(d.position?.konfidenz).toBe('82.00');
    // K-05: der Preis kommt nur ueber `app.lv_preis_lesen`, und ohne das
    // Recht gibt der Leser NULL — nie eine 0.
    expect(d.position?.einheitspreis_cent).toBeNull();
    expect(d.position?.darf_preis_lesen).toBe(false);
    expect(d.pfad.map((z) => z.oz)).toEqual(['1']);
    expect(d.aufmasse).toEqual([]);
    // Der Bezugsweg steht dabei — im § 2-Streit ist genau er die Frage.
    expect(d.nachtraege.map((z) => [z.nummer, z.bezug])).toEqual([['N-001', 'nachtrags_lv']]);
    expect(d.abnahmen).toEqual([]);
    expect(d.importe).toEqual([]);
  });

  it('die Bestaetigung der maschinell gelesenen Position benennt ihren Pruefer', async () => {
    const bau = await baueProjekt(f.bau);
    const nachher = await alsApp(SITZUNG(bau), async (tx) => {
      const kontext = kontextAus(tx, bau);
      await bestaetigeLvPosition(kontext, bau.position);
      return findeLvPosition(kontext, bau.position);
    });
    expect(nachher?.geprueft_lokal).not.toBeNull();
    expect(nachher?.geprueft_von_name).toBe('Bauleitung Probe');
  });
});

describe('mit `bau.preis_lesen` (Rolle `admin`) kommen Preis und Summe durch', () => {
  it('Einheitspreis, Auftragssumme und Sicherheitseinbehalt stehen da', async () => {
    const bau = await baueProjekt(f.bau, 'admin');
    const d = await alsApp(SITZUNG(bau), async (tx) => {
      const kontext = kontextAus(tx, bau);
      return {
        projekt: await findeProjektDetail(kontext, bau.projekt),
        position: await findeLvPosition(kontext, bau.position),
        marge: await ladeProjektMarge(kontext, bau.projekt),
      };
    });
    expect(d.projekt?.darf_preis_lesen).toBe(true);
    expect(d.projekt?.auftragssumme_cent).toBe('4200000');
    expect(d.projekt?.sicherheitseinbehalt_bp).toBe(500);
    expect(d.position?.einheitspreis_cent).toBe('8650');
    // `kalkulation.lesen` haelt `admin` ebenfalls — die Marge kommt als Zeile.
    expect(d.marge).not.toBeNull();
  });
});
