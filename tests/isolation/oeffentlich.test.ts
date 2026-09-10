/**
 * Der Website-Renderer ist ein LESER (03-AUTH §14.3).
 *
 * Diese Datei prueft die Aussage an der Datenbank und nicht am Typsystem:
 * `LeseKontext` hat kein `schreibe`, aber ein Angreifer schreibt kein
 * TypeScript. Was zaehlt, ist was diese Verbindung in Postgres darf.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { alsApp, DB_URL, sql } from './harness.js';
import { withOeffentlich } from '../../src/server/kontext/oeffentlich.js';
import { bereicheLesen } from '../../src/server/inhalt/lesen.js';
import type { LeseKontext } from '../../src/server/kontext/index.js';

/** Der Kontext so, wie ihn eine oeffentliche Seite bekommt. */
async function alsRenderer<T>(fn: (k: LeseKontext) => Promise<T>): Promise<T> {
  return sql.begin((tx) => withOeffentlich(tx, fn)) as Promise<T>;
}

const WURZEL = resolve(import.meta.dirname, '../..');

let rendererId: string;

/**
 * Frisch aufsetzen UND seeden — wie `seed.test.ts`, und aus demselben Grund.
 *
 * Der Seed allein genuegt nicht: fruehere Dateien dieser Suite setzen
 * `mandant.ist_rechtseinheit` auf NULL, um die TEN-02-Sperre zu pruefen, und
 * der Mandanten-Upsert des Seeds schreibt nur `name` zurueck. Ein zweiter Lauf
 * auf einer so veraenderten Datenbank scheitert dann an genau der Sperre, die
 * eine andere Datei absichtlich ausgeloest hat — ein Fehlschlag, der nach
 * einem Seed-Fehler aussieht und keiner ist.
 *
 * Ohne Seed wiederum bestuenden die Schreibpruefungen unten aus dem falschen
 * Grund: ein INSERT, der NULL Zeilen erzeugt, wirft nicht.
 */
beforeAll(async () => {
  const umgebung = { ...process.env, DATABASE_URL: DB_URL };
  execFileSync('bash', [join(WURZEL, 'scripts/test-db.sh'), 'up'],
    { cwd: WURZEL, encoding: 'utf8' });
  execFileSync(join(WURZEL, 'node_modules/.bin/tsx'),
    [join(WURZEL, 'src/server/db/seed/index.ts')],
    { cwd: WURZEL, encoding: 'utf8', env: umgebung });
  execFileSync(join(WURZEL, 'node_modules/.bin/tsx'),
    [join(WURZEL, 'scripts/content-import.ts')],
    { cwd: WURZEL, encoding: 'utf8', env: umgebung });

  const [z] = await sql<{ id: string }[]>`
    select wert #>> '{}' as id from plattform_einstellung
     where schluessel = 'website.renderer_benutzer'`;
  rendererId = z!.id;
}, 180_000);

describe('der Renderer sieht die vier Gesellschaften — sonst bliebe der NAP leer', () => {
  it('mandant ist lesbar, und zwar alle vier', async () => {
    const zeilen = await alsRenderer(async (k) =>
      k.abfrage<{ slug: string }>(`select slug from mandant order by slug`));
    expect(zeilen.map((z) => z.slug).sort())
      .toEqual(['bau', 'operations', 'reinigung', 'security']);
  });

  it('OHNE den Prinzipal sähe er null Gesellschaften', async () => {
    // Das ist der Fehler, den diese Datei festhält: eine Verbindung ohne
    // Sitzung liest `seite` anstandslos und `mandant` gar nicht. Die Seite
    // hätte gerendert — ohne Firma, Anschrift und Telefon.
    const zeilen = await alsApp({ scope: 'gruppe', mandantIds: [] }, (tx) =>
      tx.unsafe(`select slug from mandant`));
    expect(zeilen).toEqual([]);
  });

  it('veröffentlichte Seiten sind lesbar, Entwürfe nicht', async () => {
    /**
     * Seit D-82 gibt es die Startseite ZWEIMAL — deutsch und englisch, mit
     * demselben Pfad und verschiedener `sprache`. Die Zusage dieser Prüfung
     * ist aber nicht "genau eine Zeile", sondern "der Renderer sieht die
     * veröffentlichten und keine Entwürfe". Also je Sprache eine.
     */
    const sichtbar = await alsRenderer(async (k) =>
      k.abfrage<{ sprache: string }>(`select sprache from seite where pfad = '/'`));
    expect(sichtbar.map((z) => z.sprache).sort()).toEqual(['de', 'en']);

    const entwuerfe = await alsRenderer(async (k) =>
      k.abfrage<{ n: string }>(
        `select count(*) n from seite where status <> 'veroeffentlicht'`));
    expect(entwuerfe[0]!.n).toBe('0');
  });
});

describe('und er kann nichts schreiben — auf keinem Weg', () => {
  it('kein INSERT in seite', async () => {
    await expect(alsRenderer(async (k) =>
      k.abfrage(`insert into seite (pfad, titel) values ('/x', 'X')`),
    )).rejects.toThrow();
  });

  it('kein UPDATE auf mandant', async () => {
    await expect(alsRenderer(async (k) =>
      k.abfrage(`update mandant set telefon = '000'`),
    )).rejects.toThrow();
  });

  it('kein INSERT in referenz — auch nicht mit gesetzter Kundenfreigabe', async () => {
    await expect(alsRenderer(async (k) =>
      k.abfrage(
        `insert into referenz (mandant_id, titel, freigegeben_vom_kunden, freigabe_am)
         select id, 'X', true, now() from mandant limit 1`),
    )).rejects.toThrow();
  });

  it('er hält kein einziges Schreibrecht', async () => {
    const [z] = await sql<{ n: string }[]>`
      select count(*) n
        from benutzer_mandant bm
        join rolle_berechtigung rb on rb.rolle_id = bm.rolle_id and rb.gewaehrt
        join berechtigung b on b.id = rb.berechtigung_id
       where bm.benutzer_id = ${rendererId}
         and b.aktion not in ('lesen', 'exportieren')`;
    expect(z!.n).toBe('0');
  });

  it('und keine globale Rolle, die die Mitgliedschaft überginge (TEN-08)', async () => {
    const [z] = await sql<{ globale_rolle_id: string | null }[]>`
      select globale_rolle_id from benutzer where id = ${rendererId}`;
    expect(z!.globale_rolle_id).toBeNull();
  });
});

describe('der Kontext selbst trägt die Zusagen', () => {
  it('readonly ist an, der Scope ist gruppe, es gibt keinen aktiven Mandanten', async () => {
    const werte = await alsRenderer(async (k) => ({
      aktiv: k.aktiverMandantId,
      scope: k.scope,
      db: (await k.abfrage<{ readonly: string; scope: string; portal: string }>(
        `select current_setting('app.readonly', true) as readonly,
                app.scope() as scope, app.portal() as portal`))[0]!,
    }));
    // Ohne aktiven Mandanten gibt es keinen Schreibpfad — Invariante 10 hängt
    // genau daran, und der Renderer ist der Fall, für den sie gemacht ist.
    expect(werte.aktiv).toBeNull();
    expect(werte.scope).toBe('gruppe');
    expect(werte.db.readonly).toBe('on');
    expect(werte.db.portal).toBe('intern');
  });

  it('eine Referenz ohne Kundenfreigabe bleibt unsichtbar', async () => {
    const [m] = await sql<{ id: string }[]>`select id from mandant where slug = 'reinigung'`;
    await sql`
      insert into referenz (mandant_id, titel, status, freigegeben_vom_kunden)
      values (${m!.id}, 'Ohne Freigabe', 'veroeffentlicht', false)
      on conflict do nothing`;

    const sichtbar = await alsRenderer(async (k) =>
      k.abfrage<{ titel: string }>(`select titel from referenz`));
    expect(sichtbar.map((r: { titel: string }) => r.titel)).not.toContain('Ohne Freigabe');
  });
});

describe('D-82 — der Kurztext der Markenkarte steht in der Sprache der Seite', () => {
  /**
   * Der Befund: die Karten unter `/en` und der Bereichswaehler unter
   * `/en/angebot` zeigten die DEUTSCHE `kurzbeschreibung` — eine englische
   * Seite mit vier deutschen Saetzen mittendrin.
   */
  it('englisch liefert die englische Zeile', async () => {
    const bereiche = await alsRenderer((k) => bereicheLesen(k, 'en'));
    const reinigung = bereiche.find((b) => b.slug === 'reinigung');
    expect(reinigung?.kurzbeschreibung).toBe('Building cleaning');
  });

  it('deutsch liefert die deutsche — und die beiden sind nicht dieselbe', async () => {
    const de = await alsRenderer((k) => bereicheLesen(k, 'de'));
    const en = await alsRenderer((k) => bereicheLesen(k, 'en'));
    expect(de.find((b) => b.slug === 'reinigung')?.kurzbeschreibung)
      .toBe('Gebäudereinigung');
    // Ohne diese Zeile bestuende der Test auch dann, wenn beide Sprachen
    // dieselbe Zeile lesen — also genau im Fehlerfall.
    expect(de.map((b) => b.kurzbeschreibung))
      .not.toEqual(en.map((b) => b.kurzbeschreibung));
  });

  it('fehlt die Uebersetzung, kommt der deutsche Satz — keine leere Karte', async () => {
    /**
     * Der Rueckfall ist eine Entscheidung: ein deutscher Satz auf einer
     * englischen Seite ist die schlechtere von zwei Auskuenften, eine LEERE
     * Karte die schlechteste — sie liest sich wie "ueber diese Gesellschaft
     * gibt es nichts zu sagen".
     */
    await sql`
      update unternehmensprofil set geloescht_am = now()
       where sprache = 'en'
         and mandant_id = (select id from mandant where slug = 'bau')`;
    try {
      const bereiche = await alsRenderer((k) => bereicheLesen(k, 'en'));
      expect(bereiche.find((b) => b.slug === 'bau')?.kurzbeschreibung)
        .toBe('Hochbau, Ausbau, Rückbau');
    } finally {
      await sql`
        update unternehmensprofil set geloescht_am = null
         where sprache = 'en'
           and mandant_id = (select id from mandant where slug = 'bau')`;
    }
  });
});

