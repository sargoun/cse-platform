/**
 * **Das Verarbeitungsverzeichnis beschreibt EINE Gesellschaft** (Art. 30
 * DSGVO, LEG-09, Phase 10).
 *
 * Es wird beim Abruf erzeugt, nicht gepflegt — und damit hängt alles daran,
 * dass es die richtige Gesellschaft beschreibt: ihre Firma, ihre gebuchten
 * Module, ihre Aufbewahrungsregeln. Ein Verzeichnis, das die Bautätigkeiten
 * einer Reinigungsfirma aufführt, ist vor einer Aufsicht schlimmer als eines,
 * das fehlt: es zeigt, dass niemand hingesehen hat.
 *
 * Die Fälle laufen deshalb gegen die Datenbank und nicht gegen einen
 * Doppelgänger: RLS, `app.aktiver_mandant()` und die Modulbuchung entscheiden
 * hier, nicht eine Nachbildung davon.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { alsApp, schliessen, seed, sql, type Fixtur } from './harness.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';
import {
  alsMarkdown, erstelleVerarbeitungsverzeichnis,
} from '../../src/server/services/datenschutz/verzeichnis.js';
import { VERARBEITUNGEN } from '../../src/server/registry/verarbeitungen.js';

let f: Fixtur;
let benutzer: string;

const zufall = (): string => Math.random().toString(36).slice(2, 10);

async function legeAdministrationAn(mandantId: string): Promise<string> {
  const email = `vv-${zufall()}@cse.test`;
  const [u] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (email) values ($1) returning id`, [email]);
  await sql.unsafe(`insert into auth.mfa_factors (user_id) values ($1)`, [u!.id]);
  await sql.unsafe(
    `insert into benutzer (id, email, name, status)
     values ($1, $2, 'Verwaltung', 'aktiv')`, [u!.id, email]);
  await sql.unsafe(
    `insert into benutzer_mandant (benutzer_id, mandant_id, rolle_id)
     values ($1, $2, (select id from rolle where schluessel = 'admin' and mandant_id is null))`,
    [u!.id, mandantId]);
  return u!.id;
}

function sitzung(mandantId?: string) {
  return {
    scope: 'mandant' as const, mandantId: mandantId ?? f.reinigung,
    benutzerId: benutzer, portal: 'intern' as const, readonly: false,
  };
}

function kontextAus(tx: postgres.TransactionSql, mandantId?: string): SchreibKontext {
  const m = mandantId ?? f.reinigung;
  const abfrage = async <T,>(a: string, w?: readonly unknown[]): Promise<readonly T[]> =>
    (await tx.unsafe(a, (w ?? []) as never[])) as unknown as readonly T[];
  return {
    scope: 'mandant', portal: 'intern', benutzerId: benutzer,
    aktiverMandantId: m, mandantIds: [m], abfrage, schreibe: abfrage,
  };
}

/** Eine feste Uhr: der Abruf steht NEBEN dem Hash, nicht darin. */
const JETZT = new Date('2026-07-14T09:30:00Z');

beforeEach(async () => {
  f = await seed();
  benutzer = await legeAdministrationAn(f.reinigung);
});

afterAll(schliessen);

describe('das Verzeichnis beschreibt die Gesellschaft, in der es abgerufen wird', () => {
  it('Firma und Anschrift kommen aus `mandant`, nicht aus einer Liste', async () => {
    await sql.unsafe(
      `update mandant set strasse = 'Kurfürstendamm 21', plz = '10719', ort = 'Berlin',
                          geschaeftsfuehrer = array['Eine Geschäftsführerin']
        where id = $1`, [f.reinigung]);
    const [m] = await sql.unsafe<{ firma: string }[]>(
      `select firma from mandant where id = $1`, [f.reinigung]);

    const v = await alsApp(sitzung(), (tx) =>
      erstelleVerarbeitungsverzeichnis(kontextAus(tx), JETZT));

    expect(v.verantwortlicher.firma).toBe(m!.firma);
    expect(v.verantwortlicher.anschrift).toContain('Berlin');
    expect(v.verantwortlicher.geschaeftsfuehrer).toContain('Eine Geschäftsführerin');
  });

  /**
   * **Was nicht gebucht ist, steht nicht drin.** Die Gewerke entscheiden, und
   * `modulAktiv` beantwortet die Frage hier genauso wie in der Navigation.
   */
  it('eine Gesellschaft ohne Gewerk führt keine Gewerkstätigkeit auf', async () => {
    const v = await alsApp(sitzung(), (tx) =>
      erstelleVerarbeitungsverzeichnis(kontextAus(tx), JETZT));
    /*
     * Alle zwölf Tätigkeiten hängen heute an Querschnittsmodulen — das ist
     * der Sollzustand und zugleich die Gegenprobe: käme eine gewerkgebundene
     * dazu, ohne dass dieser Fall sie sieht, wäre die Filterung tot.
     */
    expect(v.taetigkeiten.length).toBe(VERARBEITUNGEN.length);
    expect(v.taetigkeiten.map((t) => t.nummer)).toContain('V-01');
  });

  it('die Frist einer Dokumentklasse kommt aus der Regel der Gesellschaft', async () => {
    const v = await alsApp(sitzung(), (tx) =>
      erstelleVerarbeitungsverzeichnis(kontextAus(tx), JETZT));
    const fristen = v.abschnitte.find((a) => a.nummer === '6');
    expect(fristen?.tabelle).not.toBeNull();
    const rechnungszeile = (fristen?.tabelle?.zeilen ?? []).find((z) => z[0] === 'V-07');
    /* § 147 AO: zehn Jahre — als Zahl aus der Regel, nicht als Text von hier. */
    expect(rechnungszeile?.[2]).toMatch(/10 Jahre/u);
  });

  it('die Bewerberfrist kommt aus der Plattformeinstellung', async () => {
    const v = await alsApp(sitzung(), (tx) =>
      erstelleVerarbeitungsverzeichnis(kontextAus(tx), JETZT));
    const fristen = v.abschnitte.find((a) => a.nummer === '6');
    const bewerbung = (fristen?.tabelle?.zeilen ?? []).find((z) => z[0] === 'V-05');
    expect(bewerbung?.[2]).toMatch(/Tage ab Eingang|nicht gesetzt/u);
  });

  /**
   * **Derselbe Stand, derselbe Abdruck.** Der Hash läuft über den Inhalt ohne
   * Uhr — sonst wäre er bei jedem Abruf ein anderer und bewiese nichts.
   */
  it('zwei Abrufe desselben Standes tragen denselben SHA-256', async () => {
    const a = await alsApp(sitzung(), (tx) =>
      erstelleVerarbeitungsverzeichnis(kontextAus(tx), JETZT));
    const b = await alsApp(sitzung(), (tx) =>
      erstelleVerarbeitungsverzeichnis(kontextAus(tx), new Date('2026-12-24T18:00:00Z')));
    expect(b.sha256).toBe(a.sha256);
    expect(b.abgerufenAm).not.toBe(a.abgerufenAm);
  });

  it('eine andere Gesellschaft bekommt ein anderes Verzeichnis', async () => {
    const reinigung = await alsApp(sitzung(f.reinigung), (tx) =>
      erstelleVerarbeitungsverzeichnis(kontextAus(tx, f.reinigung), JETZT));
    const bauBenutzer = await legeAdministrationAn(f.bau);
    benutzer = bauBenutzer;
    const bau = await alsApp(sitzung(f.bau), (tx) =>
      erstelleVerarbeitungsverzeichnis(kontextAus(tx, f.bau), JETZT));

    expect(bau.verantwortlicher.firma).not.toBe(reinigung.verantwortlicher.firma);
    expect(bau.mandantId).toBe(f.bau);
  });

  /**
   * **Das Verzeichnis sagt, was es nicht sagt.** Ohne diesen Abschnitt sähe
   * es vollständig aus — und genau das wäre die Täuschung, gegen die O-514
   * geschrieben ist.
   */
  it('Abschnitt 8 nennt die Rechtsgrundlage als offen, statt eine zu behaupten', async () => {
    const v = await alsApp(sitzung(), (tx) =>
      erstelleVerarbeitungsverzeichnis(kontextAus(tx), JETZT));
    const grenze = v.abschnitte.find((a) => a.nummer === '8');
    expect(grenze?.quelle).toBe('offen');
    expect(grenze?.absaetze.join(' ')).toMatch(/Art\. 6/u);
    expect(v.offen.join(' ')).toMatch(/O-514/u);
  });

  it('als Markdown trägt es Kopf, Abschnitte und die offenen Punkte', async () => {
    const v = await alsApp(sitzung(), (tx) =>
      erstelleVerarbeitungsverzeichnis(kontextAus(tx), JETZT));
    const md = alsMarkdown(v);
    expect(md).toContain('# Verzeichnis von Verarbeitungstätigkeiten');
    expect(md).toContain(v.sha256);
    expect(md).toContain('## 4. Empfänger und Auftragsverarbeiter');
    expect(md).toContain('## Offen');
  });
});
