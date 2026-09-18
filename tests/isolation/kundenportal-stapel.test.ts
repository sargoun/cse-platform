/**
 * Aufträge, Angebote, Objekte und Dokumente im Kundenportal — gegen eine
 * ECHTE Datenbank mit FORCE RLS (OPS-05, OPS-08, OPS-01, DOC-01, DOC-04,
 * K-04, K-18, K-20, AUT-06, 04-SEITENKARTE §8).
 *
 * **Warum keine dieser Aussagen mockbar ist.** Sie sind alle Aussagen über
 * Policies, und eine Policy hat nur eine Datenbank. Schlimmer: der
 * Fehlermodus, den diese Datei absichert, ist NICHT eine Fehlermeldung,
 * sondern die leere Menge — „keine Aufträge" statt „nicht erlaubt" (K-18).
 * Ein Mock, der null Zeilen zurückgibt, bestätigt genau die Verwechslung, die
 * hier ausgeschlossen werden soll.
 *
 * **Die Sätze, die diese Datei beweist:**
 *
 *  1. Der eigene Auftrag ist lesbar, der eines FREMDEN Kunden derselben
 *     Gesellschaft nicht (K-04).
 *  2. Die Leistungszeilen folgen ihrem Auftrag — über den Elternteil, weil
 *     `auftrag_leistung` kein `kunde_id` trägt (0050).
 *  3. Ein VERSENDETES Angebot ist lesbar; ein Entwurf ist es nicht, und zwar
 *     strukturell: `t_kunde` UND `p_kunde_decke` verlangen beide
 *     `versendet_am is not null` (0024). Positionen und Steuerzeilen folgen.
 *  4. Das eigene Objekt samt Raumbuch ist lesbar; ein fremdes und ein Objekt
 *     OHNE Kundenzuordnung sind es nicht (0021).
 *  5. `belagsart` und `reinigungsklasse` liefern im Kunden-Scope NULL Zeilen —
 *     der gemessene Grund, warum die Objektseite sie nicht joint.
 *  6. **`dokument` liefert null Zeilen, auch wenn `sichtbar_fuer_kunde` steht
 *     und `kunde_id` passt** (O-671). Die Gegenprobe im internen Scope zeigt,
 *     dass die Fixtur echt ist — die Null ist eine Policy, keine Tatsache.
 *  7. `dokument_zugriff` ist aus dem Kunden-Scope NICHT schreibbar (O-843) —
 *     der Grund, warum ein Abrufweg heute nicht gebaut werden kann, ohne die
 *     Spur zu verlieren, die DOC-03 verlangt.
 *  8. Kein Schreibweg: weder Auftrag noch Angebot noch Objekt noch Raum
 *     lassen sich aus dem Kundenportal anlegen oder ändern (O-74).
 *  9. Die DIENSTE liefern genau das, was die Policies durchlassen — geprüft
 *     wird der echte Dienst, nicht eine Abschrift seiner Abfrage.
 * 10. Das Mitarbeiterportal bleibt unberührt und sieht von alldem nichts
 *     (K-04).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import type postgres from 'postgres';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import {
  auftragsGesellschaften, findeKundenauftrag, leistungenZumAuftrag,
  listeKundenauftraege,
} from '../../src/server/services/kundenportal/auftrag.js';
import {
  angebotsSummen, findeKundenangebot, listeKundenangebote,
  positionenZumAngebot, steuernZumAngebot,
} from '../../src/server/services/kundenportal/angebot.js';
import {
  auftraegeZumObjekt, findeKundenobjekt, listeKundenobjekte, raeumeZumObjekt,
} from '../../src/server/services/kundenportal/objekt.js';
import {
  dokumentKategorien, listeKundendokumente,
} from '../../src/server/services/kundenportal/dokument.js';
import { kundenUebersicht } from '../../src/server/services/kundenportal/uebersicht.js';

let f: Fixtur;
let chef = '';
let kunde = '';
let fremderKunde = '';
let kundenkonto = '';

/** Was die Fixtur je Lauf anlegt — die Kennungen, gegen die geprüft wird. */
let objektEigen = '';
let objektFremd = '';
let objektOhneKunde = '';
let raumEigen = '';
let auftragEigen = '';
let auftragFremd = '';
let leistungEigen = '';
let angebotVersendet = '';
let angebotEntwurf = '';
let dokumentEigen = '';

const zufall = (): string => Math.random().toString(36).slice(2, 10);
const hash = (t: string): string => createHash('sha256').update(t, 'utf8').digest('hex');

/**
 * Die Kundensitzung — genau so gebunden, wie `withKundeScope` sie bindet:
 * Scope `kunde`, KEIN aktiver Mandant (K-20), Portal `kunde`, nur lesend.
 */
function kundensitzung() {
  return {
    scope: 'kunde' as const, mandantIds: [f.reinigung], benutzerId: kundenkonto,
    portal: 'kunde' as const, readonly: true,
  };
}

/** Dieselbe Anmeldung im MITARBEITERPORTAL — die K-04-Gegenprobe. */
function mitarbeitersitzung() {
  return {
    scope: 'person' as const, mandantIds: [f.reinigung], benutzerId: kundenkonto,
    portal: 'mitarbeiter' as const, readonly: true,
  };
}

/** Die interne Sitzung der Verwaltung — die Gegenprobe „die Zeile gibt es". */
function internSitzung() {
  return {
    scope: 'mandant' as const, mandantId: f.reinigung, benutzerId: chef,
    portal: 'intern' as const, readonly: false, aal: 'aal2' as const,
  };
}

async function zaehle(
  sitzung: Parameters<typeof alsApp>[0], tabelle: string, wo = 'true',
  werte: readonly unknown[] = [],
): Promise<number> {
  const zeilen = await alsApp(sitzung, async (tx) =>
    tx.unsafe<{ n: string }[]>(
      `select count(*)::text as n from ${tabelle} where ${wo}`, werte as never[]));
  return Number(zeilen[0]!.n);
}

/** Der `KundenAbfrage`-Vertrag über einer gebundenen Transaktion. */
function alsDienst(tx: postgres.TransactionSql) {
  return {
    abfrage: async <T,>(anweisung: string, werte: readonly unknown[] = []) =>
      (await tx.unsafe(anweisung, werte as never[])) as readonly T[],
  };
}

async function imKundenScope<T>(
  fn: (k: ReturnType<typeof alsDienst>) => Promise<T>,
): Promise<T> {
  return alsApp(kundensitzung(), async (tx) => fn(alsDienst(tx)));
}

beforeEach(async () => {
  f = await seed();

  const email = `chef-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, globale_rolle_id)
     values ($1, $2, 'Verwaltung', 'aktiv',
             (select id from rolle where schluessel = 'super_admin' and mandant_id is null))`,
    [u!.id, email]);
  chef = u!.id;

  /*
   * Die Mitgliedschaft in der Gesellschaft — nicht Zierde, sondern
   * Voraussetzung: `kern.auftrag_verantwortlich_im_mandant()` (0025) weist
   * jeden Auftrag ab, dessen Verantwortliche keine gueltige
   * `benutzer_mandant`-Zeile in DIESEM Mandanten hat. Ohne sie faellt die
   * Fixtur, und der Fehlschlag saehe aus wie ein RLS-Defekt.
   */
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, gueltig_ab)
     values ($1, $2, (select id from rolle where schluessel = 'admin' and mandant_id is null),
             current_date - 1)`,
    [chef, f.reinigung]);

  const [k1] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, strasse, hausnummer, plz, ort)
     values ($1, $2, 'Berliner Hausverwaltung', 'Karl-Marx-Allee', '31', '10178', 'Berlin')
     returning id`, [f.reinigung, `K-${zufall()}`]);
  kunde = k1!.id;
  const [k2] = await sql.unsafe<{ id: string }[]>(
    `insert into kunde (mandant_id, kundennummer, name, strasse, hausnummer, plz, ort)
     values ($1, $2, 'Charlottenburg Immobilien', 'Bismarckstr', '1', '10625', 'Berlin')
     returning id`, [f.reinigung, `K-${zufall()}`]);
  fremderKunde = k2!.id;

  /*
   * Drei Objekte, und das dritte ist der Fall, den 0021 ausdrücklich nennt:
   * `objekt.kunde_id` ist NULLBAR (ein Veranstaltungsort ohne Kundenstamm).
   * Ohne dieses dritte Objekt bliebe ungeprüft, ob `= any(…)` die NULL
   * wirklich herausfallen lässt — und `NULL = any(array)` ist `unknown`, was
   * in einer Policy wie `false` wirkt, aber nicht danach aussieht.
   */
  const [o1] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung,
                         strasse, hausnummer, plz, ort, zutritt_hinweis, bemerkung)
     values ($1, $2, $3, 'Bürohaus Mitte', 'Friedrichstr.', '12', '10117', 'Berlin',
             'Schlüsselkasten Code 4711', 'Interner Vermerk: Zahlungsmoral gut')
     returning id`, [f.reinigung, kunde, `O-${zufall()}`]);
  objektEigen = o1!.id;
  const [o2] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung,
                         strasse, plz, ort)
     values ($1, $2, $3, 'Fremdhaus', 'Torstr.', '10119', 'Berlin') returning id`,
    [f.reinigung, fremderKunde, `O-${zufall()}`]);
  objektFremd = o2!.id;
  const [o3] = await sql.unsafe<{ id: string }[]>(
    `insert into objekt (mandant_id, kunde_id, objektnummer, bezeichnung,
                         strasse, plz, ort)
     values ($1, null, $2, 'Veranstaltungsort ohne Kunde', 'Revaler Str.', '10245', 'Berlin')
     returning id`, [f.reinigung, `O-${zufall()}`]);
  objektOhneKunde = o3!.id;

  const [r1] = await sql.unsafe<{ id: string }[]>(
    `insert into raum (mandant_id, objekt_id, raumnummer, bezeichnung, etage,
                       flaeche_qm, fenster_flaeche_qm)
     values ($1, $2, '101', 'Büro', '1', 24.5, 6.25) returning id`,
    [f.reinigung, objektEigen]);
  raumEigen = r1!.id;
  await sql.unsafe(
    `insert into raum (mandant_id, objekt_id, raumnummer, bezeichnung, flaeche_qm)
     values ($1, $2, '9', 'Fremdraum', 10)`, [f.reinigung, objektFremd]);

  const [a1] = await sql.unsafe<{ id: string }[]>(
    `insert into auftrag (mandant_id, auftragsnummer, kunde_id, objekt_id, art, status,
                          bezeichnung, verantwortlich_benutzer_id, start_datum,
                          auftragswert_netto_cent, personalbedarf_anzahl, ausstattung_hinweis)
     values ($1, $2, $3, $4, 'rahmenvertrag', 'aktiv', 'Unterhaltsreinigung',
             $5, current_date - 100, 1200000, 3, 'Wagen 3, Schlüssel bei Hausmeisterin')
     returning id`,
    [f.reinigung, `A-${zufall()}`, kunde, objektEigen, chef]);
  auftragEigen = a1!.id;
  const [a2] = await sql.unsafe<{ id: string }[]>(
    `insert into auftrag (mandant_id, auftragsnummer, kunde_id, art, status, bezeichnung,
                          verantwortlich_benutzer_id, start_datum)
     values ($1, $2, $3, 'einzelauftrag', 'aktiv', 'Fremdauftrag', $4, current_date - 5)
     returning id`, [f.reinigung, `A-${zufall()}`, fremderKunde, chef]);
  auftragFremd = a2!.id;

  const [l1] = await sql.unsafe<{ id: string }[]>(
    `insert into auftrag_leistung (mandant_id, auftrag_id, position_nr, objekt_id,
                                   bezeichnung, menge, einheit, einzelpreis_cent,
                                   steuersatz_bp, leistungsfrequenz_text, gueltig_ab)
     values ($1, $2, 1, $3, 'Unterhaltsreinigung', 1, 'Monat', 100000, 1900,
             '5× wöchentlich', current_date - 100) returning id`,
    [f.reinigung, auftragEigen, objektEigen]);
  leistungEigen = l1!.id;
  await sql.unsafe(
    `insert into auftrag_leistung (mandant_id, auftrag_id, position_nr, bezeichnung,
                                   menge, einheit, einzelpreis_cent, steuersatz_bp, gueltig_ab)
     values ($1, $2, 1, 'Fremdleistung', 1, 'psch', 50000, 1900, current_date - 5)`,
    [f.reinigung, auftragFremd]);

  /*
   * Ein Angebot, das WIRKLICH versendet wird — über den Zustandswechsel, den
   * die drei Auslöser aus 0024 bewachen, und nicht durch ein `insert` mit
   * gesetztem `versendet_am`. Nur so entstehen die `angebot_steuer`-Zeilen,
   * und nur so ist geprüft, dass der Kunde sieht, was der Versand erzeugt.
   */
  const [g1] = await sql.unsafe<{ id: string }[]>(
    `insert into angebot (mandant_id, kunde_id, objekt_id, titel, status, gueltig_bis,
                          leistungszeitraum_von, leistungszeitraum_bis,
                          einleitungstext, schlusstext, entscheidung_notiz)
     values ($1, $2, $3, 'Unterhaltsreinigung 2026', 'entwurf', current_date + 20,
             current_date, current_date + 365, 'Sehr geehrte Damen und Herren,',
             'Mit freundlichen Grüßen', 'INTERN: Kunde wollte 8 % runter')
     returning id`, [f.reinigung, kunde, objektEigen]);
  angebotVersendet = g1!.id;
  await sql.unsafe(
    `insert into angebotsposition (mandant_id, angebot_id, position_nr, kurztext,
                                   menge, einheit, einzelpreis_cent, steuersatz_bp)
     values ($1, $2, 1, 'Unterhaltsreinigung monatlich', 12, 'Monat', 100000, 1900),
            ($1, $2, 2, 'Glasreinigung', 2, 'Einsatz', 45000, 700)`,
    [f.reinigung, angebotVersendet]);
  await alsApp(internSitzung(), async (tx) => tx.unsafe(
    `update angebot
        set angebotsnummer = $2, status = 'versendet',
            freigegeben_von = $3, freigegeben_am = now(),
            versendet_am = now(), versendet_von = $3
      where id = $1`,
    [angebotVersendet, `AN-${zufall()}`, chef]));

  const [g2] = await sql.unsafe<{ id: string }[]>(
    `insert into angebot (mandant_id, kunde_id, titel, status)
     values ($1, $2, 'Entwurf, nie versendet', 'entwurf') returning id`,
    [f.reinigung, kunde]);
  angebotEntwurf = g2!.id;
  await sql.unsafe(
    `insert into angebotsposition (mandant_id, angebot_id, position_nr, kurztext,
                                   menge, einheit, einzelpreis_cent, steuersatz_bp)
     values ($1, $2, 1, 'Noch nicht abgestimmt', 1, 'psch', 999900, 1900)`,
    [f.reinigung, angebotEntwurf]);

  /*
   * Ein Dokument, das ALLE Bedingungen der Kundendecke erfüllt: freigegeben,
   * diesem Kunden zugeordnet, nicht gelöscht. Genau deshalb ist die Null im
   * Kunden-Scope aussagekräftig — sie kann nur von der fehlenden permissiven
   * Policy kommen (O-671).
   */
  const [d1] = await sql.unsafe<{ id: string }[]>(
    `insert into dokument (mandant_id, kategorie, titel, kunde_id, objekt_id,
                           objekt_schluessel, mime_typ,
                           mime_verifiziert, groesse_bytes, exif_entfernt)
     values ($1, 'vertrag', 'Rahmenvertrag 2026', $2, $3,
             'dokumente/vertrag.pdf', 'application/pdf', true, 1536000, true)
     returning id`, [f.reinigung, kunde, objektEigen]);
  dokumentEigen = d1!.id;
  /*
   * Die Freigabe ist ein EIGENER Vorgang mit eigenem Recht (DOC-04, 0297):
   * `kern.dokument_kundenfreigabe_pruefen()` weist ein INSERT ab, das bereits
   * freigegeben zur Welt kommt — und ein Aufruf ohne Benutzersitzung
   * ebenfalls (0325). Die Fixtur geht deshalb denselben Weg wie das Haus:
   * erst ablegen, dann in einer internen Sitzung freigeben.
   */
  await alsApp(internSitzung(), async (tx) => tx.unsafe(
    `update dokument set sichtbar_fuer_kunde = true where id = $1`, [dokumentEigen]));

  const [z] = await alsApp(internSitzung(), async (tx) => {
    await tx.unsafe(`select set_config('app.aal','aal2',true)`);
    return tx.unsafe<{ ok: boolean; konto_id: string | null }[]>(
      `select ok, konto_id from app.kundenzugang_ausstellen($1::uuid, $2, $3, $4)`,
      [kunde, `portal-${zufall()}@hv.test`, 'Bernd Beispiel',
        hash(randomBytes(32).toString('hex'))]);
  });
  expect(z!.ok).toBe(true);
  kundenkonto = z!.konto_id!;
});

afterAll(schliessen);

// ---------------------------------------------------------------------------

describe('0025 · der eigene Auftrag, und nur der eigene', () => {
  it('(1) der eigene Auftrag ist im Kundenportal lesbar', async () => {
    expect(await zaehle(kundensitzung(), 'auftrag', 'id = $1', [auftragEigen])).toBe(1);
  });

  it('(2) der Auftrag eines FREMDEN Kunden derselben Gesellschaft nicht (K-04)', async () => {
    expect(await zaehle(kundensitzung(), 'auftrag', 'id = $1', [auftragFremd])).toBe(0);
  });

  it('(3) die Leistungszeile folgt ihrem Auftrag — über den Elternteil (0050)', async () => {
    /**
     * `auftrag_leistung` trägt kein `kunde_id` und bekommt auch keines: der
     * Auftrag ist die kaufmännische Beziehung, die Zeile ist ihr Inhalt. Die
     * Policy prüft deshalb über eine Unterabfrage auf `auftrag` — und genau
     * das wird hier gemessen, in beide Richtungen.
     */
    expect(await zaehle(kundensitzung(), 'auftrag_leistung', 'id = $1', [leistungEigen]))
      .toBe(1);
    expect(await zaehle(kundensitzung(), 'auftrag_leistung', 'auftrag_id = $1',
      [auftragFremd])).toBe(0);
  });

  it('(4) der Dienst liefert genau die eigene Zeile — und die fremde als `null`', async () => {
    const ergebnis = await imKundenScope(async (k) => ({
      liste: await listeKundenauftraege(k),
      eigen: await findeKundenauftrag(k, auftragEigen),
      fremd: await findeKundenauftrag(k, auftragFremd),
      leistungen: await leistungenZumAuftrag(k, auftragEigen),
      gesellschaften: await auftragsGesellschaften(k),
    }));
    expect(ergebnis.liste.map((a) => a.id)).toEqual([auftragEigen]);
    expect(ergebnis.eigen?.auftragsnummer).toBeTruthy();
    /* 404 und nicht 403: „nicht da" ist byte-gleich mit „nicht erlaubt" (AUT-06). */
    expect(ergebnis.fremd).toBeNull();
    expect(ergebnis.leistungen).toHaveLength(1);
    expect(ergebnis.leistungen[0]?.inKraft).toBe(true);
    /*
     * `gesamtpreis_cent` ist eine ERZEUGTE Spalte (`round(menge *
     * einzelpreis_cent)`) — sie kommt aus der Datenbank und wird nirgends
     * nachgerechnet. Als Ganzzahltext, nie als `number` (Invariante 1, K-16).
     */
    expect(ergebnis.leistungen[0]?.gesamtpreisCent).toBe('100000');
    expect(typeof ergebnis.leistungen[0]?.gesamtpreisCent).toBe('string');
    expect(ergebnis.gesellschaften.map((g) => g.mandantSlug)).toEqual(['reinigung']);
  });

  it('(5) der Gesellschaftsfilter kann nur wegnehmen, nie öffnen (Invariante 3)', async () => {
    /**
     * Der Slug in der Adresse verengt die ANZEIGE. Ein Slug einer anderen
     * Gesellschaft — oder einer, die es nicht gibt — ergibt eine leere Liste;
     * er kann nichts sichtbar machen, was RLS nicht ohnehin durchlässt.
     */
    const ergebnis = await imKundenScope(async (k) => ({
      fremdeGesellschaft: await listeKundenauftraege(k, { mandantSlug: 'bau' }),
      erfunden: await listeKundenauftraege(k, { mandantSlug: 'gibt-es-nicht' }),
    }));
    expect(ergebnis.fremdeGesellschaft).toHaveLength(0);
    expect(ergebnis.erfunden).toHaveLength(0);
  });
});

describe('0024 · das versendete Angebot — und der Entwurf, den es nicht gibt', () => {
  it('(6) ein versendetes Angebot ist lesbar', async () => {
    expect(await zaehle(kundensitzung(), 'angebot', 'id = $1', [angebotVersendet])).toBe(1);
  });

  it('(7) ein ENTWURF ist strukturell unerreichbar — auch der eigene', async () => {
    /**
     * Das ist die teuerste Zusage dieser Seite: ein Entwurf ist ein Preis, an
     * dem noch gerechnet wird. Ihn zu zeigen hiesse, ein Angebot abzugeben,
     * das niemand freigegeben hat (Invariante 7). Die Bedingung steht in
     * BEIDEN Policies (`t_kunde` und `p_kunde_decke`), nicht in einer
     * `where`-Klausel, die jemand vergisst.
     */
    expect(await zaehle(kundensitzung(), 'angebot', 'id = $1', [angebotEntwurf])).toBe(0);
    expect(await zaehle(kundensitzung(), 'angebotsposition', 'angebot_id = $1',
      [angebotEntwurf])).toBe(0);
  });

  it('(8) Positionen und Steuerzeilen folgen dem versendeten Angebot', async () => {
    expect(await zaehle(kundensitzung(), 'angebotsposition', 'angebot_id = $1',
      [angebotVersendet])).toBe(2);
    /* Zwei Steuersatzgruppen (19 % und 7 %) — je Gruppe eine Zeile. */
    expect(await zaehle(kundensitzung(), 'angebot_steuer', 'angebot_id = $1',
      [angebotVersendet])).toBe(2);
  });

  it('(9) der Dienst liefert das versendete Angebot, seine Positionen und Summen', async () => {
    const ergebnis = await imKundenScope(async (k) => ({
      liste: await listeKundenangebote(k),
      eigen: await findeKundenangebot(k, angebotVersendet),
      entwurf: await findeKundenangebot(k, angebotEntwurf),
      positionen: await positionenZumAngebot(k, angebotVersendet),
      steuern: await steuernZumAngebot(k, angebotVersendet),
      summen: await angebotsSummen(k, angebotVersendet),
    }));
    expect(ergebnis.liste.map((a) => a.id)).toEqual([angebotVersendet]);
    expect(ergebnis.entwurf).toBeNull();
    expect(ergebnis.positionen).toHaveLength(2);
    expect(ergebnis.steuern).toHaveLength(2);

    /**
     * Die Summen kommen aus der Datenbank, in `bigint`, und werden hier nur
     * NACHGERECHNET, um zu zeigen, dass sie stimmen — 12 × 1.000,00 EUR plus
     * 2 × 450,00 EUR sind 12.900,00 EUR netto; 19 % auf 12.000,00 EUR sind
     * 2.280,00 EUR, 7 % auf 900,00 EUR sind 63,00 EUR.
     */
    expect(ergebnis.summen.nettoCent).toBe('1290000');
    expect(ergebnis.summen.steuerCent).toBe('234300');
    expect(ergebnis.summen.bruttoCent).toBe('1524300');
    /* Ganzzahltext, nie `number` (Invariante 1, K-16). */
    for (const wert of Object.values(ergebnis.summen)) {
      expect(typeof wert).toBe('string');
    }
  });

  it('(10) der interne Vermerk zur Entscheidung steht in KEINER Projektion', async () => {
    /**
     * `entscheidung_notiz` trägt Sätze über den Kunden, nicht für ihn („Kunde
     * wollte 8 % runter"). Die ZEILE lässt die Policy zu Recht durch; welche
     * SPALTEN herauskommen, entscheidet allein die Projektion — deshalb wird
     * hier das Ergebnis geprüft und nicht nur der Quelltext.
     */
    const angebot = await imKundenScope(async (k) => findeKundenangebot(k, angebotVersendet));
    expect(JSON.stringify(angebot)).not.toContain('INTERN');
  });
});

describe('0021 · das eigene Objekt und sein Raumbuch', () => {
  it('(11) das eigene Objekt ist lesbar, das fremde nicht', async () => {
    expect(await zaehle(kundensitzung(), 'objekt', 'id = $1', [objektEigen])).toBe(1);
    expect(await zaehle(kundensitzung(), 'objekt', 'id = $1', [objektFremd])).toBe(0);
  });

  it('(12) ein Objekt OHNE Kundenzuordnung gehört niemandem — und ist unsichtbar', async () => {
    /**
     * `objekt.kunde_id` ist nullbar, und 0021 sagt woertlich: „ein
     * Veranstaltungsort ohne Kundenstamm gehoert niemandem, also sieht ihn im
     * Kundenportal auch niemand". `NULL = any(…)` ist `unknown` und wirkt wie
     * `false` — das SIEHT man einer Policy aber nicht an, deshalb steht es
     * hier gemessen.
     */
    expect(await zaehle(kundensitzung(), 'objekt', 'id = $1', [objektOhneKunde])).toBe(0);
  });

  it('(13) das Raumbuch erbt die Sichtbarkeit seines Objekts', async () => {
    expect(await zaehle(kundensitzung(), 'raum', 'id = $1', [raumEigen])).toBe(1);
    expect(await zaehle(kundensitzung(), 'raum', 'objekt_id = $1', [objektFremd])).toBe(0);
  });

  it('(14) `belagsart` und `reinigungsklasse` liefern NULL Zeilen — der Grund für die fehlende Spalte', async () => {
    /**
     * Das ist die Messung, auf der die Objektseite beruht: ein `left join` auf
     * diese Kataloge ergäbe für JEDEN Raum „—" und liese sich wie „nicht
     * erfasst", obwohl das Raumbuch gepflegt ist (K-18). Und fachlich sind sie
     * die Kalkulationsgrundlage (0021).
     */
    expect(await zaehle(kundensitzung(), 'belagsart')).toBe(0);
    expect(await zaehle(kundensitzung(), 'reinigungsklasse')).toBe(0);
  });

  it('(15) der Dienst liefert Objekt, Raumbuch und die Aufträge am Standort', async () => {
    const ergebnis = await imKundenScope(async (k) => ({
      liste: await listeKundenobjekte(k),
      eigen: await findeKundenobjekt(k, objektEigen),
      fremd: await findeKundenobjekt(k, objektFremd),
      ohneKunde: await findeKundenobjekt(k, objektOhneKunde),
      raeume: await raeumeZumObjekt(k, objektEigen),
      auftraege: await auftraegeZumObjekt(k, objektEigen),
    }));
    expect(ergebnis.liste.map((o) => o.id)).toEqual([objektEigen]);
    expect(ergebnis.fremd).toBeNull();
    expect(ergebnis.ohneKunde).toBeNull();
    expect(ergebnis.raeume.map((r) => r.id)).toEqual([raumEigen]);
    expect(ergebnis.auftraege.map((a) => a.id)).toEqual([auftragEigen]);

    /*
     * Die Flächensumme kommt aus Postgres als `numeric`-TEXT (R-15) — nie als
     * `number`, wo 24,5 + 0,1 nicht 24,6 ergibt.
     */
    expect(ergebnis.eigen?.flaecheQm).toBe('24.500');
    expect(typeof ergebnis.eigen?.flaecheQm).toBe('string');
    expect(ergebnis.eigen?.fensterFlaecheQm).toBe('6.250');
  });

  it('(16) Zutrittshinweis und interner Vermerk stehen in KEINER Projektion', async () => {
    /**
     * `zutritt_hinweis` ist die Schlüsselangabe des Hauses. Sie im Portal
     * auszugeben hiesse, sie an jeden Kundenzugang zu geben, der je
     * ausgestellt wird — und die ZEILE ist zu Recht sichtbar, es ist die
     * Liegenschaft des Kunden.
     */
    const ergebnis = await imKundenScope(async (k) => ({
      liste: await listeKundenobjekte(k),
      eigen: await findeKundenobjekt(k, objektEigen),
    }));
    const text = JSON.stringify(ergebnis);
    expect(text).not.toContain('4711');
    expect(text).not.toContain('Zahlungsmoral');
  });

  it('(17) auch der AUFTRAG gibt seine internen Spalten nicht heraus', async () => {
    const auftrag = await imKundenScope(async (k) => findeKundenauftrag(k, auftragEigen));
    const text = JSON.stringify(auftrag);
    /* Auftragssumme (O-840), Besetzung und Ausstattungshinweis. */
    expect(text).not.toContain('1200000');
    expect(text).not.toContain('Wagen 3');
    expect(text).not.toContain('Hausmeisterin');
  });
});

describe('DOC-04 · Dokumente: die Null ist eine Policy, keine Tatsache (O-671)', () => {
  it('(18) intern IST das Dokument da — die Fixtur ist echt', async () => {
    /**
     * Ohne diese Gegenprobe wäre (19) wertlos: eine leere Liste über einer
     * leeren Tabelle beweist nichts. Erst weil die Zeile nachweislich
     * existiert, freigegeben ist und diesem Kunden gehört, sagt die Null im
     * Kunden-Scope etwas.
     */
    expect(await zaehle(internSitzung(), 'dokument',
      'id = $1 and sichtbar_fuer_kunde and geloescht_am is null and kunde_id = $2',
      [dokumentEigen, kunde])).toBe(1);
  });

  it('(19) im Kunden-Scope liefert `dokument` NULL Zeilen — es fehlt die permissive Policy', async () => {
    /**
     * `p_kunde_ceiling` (0009) und `p_kunde_dokument_zuordnung` (0297) sind
     * RESTRIKTIV: sie schneiden weg und gewähren nie. `t_mandant` greift nicht,
     * weil `app.aktiver_mandant()` im Kunden-Scope NULL ist (K-20), und ein
     * `t_kunde` gibt es auf dieser Tabelle nicht.
     *
     * **Das ist eine offene Entscheidung, kein Defekt** (O-671): ob Dokumente
     * und Anlagen über das Portal ausgeliefert werden, ist eine Entscheidung
     * über Offenlegung. Fällt sie positiv aus, genügt EINE Migration — dieser
     * Test kehrt sich dann um, und die Seite braucht keine Änderung.
     */
    expect(await zaehle(kundensitzung(), 'dokument', 'id = $1', [dokumentEigen])).toBe(0);
    expect(await zaehle(kundensitzung(), 'dokument')).toBe(0);
  });

  it('(20) der Dienst gibt die leere Liste zurück — ohne Fehler und ohne Umweg', async () => {
    /**
     * Die Seite muss die Leere ERKLÄREN können, nicht an ihr scheitern. Ein
     * Dienst, der hier wirft, ergäbe einen Serverfehler statt des Satzes, der
     * sagt, wie die Unterlage heute kommt.
     */
    const ergebnis = await imKundenScope(async (k) => ({
      liste: await listeKundendokumente(k),
      kategorien: await dokumentKategorien(k),
    }));
    expect(ergebnis.liste).toHaveLength(0);
    expect(ergebnis.kategorien).toHaveLength(0);
  });

  it('(21) die Abrufspur ist aus dem Kunden-Scope NICHT schreibbar (O-843)', async () => {
    /**
     * DOC-03 und SEC-A6 verlangen, dass jeder Dateiabruf eine Zeile in
     * `dokument_zugriff` hinterlässt — die interne Route schreibt sie VOR der
     * signierten Adresse, in derselben Transaktion. Aus dem Kunden-Scope geht
     * das heute nicht: `t_dokument_zugriff_anlegen` (0139) verlangt
     * `mandant_id = app.aktiver_mandant()`, und der ist hier NULL (K-20);
     * ausserdem ist der Scope `app.ist_readonly()`.
     *
     * Deshalb wird der Abrufweg NICHT gebaut, solange O-671 offen ist: er wäre
     * entweder ohne Spur (unzulässig) oder ohne Wirkung. Diese Messung ist der
     * Grund — und sie fällt an dem Tag, an dem jemand den Definer nachrüstet,
     * was genau der richtige Zeitpunkt ist, sie umzuschreiben.
     */
    await expect(alsApp(kundensitzung(), async (tx) => tx.unsafe(
      `insert into dokument_zugriff (mandant_id, dokument_id, benutzer_id, art)
       values ($1::uuid, $2::uuid, app.aktueller_benutzer(), 'abruf')`,
      [f.reinigung, dokumentEigen]))).rejects.toThrow();
  });
});

describe('O-74 · aus dem Kundenportal führt kein Schreibweg', () => {
  /**
   * **Zwei zulässige Ausgänge, und beide sind richtig.** Entweder wirft die
   * `WITH CHECK` der schreibenden Policy (beim INSERT), oder das UPDATE
   * trifft keine Zeile, weil die `USING`-Klausel im Kunden-Scope nie wahr
   * wird — `t_mandant` verlangt `mandant_id = app.aktiver_mandant()`, und der
   * ist hier NULL (K-20), und `not app.ist_readonly()`, und der Scope IST
   * readonly. Was NICHT passieren darf, ist eine geänderte Zeile.
   *
   * Jeder Fall bekommt seine EIGENEN Parameter: eine gemeinsame Liste mit
   * ungenutzten Platzhaltern lässt Postgres schon beim Vorbereiten scheitern
   * („could not determine data type of parameter"), und dann bestünde der Test
   * aus dem falschen Grund.
   */
  function faelle(): readonly (readonly [string, string, readonly unknown[]])[] {
    return [
      ['Auftrag anlegen',
        `insert into auftrag (mandant_id, auftragsnummer, kunde_id, art, status, bezeichnung,
                              verantwortlich_benutzer_id, start_datum)
         values ($1::uuid, 'X-1', $2::uuid, 'einzelauftrag', 'angelegt', 'Selbst angelegt',
                 $3::uuid, current_date)`,
        [f.reinigung, kunde, chef]],
      ['Auftrag ändern',
        `update auftrag set bezeichnung = 'Geändert' where id = $1::uuid`, [auftragEigen]],
      ['Objekt ändern',
        `update objekt set bezeichnung = 'Geändert' where id = $1::uuid`, [objektEigen]],
      ['Raum ändern',
        `update raum set flaeche_qm = 1 where id = $1::uuid`, [raumEigen]],
      ['Angebot annehmen',
        `update angebot set status = 'angenommen', entschieden_am = now()
          where id = $1::uuid`, [angebotVersendet]],
      ['Leistungszeile ändern',
        `update auftrag_leistung set einzelpreis_cent = 1 where id = $1::uuid`,
        [leistungEigen]],
    ];
  }

  /*
   * Die NAMEN stehen fest, die Anweisungen entstehen erst im Test: `faelle()`
   * liest `f`, `kunde` und die Kennungen, und die füllt `beforeEach` — beim
   * Einsammeln der Tests sind sie noch leer.
   */
  const NAMEN = ['Auftrag anlegen', 'Auftrag ändern', 'Objekt ändern', 'Raum ändern',
    'Angebot annehmen', 'Leistungszeile ändern'] as const;

  for (const name of NAMEN) {
    it(`(22) ${name} schlägt fehl oder trifft null Zeilen`, async () => {
      const fall = faelle().find(([n]) => n === name)!;
      /*
       * Gefangen wird AUSSERHALB von `alsApp`: nach einem Fehler ist die
       * Transaktion abgebrochen, und schon ihr Abschluss wirft. Ein `catch`
       * im Rumpf gäbe deshalb eine Ablehnung zurück, die wie ein Defekt
       * aussieht.
       */
      let betroffen = 0;
      try {
        betroffen = await alsApp(kundensitzung(), async (tx) => {
          const ergebnis = await tx.unsafe(fall[1], fall[2] as never[]);
          return ergebnis.count;
        });
      } catch {
        betroffen = 0;
      }
      expect(betroffen).toBe(0);
    });
  }

  it('(23) und der Zustand ist danach unverändert', async () => {
    expect(await zaehle(internSitzung(), 'auftrag',
      `id = $1 and bezeichnung = 'Unterhaltsreinigung'`, [auftragEigen])).toBe(1);
    expect(await zaehle(internSitzung(), 'angebot',
      `id = $1 and status = 'versendet'`, [angebotVersendet])).toBe(1);
    expect(await zaehle(internSitzung(), 'auftrag_leistung',
      'id = $1 and einzelpreis_cent = 100000', [leistungEigen])).toBe(1);
  });
});

describe('K-04 · das Mitarbeiterportal sieht von alldem nichts', () => {
  it('(24) dieselbe Anmeldung im Mitarbeiterportal trifft null Zeilen', async () => {
    /**
     * Die Kundendecke ist an `app.portal()` gebunden, die permissive
     * `t_kunde` an `app.scope()`. Ein Konto, das im Kundenportal seine
     * Aufträge sieht, darf sie nicht dadurch weitersehen, dass es die
     * Portal-Angabe wechselt — sonst wäre die Decke eine Bitte.
     */
    for (const tabelle of ['auftrag', 'auftrag_leistung', 'angebot',
      'angebotsposition', 'angebot_steuer', 'objekt', 'raum']) {
      expect(await zaehle(mitarbeitersitzung(), tabelle), `${tabelle} im Mitarbeiterportal`)
        .toBe(0);
    }
  });
});

describe('die Übersicht zählt, was die Seiten zeigen', () => {
  it('(25) jede Zahl der Übersicht stimmt mit ihrer Liste überein', async () => {
    /**
     * Eine Kachel, die eine andere Zahl nennt als die Liste dahinter, ist
     * schlimmer als keine Kachel: sie sieht nach einer Kennzahl aus. Gezählt
     * wird in der Datenbank (`liste(...).length` liefe bei der Obergrenze von
     * 200 still falsch) — diese Prüfung hält die beiden zusammen.
     */
    const ergebnis = await imKundenScope(async (k) => {
      const [heute] = await k.abfrage<{ tag: string }>(
        `select app.berlin_heute()::text as tag`);
      return {
        uebersicht: await kundenUebersicht(k, heute?.tag ?? '2026-01-01'),
        auftraege: await listeKundenauftraege(k),
        angebote: await listeKundenangebote(k),
        objekte: await listeKundenobjekte(k),
        dokumente: await listeKundendokumente(k),
      };
    });
    expect(ergebnis.uebersicht.auftraege).toBe(ergebnis.auftraege.length);
    expect(ergebnis.uebersicht.auftraegeAktiv).toBe(1);
    expect(ergebnis.uebersicht.angebote).toBe(ergebnis.angebote.length);
    expect(ergebnis.uebersicht.angeboteOffen).toBe(1);
    expect(ergebnis.uebersicht.objekte).toBe(ergebnis.objekte.length);
    /* 0 — und zwar aus derselben Policy-Lage wie die Liste (O-671). */
    expect(ergebnis.uebersicht.dokumente).toBe(ergebnis.dokumente.length);
    expect(ergebnis.uebersicht.dokumente).toBe(0);
  });
});
