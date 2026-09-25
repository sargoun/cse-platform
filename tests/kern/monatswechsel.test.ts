import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MEIN_TEXTE, PORTAL_SPRACHEN } from '../../src/lib/i18n/texte.js';

/**
 * Wer `?monat=` LIEST, muss ihn auch SETZEN lassen (V-053, EMP-03).
 *
 * **Der Befund.** Drei Arbeiterseiten werteten den Parameter aus:
 * `/portal/mein/zeiten`, `/portal/mein/monatsnachweis` und
 * `/portal/mein/stundenkonto`. Nur die dritte bot ein Bedienelement, das ihn
 * erzeugt — zwei nackte Pfeile mit einer Zahl daneben. Auf den anderen
 * beiden musste man die Adresszeile tippen; auf einem Telefon ist das kein
 * Umweg, sondern eine verschlossene Tür.
 *
 * Und es ist genau der Blick, um den es geht: **die Abrechnung des letzten
 * Monats prüft man, wenn der Lohn da ist** — also im nächsten.
 *
 * **Warum das eine Sperrklinke braucht.** Ein fehlender Knopf wirft keine
 * Ausnahme. Die Seite lädt, zeigt den laufenden Monat und sieht vollständig
 * aus. Die nächste Seite, die `?monat=` liest, wird ihn genauso vergessen —
 * es sei denn, eine Prüfung besteht darauf.
 */

const WURZEL = 'src/app/portal/mein';

function alleSeiten(verzeichnis: string): readonly string[] {
  const gefunden: string[] = [];
  for (const eintrag of readdirSync(verzeichnis)) {
    const voll = join(verzeichnis, eintrag);
    if (statSync(voll).isDirectory()) gefunden.push(...alleSeiten(voll));
    else if (eintrag === 'page.tsx') gefunden.push(voll);
  }
  return gefunden;
}

describe('(1) jede Seite, die den Monat liest, lässt ihn wechseln', () => {
  it('kein `?monat=`-Leser ohne Monatswechsler', () => {
    const fehlend: string[] = [];
    for (const datei of alleSeiten(WURZEL)) {
      const quelle = readFileSync(datei, 'utf8');
      /*
       * Gesucht wird der ZUGRIFF auf den Parameter, nicht das Wort „monat":
       * eine Seite, die eine Spalte „Monat" beschriftet, liest ihn nicht.
       */
      const liest = /\[\s*'monat'\s*\]/u.test(quelle);
      if (liest && !quelle.includes('Monatswechsler')) fehlend.push(datei);
    }
    expect(fehlend).toEqual([]);
  });

  it('und mindestens eine Seite tut es — sonst prüft (1) nichts', () => {
    const leser = alleSeiten(WURZEL).filter(
      (d) => /\[\s*'monat'\s*\]/u.test(readFileSync(d, 'utf8')));
    expect(leser.length).toBeGreaterThanOrEqual(3);
  });
});

describe('(2) der Wechsler spricht alle vier Sprachen (SPEC §10)', () => {
  it('jede Sprache nennt die drei Wörter, und keines ist leer', () => {
    for (const sprache of PORTAL_SPRACHEN) {
      const t = MEIN_TEXTE[sprache];
      for (const wort of [t.monatVorher, t.monatSpaeter, t.monatHeute] as const) {
        expect(wort.trim()).not.toBe('');
      }
    }
  });

  it('keine zwei Sprachen teilen sich dasselbe Wort für „voriger Monat"', () => {
    /*
     * Eine kopierte Zeile ist die haeufigste Art, eine Uebersetzung zu
     * vergessen — sie faellt niemandem auf, weil der Bildschirm gefuellt
     * aussieht. Deutsch und Englisch teilen hier nichts; waere es so, waere
     * es ein Versehen.
     */
    const woerter = PORTAL_SPRACHEN.map((s) => MEIN_TEXTE[s].monatVorher);
    expect(new Set(woerter).size).toBe(woerter.length);
  });
});

describe('(3) die Entscheidung über einen Einwand hat Wörter (V-051)', () => {
  it('jede Sprache benennt alle sechs Zustände', async () => {
    const { EINWAND_STATUS_TEXTE } = await import('../../src/lib/i18n/texte.js');
    const zustaende = [
      'offen', 'in_pruefung', 'anerkannt', 'teilweise_anerkannt',
      'abgelehnt', 'zurueckgezogen',
    ] as const;
    for (const sprache of PORTAL_SPRACHEN) {
      for (const z of zustaende) {
        expect(EINWAND_STATUS_TEXTE[sprache][z].trim()).not.toBe('');
      }
    }
  });

  it('die Seite zeigt Zustand, Zeitpunkt UND Begründung — nicht nur den Zustand', () => {
    const seite = readFileSync(
      'src/app/portal/mein/zeiten/[id]/einwand/page.tsx', 'utf8');
    /*
     * Die Liste steht seit V-189 als `EinwandListe` in den Bausteinen, weil
     * auch „Eine Zeit fehlt" sie zeigt — die Seite muss sie benutzen.
     */
    expect(seite).toContain('<EinwandListe');
    const quelle = readFileSync('src/app/portal/mein/bausteine.tsx', 'utf8');
    /*
     * Vorher stand dort `{e.status}` — der rohe Enum-Wert — und sonst nichts.
     * Diese drei Zeilen halten fest, dass alle drei Teile der Entscheidung
     * auf dem Bildschirm landen.
     */
    expect(quelle).toContain('EINWAND_STATUS_TEXTE');
    expect(quelle).toContain('einwandEntschiedenAm');
    expect(quelle).toContain('entscheidungBegruendung');
    expect(quelle).not.toMatch(/<Feld label=\{t\.status\}>\{e\.status\}<\/Feld>/u);
  });
});

describe('(4) wer `?jahr=` liest, lässt es auch wechseln (V-054)', () => {
  it('kein `?jahr=`-Leser ohne Jahreswechsler', () => {
    /*
     * Derselbe Befund ein Jahr grösser: `/portal/mein/urlaub` las den
     * Parameter und bot nichts an, das ihn setzt. Der Blick auf das Vorjahr
     * ist hier der häufigste überhaupt — ein Übertrag verfällt im Frühjahr.
     */
    const fehlend: string[] = [];
    for (const datei of alleSeiten(WURZEL)) {
      const quelle = readFileSync(datei, 'utf8');
      const liest = /\[\s*'jahr'\s*\]/u.test(quelle);
      if (liest && !quelle.includes('Jahreswechsler')) fehlend.push(datei);
    }
    expect(fehlend).toEqual([]);
  });

  it('und mindestens eine Seite tut es — sonst prüft (4) nichts', () => {
    const leser = alleSeiten(WURZEL).filter(
      (d) => /\[\s*'jahr'\s*\]/u.test(readFileSync(d, 'utf8')));
    expect(leser.length).toBeGreaterThanOrEqual(1);
  });

  it('jede Sprache nennt die vier Wörter, und keines ist leer', () => {
    for (const sprache of PORTAL_SPRACHEN) {
      const t = MEIN_TEXTE[sprache];
      for (const wort of [t.jahr, t.jahrVorher, t.jahrSpaeter, t.jahrHeute] as const) {
        expect(wort.trim()).not.toBe('');
      }
    }
  });

  it('keine zwei Sprachen teilen sich dasselbe Wort für „voriges Jahr"', () => {
    const woerter = PORTAL_SPRACHEN.map((s) => MEIN_TEXTE[s].jahrVorher);
    expect(new Set(woerter).size).toBe(woerter.length);
  });

  it('das Urlaubskonto führt auch zum Antrag, nicht nur zur Zahl', () => {
    /*
     * Es zeigte den Anspruch, ohne zu sagen, wie man ihn nimmt: der
     * Urlaubsantrag liegt zwei Ebenen weiter unter „Anträge" — also genau
     * dort, wo niemand sucht, der auf sein Urlaubskonto schaut.
     */
    const quelle = readFileSync('src/app/portal/mein/urlaub/page.tsx', 'utf8');
    expect(quelle).toContain('/portal/mein/antraege/neu');
  });
});

describe('(5) der Monatsnachweis ist bedienbar (V-055)', () => {
  const NACHWEIS = 'src/app/portal/mein/monatsnachweis/page.tsx';

  it('„Drucken" ist ein Knopf und kein Wort', () => {
    const quelle = readFileSync(NACHWEIS, 'utf8');
    expect(quelle).toContain('DruckKnopf');
    // Vorher stand „{t.monatsnachweis} · {t.drucken}" in der Kopfzeile: eine
    // Anleitung ohne Bedienelement, und auf einem Telefon gibt es kein
    // Datei-Menü.
    expect(quelle).not.toContain('{t.monatsnachweis} · {t.drucken}');
  });

  it('der Knopf steht nicht auf dem Ausdruck', () => {
    // Ein Bedienelement im Ausdruck wäre ein Knopf auf einem Beweisstück.
    const knopf = readFileSync(
      'src/app/portal/mein/monatsnachweis/DruckKnopf.tsx', 'utf8');
    expect(knopf).toContain('cse-nicht-drucken');
  });

  it('bei zwei Beschäftigungen lässt sich wählen (D-09)', () => {
    /*
     * Zwei Arbeitsverhältnisse sind zwei Aufzeichnungen gegen zwei
     * Arbeitgeber. Die Seite nahm stillschweigend die erste; wer für die
     * zweite einen Nachweis brauchte, musste `?anstellung=` mit einer UUID
     * tippen, die nirgends stand.
     */
    const quelle = readFileSync(NACHWEIS, 'utf8');
    expect(quelle).toContain('beschaeftigungen');
    expect(quelle).toContain('nachweis-beschaeftigung');
  });
});

describe('(6) die Antragsart steht in der Sprache des Menschen (V-062)', () => {
  it('beide Antragsseiten übersetzen sie', async () => {
    const { artInSprache } = await import(
      '../../src/server/services/abwesenheit/antrag.js');
    const zeile = {
      art: 'Urlaubsantrag',
      artI18n: { de: 'Urlaubsantrag', ar: 'طلب إجازة', tr: '  ' },
    };
    expect(artInSprache(zeile, 'ar')).toBe('طلب إجازة');
    // Nicht übersetzt → die deutsche Bezeichnung, nicht eine Lücke: der
    // Mensch soll wenigstens danach fragen können.
    expect(artInSprache(zeile, 'en')).toBe('Urlaubsantrag');
    // Leerzeichen zählen als nicht übersetzt — in gepflegten Katalogen
    // stehen sie häufiger da, als man denkt.
    expect(artInSprache(zeile, 'tr')).toBe('Urlaubsantrag');
  });

  it('keine Seite zeigt mehr die rohe Bezeichnung', () => {
    for (const datei of [
      'src/app/portal/mein/antraege/page.tsx',
      'src/app/portal/mein/antraege/[id]/page.tsx',
    ]) {
      const quelle = readFileSync(datei, 'utf8');
      expect(quelle).toContain('artInSprache');
    }
  });
});

describe('(7) die Nachweisseite nennt einen nächsten Schritt (V-061)', () => {
  const SEITE = 'src/app/portal/mein/nachweise/page.tsx';

  it('neben der Sperre steht, was zu tun ist — und wohin', () => {
    /*
     * Die Seite sagte „Ohne diesen Nachweis darf Sie niemand einteilen." und
     * hörte dort auf: kein Weg, kein Ansprechpartner, kein Satz darüber, was
     * jetzt passiert. Wer das liest und nichts findet, hält das Portal für
     * kaputt.
     */
    const quelle = readFileSync(SEITE, 'utf8');
    expect(quelle).toContain('nachweisWasTun');
    expect(quelle).toContain('/portal/mein/nachrichten');
  });

  it('und verspricht KEIN Hochladen', () => {
    /*
     * Es gibt keine Ablage für Dateien (O-12/O-13: kein Medienspeicher
     * verbunden). Ein Feld, das nichts speichert, wäre schlimmer als keines —
     * der Mensch hielte die Sache für erledigt.
     */
    const quelle = readFileSync(SEITE, 'utf8');
    expect(quelle).toContain('nachweisKeinUpload');
    expect(quelle).not.toMatch(/type="file"/u);
  });

  it('der Satz steht in allen vier Sprachen', () => {
    for (const sprache of PORTAL_SPRACHEN) {
      const t = MEIN_TEXTE[sprache];
      for (const wort of [
        t.nachweisWasTun, t.nachweisWasTunText, t.nachweisKeinUpload,
        t.nachweisZuNachrichten,
      ] as const) {
        expect(wort.trim()).not.toBe('');
      }
    }
  });
});
