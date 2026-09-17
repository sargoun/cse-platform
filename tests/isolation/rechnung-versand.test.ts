/**
 * `rechnung_versand` und `bauleistung_jahressumme` gegen eine echte Datenbank
 * (0181, 0182; 05-FINANZEN.md §8.6, §9.6; FIN-10, FIN-11, FIN-12, LEG-06,
 * SOC-07, Invariante 7, Invariante 8, K-12, §48 Abs. 2 EStG, §286 BGB).
 *
 * **Die Aussage, um die es hier geht: das Schema weigert sich, einen Versand
 * zu protokollieren, der nicht stattgefunden hat.** Solange
 * `versand.<kanal>.verbunden` nicht ausdrücklich `true` sagt, ist der einzige
 * erlaubte Zustand `nicht_verbunden`. Ein vorgetäuschter Erfolg fällt erst
 * auf, wenn der Mahnlauf schon gelaufen ist — und dann ist er nicht mehr zu
 * korrigieren, sondern zu erklären.
 *
 * **Und die zweite: der Versandstand ist ein KIND** (K-12). Was protokolliert
 * ist — wer freigegeben hat, welches Artefakt, an wen — ändert sich nicht;
 * was danach geschieht, schon.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, alsRolle, schliessen, seed, sql, type Fixtur } from './harness.js';
import { cent } from '../../src/server/services/finanz/geld.js';
import { milliMenge } from '../../src/server/services/finanz/menge.js';
import {
  finalisiere, fuegePositionHinzu, legeEntwurfAn, vonHand, type Abfrage,
} from '../../src/server/services/finanz/rechnung.js';
import {
  versandprotokoll, versandwege,
} from '../../src/server/services/finanz/versand.js';

let f: Fixtur;
let benutzer: string;
let kundeId: string;

const zufall = (): string => Math.random().toString(36).slice(2, 10);

function alsDienst(tx: postgres.TransactionSql): Abfrage {
  return {
    abfrage: async <T,>(anweisung: string, werte: readonly unknown[] = []) =>
      (await tx.unsafe(anweisung, werte as never[])) as readonly T[],
  };
}

function sitzung() {
  return {
    scope: 'mandant' as const, mandantId: f.reinigung, benutzerId: benutzer,
    portal: 'intern' as const, readonly: false,
  };
}

async function legeBenutzerAn(email: string): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status, globale_rolle_id)
     values ($1, $2, 'Buchhaltung', 'aktiv',
             (select id from rolle where schluessel = 'super_admin' and mandant_id is null))`,
    [u!.id, email]);
  return u!.id;
}

async function macheFakturierfaehig(mandantId: string): Promise<void> {
  await sql.unsafe(
    `update mandant
        set ist_rechtseinheit = true, eigener_nummernkreis = true,
            strasse = 'Kurfürstendamm 21', plz = '10719', ort = 'Berlin',
            ust_id = 'DE123456789', steuernummer = '30/123/45678',
            handelsregister_gericht = 'Amtsgericht Charlottenburg',
            handelsregister_nummer = 'HRB 12345 B'
      where id = $1`, [mandantId]);
  await sql.unsafe(
    `insert into nummernkreis
       (mandant_id, kreis_typ, kontext_id, jahr, bezeichnung, lueckenlos, format_maske,
        zuruecksetzung, geoeffnet_am, ist_platzhalter, erstellt_von_art, erstellt_von_dienst)
     values ($1, 'ausgangsrechnung', null, 0, 'Rechnungen', true, 'RE-{nr:5}', 'nie',
             '2026-01-01', false, 'system', 'job:test')`,
    [mandantId]);
}

/** Ein Entwurf mit einer Position — und der festgeschriebene Beleg daraus. */
async function belegAnlegen(): Promise<{ entwurf: string; fest: string }> {
  const entwurf = await alsApp(sitzung(), async (tx) => {
    const d = alsDienst(tx);
    const id = await legeEntwurfAn(d, {
      kundeId, rechnungsart: 'standard',
      leistungVon: '2026-02-01', leistungBis: '2026-02-28', zahlungszielTage: 30,
    });
    await fuegePositionHinzu(d, {
      rechnungId: id, bezeichnung: 'Unterhaltsreinigung Februar',
      menge: milliMenge(1000n), einheit: 'm2',
      einzelpreisCent: cent(100_000n), steuergruppe: 'ust_19',
      quellen: vonHand('Testfixtur ohne Beleg — von Hand erfasst'),
    });
    return id;
  });
  const zweiter = await alsApp(sitzung(), async (tx) => {
    const d = alsDienst(tx);
    const id = await legeEntwurfAn(d, {
      kundeId, rechnungsart: 'standard',
      leistungVon: '2026-03-01', leistungBis: '2026-03-31', zahlungszielTage: 30,
    });
    await fuegePositionHinzu(d, {
      rechnungId: id, bezeichnung: 'Unterhaltsreinigung März',
      menge: milliMenge(1000n), einheit: 'm2',
      einzelpreisCent: cent(100_000n), steuergruppe: 'ust_19',
      quellen: vonHand('Testfixtur ohne Beleg — von Hand erfasst'),
    });
    return id;
  });
  await alsApp(sitzung(), async (tx) => finalisiere(alsDienst(tx), zweiter));
  return { entwurf, fest: zweiter };
}

/** Der Grundsatz einer Versandzeile — die Felder, die Pflicht sind. */
async function eintragen(
  rechnungId: string,
  {
    kanal = 'email', status = 'nicht_verbunden', artefakt = 'xrechnung',
    gesendet = false, hash = 'a',
  }: {
    kanal?: string; status?: string; artefakt?: string;
    gesendet?: boolean; hash?: string;
  } = {},
): Promise<string> {
  const [z] = await sql.unsafe<{ id: string }[]>(
    `insert into rechnung_versand
       (mandant_id, rechnung_id, artefakt, nutzlast_sha256, kunde_id, kanal,
        empfaenger_text, freigegeben_von, erstellt_von, status, gesendet_am)
     values ($1,$2,$3,repeat($4,64),$5,$6::uebertragungsweg,'amt@example.test',
             $7,$7,$8::versand_status, case when $9 then now() end)
     returning id`,
    [f.reinigung, rechnungId, artefakt, hash, kundeId, kanal, benutzer, status, gesendet]);
  return z!.id;
}

beforeEach(async () => {
  f = await seed();
  benutzer = await legeBenutzerAn(`buchhaltung-${zufall()}@cse.test`);
  await macheFakturierfaehig(f.reinigung);
  const [k] = await sql.unsafe<{ id: string }[]>(
    /*
     * Ein GEWERBLICHER Kunde, obwohl die Leitweg-ID dasteht: mit
     * `ist_oeffentlicher_auftraggeber = true` zöge die §14-Vorabprüfung
     * zusätzliche Pflichtangaben nach (BR-DE-15 und die Käuferreferenz), und
     * dann prüfte dieser Test die Fixtur statt den Versand.
     */
    `insert into kunde (mandant_id, kundennummer, name, strasse, hausnummer, plz, ort,
                        leitweg_id)
     values ($1,$2,'Bezirksamt Mitte','Karl-Marx-Allee','31','10178','Berlin',
             '991-12345-67')
     returning id`, [f.reinigung, `K-${zufall()}`]);
  kundeId = k!.id;
});

afterAll(schliessen);

describe('SOC-07 — kein Versand ohne verbundenen Weg', () => {
  it('weist „gesendet" auf E-Mail ab, solange nichts konfiguriert ist (O-36)', async () => {
    const { fest } = await belegAnlegen();
    await expect(eintragen(fest, { status: 'gesendet', gesendet: true }))
      .rejects.toThrow(/kein Ausliefererweg verbunden/u);
  });

  it('weist „gesendet" auf Peppol, ZRE und OZG-RE ebenso ab (O-22)', async () => {
    const { fest } = await belegAnlegen();
    for (const kanal of ['peppol', 'zre', 'ozg_re']) {
      await expect(eintragen(fest, { kanal, status: 'gesendet', gesendet: true }))
        .rejects.toThrow(/kein Ausliefererweg verbunden/u);
    }
  });

  it('lässt „nicht_verbunden" zu — der Zustand, den es wirklich gibt', async () => {
    const { fest } = await belegAnlegen();
    const id = await eintragen(fest);
    const [z] = await sql.unsafe<{ status: string }[]>(
      `select status::text as status from rechnung_versand where id = $1`, [id]);
    expect(z!.status).toBe('nicht_verbunden');
  });

  it('lässt Post und Kundenportal ohne Verbindung senden', async () => {
    /*
     * Beides ist KEIN elektronischer Versand durch die Plattform: das Portal
     * zeigt das Dokument, Papier kuvertiert ein Mensch. Eine Verbindung dafür
     * zu verlangen hiesse, die eine Zustellung zu sperren, die ohne Software
     * funktioniert.
     */
    const { fest } = await belegAnlegen();
    for (const kanal of ['post', 'kundenportal']) {
      const id = await eintragen(fest,
        { kanal, status: 'gesendet', gesendet: true, artefakt: 'pdf', hash: 'b' });
      expect(id).toBeTruthy();
    }
  });

  it('lässt „gesendet" zu, sobald der Kanal ausdrücklich verbunden ist', async () => {
    const { fest } = await belegAnlegen();
    await sql.unsafe(
      `insert into mandant_einstellung (mandant_id, schluessel, wert)
       values ($1,'versand.email.verbunden','true'::jsonb)`, [f.reinigung]);
    const id = await eintragen(fest,
      { status: 'gesendet', gesendet: true, artefakt: 'zugferd', hash: 'c' });
    expect(id).toBeTruthy();
  });

  it('liest denselben Schlüssel im Dienst wie im Auslöser', async () => {
    /*
     * Zwei Stellen, EIN Schlüssel: die Oberfläche darf den Knopf nicht
     * anbieten, den die Datenbank abweist. Liefe der Dienst auf einen anderen
     * Schlüssel, zeigte die Seite „verbunden" und der Versand scheiterte —
     * oder umgekehrt, und dann fehlte ein Knopf, der gehen würde.
     */
    const vorher = await alsApp(sitzung(), async (tx) => versandwege(alsDienst(tx)));
    expect(vorher.every((w) => !w.verbunden)).toBe(true);
    expect(vorher.find((w) => w.kanal === 'email')?.grund).toContain('O-36');

    await sql.unsafe(
      `insert into mandant_einstellung (mandant_id, schluessel, wert)
       values ($1,'versand.email.verbunden','true'::jsonb)`, [f.reinigung]);
    const nachher = await alsApp(sitzung(), async (tx) => versandwege(alsDienst(tx)));
    expect(nachher.find((w) => w.kanal === 'email')?.verbunden).toBe(true);
    expect(nachher.find((w) => w.kanal === 'peppol')?.verbunden).toBe(false);
  });

  it('wertet den Schlüssel DES MANDANTEN der Zeile aus', async () => {
    /*
     * Ein Job hat keinen aktiven Mandanten. Läse der Auslöser
     * `app.aktiver_mandant()`, gälte für jede Gesellschaft dieselbe Antwort —
     * bei Reinigung verbunden, bei Security auch. Das wäre ein Versand über
     * einen Weg, den diese Gesellschaft nicht hat.
     */
    const { fest } = await belegAnlegen();
    await sql.unsafe(
      `insert into mandant_einstellung (mandant_id, schluessel, wert)
       values ($1,'versand.email.verbunden','true'::jsonb)`, [f.security]);
    await expect(eintragen(fest, { status: 'gesendet', gesendet: true }))
      .rejects.toThrow(/kein Ausliefererweg verbunden/u);
  });
});

describe('Nur eine festgeschriebene Rechnung wird versendet', () => {
  it('weist einen Entwurf ab — er trägt keine Nummer', async () => {
    const { entwurf } = await belegAnlegen();
    await expect(eintragen(entwurf))
      .rejects.toThrow(/Nur eine festgeschriebene Rechnung/u);
  });
});

describe('K-12 — append-only bis auf den Zustand', () => {
  it('lässt Empfänger, Artefakt, Hash und Freigabe nicht ändern', async () => {
    const { fest } = await belegAnlegen();
    const id = await eintragen(fest);
    for (const anweisung of [
      `update rechnung_versand set empfaenger_text = 'anders@example.test' where id = $1`,
      `update rechnung_versand set artefakt = 'pdf' where id = $1`,
      `update rechnung_versand set nutzlast_sha256 = repeat('f',64) where id = $1`,
      `update rechnung_versand set freigegeben_am = now() where id = $1`,
    ]) {
      await expect(sql.unsafe(anweisung, [id]))
        .rejects.toThrow(/aendert sich nicht/u);
    }
  });

  it('lässt den Zustandsteil ändern — dafür ist die Tabelle ein Kind', async () => {
    const { fest } = await belegAnlegen();
    const id = await eintragen(fest);
    await sql.unsafe(
      `update rechnung_versand set zugang_am = '2026-04-01',
              zugang_grundlage = 'Einschreiben mit Rückschein' where id = $1`, [id]);
    const [z] = await sql.unsafe<{ zugang_am: string }[]>(
      `select zugang_am::text as zugang_am from rechnung_versand where id = $1`, [id]);
    expect(z!.zugang_am).toBe('2026-04-01');
  });

  it('verlangt für einen Zugang seine Grundlage (§286 BGB)', async () => {
    /*
     * `zugang_am` ohne `zugang_grundlage` wäre ein Verzugsbeginn, den niemand
     * belegen kann — und der Mahnlauf rechnet ab diesem Tag.
     */
    const { fest } = await belegAnlegen();
    const id = await eintragen(fest);
    await expect(sql.unsafe(
      `update rechnung_versand set zugang_am = '2026-04-01' where id = $1`, [id]))
      .rejects.toThrow(/rv_zugang_begruendet/u);
  });

  it('verlangt für „gesendet" einen Zeitpunkt und umgekehrt', async () => {
    const { fest } = await belegAnlegen();
    await expect(eintragen(fest, { kanal: 'post', status: 'gesendet', gesendet: false }))
      .rejects.toThrow(/rv_gesendet_hat_zeitpunkt/u);
  });

  it('verlangt für „fehlgeschlagen" einen Fehlertext', async () => {
    const { fest } = await belegAnlegen();
    const id = await eintragen(fest);
    await expect(sql.unsafe(
      `update rechnung_versand set status = 'fehlgeschlagen' where id = $1`, [id]))
      .rejects.toThrow(/rv_fehlertext_bei_fehler/u);
  });

  it('trägt auf rechnung KEIN versendet_am (K-12)', async () => {
    const [z] = await sql.unsafe<{ anzahl: string }[]>(
      `select count(*)::text as anzahl from information_schema.columns
        where table_name = 'rechnung' and column_name = 'versendet_am'`);
    expect(Number(z!.anzahl)).toBe(0);
  });
});

describe('Invariante 5 — der Freigabezeitpunkt kommt von der Serveruhr', () => {
  it('überschreibt einen mitgeschickten Zeitpunkt', async () => {
    /*
     * Der erste Entwurf hängte `kern.erzwinge_serverzeit()` an diese Tabelle.
     * Die Funktion stempelt fest `eingegangen_am` — eine Spalte, die es hier
     * nicht gibt —, und JEDES Einfügen scheiterte mit
     * `record "new" has no field "eingegangen_am"`. Der Test hält beides fest:
     * dass es geht, und dass die Zeit vom Server kommt.
     */
    const { fest } = await belegAnlegen();
    const [z] = await sql.unsafe<{ id: string; alt: boolean }[]>(
      `insert into rechnung_versand
         (mandant_id, rechnung_id, artefakt, nutzlast_sha256, kunde_id, kanal,
          empfaenger_text, freigegeben_von, erstellt_von, status, freigegeben_am)
       values ($1,$2,'xrechnung',repeat('a',64),$3,'email','amt@example.test',
               $4,$4,'nicht_verbunden','2001-01-01T00:00:00Z')
       returning id, freigegeben_am < now() - interval '1 year' as alt`,
      [f.reinigung, fest, kundeId, benutzer]);
    expect(z!.alt).toBe(false);
  });
});

describe('Invariante 8 und die Mandantengrenze', () => {
  it('sperrt DELETE und TRUNCATE auf rechnung_versand', async () => {
    const { fest } = await belegAnlegen();
    await eintragen(fest);
    await expect(sql.unsafe(`delete from rechnung_versand`))
      .rejects.toThrow(/Hard delete|gesperrt/iu);
    await expect(sql.unsafe(`truncate table rechnung_versand`))
      .rejects.toThrow(/Hard delete|gesperrt/iu);
    await expect(alsRolle('cse_app', async (tx) =>
      tx.unsafe(`delete from rechnung_versand`)))
      .rejects.toThrow(/permission denied|Hard delete|gesperrt/iu);
  });

  it('gibt das Protokoll nur im eigenen Mandanten heraus', async () => {
    const { fest } = await belegAnlegen();
    await eintragen(fest);
    const eigene = await alsApp(sitzung(), async (tx) =>
      versandprotokoll(alsDienst(tx), fest));
    expect(eigene).toHaveLength(1);
    expect(eigene[0]!.kanal).toBe('email');
    expect(eigene[0]!.status).toBe('nicht_verbunden');
    /* Die Leitweg-ID des Käufers gehört NICHT automatisch in die Zeile —
       sie wird eingefroren, wenn sie benutzt wurde, und ist hier leer. */
    expect(eigene[0]!.leitwegId).toBeNull();

    const fremde = await alsApp(
      { ...sitzung(), mandantId: f.security }, async (tx) =>
        versandprotokoll(alsDienst(tx), fest));
    expect(fremde).toHaveLength(0);
  });
});

describe('§48 Abs. 2 EStG — die Jahressumme entsteht VOR der Abzugsentscheidung', () => {
  /** Lieferant, Beleg und eine bauabzugspflichtige Eingangsrechnung. */
  async function eingangsrechnung(
    brutto: bigint, leistungsdatum: string,
  ): Promise<{ id: string; lieferant: string }> {
    const [l] = await sql.unsafe<{ id: string }[]>(
      `insert into lieferant (mandant_id, lieferantennummer, name, leistungsart,
                              erstellt_von_art, erstellt_von)
       values ($1,$2,'Gerüstbau Spree GmbH','bau','mensch',$3) returning id`,
      [f.reinigung, `L-${zufall()}`, benutzer]);
    const schluessel = `mandant/${f.reinigung}/beleg/${zufall()}.pdf`;
    const [d] = await sql.unsafe<{ id: string }[]>(
      `insert into dokument (mandant_id, kategorie, titel, objekt_schluessel, mime_typ,
                             mime_verifiziert, groesse_bytes, entstanden_am, exif_entfernt)
       values ($1,'buchhaltung','Gerüstbau',$2,'application/pdf',true,2048,$3,true)
       returning id`, [f.reinigung, schluessel, leistungsdatum]);
    const [v] = await sql.unsafe<{ id: string }[]>(
      `insert into dokument_version (mandant_id, dokument_id, version, objekt_schluessel,
                                     sha256, groesse_bytes, mime_typ)
       values ($1,$2,1,$3,repeat('a',64),2048,'application/pdf') returning id`,
      [f.reinigung, d!.id, schluessel]);
    const [b] = await sql.unsafe<{ id: string }[]>(
      `insert into beleg (mandant_id, belegnummer, typ, quelle, dokument_id,
                          dokument_version_id, datei_sha256, seiten, belegdatum,
                          betrag_brutto_cent, erstellt_von_art, erstellt_von)
       values ($1,$2,'eingangsrechnung','email',$3,$4,repeat('a',64),2,$5,$6,'mensch',$7)
       returning id`,
      [f.reinigung, `B-${zufall()}`, d!.id, v!.id, leistungsdatum, String(brutto), benutzer]);
    const netto = brutto - brutto / 6n;
    const [er] = await sql.unsafe<{ id: string }[]>(
      `insert into eingangsrechnung
         (mandant_id, lieferant_id, rechnungsnummer_lieferant, rechnungsdatum,
          leistungsdatum, netto_cent, steuer_cent, brutto_cent, beleg_id,
          bauabzugsteuer_pflichtig, bauabzugsteuer_satz_bp, status,
          erstellt_von_art, erstellt_von)
       values ($1,$2,$3,$4,$4,$5,$6,$7,$8,true,1500,'in_pruefung','mensch',$9)
       returning id`,
      [f.reinigung, l!.id, `GB-${zufall()}`, leistungsdatum,
        String(netto), String(brutto - netto), String(brutto), b!.id, benutzer] as never[]);
    return { id: er!.id, lieferant: l!.id };
  }

  async function gibFrei(erId: string): Promise<void> {
    const [fr] = await sql.unsafe<{ id: string }[]>(
      `insert into freigabe (mandant_id, aktion, status, freigegeben_von, freigegeben_am)
       values ($1,'eingangsrechnung_buchen','genehmigt',$2,now()) returning id`,
      [f.reinigung, benutzer]);
    await alsApp(sitzung(), async (tx) => tx.unsafe(
      `update eingangsrechnung
          set status = 'freigegeben', freigabe_id = $2, freigegeben_von = $3
        where id = $1`, [erId, fr!.id, benutzer]));
  }

  it('schreibt die Summe beim Übergang nach freigegeben fort', async () => {
    const { id, lieferant } = await eingangsrechnung(119_000n, '2026-02-28');
    /* Vor der Freigabe gibt es sie nicht — sie entsteht mit der Freigabe. */
    const [vorher] = await sql.unsafe<{ anzahl: string }[]>(
      `select count(*)::text as anzahl from bauleistung_jahressumme`);
    expect(Number(vorher!.anzahl)).toBe(0);

    await gibFrei(id);
    const [z] = await sql.unsafe<{ jahr: number; betrag: string; dienst: string }[]>(
      `select jahr, gegenleistung_cent::text as betrag, erstellt_von_dienst as dienst
         from bauleistung_jahressumme where lieferant_id = $1`, [lieferant]);
    expect(z!.jahr).toBe(2026);
    expect(z!.betrag).toBe('119000');
    expect(z!.dienst).toContain('bauleistung_jahressumme');
  });

  it('zählt nach dem LEISTUNGSJAHR, nicht nach dem Rechnungsdatum', async () => {
    /*
     * §48 misst das Kalenderjahr der Bauleistung. Eine Leistung vom Dezember,
     * im Januar abgerechnet, gehört ins alte Jahr — sonst wäre die Grenze in
     * beiden Jahren falsch gemessen.
     */
    const a = await eingangsrechnung(60_000n, '2025-12-20');
    await gibFrei(a.id);
    const [z] = await sql.unsafe<{ jahr: number }[]>(
      `select jahr from bauleistung_jahressumme where lieferant_id = $1`, [a.lieferant]);
    expect(z!.jahr).toBe(2025);
  });

  it('addiert zwei Rechnungen desselben Leistenden im selben Jahr', async () => {
    const erste = await eingangsrechnung(119_000n, '2026-02-28');
    await gibFrei(erste.id);
    /* Eine zweite Rechnung desselben Lieferanten, dasselbe Jahr. */
    const schluessel = `mandant/${f.reinigung}/beleg/${zufall()}.pdf`;
    const [d] = await sql.unsafe<{ id: string }[]>(
      `insert into dokument (mandant_id, kategorie, titel, objekt_schluessel, mime_typ,
                             mime_verifiziert, groesse_bytes, entstanden_am, exif_entfernt)
       values ($1,'buchhaltung','Gerüstbau II',$2,'application/pdf',true,2048,
               '2026-05-31',true) returning id`, [f.reinigung, schluessel]);
    const [v] = await sql.unsafe<{ id: string }[]>(
      `insert into dokument_version (mandant_id, dokument_id, version, objekt_schluessel,
                                     sha256, groesse_bytes, mime_typ)
       values ($1,$2,1,$3,repeat('b',64),2048,'application/pdf') returning id`,
      [f.reinigung, d!.id, schluessel]);
    const [b] = await sql.unsafe<{ id: string }[]>(
      `insert into beleg (mandant_id, belegnummer, typ, quelle, dokument_id,
                          dokument_version_id, datei_sha256, seiten, belegdatum,
                          betrag_brutto_cent, erstellt_von_art, erstellt_von)
       values ($1,$2,'eingangsrechnung','email',$3,$4,repeat('b',64),2,'2026-05-31',
               59500,'mensch',$5) returning id`,
      [f.reinigung, `B-${zufall()}`, d!.id, v!.id, benutzer]);
    const [er] = await sql.unsafe<{ id: string }[]>(
      `insert into eingangsrechnung
         (mandant_id, lieferant_id, rechnungsnummer_lieferant, rechnungsdatum,
          leistungsdatum, netto_cent, steuer_cent, brutto_cent, beleg_id,
          bauabzugsteuer_pflichtig, bauabzugsteuer_satz_bp, status,
          erstellt_von_art, erstellt_von)
       values ($1,$2,$3,'2026-05-31','2026-05-31',50000,9500,59500,$4,true,1500,
               'in_pruefung','mensch',$5) returning id`,
      [f.reinigung, erste.lieferant, `GB-${zufall()}`, b!.id, benutzer]);
    await gibFrei(er!.id);

    const [z] = await sql.unsafe<{ betrag: string }[]>(
      `select gegenleistung_cent::text as betrag from bauleistung_jahressumme
        where lieferant_id = $1 and jahr = 2026`, [erste.lieferant]);
    expect(z!.betrag).toBe('178500');
  });

  it('zählt eine nicht bauabzugspflichtige Rechnung NICHT mit', async () => {
    /*
     * Die Grenze des §48 Abs. 2 misst Bauleistungen, nicht jeden Einkauf bei
     * derselben Firma. Ein Bürostuhl vom Gerüstbauer zählt nicht.
     */
    const { id, lieferant } = await eingangsrechnung(119_000n, '2026-02-28');
    await sql.unsafe(
      `update eingangsrechnung set bauabzugsteuer_pflichtig = false where id = $1`, [id]);
    await gibFrei(id);
    const [z] = await sql.unsafe<{ anzahl: string }[]>(
      `select count(*)::text as anzahl from bauleistung_jahressumme
        where lieferant_id = $1`, [lieferant]);
    expect(Number(z!.anzahl)).toBe(0);
  });

  it('verlangt für eine Prognose ihre Grundlage — sie wird nie abgeleitet', async () => {
    const { id, lieferant } = await eingangsrechnung(119_000n, '2026-02-28');
    await gibFrei(id);
    await expect(sql.unsafe(
      `update bauleistung_jahressumme set prognose_cent = 500000
        where lieferant_id = $1`, [lieferant]))
      .rejects.toThrow(/blj_prognose_begruendet/u);
    await sql.unsafe(
      `update bauleistung_jahressumme
          set prognose_cent = 500000,
              prognose_grundlage = 'Rahmenvertrag über 5.000 € netto je Monat'
        where lieferant_id = $1`, [lieferant]);
  });

  it('sperrt DELETE — sie ist der Nachweis, WARUM einbehalten wurde', async () => {
    const { id } = await eingangsrechnung(119_000n, '2026-02-28');
    await gibFrei(id);
    await expect(sql.unsafe(`delete from bauleistung_jahressumme`))
      .rejects.toThrow(/Hard delete|gesperrt/iu);
  });

  it('gibt einer fremden Gesellschaft die Summe nicht heraus (Invariante 3)', async () => {
    const { id } = await eingangsrechnung(119_000n, '2026-02-28');
    await gibFrei(id);
    const fremde = await alsApp(
      { ...sitzung(), mandantId: f.security }, async (tx) =>
        tx.unsafe(`select id from bauleistung_jahressumme`));
    expect(fremde).toHaveLength(0);
    const eigene = await alsApp(sitzung(), async (tx) =>
      tx.unsafe(`select id from bauleistung_jahressumme`));
    expect(eigene).toHaveLength(1);
  });
});
