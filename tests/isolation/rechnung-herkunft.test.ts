/**
 * PR 49 — Abnahme (1) bis (5) gegen eine ECHTE Datenbank mit FORCE RLS.
 *
 * Keine dieser Aussagen lässt sich mocken:
 *
 *  · „Eine Zeile ohne Beleg lässt sich nicht anlegen" ist eine Aussage über
 *    einen **aufgeschobenen Auslöser**, und der feuert beim COMMIT. Ein Mock
 *    wäre der übergangene Aufrufer, gegen den die Bedingung geschrieben ist.
 *  · „Eine Stunde wird nicht still ein zweites Mal abgerechnet" ist eine
 *    Aussage über einen partiellen Unique-Index und über eine Spalte auf der
 *    Quellseite — **beide**, und der Test zeigt, dass keiner den anderen
 *    ersetzt.
 *  · „Ein Aufmaß wird bewusst NICHT exklusiv beansprucht" lässt sich nur mit
 *    einer Zwei-Raten-Fixtur zeigen: die zweite Rate muss durchgehen, die
 *    übermäßige dritte nicht.
 *  · „Die Warnung fällt, BEVOR eine Nummer gezogen wird" ist eine Aussage über
 *    den Zähler in `nummernkreis` — und die ist nur nachprüfbar, wenn man ihn
 *    vorher und nachher liest.
 *
 * **Jede Prüfung ist falsifizierbar.** Wo das nicht offensichtlich ist, steht
 * daneben, welche Sicherung man entfernen müsste, damit sie fällt.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { schliessen, seed, sql, type Fixtur } from './harness.js';
import { cent } from '../../src/server/services/finanz/geld.js';
import { milliMenge } from '../../src/server/services/finanz/menge.js';
import {
  finalisiere, fuegePositionHinzu, fuegeZeitPositionHinzu, korrigiere, legeEntwurfAn,
  schreibeSummen, storniere, vonHand,
} from '../../src/server/services/finanz/rechnung.js';
import {
  fuegeQuelleHinzu, ladeQuellen, pruefeZeiterfassung, type Abfrage,
} from '../../src/server/services/finanz/positionsquelle.js';

let f: Fixtur;
let benutzer: string;
let bau: Aufbau;

const zufall = (): string => String(Math.random()).slice(2, 10);

interface Aufbau {
  readonly mandant: string;
  readonly kunde: string;
  readonly objekt: string;
  readonly auftrag: string;
  readonly leistung: string;
  readonly person: string;
  readonly anstellung: string;
  readonly projekt: string;
  readonly lv: string;
  readonly lvPosition: string;
}

function alsDienst(tx: postgres.TransactionSql): Abfrage {
  return {
    abfrage: async <T,>(anweisung: string, werte: readonly unknown[] = []) =>
      (await tx.unsafe(anweisung, werte as never[])) as readonly T[],
  };
}

/** Eine Sitzung im internen Portal mit allen Finanz- und Zeitrechten. */
async function inSitzung<T>(
  mandantId: string, fn: (tx: postgres.TransactionSql) => Promise<T>,
  opts: { portal?: string; kunden?: readonly string[] } = {},
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx.unsafe(`set local role cse_app`);
    await tx.unsafe(`select set_config('app.scope', 'mandant', true)`);
    await tx.unsafe(`select set_config('app.mandant_id', $1, true)`, [mandantId]);
    await tx.unsafe(`select set_config('app.mandant_ids', $1, true)`, [mandantId]);
    await tx.unsafe(`select set_config('app.person_id', '', true)`);
    await tx.unsafe(`select set_config('app.benutzer_id', $1, true)`, [benutzer]);
    await tx.unsafe(`select set_config('app.readonly', 'off', true)`);
    await tx.unsafe(`select set_config('app.portal', $1, true)`, [opts.portal ?? 'intern']);
    await tx.unsafe(`select set_config('app.akteur_typ', 'mensch', true)`);
    /* Vollständig angemeldet — ein admin-Konto hält ohne aal2 nichts (V-136). */
    await tx.unsafe(`select set_config('app.aal', 'aal2', true)`);
    return fn(tx);
  }) as Promise<T>;
}

async function legeBenutzerAn(email: string): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email],
  );
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, globale_rolle_id)
     values ($1, $2, 'Buchhaltung', 'aktiv',
             (select id from rolle where schluessel = 'super_admin' and mandant_id is null))`,
    [u!.id, email],
  );
  return u!.id;
}

async function macheFakturierfaehig(mandantId: string, praefix: string): Promise<void> {
  await sql.unsafe(
    `update mandant
        set ist_rechtseinheit = true, eigener_nummernkreis = true,
            strasse = 'Kurfürstendamm 21', plz = '10719', ort = 'Berlin',
            ust_id = 'DE123456789', steuernummer = '30/123/45678',
            handelsregister_gericht = 'Amtsgericht Charlottenburg',
            handelsregister_nummer = 'HRB 12345 B'
      where id = $1`, [mandantId],
  );
  await sql.unsafe(
    `insert into nummernkreis
       (mandant_id, kreis_typ, kontext_id, jahr, bezeichnung, lueckenlos, format_maske,
        zuruecksetzung, geoeffnet_am, ist_platzhalter, erstellt_von_art, erstellt_von_dienst)
     values ($1, 'ausgangsrechnung', null, 0, $2, true, $3, 'nie',
             '2026-01-01', false, 'system', 'job:test')`,
    [mandantId, `Rechnungen ${praefix}`, `${praefix}-{nr:5}`],
  );
}

/** Kunde · Objekt · Auftrag · Leistungszeile · Projekt · LV · Beschäftigung. */
async function baueStammdaten(mandant: string): Promise<Aufbau> {
  /**
   * Der Verantwortliche ist ein EIGENER Benutzer mit Mitgliedschaft.
   *
   * `auftrag` prüft, dass `verantwortlich_benutzer_id` zu dieser Gesellschaft
   * gehört; die Sitzungskennung dieses Tests trägt dagegen nur eine GLOBALE
   * Rolle (super_admin) und keine Mitgliedschaft. Ihr eine zu geben würde die
   * Rechteauflösung des Tests verschieben — also lieber zwei Konten.
   */
  const [vu] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`,
    [`leitung-${zufall()}@cse.test`]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1,$2,'Objektleitung','aktiv')`,
    [vu!.id, `leitung-${zufall()}@cse.test`] as never[]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id)
     values ($1,$2,(select id from rolle where schluessel = 'leitung' and mandant_id is null))`,
    [vu!.id, mandant]);
  const verantwortlich = vu!.id;

  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, strasse, hausnummer, plz, ort)
     values ($1,$2,'Bezirksamt Mitte','Karl-Marx-Allee','31','10178','Berlin') returning id`,
    [mandant, `K-${zufall()}`]);
  const [o] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung, strasse, plz, ort)
     values ($1,$2,$3,'Bürohaus Nord','Teststr. 3','10115','Berlin') returning id`,
    [mandant, k!.id, `O-${zufall()}`]);
  const [a] = await sql.unsafe<{ id: string }[]>(
    `insert into auftrag (mandant_id, auftragsnummer, kunde_id, objekt_id, art, status,
                          bezeichnung, verantwortlich_benutzer_id, start_datum)
     values ($1,$2,$3,$4,'rahmenvertrag','aktiv','Unterhaltsreinigung Nord',$5,'2026-01-01')
     returning id`,
    [mandant, `AU-${zufall()}`, k!.id, o!.id, verantwortlich] as never[]);
  const [l] = await sql.unsafe<{ id: string }[]>(
    `insert into auftrag_leistung (mandant_id, auftrag_id, position_nr, objekt_id,
                                   bezeichnung, menge, einheit, einzelpreis_cent,
                                   steuersatz_bp, gueltig_ab)
     values ($1,$2,1,$3,'Unterhaltsreinigung',1,'Monat',189000,1900,'2026-01-01')
     returning id`,
    [mandant, a!.id, o!.id] as never[]);
  const [p] = await sql.unsafe<{ id: string }[]>(
    `insert into projekt (mandant_id, auftrag_id, nummer, bezeichnung, kunde_id, art,
                          vertragsgrundlage)
     values ($1,$2,$3,'Rohbau Nord',$4,'hochbau','vob_b') returning id`,
    [mandant, a!.id, `P-${zufall()}`, k!.id] as never[]);
  const [lv] = await sql.unsafe<{ id: string }[]>(
    `insert into leistungsverzeichnis (mandant_id, projekt_id, art, bezeichnung)
     values ($1,$2,'hauptauftrag','LV Rohbau') returning id`, [mandant, p!.id] as never[]);
  const [lvp] = await sql.unsafe<{ id: string }[]>(
    `insert into lv_position (mandant_id, leistungsverzeichnis_id, projekt_id, oz, pfad,
                              sortier_pfad, ebene, art, kurztext, einheit, menge_vertrag,
                              einheitspreis_cent)
     values ($1,$2,$3,'01.02.0030','','',1,'position','Mauerwerk','m²',120,4599)
     returning id`, [mandant, lv!.id, p!.id] as never[]);

  const [person] = await sql.unsafe<{ id: string }[]>(
    `insert into person (vorname, nachname) values ('Fatima',$1) returning id`,
    [`Nr-${zufall()}`]);
  const [anst] = await sql.unsafe<{ id: string }[]>(
    `insert into anstellung (mandant_id, person_id, personalnummer, eintritt)
     values ($1,$2,$3,'2026-01-01') returning id`,
    [mandant, person!.id, `PN-${zufall()}`] as never[]);

  return {
    mandant, kunde: k!.id, objekt: o!.id, auftrag: a!.id, leistung: l!.id,
    person: person!.id, anstellung: anst!.id, projekt: p!.id, lv: lv!.id,
    lvPosition: lvp!.id,
  };
}

/**
 * Ein abgeschlossener, FREIGEGEBENER Zeiteintrag mit historischen Zeitpunkten.
 *
 * `quelle_* = 'import'`: bei `server_uhr` ersetzt `kern.stempel_feldzeit()`
 * den mitgeschickten Wert durch `now()` (Invariante 5) — völlig zu Recht, aber
 * dann ließe sich keine Schicht von gestern aufbauen.
 */
async function baueZeiteintrag(von: string, bis: string, pause = 0): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into zeiteintrag
       (mandant_id, anstellung_id, person_id, auftrag_leistung_id, objekt_id,
        beginn_zeitpunkt, ende_zeitpunkt, pause_minuten,
        erfassungsart_beginn, erfassungsart_ende, quelle_beginn, quelle_ende,
        status, freigegeben_am, freigegeben_von, erstellt_von_art)
     values ($1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz,$8,
             'import','import','import','import','abgeschlossen', now(), $9, 'system')
     returning id`,
    [bau.mandant, bau.anstellung, bau.person, bau.leistung, bau.objekt,
     von, bis, pause, benutzer] as never[]);
  return z!.id;
}

/** Ein gegengezeichnetes Aufmaßblatt mit EINER Zeile über 30,870 m². */
async function baueAufmass(menge = '30.870', skaliert = 308_700): Promise<string> {
  const [blatt] = await sql.unsafe<{ id: string }[]>(
    `insert into aufmass (mandant_id, projekt_id, kunde_id, nummer, bezeichnung, messdatum,
                          erhebungsart, status, gesperrt_am, leistungsverzeichnis_id)
     values ($1,$2,$3,$4,'Wand Achse C, OG1','2026-09-10','gemeinsam',
             'gegengezeichnet', now(), $5) returning id`,
    [bau.mandant, bau.projekt, bau.kunde, `A-${zufall()}`, bau.lv] as never[]);
  await sql.unsafe(
    `insert into aufmass_zeile (mandant_id, aufmass_id, projekt_id, kunde_id, lv_position_id,
                                reihenfolge, bezeichnung, rechenansatz, ergebnis_skaliert,
                                menge, einheit)
     values ($1,$2,$3,$3,$4,1,'Wand Achse C','3 × (4,20 × 2,75)',$5,$6::numeric,'m²')`,
    [bau.mandant, blatt!.id, bau.projekt, bau.lvPosition, skaliert, menge] as never[]);
  return blatt!.id;
}

/**
 * Eine erfasste, weiterberechenbare Ausgabe samt Kategorie — das Elternteil,
 * auf das `rechnungsposition_quelle.ausgabe_id` seit 0180 zeigen MUSS.
 *
 * Status `erfasst`: erst ab `freigegeben` verlangt der CHECK einen Beleg, und
 * erst `gebucht` verlangt die Aufteilung nach Steuersätzen. Die Fixtur stellt
 * einen Ausgangszustand her und prüft nicht den Ausgabenweg — den prüft
 * `ausgabe.test.ts`.
 */
async function baueAusgabe(): Promise<string> {
  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into ausgabe_kategorie (mandant_id, schluessel, bezeichnung,
                                    erstellt_von_art, erstellt_von)
     values ($1, $2, 'Material', 'mensch', $3) returning id`,
    [bau.mandant, `material-${zufall()}`, benutzer]);
  const [a] = await sql.unsafe<{ id: string }[]>(
    `insert into ausgabe (mandant_id, kategorie_id, bezeichnung, ausgabedatum,
                          netto_cent, steuer_cent, brutto_cent, zahlungsmittel,
                          weiterberechenbar, status, erstellt_von_art, erstellt_von)
     values ($1, $2, 'Dichtungsband', '2026-08-04', 419, 80, 499, 'karte',
             true, 'erfasst', 'mensch', $3)
     returning id`,
    [bau.mandant, k!.id, benutzer]);
  return a!.id;
}

/** Ein Entwurf ohne Position — jeder Test bestückt ihn selbst. */
async function leerEntwurf(
  tx: postgres.TransactionSql, opts: { mitAuftrag?: boolean } = {},
): Promise<string> {
  return legeEntwurfAn(alsDienst(tx), {
    kundeId: bau.kunde,
    objektId: bau.objekt,
    auftragId: opts.mitAuftrag === false ? null : bau.auftrag,
    leistungVon: '2026-08-01', leistungBis: '2026-08-31', zahlungszielTage: 30,
  });
}

async function zaehlerstand(): Promise<number> {
  const [n] = await sql.unsafe<{ naechste_nummer: string }[]>(
    `select naechste_nummer::text from nummernkreis
      where mandant_id = $1 and kreis_typ = 'ausgangsrechnung'`, [bau.mandant]);
  return Number(n!.naechste_nummer);
}

beforeEach(async () => {
  f = await seed();
  benutzer = await legeBenutzerAn(`herkunft-${zufall()}@cse.test`);
  await macheFakturierfaehig(f.reinigung, 'RE');
  bau = await baueStammdaten(f.reinigung);
}, 120_000);

afterAll(schliessen);

// ===========================================================================
// (1) Der Beleg lebt in `rechnungsposition_quelle` — und ohne ihn keine Zeile
// ===========================================================================

describe('(1) Eine Leistungszeile ohne Herkunft lässt sich nicht anlegen', () => {
  it('die DATENBANK weist sie ab, nicht der Dienst — mit umgangenem Dienst', async () => {
    /**
     * Der Dienst wird hier ABSICHTLICH übergangen: die Position entsteht mit
     * rohem SQL, so wie es `storniere()`, ein Import oder ein zweiter
     * Schreibweg täte. Genau dagegen ist `rp_hat_quelle` geschrieben.
     *
     * Entfernt man den aufgeschobenen Auslöser aus `0088`, geht dieser Fall
     * durch — und eine Rechnungszeile ohne Beleg steht in der Datenbank.
     */
    const fehler = await inSitzung(bau.mandant, async (tx) => {
      const id = await leerEntwurf(tx);
      await tx.unsafe(
        `insert into rechnungsposition
           (mandant_id, rechnung_id, position_nr, bezeichnung, menge, einheit,
            masseinheit_id, einzelpreis_cent, netto_cent, steuersatz_gruppe_id,
            satz_bp, kategorie, erstellt_von_art, erstellt_von)
         select app.aktiver_mandant(), $1, 1, 'Zeile ohne Beleg', 1, 'stk',
                (select id from masseinheit where schluessel = 'stk'),
                10000, 10000, g.id, g.satz_bp, g.kategorie, 'mensch', app.aktueller_benutzer()
           from steuersatz_gruppe g where g.schluessel = 'ust_19'`,
        [id] as never[]);
      /**
       * Die Kopfsummen werden nachgezogen, damit die AUFGESCHOBENE
       * Summenprüfung (§4.9, `0076`) nicht vorher zuschlägt: sonst prüfte
       * dieser Fall die falsche Sicherung.
       */
      await schreibeSummen(alsDienst(tx), id);
      return id;
    }).catch((e: unknown) => e);

    expect((fehler as Error).message).toMatch(/keine Herkunft hinterlegt/u);
    expect((fehler as Error).message).toMatch(/FIN-07/u);
  });

  it('der Dienst weist schon vorher ab und nennt die Zeile', async () => {
    const fehler = await inSitzung(bau.mandant, async (tx) => {
      const id = await leerEntwurf(tx);
      return fuegePositionHinzu(alsDienst(tx), {
        rechnungId: id, bezeichnung: 'Ohne Beleg', menge: milliMenge(1_000n),
        einheit: 'stk', einzelpreisCent: cent(100n), steuergruppe: 'ust_19',
        quellen: [],
      });
    }).catch((e: unknown) => e);
    expect((fehler as Error).message).toMatch(/Ohne Beleg.*ohne Herkunft/su);
  });

  it('eine TEXTZEILE braucht keinen Beleg — sie trägt weder Menge noch Betrag', async () => {
    // Die Gegenprobe zur Bedingung oben. Verlangte `rp_hat_quelle` auch von
    // einer Textzeile einen Beleg, müsste man für einen VOB-Verweis eine
    // Quellzeile erfinden.
    const id = await inSitzung(bau.mandant, async (tx) => {
      const r = await leerEntwurf(tx);
      await tx.unsafe(
        `insert into rechnungsposition
           (mandant_id, rechnung_id, position_nr, positionsart, bezeichnung,
            steuersatz_gruppe_id, satz_bp, kategorie, erstellt_von_art, erstellt_von)
         select app.aktiver_mandant(), $1, 1, 'textzeile',
                'Leistungen gemäß VOB/B § 2 Abs. 3', g.id, g.satz_bp, g.kategorie,
                'mensch', app.aktueller_benutzer()
           from steuersatz_gruppe g where g.schluessel = 'ust_19'`, [r] as never[]);
      return r;
    });
    expect(id).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it('der Diskriminator und der typisierte Schlüssel müssen zusammenpassen', async () => {
    const fehler = await inSitzung(bau.mandant, async (tx) => {
      const r = await leerEntwurf(tx);
      const pos = await fuegePositionHinzu(alsDienst(tx), {
        rechnungId: r, bezeichnung: 'Mit Beleg', menge: milliMenge(1_000n),
        einheit: 'stk', einzelpreisCent: cent(100n), steuergruppe: 'ust_19',
        quellen: vonHand('Von Hand, zu Prüfzwecken'),
      });
      // `quelle_typ = 'zeiteintrag'`, aber gefüllt ist `aufmass_id`.
      const blatt = await baueAufmass();
      await tx.unsafe(
        `insert into rechnungsposition_quelle
           (mandant_id, rechnungsposition_id, rechnung_id, quelle_typ, aufmass_id,
            menge_anteil, erstellt_von_art, erstellt_von)
         values (app.aktiver_mandant(), $1, $2, 'zeiteintrag', $3, 1,
                 'mensch', app.aktueller_benutzer())`,
        [pos, r, blatt] as never[]);
      return pos;
    }).catch((e: unknown) => e);
    expect((fehler as { constraint_name?: string }).constraint_name)
      .toBe('rpq_diskriminator');
  });

  it('eine `manuell`-Zeile ohne Begründung ist keine Herkunft', async () => {
    const fehler = await inSitzung(bau.mandant, async (tx) => {
      const r = await leerEntwurf(tx);
      const pos = await fuegePositionHinzu(alsDienst(tx), {
        rechnungId: r, bezeichnung: 'Mit Beleg', menge: milliMenge(1_000n),
        einheit: 'stk', einzelpreisCent: cent(100n), steuergruppe: 'ust_19',
        quellen: vonHand('Von Hand, zu Prüfzwecken'),
      });
      await tx.unsafe(
        `insert into rechnungsposition_quelle
           (mandant_id, rechnungsposition_id, rechnung_id, quelle_typ, notiz,
            erstellt_von_art, erstellt_von)
         values (app.aktiver_mandant(), $1, $2, 'manuell', null,
                 'mensch', app.aktueller_benutzer())`, [pos, r] as never[]);
      return pos;
    }).catch((e: unknown) => e);
    expect((fehler as { constraint_name?: string }).constraint_name)
      .toBe('rpq_manuell_begruendet');
  });

  it('die Materialspalte ist da, BENANNT — und seit 0180 auch verankert', async () => {
    /**
     * **Diese Prüfung ist FORTGESCHRIEBEN, nicht abgeschwächt.**
     *
     * Ihre erste Fassung fror den Zustand vor PR 54 ein: Spalte und
     * partieller Unique-Index galten, der Fremdschlüssel fehlte, und der Satz
     * daneben lautete „wer PR 54 baut, sieht hier, was dann dazukommen muss".
     * PR 54 ist gebaut — `0180_ausgabe.sql` legt `ausgabe` an und trägt
     * `rpq_ausgabe_fk` nach. Die Erwartung „kein Fremdschlüssel" wäre ab jetzt
     * eine Zusage, die gegen die Datenbank steht; sie wächst deshalb mit, statt
     * zu verschwinden.
     *
     * Geprüft wird jetzt beides zusammen: die Kennung zeigt auf eine Zeile,
     * die es GIBT (Fremdschlüssel), und dieselbe Ausgabe wird genau EINMAL
     * weiterberechnet (Teilindex). Keiner der beiden ersetzt den anderen —
     * der Fremdschlüssel sagt nichts über die Anzahl, der Index nichts über
     * die Existenz.
     */
    const [spalte] = await sql.unsafe<{ data_type: string }[]>(
      `select data_type from information_schema.columns
        where table_name = 'rechnungsposition_quelle' and column_name = 'ausgabe_id'`);
    expect(spalte?.data_type).toBe('uuid');

    const fks = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from information_schema.key_column_usage k
         join information_schema.table_constraints c
           on c.constraint_name = k.constraint_name
        where k.table_name = 'rechnungsposition_quelle'
          and k.column_name = 'ausgabe_id' and c.constraint_type = 'FOREIGN KEY'`);
    expect(Number(fks[0]!.n)).toBe(1);

    const [idx] = await sql.unsafe<{ indexdef: string }[]>(
      `select indexdef from pg_indexes
        where tablename = 'rechnungsposition_quelle' and indexname = 'quelle_ausgabe_uk'`);
    expect(idx?.indexdef).toMatch(/UNIQUE.*ausgabe_id.*material.*wirksam/su);

    /*
     * Der Verweis ins Leere fällt jetzt am Fremdschlüssel — und zwar bei der
     * ERSTEN Zeile. Vor 0180 kam er durch und fiel niemandem auf.
     */
    const ins_leere = await inSitzung(bau.mandant, async (tx) =>
      fuegePositionHinzu(alsDienst(tx), {
        rechnungId: await leerEntwurf(tx, { mitAuftrag: false }),
        bezeichnung: 'Material ohne Ausgabe', menge: milliMenge(1_000n),
        einheit: 'stk', einzelpreisCent: cent(4_99n), steuergruppe: 'ust_19',
        quellen: [{ typ: 'material', id: crypto.randomUUID() }],
      })).catch((e: unknown) => e);
    expect((ins_leere as { constraint_name?: string }).constraint_name).toBe('rpq_ausgabe_fk');

    // Und die Sperre greift weiterhin: zweimal dieselbe ECHTE Ausgabe geht nicht.
    const ausgabe = await baueAusgabe();
    const fehler = await inSitzung(bau.mandant, async (tx) => {
      const d = alsDienst(tx);
      for (const nr of [1, 2]) {
        const r = await leerEntwurf(tx, { mitAuftrag: false });
        await fuegePositionHinzu(d, {
          rechnungId: r, bezeichnung: `Material ${String(nr)}`, menge: milliMenge(1_000n),
          einheit: 'stk', einzelpreisCent: cent(4_99n), steuergruppe: 'ust_19',
          quellen: [{ typ: 'material', id: ausgabe }],
        });
      }
      return 'durchgekommen';
    }).catch((e: unknown) => e);
    expect((fehler as { constraint_name?: string }).constraint_name).toBe('quelle_ausgabe_uk');
  });

  it('eine Herkunftszeile entsteht NICHT an einem festgeschriebenen Beleg', async () => {
    const fehler = await inSitzung(bau.mandant, async (tx) => {
      const d = alsDienst(tx);
      const r = await leerEntwurf(tx, { mitAuftrag: false });
      const pos = await fuegePositionHinzu(d, {
        rechnungId: r, bezeichnung: 'Fertig', menge: milliMenge(1_000n),
        einheit: 'stk', einzelpreisCent: cent(100n), steuergruppe: 'ust_19',
        quellen: vonHand('Von Hand, zu Prüfzwecken'),
      });
      await finalisiere(d, r);
      return fuegeQuelleHinzu(d, pos, { typ: 'manuell', notiz: 'Nachträglich angeheftet' });
    }).catch((e: unknown) => e);
    expect((fehler as Error).message).toMatch(/unveraenderlich|Beleg/u);
  });
});

// ===========================================================================
// (2) Der Klick führt an den Satz dahinter — und die Summe geht auf
// ===========================================================================

describe('(2) Ein Klick auf die Zeile öffnet genau den Beleg dahinter', () => {
  it('drei Schichten: das Ziel ist der Zeiteintrag, und die Anteile ergeben die Zeile', async () => {
    const ergebnis = await inSitzung(bau.mandant, async (tx) => {
      const d = alsDienst(tx);
      const eintraege = [
        await baueZeiteintrag('2026-08-03T06:00:00Z', '2026-08-03T09:07:00Z'), // 187 min
        await baueZeiteintrag('2026-08-04T06:00:00Z', '2026-08-04T09:32:00Z'), // 212 min
        await baueZeiteintrag('2026-08-05T06:00:00Z', '2026-08-05T07:35:00Z'), //  95 min
      ];
      const r = await leerEntwurf(tx);
      const zeile = await fuegeZeitPositionHinzu(d, {
        rechnungId: r, bezeichnung: 'Geleistete Stunden August',
        stundensatzCent: cent(42_50n), steuergruppe: 'ust_19',
        auftragLeistungId: bau.leistung,
      });
      const quellen = await ladeQuellen(d, r);
      const [pos] = await tx.unsafe<{ netto_cent: string }[]>(
        `select netto_cent::text from rechnungsposition where id = $1`, [zeile.positionId]);
      return { eintraege, zeile, quellen, netto: BigInt(pos!.netto_cent) };
    });

    expect(ergebnis.zeile.zeiteintraege).toBe(3);
    expect(ergebnis.zeile.minuten).toBe(494);
    expect(ergebnis.quellen).toHaveLength(3);

    // Das ZIEL ist genau der Zeiteintrag — nicht eine Liste, nicht der Auftrag.
    for (const id of ergebnis.eintraege) {
      expect(ergebnis.quellen.some((q) => q.ziel === `zeiten/${id}`)).toBe(true);
      expect(ergebnis.quellen.some((q) => q.quelleId === id)).toBe(true);
    }

    /**
     * **Auf den Cent.** Entfernte man `verteileAufQuellen` und rechnete jede
     * Quelle einzeln, stünde hier eine Summe, die die Zeile um ein bis zwei
     * Cent verfehlt — genau die Abweichung, wegen der DSH-04 existiert.
     */
    const summe = ergebnis.quellen.reduce((a, q) => a + q.anteilCent, 0n);
    expect(summe).toBe(ergebnis.netto);
  });

  it('ein Aufmaßblatt führt auf sein Blatt im Projekt, mit Anteil', async () => {
    const quellen = await inSitzung(bau.mandant, async (tx) => {
      const d = alsDienst(tx);
      const blatt = await baueAufmass();
      const r = await leerEntwurf(tx);
      const pos = await fuegePositionHinzu(d, {
        rechnungId: r, bezeichnung: 'Mauerwerk Achse C', menge: milliMenge(30_870n),
        einheit: 'm2', einzelpreisCent: cent(45_99n), steuergruppe: 'ust_19',
      quellen: [{ typ: 'aufmass', id: blatt, mengeAnteil: milliMenge(30_870n) }],
      });
      expect(pos).toMatch(/^[0-9a-f-]{36}$/u);
      return { blatt, zeilen: await ladeQuellen(d, r) };
    });

    expect(quellen.zeilen).toHaveLength(1);
    expect(quellen.zeilen[0]?.ziel)
      .toBe(`bau/projekte/${bau.projekt}/aufmass/${quellen.blatt}`);
    expect(quellen.zeilen[0]?.bezeichnung).toMatch(/^Aufmaß A-/u);
    expect(quellen.zeilen[0]?.mengeAnteil).toBe('30.870');
  });

  it('die Herkunft steht in der kanonischen Nutzlast — also im Hash', async () => {
    const nutzlast = await inSitzung(bau.mandant, async (tx) => {
      const d = alsDienst(tx);
      const z = await baueZeiteintrag('2026-08-03T06:00:00Z', '2026-08-03T14:00:00Z');
      const r = await leerEntwurf(tx, { mitAuftrag: false });
      await fuegeZeitPositionHinzu(d, {
        rechnungId: r, bezeichnung: 'Stunden', stundensatzCent: cent(42_50n),
        steuergruppe: 'ust_19', auftragLeistungId: bau.leistung,
      });
      await finalisiere(d, r);
      const [s] = await tx.unsafe<{ nutzlast: unknown }[]>(
        `select nutzlast from rechnung_snapshot where rechnung_id = $1`, [r]);
      return { snapshot: s!.nutzlast as { positionen: { quellen: unknown[] }[] }, z };
    });

    /**
     * Ohne diese Zeile wäre die Herkunft ein Datum NEBEN dem Beleg statt
     * darin: wer später behauptet, eine andere Stunde sei abgerechnet worden,
     * widerspräche nichts.
     */
    expect(nutzlast.snapshot.positionen[0]?.quellen)
      .toEqual([{ typ: 'zeiteintrag', id: nutzlast.z, menge_anteil: '8.000' }]);
  });
});

// ===========================================================================
// (3) FIN-18 — blockierend, benannt, protokolliert, VOR der Nummer
// ===========================================================================

describe('(3) Abgeschlossener Auftrag ohne erfasste Minute', () => {
  beforeEach(async () => {
    /**
     * **Der Abschluss geht seit 0296 durch `kern.auftrag_uebergang_pruefen`**
     * und verlangt `auftrag.abschliessen` — ein eigenes Recht neben
     * `auftrag.schreiben` (OPS-05, D-366).
     *
     * Die Fixtur schloss den Auftrag bisher mit rohem SQL auf der
     * ungebundenen Verbindung. Dort gibt `app.aktueller_benutzer()` NULL,
     * `app.hat_recht` also `false`, und der Auslöser weist ab — richtig, denn
     * ein Abschluss ohne Benutzer ist keiner. Abgeschwächt wird deshalb nicht
     * der Riegel, sondern die Fixtur nimmt den Weg, den die Oberfläche nimmt.
     *
     * `abgeschlossen_am` wird ABSICHTLICH nicht mitgeschrieben: der Auslöser
     * zieht es aus der Serveruhr nach (Invariante 5). Bliebe das aus, stünde
     * hier eine Zeile mit Abschlussdatum und Status `aktiv` — und genau die
     * läse FIN-18 als abgeschlossen, während die Liste sie als laufend zeigt.
     */
    await inSitzung(bau.mandant, async (tx) => tx.unsafe(
      `update auftrag set status = 'abgeschlossen' where id = $1`,
      [bau.auftrag] as never[]));
    const [a] = await sql.unsafe<{ abgeschlossen_am: Date | null }[]>(
      `select abgeschlossen_am from auftrag where id = $1`, [bau.auftrag]);
    expect(a!.abgeschlossen_am).not.toBeNull();
  });

  it('blockiert die Festschreibung, BENENNT den Auftrag — und der Zähler steht still', async () => {
    const vorher = await zaehlerstand();

    /**
     * **Die Abweisung wird INNERHALB der Transaktion gefangen** — und das ist
     * der Kern dieser Prüfung.
     *
     * `Fin18Fehler` ist ein TypeScript-Fehler, keine Postgres-Ausnahme: die
     * Transaktion ist danach nicht abgebrochen, sondern lebt. Also lässt sich
     * genau dort nachsehen, was bis dahin passiert ist. Ein Vergleich des
     * Zählers NACH dem Rollback bewiese dagegen nichts — der Zug ist
     * transaktional (PR 46), und der Zähler stünde auch dann still, wenn die
     * Prüfung zu spät käme.
     *
     * Verschiebt man den FIN-18-Block in `finalisiere()` hinter Definer-Aufruf
     * A, fällt dieser Fall: `naechste_nummer` wäre dann schon bewegt und
     * `rechnung.nummer` gesetzt.
     */
    const befund = await inSitzung(bau.mandant, async (tx) => {
      const d = alsDienst(tx);
      const r = await leerEntwurf(tx);
      await fuegePositionHinzu(d, {
        rechnungId: r, bezeichnung: 'Pauschale', menge: milliMenge(1_000n),
        einheit: 'psch', einzelpreisCent: cent(500_00n), steuergruppe: 'ust_19',
        quellen: vonHand('Pauschale ohne Zeitbezug'),
      });
      const fehler = await finalisiere(d, r).then(() => null, (e: unknown) => e);
      const [kreis] = await tx.unsafe<{ naechste_nummer: string }[]>(
        `select naechste_nummer::text from nummernkreis
          where mandant_id = $1 and kreis_typ = 'ausgangsrechnung'`,
        [bau.mandant] as never[]);
      const [beleg] = await tx.unsafe<{ nummer: string | null; status: string }[]>(
        `select nummer, status::text as status from rechnung where id = $1`,
        [r] as never[]);
      return {
        fehler, inTransaktion: Number(kreis!.naechste_nummer),
        nummer: beleg!.nummer, status: beleg!.status,
      };
    });

    expect((befund.fehler as Error).name).toBe('Fin18Fehler');
    expect((befund.fehler as Error).message).toMatch(/FIN-18/u);
    // Der Auftrag steht IN der Meldung — „irgendein Auftrag" wäre nutzlos.
    const [a] = await sql.unsafe<{ auftragsnummer: string }[]>(
      `select auftragsnummer from auftrag where id = $1`, [bau.auftrag]);
    expect((befund.fehler as Error).message).toContain(a!.auftragsnummer);

    // Und der Beleg ist unberührt: keine Nummer, kein Zustandswechsel.
    expect(befund.inTransaktion).toBe(vorher);
    expect(befund.nummer).toBeNull();
    expect(befund.status).toBe('entwurf');
  });

  it('eine zu kurze Begründung übergeht sie NICHT', async () => {
    const fehler = await inSitzung(bau.mandant, async (tx) => {
      const d = alsDienst(tx);
      const r = await leerEntwurf(tx);
      await fuegePositionHinzu(d, {
        rechnungId: r, bezeichnung: 'Pauschale', menge: milliMenge(1_000n),
        einheit: 'psch', einzelpreisCent: cent(500_00n), steuergruppe: 'ust_19',
        quellen: vonHand('Pauschale ohne Zeitbezug'),
      });
      return finalisiere(d, r, { fin18Begruendung: 'egal' });
    }).catch((e: unknown) => e);
    expect((fehler as Error).name).toBe('Fin18Fehler');
  });

  it('mit protokollierter Begründung geht sie durch — und die Begründung bleibt', async () => {
    const grund = 'Pauschalpreisvertrag ohne Stundenerfassung, mit AG abgestimmt';
    const ergebnis = await inSitzung(bau.mandant, async (tx) => {
      const d = alsDienst(tx);
      const r = await leerEntwurf(tx);
      await fuegePositionHinzu(d, {
        rechnungId: r, bezeichnung: 'Pauschale', menge: milliMenge(1_000n),
        einheit: 'psch', einzelpreisCent: cent(500_00n), steuergruppe: 'ust_19',
        quellen: vonHand('Pauschale ohne Zeitbezug'),
      });
      return { nummer: (await finalisiere(d, r, { fin18Begruendung: grund })).nummer, r };
    });
    expect(ergebnis.nummer).toMatch(/^RE-0000\d$/u);

    // Spur 1: das Audit-Log.
    const [log] = await sql.unsafe<{ nachher: { begruendung: string } }[]>(
      `select nachher from audit_log
        where aktion = 'rechnung.fin18_uebergangen' and objekt_id = $1`, [ergebnis.r]);
    expect(log?.nachher.begruendung).toBe(grund);

    /**
     * Spur 2: der Schnappschuss — und die ist die wichtigere, weil sie mit dem
     * Beleg eingefroren ist. Ein Vermerk, den man später noch ändern kann, ist
     * keiner.
     */
    const [snap] = await sql.unsafe<{ pruefung: { fin18?: { begruendung: string } } }[]>(
      `select pflichtfeld_pruefung as pruefung from rechnung_snapshot
        where rechnung_id = $1`, [ergebnis.r]);
    expect(snap?.pruefung.fin18?.begruendung).toBe(grund);
  });

  it('mit erfasster Zeit gibt es keine Warnung — sie kommt nicht immer', async () => {
    /**
     * Die Gegenprobe, ohne die der Rest wertlos wäre: eine Warnung, die bei
     * JEDEM Auftrag anschlägt, wird nach dem dritten Mal ungelesen
     * weggeklickt. Genau das passiert, wenn man `zeiteintrag_auftrag`
     * (security_invoker) statt `fin.auftrag_erfasste_minuten` fragt.
     */
    const befund = await inSitzung(bau.mandant, async (tx) => {
      await baueZeiteintrag('2026-08-03T06:00:00Z', '2026-08-03T14:00:00Z');
      const r = await leerEntwurf(tx);
      return pruefeZeiterfassung(alsDienst(tx), r);
    });
    expect(befund).toBeNull();
  });

  it('ein STORNO wird nie an FIN-18 gehindert', async () => {
    /**
     * Sonst wäre ausgerechnet der Vorgang gesperrt, mit dem man eine zu
     * Unrecht gestellte Rechnung wieder loswird — und die Warnung träfe den,
     * der den Fehler behebt, statt den, der ihn gemacht hat.
     */
    const nummern = await inSitzung(bau.mandant, async (tx) => {
      const d = alsDienst(tx);
      const r = await leerEntwurf(tx);
      await fuegePositionHinzu(d, {
        rechnungId: r, bezeichnung: 'Pauschale', menge: milliMenge(1_000n),
        einheit: 'psch', einzelpreisCent: cent(500_00n), steuergruppe: 'ust_19',
        quellen: vonHand('Pauschale ohne Zeitbezug'),
      });
      await finalisiere(d, r, { fin18Begruendung: 'Pauschalvertrag, mit AG abgestimmt' });
      // Und jetzt das Storno — OHNE Begründung, und es muss trotzdem gehen.
      return storniere(d, r, 'Rechnung an den falschen Auftrag gehängt');
    });
    expect(nummern.nummer).toMatch(/^RE-0000\d$/u);
  });
});

// ===========================================================================
// (4) Eine Stunde wird nicht still ein zweites Mal abgerechnet
// ===========================================================================

describe('(4) Der Anspruch und sein Spiegel — beide, und keiner ersetzt den anderen', () => {
  it('der partielle Unique-Index verhindert die zweite wirksame Beanspruchung', async () => {
    const fehler = await inSitzung(bau.mandant, async (tx) => {
      const d = alsDienst(tx);
      const z = await baueZeiteintrag('2026-08-03T06:00:00Z', '2026-08-03T14:00:00Z');
      for (const nr of [1, 2]) {
        const r = await leerEntwurf(tx, { mitAuftrag: false });
        const pos = await fuegePositionHinzu(d, {
          rechnungId: r, bezeichnung: `Stunden ${String(nr)}`, menge: milliMenge(8_000n),
          einheit: 'h', einzelpreisCent: cent(42_50n), steuergruppe: 'ust_19',
          quellen: [{ typ: 'zeiteintrag', id: z }],
        });
        expect(pos).toMatch(/^[0-9a-f-]{36}$/u);
      }
      return 'durchgekommen';
    }).catch((e: unknown) => e);

    expect((fehler as { constraint_name?: string }).constraint_name)
      .toBe('quelle_zeiteintrag_uk');
  });

  it('`abgerechnet_am` wird IN der Festschreibungstransaktion gesetzt', async () => {
    const z = await inSitzung(bau.mandant, async (tx) => {
      const d = alsDienst(tx);
      const zeit = await baueZeiteintrag('2026-08-03T06:00:00Z', '2026-08-03T14:00:00Z');
      const r = await leerEntwurf(tx, { mitAuftrag: false });
      const pos = await fuegeZeitPositionHinzu(d, {
        rechnungId: r, bezeichnung: 'Stunden', stundensatzCent: cent(42_50n),
        steuergruppe: 'ust_19', auftragLeistungId: bau.leistung,
      });
      // VOR dem Festschreiben ist die Stunde noch offen.
      const [vorher] = await tx.unsafe<{ abgerechnet_am: Date | null }[]>(
        `select abgerechnet_am from zeiteintrag where id = $1`, [zeit]);
      expect(vorher!.abgerechnet_am).toBeNull();
      await finalisiere(d, r);
      return { zeit, pos: pos.positionId };
    });

    const [nachher] = await sql.unsafe<{
      abgerechnet_am: Date | null; abrechnung_referenz: string | null;
    }[]>(
      `select abgerechnet_am, abrechnung_referenz::text as abrechnung_referenz
         from zeiteintrag where id = $1`, [z.zeit]);
    expect(nachher!.abgerechnet_am).not.toBeNull();
    // Und die Referenz zeigt auf die POSITION, nicht auf die Rechnung: sie
    // sagt, welche Zeile die Stunde verbraucht hat.
    expect(nachher!.abrechnung_referenz).toBe(z.pos);
  });

  it('der Spiegel allein genügt NICHT — gelöscht greift der Index weiterhin', async () => {
    /**
     * Die Aussage, die dieser PR ausdrücklich macht: „Beide existieren; keiner
     * ersetzt den anderen." Hier wird `abgerechnet_am` mit Superuserrechten
     * geleert — also so, wie es kein Anwendungsweg könnte — und die zweite
     * Beanspruchung scheitert trotzdem.
     *
     * Entfernte man den partiellen Unique-Index und verließe sich auf die
     * Spalte, ginge dieser Fall durch: derselbe Zeiteintrag stünde auf zwei
     * Rechnungen.
     */
    const z = await inSitzung(bau.mandant, async (tx) => {
      const d = alsDienst(tx);
      const zeit = await baueZeiteintrag('2026-08-03T06:00:00Z', '2026-08-03T14:00:00Z');
      const r = await leerEntwurf(tx, { mitAuftrag: false });
      await fuegeZeitPositionHinzu(d, {
        rechnungId: r, bezeichnung: 'Stunden', stundensatzCent: cent(42_50n),
        steuergruppe: 'ust_19', auftragLeistungId: bau.leistung,
      });
      await finalisiere(d, r);
      return zeit;
    });

    await sql.unsafe(
      `update zeiteintrag set abgerechnet_am = null, abrechnung_referenz = null
        where id = $1`, [z]);

    const fehler = await inSitzung(bau.mandant, async (tx) => {
      const d = alsDienst(tx);
      const r = await leerEntwurf(tx, { mitAuftrag: false });
      return fuegePositionHinzu(d, {
        rechnungId: r, bezeichnung: 'Dieselben Stunden', menge: milliMenge(8_000n),
        einheit: 'h', einzelpreisCent: cent(42_50n), steuergruppe: 'ust_19',
        quellen: [{ typ: 'zeiteintrag', id: z }],
      });
    }).catch((e: unknown) => e);

    expect((fehler as { constraint_name?: string }).constraint_name)
      .toBe('quelle_zeiteintrag_uk');
  });

  it('umgekehrt: der Index allein sagt der Arbeitsliste nichts — dafür ist die Spalte da', async () => {
    /**
     * Die andere Richtung derselben Aussage. `zeiteintrag_auftrag` mit
     * `abgerechnet_am is null` ist die Abfrage, aus der die nächste Rechnung
     * entsteht; sie kennt `rechnungsposition_quelle` nicht und braucht sie
     * nicht zu kennen (§4.4: „ohne Join").
     */
    const offen = await inSitzung(bau.mandant, async (tx) => {
      const d = alsDienst(tx);
      await baueZeiteintrag('2026-08-03T06:00:00Z', '2026-08-03T14:00:00Z');
      const r = await leerEntwurf(tx, { mitAuftrag: false });
      await fuegeZeitPositionHinzu(d, {
        rechnungId: r, bezeichnung: 'Stunden', stundensatzCent: cent(42_50n),
        steuergruppe: 'ust_19', auftragLeistungId: bau.leistung,
      });
      await finalisiere(d, r);
      const [n] = await tx.unsafe<{ n: string }[]>(
        `select count(*)::text as n from zeiteintrag_auftrag
          where auftrag_leistung_id = $1 and abgerechnet_am is null`, [bau.leistung]);
      return Number(n!.n);
    });
    expect(offen).toBe(0);
  });

  it('ein Storno gibt die Stunde wieder frei — Anspruch UND Spiegel', async () => {
    const z = await inSitzung(bau.mandant, async (tx) => {
      const d = alsDienst(tx);
      const zeit = await baueZeiteintrag('2026-08-03T06:00:00Z', '2026-08-03T14:00:00Z');
      const r = await leerEntwurf(tx, { mitAuftrag: false });
      await fuegeZeitPositionHinzu(d, {
        rechnungId: r, bezeichnung: 'Stunden', stundensatzCent: cent(42_50n),
        steuergruppe: 'ust_19', auftragLeistungId: bau.leistung,
      });
      await finalisiere(d, r);
      await storniere(d, r, 'Stundensatz falsch — mit dem Kunden geklärt');
      return zeit;
    });

    const [nach] = await sql.unsafe<{ abgerechnet_am: Date | null }[]>(
      `select abgerechnet_am from zeiteintrag where id = $1`, [z]);
    expect(nach!.abgerechnet_am).toBeNull();

    const [wirksam] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from rechnungsposition_quelle
        where zeiteintrag_id = $1 and wirksam`, [z]);
    expect(Number(wirksam!.n)).toBe(0);

    // Und die Zeile steht noch da — Invariante 8 kennt hier keinen Hard Delete.
    const [alle] = await sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from rechnungsposition_quelle where zeiteintrag_id = $1`,
      [z]);
    expect(Number(alle!.n)).toBeGreaterThanOrEqual(2);
  });

  it('die Korrektur beansprucht dieselbe Stunde neu — und wird nicht von sich selbst gesperrt', async () => {
    const ergebnis = await inSitzung(bau.mandant, async (tx) => {
      const d = alsDienst(tx);
      const zeit = await baueZeiteintrag('2026-08-03T06:00:00Z', '2026-08-03T14:00:00Z');
      const r = await leerEntwurf(tx, { mitAuftrag: false });
      await fuegeZeitPositionHinzu(d, {
        rechnungId: r, bezeichnung: 'Stunden', stundensatzCent: cent(42_50n),
        steuergruppe: 'ust_19', auftragLeistungId: bau.leistung,
      });
      await finalisiere(d, r);
      return { korrektur: await korrigiere(d, r, 'Falscher Leistungszeitraum, neu ausgestellt'), zeit };
    });

    expect(ergebnis.korrektur.neuNummer).not.toBe(ergebnis.korrektur.stornoNummer);
    const [neu] = await sql.unsafe<{ rechnung_id: string }[]>(
      `select rechnung_id::text from rechnungsposition_quelle
        where zeiteintrag_id = $1 and wirksam`, [ergebnis.zeit]);
    expect(neu!.rechnung_id).toBe(ergebnis.korrektur.neuId);
  });

  it('eine erloschene Beanspruchung lebt nicht wieder auf', async () => {
    const fehler = await inSitzung(bau.mandant, async (tx) => {
      const d = alsDienst(tx);
      const zeit = await baueZeiteintrag('2026-08-03T06:00:00Z', '2026-08-03T14:00:00Z');
      const r = await leerEntwurf(tx, { mitAuftrag: false });
      await fuegeZeitPositionHinzu(d, {
        rechnungId: r, bezeichnung: 'Stunden', stundensatzCent: cent(42_50n),
        steuergruppe: 'ust_19', auftragLeistungId: bau.leistung,
      });
      await finalisiere(d, r);
      await storniere(d, r, 'Stundensatz falsch — mit dem Kunden geklärt');
      return tx.unsafe(
        `update rechnungsposition_quelle set wirksam = true
          where zeiteintrag_id = $1 and rechnung_id = $2`, [zeit, r] as never[]);
    }).catch((e: unknown) => e);
    expect((fehler as Error).message).toMatch(/lebt nicht wieder auf/u);
  });
});

// ===========================================================================
// (5) Ein Aufmaß wird bewusst NICHT exklusiv beansprucht (§ 16 VOB/B)
// ===========================================================================

describe('(5) Zwei Raten auf EIN Aufmaßblatt', () => {
  it('die zweite Rate ist kein Constraint-Bruch — und die dritte, übermäßige, schon', async () => {
    const blatt = await inSitzung(bau.mandant, async () => baueAufmass());

    /** Eine Abschlagsrechnung über einen Teil des Blattes. */
    const rate = async (menge: bigint, art: 'abschlag' | 'schluss'): Promise<string> =>
      inSitzung(bau.mandant, async (tx) => {
        const d = alsDienst(tx);
        const r = await legeEntwurfAn(d, {
          kundeId: bau.kunde, objektId: bau.objekt, rechnungsart: art,
          leistungVon: '2026-08-01', leistungBis: '2026-08-31', zahlungszielTage: 30,
        });
        await fuegePositionHinzu(d, {
          rechnungId: r, bezeichnung: 'Mauerwerk Achse C', menge: milliMenge(menge),
          einheit: 'm2', einzelpreisCent: cent(45_99n), steuergruppe: 'ust_19',
          quellen: [{ typ: 'aufmass', id: blatt, mengeAnteil: milliMenge(menge) }],
        });
        return (await finalisiere(d, r)).nummer;
      });

    // Rate 1 von 30,870 m²: 20,000.
    expect(await rate(20_000n, 'abschlag')).toMatch(/^RE-/u);
    const [nach1] = await sql.unsafe<{ abgerechnet_menge: string }[]>(
      `select abgerechnet_menge::text from aufmass where id = $1`, [blatt]);
    expect(nach1!.abgerechnet_menge).toBe('20.000');

    /**
     * **Rate 2 — genau der Fall, den ein Unique-Index unmöglich machte.**
     * Legte man `quelle_aufmass_uk` analog zu `quelle_zeiteintrag_uk` an,
     * scheiterte diese Zeile, und FIN-08 wäre auf gemessener Leistung — also
     * auf der einzigen Art, die Bau produziert — nicht ausführbar.
     */
    expect(await rate(10_870n, 'schluss')).toMatch(/^RE-/u);
    const [nach2] = await sql.unsafe<{ abgerechnet_menge: string }[]>(
      `select abgerechnet_menge::text from aufmass where id = $1`, [blatt]);
    expect(nach2!.abgerechnet_menge).toBe('30.870');

    // Und die dritte Rate überschreitet die gemessene Menge — aufgeschobene SUMME.
    const fehler = await rate(1_000n, 'schluss').catch((e: unknown) => e);
    expect((fehler as Error).message).toMatch(/§ 16 VOB\/B/u);
    expect((fehler as Error).message).toMatch(/31\.870 von gemessenen 30\.870/u);
  });

  it('auf `aufmass_id` gibt es KEINEN Unique-Index — und auf `zeiteintrag_id` schon', async () => {
    /**
     * Die Aussage steht in der Abnahme wörtlich, also steht sie auch als
     * Prüfung da: der Unterschied zwischen den beiden Quellarten ist eine
     * Entscheidung und kein Versehen.
     */
    const indizes = await sql.unsafe<{ indexdef: string }[]>(
      `select indexdef from pg_indexes
        where tablename = 'rechnungsposition_quelle' and indexdef like '%UNIQUE%'`);
    const texte = indizes.map((i) => i.indexdef).join('\n');
    expect(texte).toMatch(/zeiteintrag_id.*quelle_typ = 'zeiteintrag'.*wirksam/su);
    expect(texte).not.toMatch(/\(aufmass_id\)/u);
  });

  it('ein Aufmaß ohne `menge_anteil` ist keine Teilentnahme, sondern ein Fehler', async () => {
    const fehler = await inSitzung(bau.mandant, async (tx) => {
      const d = alsDienst(tx);
      const blatt = await baueAufmass();
      const r = await leerEntwurf(tx, { mitAuftrag: false });
      return fuegePositionHinzu(d, {
        rechnungId: r, bezeichnung: 'Mauerwerk', menge: milliMenge(30_870n),
        einheit: 'm2', einzelpreisCent: cent(45_99n), steuergruppe: 'ust_19',
        quellen: [{ typ: 'aufmass', id: blatt }],
      });
    }).catch((e: unknown) => e);
    expect((fehler as Error).message).toMatch(/§ 16 VOB\/B/u);
  });

  it('ein Storno senkt die aufgelaufene Menge wieder', async () => {
    const blatt = await inSitzung(bau.mandant, async () => baueAufmass());
    await inSitzung(bau.mandant, async (tx) => {
      const d = alsDienst(tx);
      const r = await legeEntwurfAn(d, {
        kundeId: bau.kunde, objektId: bau.objekt, rechnungsart: 'abschlag',
        leistungVon: '2026-08-01', leistungBis: '2026-08-31', zahlungszielTage: 30,
      });
      await fuegePositionHinzu(d, {
        rechnungId: r, bezeichnung: 'Mauerwerk', menge: milliMenge(20_000n),
        einheit: 'm2', einzelpreisCent: cent(45_99n), steuergruppe: 'ust_19',
        quellen: [{ typ: 'aufmass', id: blatt, mengeAnteil: milliMenge(20_000n) }],
      });
      await finalisiere(d, r);
      await storniere(d, r, 'Menge falsch gemessen — Blatt wird neu aufgenommen');
    });
    const [nach] = await sql.unsafe<{ abgerechnet_menge: string }[]>(
      `select abgerechnet_menge::text from aufmass where id = $1`, [blatt]);
    expect(nach!.abgerechnet_menge).toBe('0.000');
  });
});

// ===========================================================================
// Die Decke: `rechnungsposition_quelle` ist INTERN (§1.4, EMP-13)
// ===========================================================================

describe('Die Herkunft verlässt das interne Portal nicht', () => {
  it('das Kundenportal liest keine Herkunftszeile — auch nicht zur eigenen Rechnung', async () => {
    const rechnung = await inSitzung(bau.mandant, async (tx) => {
      const d = alsDienst(tx);
      await baueZeiteintrag('2026-08-03T06:00:00Z', '2026-08-03T14:00:00Z');
      const r = await leerEntwurf(tx, { mitAuftrag: false });
      await fuegeZeitPositionHinzu(d, {
        rechnungId: r, bezeichnung: 'Stunden', stundensatzCent: cent(42_50n),
        steuergruppe: 'ust_19', auftragLeistungId: bau.leistung,
      });
      await finalisiere(d, r);
      return r;
    });

    const gesehen = await sql.begin(async (tx) => {
      await tx.unsafe(`set local role cse_app`);
      await tx.unsafe(`select set_config('app.scope', 'kunde', true)`);
      await tx.unsafe(`select set_config('app.mandant_id', '', true)`);
      await tx.unsafe(`select set_config('app.mandant_ids', $1, true)`, [bau.mandant]);
      await tx.unsafe(`select set_config('app.benutzer_id', $1, true)`, [benutzer]);
      await tx.unsafe(`select set_config('app.readonly', 'on', true)`);
      await tx.unsafe(`select set_config('app.portal', 'kunde', true)`);
      const [n] = await tx.unsafe<{ n: string }[]>(
        `select count(*)::text as n from rechnungsposition_quelle where rechnung_id = $1`,
        [rechnung] as never[]);
      return Number(n!.n);
    }) as number;

    /**
     * Ein Kunde bekommt die Rechnungszeile, den Leistungsnachweis und das
     * Aufmaßblatt über seine eigenen Dokumente — nie den Dienstplan. Nähme man
     * `p_intern_ceiling` weg, stünde hier eine Zahl größer null, und mit ihr
     * die Namen und Schichten der Kolonne.
     */
    expect(gesehen).toBe(0);
  });

  it('die Herkunftszeile kann nicht gelöscht werden — auch nicht vom Eigentümer', async () => {
    const rechnung = await inSitzung(bau.mandant, async (tx) => {
      const d = alsDienst(tx);
      const r = await leerEntwurf(tx, { mitAuftrag: false });
      await fuegePositionHinzu(d, {
        rechnungId: r, bezeichnung: 'Pauschale', menge: milliMenge(1_000n),
        einheit: 'psch', einzelpreisCent: cent(100_00n), steuergruppe: 'ust_19',
        quellen: vonHand('Pauschale ohne Zeitbezug'),
      });
      return r;
    });
    const fehler = await sql.unsafe(
      `delete from rechnungsposition_quelle where rechnung_id = $1`, [rechnung],
    ).catch((e: unknown) => e);
    expect((fehler as Error).message).toMatch(/gel|Loesch|delete/iu);
  });
});

// ===========================================================================
// (9) Die Quelle muss zu DIESER Rechnung gehören
// ===========================================================================

/**
 * **Die RLS sagt „dieselbe Gesellschaft", nicht „derselbe Auftrag".**
 *
 * `fuegeZeitPositionHinzu` filterte die Zeiteinträge ausschliesslich über die
 * mitgegebenen Kennungen. Keine Zeile band sie an die Rechnung, in die sie
 * geschrieben wurden — und keine erzwang, dass überhaupt eine Kennung kommt.
 * Beides fand der Copilot-Durchgang auf PR #7.
 *
 * Zwei Fälle, und der erste ist der teurere:
 *
 *  - **Ohne jeden Anker** wird aus `($1 is null or …)` ein „egal": die Zeile
 *    war dann die Summe ALLER freigegebenen, noch nicht abgerechneten Stunden
 *    der Gesellschaft — und markierte sie anschliessend als abgerechnet. Der
 *    Typ sagte seit jeher „genau eine der beiden"; durchgesetzt hat es nichts.
 *  - **Ein fremder Auftrag** liess sich an eine Rechnung hängen, die einen
 *    anderen trägt. Jede Zeile für sich stimmig, jeder Fremdschlüssel erfüllt.
 *
 * Über das Formular kam beides nicht — die Route schickt genau eine Kennung.
 * Über `POST /api/rechnungen` von Hand schon, und die Zeile wäre danach
 * festgeschrieben und unveränderlich.
 */
describe('(9) Zeit aus einem fremden Auftrag kommt nicht auf diese Rechnung', () => {
  it('ohne Anker wird abgewiesen — sonst ist die Zeile die Summe aller offenen Stunden', async () => {
    await baueZeiteintrag('2026-08-10T06:00:00Z', '2026-08-10T10:00:00Z');
    await expect(inSitzung(bau.mandant, async (tx) => {
      const r = await leerEntwurf(tx);
      return fuegeZeitPositionHinzu(alsDienst(tx), {
        rechnungId: r, bezeichnung: 'Ohne Anker',
        stundensatzCent: cent(42_50n), steuergruppe: 'ust_19',
      });
    })).rejects.toMatchObject({ name: 'RechnungFehler', grund: 'quelle_passt_nicht' });
  });

  it('und mit BEIDEN Ankern ebenso — „genau eine" ist keine Empfehlung', async () => {
    await expect(inSitzung(bau.mandant, async (tx) => {
      const r = await leerEntwurf(tx);
      return fuegeZeitPositionHinzu(alsDienst(tx), {
        rechnungId: r, bezeichnung: 'Beide Anker',
        stundensatzCent: cent(42_50n), steuergruppe: 'ust_19',
        auftragId: bau.auftrag, auftragLeistungId: bau.leistung,
      });
    })).rejects.toMatchObject({ name: 'RechnungFehler', grund: 'quelle_passt_nicht' });
  });

  it('die Zeit eines ANDEREN Auftrags wird abgewiesen, nicht stillschweigend gebucht', async () => {
    // Ein zweiter Auftrag beim selben Kunden, im selben Objekt, derselbe
    // Mandant — alles, was die RLS prüft, stimmt. Nur der Auftrag ist ein
    // anderer, und genau das ist der Fall.
    const [fremd] = await sql.unsafe<{ id: string }[]>(
      `insert into auftrag (mandant_id, auftragsnummer, kunde_id, objekt_id, art, status,
                            bezeichnung, verantwortlich_benutzer_id, start_datum)
       select $1, $2, kunde_id, objekt_id, 'rahmenvertrag', 'aktiv', 'Zweiter Auftrag',
              verantwortlich_benutzer_id, '2026-01-01'
         from auftrag where id = $3
       returning id`,
      [bau.mandant, `AU-${zufall()}`, bau.auftrag] as never[]);

    await expect(inSitzung(bau.mandant, async (tx) => {
      const r = await legeEntwurfAn(alsDienst(tx), {
        kundeId: bau.kunde, objektId: bau.objekt, auftragId: fremd!.id,
        leistungVon: '2026-08-01', leistungBis: '2026-08-31', zahlungszielTage: 30,
      });
      return fuegeZeitPositionHinzu(alsDienst(tx), {
        rechnungId: r, bezeichnung: 'Stunden des anderen Auftrags',
        stundensatzCent: cent(42_50n), steuergruppe: 'ust_19',
        auftragLeistungId: bau.leistung,
      });
    })).rejects.toThrow(/anderen Auftrag/u);
  });

  it('Gegenprobe: eine Rechnung OHNE Auftrag nimmt dieselbe Zeile an', async () => {
    // Der Fall gibt es ausdrücklich — eine Einmalleistung ohne Auftragsbezug.
    // Ihn zu verbieten wäre eine erfundene Regel, und ohne diese Prüfung
    // stünde oben nur, dass Festschreiben schwierig ist.
    await baueZeiteintrag('2026-08-11T06:00:00Z', '2026-08-11T10:00:00Z');
    const ergebnis = await inSitzung(bau.mandant, async (tx) => {
      const r = await leerEntwurf(tx, { mitAuftrag: false });
      return fuegeZeitPositionHinzu(alsDienst(tx), {
        rechnungId: r, bezeichnung: 'Einmalleistung',
        stundensatzCent: cent(42_50n), steuergruppe: 'ust_19',
        auftragLeistungId: bau.leistung,
      });
    });
    expect(ergebnis.zeiteintraege).toBeGreaterThan(0);
  });
});
