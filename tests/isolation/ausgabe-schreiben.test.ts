import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import { cent } from '../../src/server/services/finanz/geld.js';
import {
  AusgabeFehler, bucheAusgabe, erfasseAusgabe, gibAusgabeFrei, lehneAusgabeAb,
} from '../../src/server/services/finanz/ausgabe-schreiben.js';
import { leseAusgabe, steuerzeilen } from '../../src/server/services/finanz/ausgabe.js';

/**
 * **Eine Ausgabe entsteht, wird entschieden und gebucht** (V-011, FIN-14,
 * FIN-17, ACC-01, ACC-03).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `0180` baut vier Zustände, den Übergangsauslöser, die Belegpflicht ab
 * `freigegeben`, die Unveränderlichkeit ab `gebucht` und die Steueraufteilung
 * je Satzgruppe. Zwei Seiten lasen das alles. **Schreiben konnte es
 * niemand** — eine Tankquittung liess sich nicht erfassen.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Was hier gemessen wird, ist nicht das Einfügen.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Gemessen werden die vier Stellen, an denen eine Ausgabe teuer wird:
 *
 *  §1 die Steuer je Satzgruppe — gerechnet, nie aus dem Brutto zurück;
 *  §2 die Belegpflicht ab der Freigabe (ACC-03), mit einem SATZ und nicht
 *     mit einer Constraint-Meldung;
 *  §3 die Übergänge, die es nicht gibt — und der zweite Klick auf denselben
 *     Knopf;
 *  §4 das Buchen: Zustand und Buchungssatz in DERSELBEN Transaktion, mit
 *     offener Kontierung statt gar keiner Zeile.
 */

let f: Fixtur;
/** Hält `eingang.schreiben` UND `eingang.freigeben`. */
let buchhaltung = '';
let kategorieId = '';

async function konto(email: string, mandant: string, rolle: string): Promise<string> {
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status) values ($1, $2, $2, 'aktiv')`,
    [u!.id, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id, ist_standard)
     values ($1, $2, (select id from rolle
                       where schluessel = $3 and mandant_id is null), true)`,
    [u!.id, mandant, rolle]);
  return u!.id;
}

beforeAll(async () => {
  f = await seed();
  buchhaltung = await konto('ausg-buch@test.invalid', f.reinigung, 'leitung');
  /*
   * **`buchhaltung.*` steht mit dabei, und das ist ein Befund und kein
   * Testaufbau** (V-128). Ohne sie scheiterte §4 mit „Die Periode zum …
   * liess sich weder anlegen noch lesen" — `sicherePeriode` legt den Monat
   * über einen Definer an und LIEST ihn als `cse_app` zurück, und die
   * Lesepolicy auf `periode` verlangt `buchhaltung.lesen` (0127). Der
   * Mensch am Knopf bekam einen 500 statt einer Auskunft. Die Route
   * verlangt das Recht jetzt ausdrücklich, und der Knopf steht nur, wenn es
   * da ist.
   */
  for (const r of ['eingang.lesen', 'eingang.schreiben', 'eingang.freigeben',
    'buchhaltung.lesen', 'buchhaltung.schreiben', 'finanzen.schreiben']) {
    await sql.unsafe(
      `insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
       values ((select id from rolle where schluessel = 'leitung' and mandant_id is null),
               (select id from berechtigung where schluessel = $1), $2, true)
       on conflict (rolle_id, berechtigung_id, mandant_id)
         do update set gewaehrt = true`,
      [r, f.reinigung]);
  }

  const [k] = await sql.unsafe<{ id: string }[]>(
    `insert into ausgabe_kategorie
       (mandant_id, schluessel, bezeichnung, erstellt_von_art, erstellt_von)
     values ($1, 'kraftstoff', 'Kraftstoff', 'mensch', $2)
     returning id`, [f.reinigung, buchhaltung]);
  kategorieId = k!.id;

});

const zufall = (): string => Math.random().toString(36).slice(2, 10);

/**
 * Ein Beleg mit Dokument und Version — ohne ihn gibt es keine Freigabe.
 *
 * Er entsteht über die rohe Verbindung und damit ohne Policy: geprüft wird
 * hier die AUSGABE. Den Belegweg selbst prüfen `belegarchiv` und `dokument`.
 */
async function legeBelegAn(): Promise<string> {
  const schluessel = `mandant/${f.reinigung}/beleg/${zufall()}.pdf`;
  const [d] = await sql.unsafe<{ id: string }[]>(
    `insert into dokument (mandant_id, kategorie, titel, objekt_schluessel, mime_typ,
                           mime_verifiziert, groesse_bytes, entstanden_am, exif_entfernt)
     values ($1,'buchhaltung','Tankbeleg',$2,'application/pdf',true,2048,'2026-03-12',true)
     returning id`, [f.reinigung, schluessel]);
  const hash = zufall().padEnd(8, 'a').slice(0, 8).repeat(8).slice(0, 64)
    .replace(/[^0-9a-f]/gu, 'a');
  const [v] = await sql.unsafe<{ id: string }[]>(
    `insert into dokument_version (mandant_id, dokument_id, version, objekt_schluessel,
                                   sha256, groesse_bytes, mime_typ)
     values ($1,$2,1,$3,$4,2048,'application/pdf') returning id`,
    [f.reinigung, d!.id, schluessel, hash]);
  const [b] = await sql.unsafe<{ id: string }[]>(
    `insert into beleg (mandant_id, belegnummer, typ, quelle, dokument_id,
                        dokument_version_id, datei_sha256, seiten, belegdatum,
                        betrag_brutto_cent, erstellt_von_art, erstellt_von)
     values ($1,$2,'kassenbeleg','scan',$3,$4,$5,1,'2026-03-12',10828,'mensch',$6)
     returning id`,
    [f.reinigung, `B-${zufall()}`, d!.id, v!.id, hash, buchhaltung]);
  return b!.id;
}
afterAll(schliessen);

function sitzung(benutzerId: string) {
  return {
    scope: 'mandant' as const, mandantId: f.reinigung, benutzerId,
    portal: 'intern' as const, readonly: false,
  };
}

function alsKontext(tx: postgres.TransactionSql, benutzerId: string): SchreibKontext {
  const abfrage = async <T,>(
    anweisung: string, werte?: readonly unknown[],
  ): Promise<readonly T[]> =>
    (await tx.unsafe(anweisung, (werte ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId,
    aktiverMandantId: f.reinigung, mandantIds: [f.reinigung],
    abfrage, schreibe: abfrage,
  };
}

async function imKontext<T>(
  benutzerId: string, fn: (k: SchreibKontext) => Promise<T>,
): Promise<T> {
  return alsApp(sitzung(benutzerId), async (tx) => {
    await tx.unsafe(`select set_config('app.aal','aal2',true)`);
    return fn(alsKontext(tx, benutzerId));
  }) as Promise<T>;
}

/** Eine gewöhnliche Quittung: Kraftstoff zu 19 %, Verpflegung zu 7 %. */
const BON = [
  { gruppe: 'ust_19', nettoCent: cent(8200n) },
  { gruppe: 'ust_07', nettoCent: cent(1000n) },
];

async function erfasse(
  o: { readonly mitBeleg?: boolean; readonly steuer?: typeof BON } = {},
): Promise<string> {
  const belegId = o.mitBeleg === true ? await legeBelegAn() : null;
  return imKontext(buchhaltung, (k) => erfasseAusgabe(k, {
    kategorieId,
    bezeichnung: 'Diesel, Tankstelle Kurfürstendamm',
    ausgabedatum: '2026-03-12',
    zahlungsmittel: 'karte',
    belegId,
    steuer: o.steuer ?? BON,
  }));
}

describe('§1 die Steuer wird gerechnet, nie aus dem Brutto zurück', () => {
  it('je Satzgruppe, und der Kopf ist die Summe der Zeilen', async () => {
    const id = await erfasse();
    const a = await imKontext(buchhaltung, (k) => leseAusgabe(k, id));
    expect(a, 'die Zeile ist lesbar').not.toBeNull();
    /* 8200 × 19 % = 1558 · 1000 × 7 % = 70 */
    expect(a?.nettoCent).toBe(9200n);
    expect(a?.steuerCent).toBe(1628n);
    expect(a?.bruttoCent).toBe(10828n);

    const lage = await imKontext(buchhaltung, (k) => steuerzeilen(k, id));
    expect(lage?.zeilen.length).toBe(2);
    expect(lage?.stimmtMitKopf, 'Kopf und Zeilen gehen auf').toBe(true);
  });

  /**
   * **Der Satz wird EINGEFROREN, nicht verwiesen.** Eine spätere Satzpflege
   * darf einen erfassten Beleg nicht rückwirkend ändern — dieselbe Regel wie
   * auf der Eingangsrechnung (0123).
   */
  it('der Satz steht als Kopie auf der Zeile', async () => {
    const id = await erfasse();
    const [z] = await sql.unsafe<{ satz_bp: number }[]>(
      `select satz_bp from ausgabe_steuer where ausgabe_id = $1 order by satz_bp desc
        limit 1`, [id]);
    expect(z?.satz_bp).toBe(1900);
  });

  it('ohne Aufteilung entsteht gar keine Ausgabe', async () => {
    await expect(erfasse({ steuer: [] })).rejects.toBeInstanceOf(AusgabeFehler);
  });

  it('bar ohne Kasse ebenfalls nicht (GoBD)', async () => {
    await expect(imKontext(buchhaltung, (k) => erfasseAusgabe(k, {
      kategorieId, bezeichnung: 'Trinkgeld', ausgabedatum: '2026-03-12',
      zahlungsmittel: 'bar', steuer: BON,
    }))).rejects.toThrow(/Kasse/u);
  });
});

describe('§2 ohne Beleg keine Freigabe (ACC-03)', () => {
  it('und der Mensch bekommt einen Satz, keine Constraint-Meldung', async () => {
    const id = await erfasse({ mitBeleg: false });
    await expect(imKontext(buchhaltung, (k) => gibAusgabeFrei(k, id)))
      .rejects.toThrow(/Ohne Beleg keine Freigabe/u);
    const a = await imKontext(buchhaltung, (k) => leseAusgabe(k, id));
    expect(a?.status, 'sie bleibt stehen, wo sie war').toBe('erfasst');
  });

  it('mit Beleg geht sie durch — und die Datenbank stempelt den Zeitpunkt', async () => {
    const id = await erfasse({ mitBeleg: true });
    await imKontext(buchhaltung, (k) => gibAusgabeFrei(k, id));
    const a = await imKontext(buchhaltung, (k) => leseAusgabe(k, id));
    expect(a?.status).toBe('freigegeben');
    const [z] = await sql.unsafe<{ am: string | null; von: string | null }[]>(
      `select freigegeben_am::text as am, freigegeben_von::text as von
         from ausgabe where id = $1`, [id]);
    expect(z?.am, 'der Auslöser setzt ihn, nicht der Dienst').not.toBeNull();
    expect(z?.von).toBe(buchhaltung);
  });
});

describe('§3 die Übergänge, die es nicht gibt', () => {
  it('eine abgelehnte Ausgabe wechselt nicht mehr', async () => {
    const id = await erfasse({ mitBeleg: true });
    await imKontext(buchhaltung, (k) => lehneAusgabeAb(k, id, 'privat veranlasst'));
    await expect(imKontext(buchhaltung, (k) => gibAusgabeFrei(k, id)))
      .rejects.toBeInstanceOf(AusgabeFehler);
  });

  it('eine Ablehnung ohne Grund ist keine', async () => {
    const id = await erfasse();
    await expect(imKontext(buchhaltung, (k) => lehneAusgabeAb(k, id, 'x')))
      .rejects.toThrow(/Grund/u);
  });

  /**
   * **Der zweite Klick auf denselben Knopf.** Zwischen dem Lesen und dem
   * Schreiben kann ein zweiter Mensch entschieden haben; `where status = …`
   * trifft dann null Zeilen, und das ist eine Antwort und kein zweiter
   * Übergang (K-09).
   */
  it('derselbe Knopf zweimal ergibt nicht zwei Übergänge', async () => {
    const id = await erfasse({ mitBeleg: true });
    await imKontext(buchhaltung, (k) => gibAusgabeFrei(k, id));
    await expect(imKontext(buchhaltung, (k) => gibAusgabeFrei(k, id)))
      .rejects.toBeInstanceOf(AusgabeFehler);
  });

  it('gebucht wird nur, was freigegeben ist', async () => {
    const id = await erfasse({ mitBeleg: true });
    await expect(imKontext(buchhaltung, (k) => bucheAusgabe(k, id)))
      .rejects.toBeInstanceOf(AusgabeFehler);
  });
});

describe('§4 das Buchen — Zustand und Buchungssatz in einer Transaktion', () => {
  it('die Zeilen entstehen, auch wenn ein Konto fehlt', async () => {
    const id = await erfasse({ mitBeleg: true });
    const befund = await imKontext(buchhaltung, async (k) => {
      await gibAusgabeFrei(k, id);
      return bucheAusgabe(k, id);
    });
    expect(befund.gebucht).toBe(true);
    /* Aufwand (2 Gruppen) + Vorsteuer (2 Gruppen) + Geldkonto = 5 */
    expect(befund.zeilen).toBe(5);
    /*
     * **Offene Kontierungen sind hier der Normalfall und kein Fehler.**
     * `app.konto_aufloesen` kennt keinen Zweig für `aufwand_kategorie`
     * (V-126), und das Geldkonto nennt bei „Karte“ weder Bank noch Kasse.
     * Die Zeile entsteht trotzdem, mit Hinweis, und steht in der
     * Arbeitsliste (D-425) — eine Ausgabe, die wegen einer fehlenden
     * Zuordnung gar nicht gebucht wird, fehlt in der Buchführung, und DAS
     * merkt niemand.
     */
    expect(befund.offeneKontierungen).toBeGreaterThan(0);
  });

  it('die Buchung geht auf — Soll gleich Haben', async () => {
    const id = await erfasse({ mitBeleg: true });
    await imKontext(buchhaltung, async (k) => {
      await gibAusgabeFrei(k, id);
      return bucheAusgabe(k, id);
    });
    const [z] = await sql.unsafe<{ soll: string; haben: string }[]>(
      `select coalesce(sum(umsatz_cent) filter (where soll_haben = 'soll'), 0)::text as soll,
              coalesce(sum(umsatz_cent) filter (where soll_haben = 'haben'), 0)::text as haben
         from buchungssatz where ausgabe_id = $1 and herkunft = 'ausgabe'`, [id]);
    expect(z?.soll).toBe('10828');
    expect(z?.haben).toBe('10828');
  });

  it('zweimal buchen ergibt keine zweite Buchung', async () => {
    const id = await erfasse({ mitBeleg: true });
    await imKontext(buchhaltung, async (k) => {
      await gibAusgabeFrei(k, id);
      return bucheAusgabe(k, id);
    });
    /* Der zweite Versuch scheitert schon am Übergang — gebucht ist das Ende. */
    await expect(imKontext(buchhaltung, (k) => bucheAusgabe(k, id)))
      .rejects.toBeInstanceOf(AusgabeFehler);
  });

  /** Ab `gebucht` ist die Zeile unveränderlich (ACC-06, GoBD). */
  it('eine gebuchte Ausgabe lässt sich nicht mehr ablehnen', async () => {
    const id = await erfasse({ mitBeleg: true });
    await imKontext(buchhaltung, async (k) => {
      await gibAusgabeFrei(k, id);
      return bucheAusgabe(k, id);
    });
    await expect(imKontext(buchhaltung, (k) => lehneAusgabeAb(k, id, 'doch nicht')))
      .rejects.toBeInstanceOf(AusgabeFehler);
  });
});
