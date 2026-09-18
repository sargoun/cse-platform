/**
 * TIM-11 — der Weg zur Korrektur, nicht die Korrektur selbst.
 *
 * **Der Befund, den dieser Test festhält.** `korrigiereZeiteintrag` war gebaut
 * und geprüft (`tests/isolation/zeit-korrektur.test.ts`) und hatte **keinen
 * einzigen Aufrufer**: keine Route, keine Seite. Damit endete der Einwandsweg
 * im Nichts — eine Mitarbeiterin meldet eine Abweichung (EMP-07), die Planung
 * erkennt sie an, und der Zeiteintrag blieb, wie er war.
 *
 * Das ist die teuerste Sorte Lücke, weil sie nirgends rot wird: jeder Test
 * über den Dienst war grün, denn der Dienst funktioniert. Was fehlte, war die
 * Frage, ob ihn jemand aufruft. Sie wird hier gestellt — am Quelltext, ohne
 * Datenbank, damit sie in jedem Lauf mitgeht.
 *
 * Die fachliche Seite (Kette, Spur, `zk_nicht_selbst`, gesperrter Monat) prüft
 * die Isolationssuite gegen echtes Postgres. Hier steht nur die Verdrahtung.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ROUTEN } from '../../src/server/auth/route-manifest.js';
import { ROUTEN as SEITEN } from '../../src/server/registry/routen.generiert.js';
import { ohneKommentareMitTexten } from './hilfen/quelltext.js';

const ROUTE = 'src/app/api/zeit/korrektur/route.ts';
const SEITE = 'src/app/portal/[mandant]/zeiten/[id]/korrektur/page.tsx';
const BLATT = 'src/app/portal/[mandant]/zeiten/[id]/page.tsx';
const DIENST = 'src/server/services/zeit/korrektur.ts';

/**
 * Der Quelltext OHNE Kommentare, aber MIT den Texten darin.
 *
 * Beides ist nötig: ohne Kommentare, weil jede dieser Dateien in ihrem
 * Kopftext erklärt, wohin sie postet und welches Recht sie trägt — eine
 * Prüfung darauf wäre grün, sobald jemand den Satz schreibt, und rot, sobald
 * er ihn streicht. Mit Texten, weil das Gesuchte selbst eine Zeichenkette ist
 * (`action="/api/zeit/korrektur"`).
 */
function quelle(pfad: string): string {
  return ohneKommentareMitTexten(readFileSync(pfad, 'utf8'));
}

describe('der Dienst hat einen Aufrufer', () => {
  it('`korrigiereZeiteintrag` wird von der Route aufgerufen', () => {
    /*
     * Der Test, der gefehlt hat. Ein Dienst ohne Aufrufer ist kein halb
     * gebautes Feature — er ist ein Versprechen, das die Oberfläche an keiner
     * Stelle einlöst, und er sieht in jeder Abdeckungszahl gut aus.
     */
    const r = quelle(ROUTE);
    expect(r).toContain('korrigiereZeiteintrag');
    expect(r).toContain("from '@/server/services/zeit/korrektur'");
  });

  it('die Route trägt `zeit.korrigieren` und ruft `authorize`', () => {
    const r = quelle(ROUTE);
    expect(r).toContain("recht: 'zeit.korrigieren'");
    expect(r).toContain('authorize(');
  });

  it('das Manifest führt sie mit demselben Recht — melden, entscheiden, korrigieren', () => {
    const k = ROUTEN.find((z) => z.pfad === 'api/zeit/korrektur');
    expect(k?.recht).toBe('zeit.korrigieren');
    // Drei Vorgaenge, drei Rechte: wer Zeiten erfasst, aendert damit noch
    // keine bestehende Aufzeichnung.
    expect(ROUTEN.find((z) => z.pfad === 'api/zeit/einwand')?.recht).toBeNull();
    expect(ROUTEN.find((z) => z.pfad === 'api/zeit/einwand/entscheidung')?.recht)
      .toBe('zeit.einwand_entscheiden');
  });

  it('und sie heisst NICHT `api/zeiten…` — die EMP-07-Wache bleibt stumpf', () => {
    /*
     * `tests/kern/mitarbeiter.test.ts` weist jede Adresse ab, die einen
     * Zeiteintrag im Pfad nennt. Diese Route ändert einen — aber nur über die
     * Kette, mit Spur und mit einem Recht, das keine Mitarbeiterrolle hält.
     * Eine Ausnahme in der Wache wäre der Anfang ihres Endes; ein Name, der
     * nicht in ihr Muster fällt, ist es nicht.
     */
    const verdaechtig = ROUTEN
      .map((z) => z.pfad)
      .filter((p) => /^api\/(?:mein\/)?zeit(?:eintrag|\/eintrag|en)/u.test(p));
    expect(verdaechtig).toEqual([]);
  });
});

describe('die Seite gibt es, und sie steht im Register', () => {
  it('`/portal/[mandant]/zeiten/[id]/korrektur` hat eine `page.tsx`', () => {
    expect(() => readFileSync(SEITE, 'utf8')).not.toThrow();
  });

  it('das Register bewacht sie mit `zeit.korrigieren`', () => {
    const r = SEITEN.find(
      (z) => z.pfad === '/portal/[mandant]/zeiten/[id]/korrektur');
    expect(r).toBeDefined();
    expect(r?.bewachung).toMatchObject({ art: 'recht', lesen: ['zeit.korrigieren'] });
  });

  it('sie postet auf die Route und schickt Eintrag und Bereich mit', () => {
    const s = quelle(SEITE);
    expect(s).toContain('action="/api/zeit/korrektur"');
    expect(s).toContain('name="eintrag"');
    expect(s).toContain('name="mandant"');
    // Ohne `zurueck` landete ein abgewiesenes Formular als JSON auf einer
    // weissen Seite — mit dem Entwurf des Menschen darin verloren.
    expect(s).toContain('name="zurueck"');
  });

  it('die Begründung ist Pflicht und hat KEINE Mindestlänge (§5.7)', () => {
    const s = quelle(SEITE);
    expect(s).toMatch(/name="begruendung"/u);
    expect(s).toContain('required');
    /*
     * „Krank" ist eine Begründung. Eine erzwungene Zeichenzahl erzeugt
     * „xxxxxxxxxx" — also einen Pflichttext ohne Auskunft, und der ist im
     * Streit weniger wert als ein kurzer wahrer.
     */
    expect(s).not.toMatch(/minLength=\{\s*\d+\s*\}[\s\S]{0,400}name="begruendung"/u);
    expect(s).not.toMatch(/name="begruendung"[\s\S]{0,400}minLength=\{\s*\d+\s*\}/u);
  });

  it('die Felder sind leer — die Behauptung wird gelesen, nicht übernommen', () => {
    /*
     * Vorbelegt trüge die entstehende Fassung `planer_entscheidung` und wäre
     * von einer echten Entscheidung nicht mehr zu unterscheiden. Dieselbe
     * Regel wie in der Nacherfassung.
     */
    const s = quelle(SEITE);
    expect(s).not.toMatch(/name="beginn"[\s\S]{0,300}defaultValue/u);
    expect(s).not.toMatch(/name="ende"[\s\S]{0,300}defaultValue/u);
    expect(s).not.toMatch(/name="pause"[\s\S]{0,300}defaultValue/u);
  });
});

describe('das Zeiteintragsblatt führt hin — aber nicht ins Leere', () => {
  it('es verlinkt die Korrekturseite', () => {
    const b = quelle(BLATT);
    expect(b).toContain('/korrektur');
    expect(b).toContain('darfKorrigieren');
  });

  it('der Link hängt an allen vier Bedingungen', () => {
    /*
     * Recht, nicht der eigene Eintrag, nicht laufend, nicht abgelöst. Jede
     * einzelne führte sonst auf eine Schaltfläche, die beim Drücken scheitert
     * — und die erste davon verriete zusätzlich die Existenz einer Seite, die
     * diese Sitzung nicht sehen darf (AUT-06).
     */
    const b = quelle(BLATT);
    const zeile = /const korrigierbar = ([\s\S]*?);/u.exec(b)?.[1] ?? '';
    expect(zeile).toContain('befugnis.recht');
    expect(zeile).toContain('!befugnis.eigener');
    expect(zeile).toContain("e.status !== 'laufend'");
    expect(zeile).toContain('e.ersetztDurchId === null');
  });
});

describe('die Antworten der Datenbank werden richtig übersetzt', () => {
  it('`zk_nicht_selbst` ist 42501 — NICHT 23514', () => {
    /*
     * Der Auslöser aus 0036 meldet `insufficient_privilege`, nicht
     * `check_violation`. Das als Prüfbedingung zu behandeln hiesse: ein
     * eigener Zeiteintrag bekäme die Meldung „gesperrter Monat ohne
     * Gegenbuchung" — eine Diagnose, die auf die falsche Fährte führt.
     */
    const sql = readFileSync('drizzle/0036_zeiteintrag_korrektur.sql', 'utf8');
    const stelle = sql.indexOf('Niemand korrigiert seinen eigenen Zeiteintrag');
    expect(stelle).toBeGreaterThan(0);
    expect(sql.slice(stelle, stelle + 400)).toContain("errcode = 'insufficient_privilege'");

    const r = quelle(ROUTE);
    expect(r).toContain("pg.code === '42501'");
    // Unterschieden am `detail`, denn 42501 ist auch ein fehlendes
    // Tabellenrecht — und das ist kein „das ist Ihr eigener Eintrag".
    expect(r).toContain("'EMP-07'");
    expect(r).toContain("pg.code === '23514'");
  });

  it('jedes Wort, das die Route zurückschickt, hat auf der Seite einen Satz', () => {
    /*
     * Ein Schlüssel ohne Text erscheint als `fehler=nicht_aktuell` in der
     * Adresszeile und als Rohwort auf dem Bildschirm. Wer hier arbeitet, ist
     * Planerin und nicht Entwicklerin.
     */
    const r = quelle(ROUTE);
    const woerter = [...r.matchAll(/wort: '([a-z_]+)'/gu)].map((m) => m[1]);
    const gesendet = [...r.matchAll(/zurueckMit\(anfrage, daten, '([a-z_]+)'/gu)]
      .map((m) => m[1]);
    const alle = [...new Set([...woerter, ...gesendet])];
    expect(alle.length).toBeGreaterThan(5);

    const s = quelle(SEITE);
    const erklaert = /const FEHLER_TEXT[\s\S]*?\n\};/u.exec(s)?.[0] ?? '';
    for (const w of alle) expect(erklaert).toContain(`${w}:`);
  });
});

describe('der Dienst bleibt, was er ist', () => {
  it('eine Korrektur ist eine neue Fassung, nie ein UPDATE am Beleg', () => {
    /*
     * Die Zusage, die den ganzen Aufbau trägt: die Fassung, DIE GALT, als der
     * Lohn gezahlt wurde, bleibt lesbar (Invariante 8). Ein `update
     * zeiteintrag set beginn_zeitpunkt` im Dienst wäre der eine Handgriff, der
     * sie kassiert.
     */
    const d = quelle(DIENST);
    expect(d).not.toMatch(/update\s+zeiteintrag\s+set/iu);
    expect(d).toContain('insert into zeiteintrag');
    expect(d).toContain('insert into zeiteintrag_korrektur');
  });
});

/**
 * **Die Verknüpfung, die es nie gab** (EMP-07, TIM-11).
 *
 * `zeiteintrag_korrektur.zeit_einwand_id` steht seit der Anlage der Tabelle da,
 * mit eigenem Fremdschlüssel `zk_einwand_fk` auf `zeit_einwand(mandant_id, id)`.
 * GELESEN wurde die Spalte: `leseEinwand` hängt daran den Abschnitt „Ist eine
 * Korrektur gefolgt?" des Einwandblatts. GESCHRIEBEN hat sie im ganzen
 * `src/`-Baum niemand — `korrigiereZeiteintrag` führte sie nicht in seinem
 * `insert`, und die Eingabe hatte kein Feld dafür.
 *
 * Die Folge war eine Seite, die IMMER dasselbe sagte: „Anerkannt, aber keine
 * Korrektur", auch für die Korrektur, die genau diese Meldung beantwortet und
 * eine Minute später entstand. Ein Bildschirm, der eine Warnung zeigt, die
 * nicht abschaltbar ist, lehrt seinen Leser, sie zu übersehen — und damit auch
 * in dem Fall, für den es sie gibt.
 *
 * Geprüft wird die VERDRAHTUNG der vier Stellen, am Quelltext und ohne
 * Datenbank; dass die Kette gegen echte Policies trägt, steht in
 * `tests/isolation/`.
 */
describe('eine Korrektur weiss, welche Meldung sie beantwortet', () => {
  const EINWANDBLATT = 'src/app/portal/[mandant]/zeiten/einwaende/[id]/page.tsx';

  it('der Dienst nimmt die Meldung an und schreibt die Spalte', () => {
    const d = quelle(DIENST);
    expect(d).toContain('zeitEinwandId');
    // Die Spalte MUSS in der Spaltenliste des `insert` stehen — ein Feld in
    // der Eingabe, das nirgends ankommt, ist schlimmer als keines.
    expect(d).toMatch(/insert into zeiteintrag_korrektur[\s\S]*?zeit_einwand_id/u);
  });

  it('die Route reicht sie durch und prüft ihre Form', () => {
    const r = quelle(ROUTE);
    expect(r).toContain("feld(daten, 'einwand')");
    expect(r).toContain('zeitEinwandId');
    // Eine unbrauchbare Kennung wird abgewiesen, nicht an Postgres gegeben.
    expect(r).toContain('UUID.test(einwand)');
    // Der Fremdschluessel antwortet mit 23503, und das ist nach aussen 404
    // und nicht 403 (AUT-06) — die Zeile eines anderen Mandanten ist nicht
    // vorhanden, nicht verboten.
    expect(r).toContain("pg.code === '23503'");
  });

  it('das Formular trägt sie als verstecktes Feld', () => {
    const s = quelle(SEITE);
    expect(s).toContain('name="einwand"');
    expect(s).toContain('leseEinwand');
    /*
     * Und eine Kennung, die diese Sitzung nicht lesen darf, verschwindet
     * nicht still: die Seite sagt es. Ein stilles Fallenlassen wäre genau
     * dieselbe Lücke noch einmal, nur eine Ebene höher.
     */
    expect(s).toContain('einwandUnlesbar');
  });

  it('und das Einwandblatt bringt sie beim Verweis mit', () => {
    const b = quelle(EINWANDBLATT);
    /*
     * Der Knopf „Korrektur schreiben" OHNE `?einwand=` wäre der Weg, auf dem
     * die Verknüpfung wieder verlorengeht — er sieht dann genauso aus.
     */
    expect(b).toMatch(/\/korrektur\?einwand=\$\{e\.id\}/u);
  });
});
