/**
 * Der Seed macht die Plattform benutzbar — und sagt, was noch fehlt.
 *
 * Der Test laeuft den Seed und prueft danach das, worauf es ankommt: dass eine
 * Nummer gezogen werden KANN, und dass die Rechnungsnummer es ausdruecklich
 * nicht kann, solange O-134 offen ist.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { eigeneDatenbank } from './eigene-datenbank.js';
import { vergebeNummer, type NummernkreisFehler } from '../../src/server/services/finanz/nummernkreis.js';

const WURZEL = resolve(import.meta.dirname, '../..');

/**
 * **Diese Datei bekommt eine EIGENE Datenbank — `cse_seed`.**
 *
 * Sie behauptet etwas ueber den Seed: „frischer Stand plus Seed ergibt eine
 * benutzbare Plattform, und der Rechnungskreis ist ein Platzhalter, solange
 * O-134 offen ist." Auf der gemeinsamen `cse_test` kann sie das nicht mehr
 * belegen, und zwar aus zwei Gruenden, die beide richtig sind:
 *
 *  - `scripts/test-db.sh up` ist bewusst NICHT mehr zerstoerend. Fuenf
 *    Dateien rufen es mitten im Lauf auf; jeder Neuaufbau riss der Suite die
 *    Datenbank unter den Fuessen weg. `up` heisst seither „sorge dafuer, dass
 *    sie steht".
 *  - Mehrere Dateien legen fuer ihre Fixtur einen ECHTEN
 *    `ausgangsrechnung`-Kreis an und ziehen Nummern daraus. Was davon beim
 *    Start dieser Datei noch steht, entscheidet allein die Reihenfolge — und
 *    Vitest ordnet nach Dateigroesse, also verschiebt schon eine neue
 *    Testdatei das Ergebnis. Genau so ist es passiert: „der Kreis ist ein
 *    Platzhalter" war rot, weil eine Schwesterdatei einen bestaetigten Kreis
 *    hinterlassen hatte, nicht weil der Seed etwas falsch macht.
 *
 * Selbst leerraeumen geht nicht — ausprobiert und verworfen: ein
 * `truncate mandant cascade` nimmt ueber die Fremdschluessel auch die
 * Systemrollen mit, die eine MIGRATION setzt, und der echte Seed scheitert
 * danach beim Nachschlagen genau dieser Rollen.
 *
 * Eine eigene Datenbank loest beides: diese Datei stoert niemanden und wird
 * von niemandem gestoert. `test-db.sh` nimmt den Namen aus der DSN, also
 * kostet das eine Umgebungsvariable und keine Zeile Skript.
 *
 * **Und sie wird NEU gebaut, nicht bloss sichergestellt.** `neu` ist der
 * zerstoerende Pfad, den auf `cse_test` niemand nehmen darf — hier gehoert
 * die Datenbank aber dieser einen Datei, und sie MUSS neu sein: eine der
 * Pruefungen unten bestaetigt die Nummernmaske (`ist_platzhalter = false`),
 * und danach ist „der Kreis ist ein Platzhalter (O-134)" beim naechsten Lauf
 * falsch. Mit `up` war diese Datei also beim ZWEITEN Lauf rot — ein Test, der
 * seine eigene Vorbedingung zerstoert, und der Fehlschlag traegt den Namen
 * einer offenen Frage statt den seiner Ursache.
 */
const { alsApp, sql, baueAuf, url: EIGEN_URL } = eigeneDatenbank('cse_seed');

beforeAll(() => { baueAuf(); }, 180_000);

/*
 * KEIN `schliessen()`: der gemeinsame Pool der Harness gehoert dieser Datei
 * nicht, und ein hier geschlossener Pool toetet jede spaetere Datei mit
 * `CONNECTION_ENDED` — derselbe Fehler, der in `mitarbeiter.spec.ts` schon
 * einmal eine Zusicherung unmessbar gemacht hat. Der EIGENE Pool endet mit
 * dem Worker-Prozess.
 */

async function mandant(slug: string): Promise<string> {
  const [m] = await sql<{ id: string }[]>`select id from mandant where slug = ${slug}`;
  return m!.id;
}

describe('nach dem Seed ist die Plattform benutzbar', () => {
  it('vier Bereiche, und `operations` traegt O-01 als NULL', async () => {
    const zeilen = await sql<{ slug: string; ist_rechtseinheit: boolean | null }[]>`
      select slug, ist_rechtseinheit from mandant order by sortierung`;
    const VIER = ['reinigung', 'security', 'bau', 'operations'];
    // Gefiltert, nicht verglichen: siehe den Absatz ueber `beforeAll`. Die
    // REIHENFOLGE bleibt die Zusicherung — sie kommt aus `sortierung`, und
    // eine fremde Zeile dazwischen wuerde sie nicht retten.
    expect(zeilen.map((z) => z.slug).filter((slug) => VIER.includes(slug)))
      .toEqual(VIER);
    // NULL ist der einzige neutrale Wert: `true` oder `false` waere eine
    // stille Entscheidung ueber eine offene Frage.
    expect(zeilen[3]!.ist_rechtseinheit).toBeNull();
  });

  it('ein Super-Admin existiert, mit hinterlegtem zweitem Faktor', async () => {
    const [b] = await sql<{ status: string; hat: boolean }[]>`
      select b.status, app.hat_zweiten_faktor(b.id) hat
        from benutzer b where b.email = 'admin@cse-gruppe.de'`;
    expect(b!.status).toBe('aktiv');
    // Ohne Faktor liesse `benutzer_2fa_pflicht` das Konto gar nicht aktiv
    // werden — und `ist_super_admin()` verlangt zusaetzlich eine aal2-Sitzung.
    expect(b!.hat).toBe(true);
  });

  it('der D-09-Fall steht drin: ein Mensch, zwei Gesellschaften, zwei Sätze', async () => {
    const zeilen = await sql<{ mandant_id: string; stundensatz_intern: string }[]>`
      select a.mandant_id, a.stundensatz_intern
        from anstellung a join person p on p.id = a.person_id
       where p.vorname = 'Fatima' order by a.personalnummer`;
    expect(zeilen).toHaveLength(2);
    expect(new Set(zeilen.map((z) => z.mandant_id)).size).toBe(2);
    expect(zeilen.map((z) => Number(z.stundensatz_intern))).toEqual([1450, 1780]);
  });

  it('ein Leistungsnachweis lässt sich SOFORT nummerieren', async () => {
    const m = await mandant('reinigung');
    /**
     * **Der erwartete Wert kommt aus dem Zähler, nicht aus einer Konstante.**
     *
     * Hier stand `LN-2026-00001` — und das war richtig, solange der Seed
     * keinen einzigen Leistungsnachweis anlegte. Seit er zwei anlegt (einen
     * vorgelegten und einen unterschriebenen, CLN-04), hat er die ersten
     * beiden Nummern gezogen, und die Prüfung fiel auf `00003`. Sie hätte
     * damit den Seed dafür bestraft, dass er die Plattform vorführt.
     *
     * Die Zusicherung dieses Falls ist nicht die Zahl, sondern dass NACH dem
     * Seed sofort eine Nummer entsteht — im Gegensatz zur Rechnung eine
     * Prüfung weiter unten, die es wegen O-134 nicht kann. Der Zähler wird
     * deshalb vorher gelesen: die gezogene Nummer muss GENAU die nächste
     * sein. Das prüft zusätzlich die Lückenlosigkeit (§14 Abs. 4 Nr. 4 UStG
     * gilt der Rechnung, der Anspruch hier ist derselbe) und bleibt richtig,
     * wie viele Nachweise der Seed künftig auch anlegt.
     */
    const [kreis] = await sql<{ naechste: string; maske: string }[]>`
      select naechste_nummer::text as naechste, format_maske as maske
        from nummernkreis
       where mandant_id = ${m} and kreis_typ = 'leistungsnachweis'
         and kontext_id is null and geschlossen_am is null`;
    expect(kreis, 'der Seed legt den Leistungsnachweis-Kreis an').toBeDefined();
    const erwartet = `LN-2026-${Number(kreis!.naechste).toString().padStart(5, '0')}`;

    const gezogen = await alsApp(
      { scope: 'mandant', mandantId: m, portal: 'intern', readonly: false },
      (tx) => vergebeNummer(tx, { kreisTyp: 'leistungsnachweis' }),
    );
    expect(gezogen.formatiert).toBe(erwartet);
  });

  /**
   * **Eine RECHNUNGSNUMMER ist nie stillschweigend erfunden** (O-134).
   *
   * Die Frage, wie die Maske lautet und ob die Folge am 1. Januar neu
   * beginnt, hat niemand beantwortet — und eine vergebene Rechnungsnummer
   * nimmt man nicht zurueck. Der Seed hat dafuer zwei Antworten, und der Test
   * verlangt genau eine davon:
   *
   *  · **Produktion:** der Kreis ist ein Platzhalter und vergibt gar nichts.
   *  · **Vorfuehrung:** der Kreis vergibt, aber jede Nummer beginnt mit
   *    `DEMO-`. Die Ueberbrueckung steht damit in jedem einzelnen Datensatz
   *    und nicht in einem Kommentar (D-514).
   *
   * Was es NICHT geben darf, ist die dritte Fassung: ein bestaetigter Kreis
   * mit einer geratenen Maske, der Nummern vergibt, die aussehen wie echte.
   * Faellt dieser Test, ist genau die entstanden.
   */
  it('eine RECHNUNGSNUMMER ist entweder gesperrt oder sichtbar DEMO (O-134)', async () => {
    const [k] = await sql<{ ist_platzhalter: boolean; maske: string }[]>`
      select ist_platzhalter, format_maske as maske from nummernkreis
       where kreis_typ = 'ausgangsrechnung' and mandant_id = ${await mandant('reinigung')}`;
    expect(k, 'der Seed legt den Rechnungskreis an').toBeDefined();

    if (k!.ist_platzhalter) {
      expect(k!.maske, 'ein Platzhalter vergibt ohnehin nichts').toContain('{nr:');
      return;
    }
    expect(k!.maske,
      'ein bestaetigter Kreis ohne Antwort auf O-134 muss sich als DEMO ausweisen')
      .toMatch(/^DEMO-/u);

    // Und die Rechnungen, die es gibt, tragen es wirklich.
    const nummern = await sql<{ nummer: string }[]>`
      select nummer from rechnung
       where mandant_id = ${await mandant('reinigung')} and nummer is not null`;
    for (const n of nummern) expect(n.nummer).toMatch(/^DEMO-/u);
  });

  it('und sobald jemand die Maske bestätigt, geht es — der Seed-Pfad steht offen', async () => {
    const m = await mandant('reinigung');
    // Als Eigentuemer, ohne angemeldeten Benutzer: der Weg, den 0013
    // ausdruecklich kennt. Ein Editor waere es nur mit Benutzer.
    await sql`
      update nummernkreis set ist_platzhalter = false, zuruecksetzung = 'jaehrlich'
       where mandant_id = ${m} and kreis_typ = 'ausgangsrechnung'`;

    const [k] = await sql<{ ist_platzhalter: boolean }[]>`
      select ist_platzhalter from nummernkreis
       where mandant_id = ${m} and kreis_typ = 'ausgangsrechnung'`;
    expect(k!.ist_platzhalter).toBe(false);

    // Gezogen wird sie trotzdem nicht von der Anwendung — der Rechnungskreis
    // laeuft ueber fin.rechnung_nummer_ziehen (PR 46).
    const fehler = await alsApp(
      { scope: 'mandant', mandantId: m, portal: 'intern', readonly: false },
      (tx) => vergebeNummer(tx, { kreisTyp: 'ausgangsrechnung' }).catch((e: unknown) => e),
    );
    expect((fehler as NummernkreisFehler).grund).toBe('definer_kreis');
  });

  it('jede Agent-Richtlinie steht auf `auto_erlaubt = false`', async () => {
    const zeilen = await sql<{ auto_erlaubt: boolean }[]>`
      select auto_erlaubt from agent_richtlinie`;
    expect(zeilen.length).toBeGreaterThan(0);
    // Invariante 7 als Vorgabe, nicht als Ausnahme.
    expect(zeilen.every((z) => !z.auto_erlaubt)).toBe(true);
  });
});

describe('der Seed laeuft ZWEIMAL — sonst ist er keiner', () => {
  /**
   * Der Befund, den dieser Fall festhaelt: `db:seed` gelang genau einmal und
   * starb beim zweiten Lauf mit
   *
   *     Konto benoetigt einen zweiten Faktor, bevor es aktiv wird (AUT-02)
   *
   * Beim ersten Lauf entsteht die `benutzer`-Zeile, BEVOR ihr die Rolle
   * zugewiesen wird — der Ausloeser sieht keine 2FA-Rolle. Beim zweiten ist
   * die Rolle da, `on conflict do update set status = 'aktiv'` feuert ihn, und
   * er weist ab. Ein Seed, der genau einmal laeuft, ist kein Seed: danach
   * traut sich niemand mehr, ihn anzufassen.
   */
  it('ein zweiter Lauf auf derselben Datenbank gelingt', () => {
    const ergebnis = execFileSync(join(WURZEL, 'node_modules/.bin/tsx'),
      ['--import', join(WURZEL, 'scripts/hooks/server-only.mjs'),
        join(WURZEL, 'src/server/db/seed/index.ts')],
      { cwd: WURZEL, encoding: 'utf8', env: { ...process.env, DATABASE_URL: EIGEN_URL } });
    expect(ergebnis).toContain('Seed fertig.');
  }, 240_000);

  it('und die Konten mit 2FA-Rolle tragen wirklich einen Faktor', async () => {
    // Die Gegenrichtung: der Lauf oben gelaenge auch, wenn jemand den
    // Ausloeser entschaerft haette. Geprueft wird die ERFUELLUNG von AUT-02,
    // nicht ihr Ausbleiben.
    const ohne = await sql<{ email: string }[]>`
      select b.email from benutzer b
       where b.status = 'aktiv'
         and exists (select 1 from rolle r
                      where (r.id = b.globale_rolle_id
                             or r.id in (select bm.rolle_id from benutzer_mandant bm
                                          where bm.benutzer_id = b.id and bm.entzogen_am is null))
                        and r.erfordert_2fa)
         and not exists (select 1 from auth.mfa_factors f where f.user_id = b.id)`;
    expect(ohne.map((o) => o.email)).toEqual([]);
  });

  it('und GENAU EINEN — der Seed ist wiederholbar, der Faktor vermehrt sich nicht', async () => {
    /**
     * `auth.mfa_factors` traegt nur einen Primaerschluessel auf der erzeugten
     * `id`; `on conflict do nothing` griff dort NIE. Jeder Seed-Lauf legte
     * also einen weiteren Faktor an. Das faellt nicht auf — bis jemand die
     * Faktoren eines Kontos auflistet und drei findet, von denen keiner
     * jemals verwendet wurde.
     *
     * Diese Suite laeuft nach mindestens zwei Seed-Laeufen; der Fehler waere
     * hier also sichtbar.
     */
    const mehrfach = await sql<{ email: string; n: number }[]>`
      select b.email, count(*)::int as n
        from auth.mfa_factors f
        join benutzer b on b.id = f.user_id
       group by b.email having count(*) > 1`;
    expect(mehrfach).toEqual([]);
  });
});

