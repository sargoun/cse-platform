/**
 * `bauleistung_jahressumme` gegen eine echte Datenbank (0182; 05-FINANZEN.md
 * §8.6; FIN-10, LEG-06, §48 Abs. 2 EStG, Invariante 1, Invariante 8).
 *
 * **Warum dieser Test existiert.** Die erste Fassung des Auslösers schrieb die
 * Jahressumme FORT: sie addierte das Brutto bei jedem Übergang nach
 * `freigegeben`. `fin.eingangsrechnung_uebergang()` erlaubt
 * `freigegeben → in_pruefung` ausdrücklich („Rücknahme vor dem Buchen") und
 * danach wieder den Weg nach vorn — die Rücknahme zog nichts ab, das zweite
 * Freigeben addierte erneut, und die Zahl war das Doppelte. Eine direkt als
 * `freigegeben` eingefügte Zeile wurde überhaupt nie gezählt, weil der
 * Auslöser nur am UPDATE hing.
 *
 * Das ist die Größe, an der sich die Bagatellgrenze des §48 Abs. 2 EStG messen
 * soll, und die Tabelle ist append-only ohne Korrekturweg: die falsche Zahl
 * wäre stehen geblieben und auf `/eingangsrechnungen/[id]/steuer` als „Bereits
 * erbrachte Gegenleistung" erschienen.
 *
 * **Die Antwort ist, aus der QUELLE zu rechnen statt zu addieren — und genau
 * das prüfen diese Fälle, je Richtung.** Nicht mockbar: es geht um einen
 * Auslöser, eine Zustandsmaschine in einem zweiten Auslöser und eine Policy
 * auf `cse_definer`. Ein Test ohne Postgres bewiese, dass ein Mock addiert.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { schliessen, seed, sql, type Fixtur } from './harness.js';

let f: Fixtur;
let benutzer: string;
let lieferantId: string;

const zufall = (): string => Math.random().toString(36).slice(2, 10);

/**
 * Als EIGENTÜMER, aber MIT gebundener Sitzung.
 *
 * `alsApp` wäre hier zu eng: die Fixtur stellt einen Ausgangszustand her und
 * prüft nicht den Schreibweg (den prüft `eingangsrechnung.test.ts`). Nur den
 * Eigentümer zu nehmen reicht aber auch nicht — der Auslöser läuft als
 * `cse_definer`, und dessen Policy `d_blj_schreiben` liest
 * `app.sichtbare_mandanten()`. Ohne gebundene Sitzung ist die Menge leer und
 * die Freigabe scheitert an einer Policy, die im Betrieb nie greift.
 */
async function mitSitzung<T>(
  mandantId: string, fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx.unsafe(`select set_config('app.scope', 'mandant', true)`);
    await tx.unsafe(`select set_config('app.mandant_id', $1, true)`, [mandantId]);
    await tx.unsafe(`select set_config('app.portal', 'intern', true)`);
    await tx.unsafe(`select set_config('app.readonly', 'off', true)`);
    await tx.unsafe(`select set_config('app.benutzer_id', $1, true)`, [benutzer]);
    await tx.unsafe(`select set_config('app.akteur_typ', 'mensch', true)`);
    return fn(tx);
  }) as Promise<T>;
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

/** Ein Beleg mit Dokument und Version — `eingangsrechnung.beleg_id` ist NOT NULL (ACC-03). */
async function legeBelegAn(mandantId: string): Promise<string> {
  const schluessel = `mandant/${mandantId}/beleg/${zufall()}.pdf`;
  const hash = zufall().padEnd(8, 'a').slice(0, 8).repeat(8).slice(0, 64)
    .replace(/[^0-9a-f]/gu, 'a');
  const [d] = await sql.unsafe<{ id: string }[]>(
    `insert into dokument (mandant_id, kategorie, titel, objekt_schluessel, mime_typ,
                           mime_verifiziert, groesse_bytes, entstanden_am, exif_entfernt)
     values ($1,'buchhaltung','Bauleistung',$2,'application/pdf',true,2048,'2026-08-31',true)
     returning id`, [mandantId, schluessel]);
  const [v] = await sql.unsafe<{ id: string }[]>(
    `insert into dokument_version (mandant_id, dokument_id, version, objekt_schluessel,
                                   sha256, groesse_bytes, mime_typ)
     values ($1,$2,1,$3,$4,2048,'application/pdf') returning id`,
    [mandantId, d!.id, schluessel, hash]);
  const [b] = await sql.unsafe<{ id: string }[]>(
    `insert into beleg (mandant_id, belegnummer, typ, quelle, dokument_id,
                        dokument_version_id, datei_sha256, seiten, belegdatum,
                        erstellt_von_art, erstellt_von)
     values ($1,$2,'eingangsrechnung','upload',$3,$4,$5,1,'2026-08-31','mensch',$6)
     returning id`,
    [mandantId, `B-${zufall()}`, d!.id, v!.id, hash, benutzer]);
  return b!.id;
}

/** Eine genehmigte Freigabe — ohne sie lässt der Übergangsauslöser nichts durch (K-13). */
async function legeFreigabeAn(mandantId: string): Promise<string> {
  const [fr] = await sql.unsafe<{ id: string }[]>(
    `insert into freigabe (mandant_id, aktion, status, titel, zusammenfassung, risiko,
                           payload_hash, erstellt_von, freigegeben_von, freigegeben_am)
     values ($1,'eingangsrechnung_buchen','genehmigt','Probe','Probe','niedrig',
             repeat('b',64),$2,$2,now())
     returning id`, [mandantId, benutzer]);
  return fr!.id;
}

/** Brutto in Netto und Steuer zerlegen — ganze Cent, nie Gleitkomma (Invariante 1). */
function zerlege(bruttoCent: bigint): { netto: bigint; steuer: bigint } {
  const steuer = (bruttoCent * 19n + 59n) / 119n;
  return { netto: bruttoCent - steuer, steuer };
}

async function legeRechnungAn(
  mandantId: string,
  { bruttoCent, status = 'in_pruefung', leistungsdatum = '2026-08-31', pflichtig = true }: {
    bruttoCent: bigint;
    status?: 'in_pruefung' | 'freigegeben';
    leistungsdatum?: string;
    pflichtig?: boolean;
  },
): Promise<string> {
  const beleg = await legeBelegAn(mandantId);
  const { netto, steuer } = zerlege(bruttoCent);
  const freigabe = status === 'freigegeben' ? await legeFreigabeAn(mandantId) : null;
  return mitSitzung(mandantId, async (tx) => {
    const [r] = await tx.unsafe<{ id: string }[]>(
      `insert into eingangsrechnung
         (mandant_id, lieferant_id, beleg_id, rechnungsnummer_lieferant,
          rechnungsdatum, leistungsdatum, netto_cent, steuer_cent, brutto_cent,
          bauabzugsteuer_pflichtig, faellig_am, status, freigabe_id,
          freigegeben_von, freigegeben_am, erstellt_von_art, erstellt_von)
       values ($1,$2,$3,$4,'2026-09-05',$5::date,$6,$7,$8,$9,'2026-10-05',
               $10::eingangsrechnung_status, $11::uuid,
               case when $11 is null then null else $12::uuid end,
               case when $11 is null then null else now() end,
               'mensch',$12)
       returning id`,
      [mandantId, lieferantId, beleg, `R-${zufall()}`, leistungsdatum,
        netto.toString(), steuer.toString(), bruttoCent.toString(), pflichtig,
        status, freigabe, benutzer] as never[]);
    return r!.id;
  });
}

async function setzeStatus(
  mandantId: string, rechnungId: string, status: 'in_pruefung' | 'freigegeben' | 'gebucht',
): Promise<void> {
  const freigabe = status === 'freigegeben' ? await legeFreigabeAn(mandantId) : null;
  await mitSitzung(mandantId, async (tx) => {
    await tx.unsafe(
      `update eingangsrechnung
          set status = $2::eingangsrechnung_status,
              freigabe_id = coalesce($3::uuid, freigabe_id),
              gebucht_am = case when $2 = 'gebucht' then now() else gebucht_am end
        where id = $1`,
      [rechnungId, status, freigabe] as never[]);
  });
}

async function jahressumme(mandantId: string, jahr = 2026): Promise<bigint | null> {
  const [z] = await sql.unsafe<{ c: string }[]>(
    `select gegenleistung_cent::text as c from bauleistung_jahressumme
      where mandant_id = $1 and lieferant_id = $2 and jahr = $3`,
    [mandantId, lieferantId, jahr] as never[]);
  return z === undefined ? null : BigInt(z.c);
}

beforeEach(async () => {
  f = await seed();
  benutzer = await legeBenutzerAn(`buchhaltung-${zufall()}@cse.test`);
  const [l] = await sql.unsafe<{ id: string }[]>(
    `insert into lieferant (mandant_id, lieferantennummer, name, status,
                            erstellt_von_art, erstellt_von_dienst)
     values ($1,$2,'Gerüstbau Probe GmbH','aktiv','system','test') returning id`,
    [f.reinigung, `L-${zufall()}`]);
  lieferantId = l!.id;
});
afterAll(schliessen);

describe('die Jahressumme wird gerechnet, nicht fortgeschrieben', () => {
  it('eine offene Rechnung erzeugt KEINE Zeile — auch keine mit 0', async () => {
    await legeRechnungAn(f.reinigung, { bruttoCent: 119_000n });
    expect(await jahressumme(f.reinigung)).toBeNull();
  });

  it('die Freigabe setzt die Summe', async () => {
    const id = await legeRechnungAn(f.reinigung, { bruttoCent: 119_000n });
    await setzeStatus(f.reinigung, id, 'freigegeben');
    expect(await jahressumme(f.reinigung)).toBe(119_000n);
  });

  it('die RÜCKNAHME zieht sie wieder ab — der Fall, den die erste Fassung verschlief',
    async () => {
      const id = await legeRechnungAn(f.reinigung, { bruttoCent: 119_000n });
      await setzeStatus(f.reinigung, id, 'freigegeben');
      await setzeStatus(f.reinigung, id, 'in_pruefung');
      expect(await jahressumme(f.reinigung)).toBe(0n);
    });

  it('ERNEUTES Freigeben zählt nicht doppelt', async () => {
    const id = await legeRechnungAn(f.reinigung, { bruttoCent: 119_000n });
    await setzeStatus(f.reinigung, id, 'freigegeben');
    await setzeStatus(f.reinigung, id, 'in_pruefung');
    await setzeStatus(f.reinigung, id, 'freigegeben');
    expect(await jahressumme(f.reinigung)).toBe(119_000n);
  });

  it('eine direkt als freigegeben eingefügte Zeile wird gezählt — der fehlende INSERT-Zweig',
    async () => {
      await legeRechnungAn(f.reinigung, { bruttoCent: 250_000n, status: 'freigegeben' });
      expect(await jahressumme(f.reinigung)).toBe(250_000n);
    });

  it('zwei freigegebene Rechnungen ergeben ihre Summe, nicht mehr', async () => {
    await legeRechnungAn(f.reinigung, { bruttoCent: 119_000n, status: 'freigegeben' });
    await legeRechnungAn(f.reinigung, { bruttoCent: 200_000n, status: 'freigegeben' });
    expect(await jahressumme(f.reinigung)).toBe(319_000n);
  });

  it('das Buchen führt weiter und zählt nicht erneut', async () => {
    const id = await legeRechnungAn(f.reinigung, { bruttoCent: 119_000n, status: 'freigegeben' });
    await setzeStatus(f.reinigung, id, 'gebucht');
    expect(await jahressumme(f.reinigung)).toBe(119_000n);
  });

  it('eine Rechnung OHNE bauabzugsteuer_pflichtig zählt nicht — §48 Abs. 2 misst Bauleistungen',
    async () => {
      await legeRechnungAn(f.reinigung,
        { bruttoCent: 500_000n, status: 'freigegeben', pflichtig: false });
      expect(await jahressumme(f.reinigung)).toBeNull();
    });

  it('gezählt wird nach dem LEISTUNGSJAHR, nicht nach dem Rechnungsdatum', async () => {
    await legeRechnungAn(f.reinigung,
      { bruttoCent: 119_000n, status: 'freigegeben', leistungsdatum: '2025-12-30' });
    expect(await jahressumme(f.reinigung, 2025)).toBe(119_000n);
    expect(await jahressumme(f.reinigung, 2026)).toBeNull();
  });
});
