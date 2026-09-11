/**
 * PR 44 — die Zusagen, die an der OBERFLÄCHE hängen (BAU-04, BAU-05, BAU-06).
 *
 * Die Datenbankhälfte steht in `tests/isolation/bau-nachtrag.test.ts` und
 * `bau-behinderung.test.ts`. Hier stehen die drei Aussagen, die dort nicht zu
 * prüfen sind, weil sie über Seiten und Rechte reden und nicht über Zeilen:
 *
 *  1. **Getrennt ANGEZEIGT** — `angemeldet_am` und `eingereicht_am` sind nicht
 *     nur zwei Spalten, sondern zwei Anzeigen mit zwei Wegen und zwei Rechten.
 *  2. **Die Warnung bietet an, einen Nachtrag anzulegen** — sie benennt die
 *     Position und führt irgendwohin, nicht nur ins Gewissen.
 *  4. **Die § 2-Grundlage ist eine Auswahl OHNE Vorgabewert** — das Formular
 *     öffnet mit „Bitte wählen", nicht mit einem Absatz.
 *
 * Gelesen wird die DATEI, nicht eine Liste, die jemand pflegt: eine Seite, die
 * die Anzeige wieder zusammenlegt, fällt damit auf, und zwar hier statt im
 * Werklohnprozess.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROUTEN } from '../../src/server/auth/route-manifest.js';
import {
  nachtragTitelVorschlag, warnungsText, type AusserhalbLvWarnung,
} from '../../src/server/services/bau/ausserhalb-lv.js';

const WURZEL = resolve(import.meta.dirname, '../..');
const SEITEN = join(WURZEL, 'src/app/portal/[mandant]/bau');

function seite(pfad: string): string {
  const voll = join(SEITEN, pfad);
  // Ohne diese Zusage bestünde jede Prüfung unten auf einer leeren Zeichenkette.
  expect(existsSync(voll), `${pfad} fehlt`).toBe(true);
  return readFileSync(voll, 'utf8');
}

/* ===========================================================================
 * (1) Zwei Daten, zwei Wege, zwei Rechte — auch in der Anzeige
 * ======================================================================== */

describe('(1) `angemeldet_am` und `eingereicht_am` sind GETRENNT angezeigt', () => {
  const detail = () => seite('projekte/[id]/nachtraege/[nachtragId]/page.tsx');

  it('die Detailseite zeigt beide Daten in zwei eigenen Blöcken', () => {
    const inhalt = detail();
    expect(inhalt).toMatch(/data-cse="anmeldung"/u);
    expect(inhalt).toMatch(/data-cse="einreichung"/u);
    expect(inhalt).toMatch(/data-cse="angemeldet-am"/u);
    expect(inhalt).toMatch(/data-cse="eingereicht-am"/u);
  });

  it('und sie führen zu ZWEI verschiedenen Adressen', () => {
    const inhalt = detail();
    expect(inhalt).toContain('/anmelden`');
    expect(inhalt).toContain('/einreichen`');
  });

  it('die Listenseite trennt sie ebenfalls — eine Spalte je Datum', () => {
    const liste = seite('projekte/[id]/nachtraege/page.tsx');
    expect(liste).toMatch(/kopf: 'Angemeldet'/u);
    expect(liste).toMatch(/kopf: 'Eingereicht'/u);
  });

  it('jede der beiden Adressen trägt ihr EIGENES Recht (Seitenkarte §5.9)', () => {
    const anmelden = ROUTEN.find((r) => r.pfad === 'api/bau/nachtraege/[id]/anmelden');
    const einreichen = ROUTEN.find((r) => r.pfad === 'api/bau/nachtraege/[id]/einreichen');
    expect(anmelden?.recht).toBe('bau.nachtrag_anmelden');
    expect(einreichen?.recht).toBe('bau.nachtrag_einreichen');
    /**
     * Der eigentliche Punkt: sie sind VERSCHIEDEN. Wer ankündigen darf, hat
     * damit noch nichts an den Auftraggeber geschickt — und umgekehrt.
     */
    expect(anmelden?.recht).not.toBe(einreichen?.recht);
  });

  it('die Einreichung verlangt im Formular eine Freigabe (Invariante 7)', () => {
    const inhalt = detail();
    // Ein Formular ohne dieses Feld erzeugte einen 409 aus dem Dienst statt
    // eines Feldes, das den Menschen nach dem fehlenden Stück fragt.
    expect(inhalt).toMatch(/name="freigabe"/u);
  });

  it('die projektübergreifende Liste hat den Filter „angemeldet, nicht eingereicht"', () => {
    const inhalt = seite('nachtraege/page.tsx');
    expect(inhalt).toMatch(/data-cse="filter-offen"/u);
    // Als GET-Link, nicht per JavaScript: auf einem Baustellentelefon filtert
    // eine Liste, die erst nach einem Skriptdownload filtert, gar nicht.
    expect(inhalt).toContain('?offen=1');
    expect(inhalt).toMatch(/nurOffen/u);
  });
});

/* ===========================================================================
 * (2) Die Warnung benennt die Position und bietet den Nachtrag an
 * ======================================================================== */

describe('(2) die Warnung ausserhalb des LV benennt und bietet an', () => {
  const aufmassWarnung: AusserhalbLvWarnung = {
    quelle: 'aufmass',
    id: '11111111-1111-1111-1111-111111111111',
    projekt_id: '22222222-2222-2222-2222-222222222222',
    projekt: 'Rohbau Nord',
    position: 'Kernbohrung D 150 mm',
    herkunft: 'Aufmaßblatt A-7',
    umfang: '12.000',
    einheit: 'St',
    ziel_id: '33333333-3333-3333-3333-333333333333',
  };
  const zeitWarnung: AusserhalbLvWarnung = {
    ...aufmassWarnung,
    quelle: 'zeit',
    position: 'Stundenlohnarbeiten Räumung',
    herkunft: 'Auftragszeile 90',
    umfang: '240',
    einheit: 'min',
  };

  it('der Satz nennt die Position wörtlich — beide Quellen', () => {
    // „Es gibt Leistungen ausserhalb des LV" wäre keine Warnung, sondern eine
    // Stimmung: die Bauleitung müsste zwölf Aufmaßblätter durchsuchen.
    expect(warnungsText(aufmassWarnung)).toContain('Kernbohrung D 150 mm');
    expect(warnungsText(aufmassWarnung)).toContain('Aufmaßblatt A-7');
    expect(warnungsText(zeitWarnung)).toContain('Stundenlohnarbeiten Räumung');
    expect(warnungsText(zeitWarnung)).toContain('Auftragszeile 90');
    expect(warnungsText(zeitWarnung)).toContain('240 Minuten');
  });

  it('und er sagt, WAS fehlt: das Leistungsverzeichnis und der Nachtrag', () => {
    for (const w of [aufmassWarnung, zeitWarnung]) {
      expect(warnungsText(w)).toMatch(/Leistungsverzeichnis/u);
      expect(warnungsText(w)).toMatch(/Nachtrag/u);
    }
  });

  it('der Titelvorschlag trägt die Position — und KEINE Anspruchsgrundlage', () => {
    expect(nachtragTitelVorschlag(aufmassWarnung)).toContain('Kernbohrung D 150 mm');
    expect(nachtragTitelVorschlag(zeitWarnung)).toContain('Stundenlohnarbeiten');
    /**
     * Welcher Absatz des § 2 VOB/B einschlägig ist, entscheidet ein Mensch
     * (K-17, O-23). Ein Vorschlag, der ihn mitbrächte, wäre eine Rechtsfolge
     * aus einer Zeichenkette.
     */
    for (const w of [aufmassWarnung, zeitWarnung]) {
      expect(nachtragTitelVorschlag(w)).not.toMatch(/§\s*2/u);
      expect(nachtragTitelVorschlag(w)).not.toMatch(/Abs\./u);
    }
  });

  it('der Warnblock BIETET AN — er führt auf das Anmeldeformular, mit Bezug', () => {
    const block = readFileSync(join(SEITEN, 'AusserhalbLvWarnungen.tsx'), 'utf8');
    expect(block).toMatch(/data-cse="nachtrag-anbieten"/u);
    expect(block).toContain('/nachtraege/neu?');
    // Der Bezug reist mit, sonst bliebe die Warnung nach der Abhilfe stehen.
    expect(block).toContain("abfrage.set('auftrag_leistung', w.id)");
    expect(block).toContain("abfrage.set('aufmass_zeile', w.id)");
    // Und er gibt KEINE Grundlage mit.
    expect(block).not.toMatch(/abfrage\.set\('grundlage'/u);
  });

  it('die Warnung erscheint auf dem Aufmaßblatt, auf der Nachtragsliste und übergreifend', () => {
    for (const p of [
      'projekte/[id]/aufmass/[aufmassId]/page.tsx',
      'projekte/[id]/nachtraege/page.tsx',
      'nachtraege/page.tsx',
    ]) {
      expect(seite(p), p).toContain('<AusserhalbLvWarnungen');
    }
  });
});

/* ===========================================================================
 * (4) Die § 2-Grundlage: Auswahl, nie Freitext, nie Vorgabewert
 * ======================================================================== */

describe('(4) das Anmeldeformular belegt keine Anspruchsgrundlage vor', () => {
  const neu = () => seite('projekte/[id]/nachtraege/neu/page.tsx');

  it('das Feld ist eine Auswahl, ist Pflicht und öffnet LEER', () => {
    const inhalt = neu();
    expect(inhalt).toMatch(/name="grundlage"/u);
    expect(inhalt).toMatch(/data-cse="grundlage"/u);
    // `defaultValue=""` plus eine deaktivierte Leerzeile: kein Absatz ist
    // vorausgewählt, und abschicken lässt sich ohne Wahl nicht.
    expect(inhalt).toMatch(/defaultValue=""/u);
    expect(inhalt).toMatch(/<option value="" disabled>/u);
  });

  it('die Einträge kommen aus der KATALOGTABELLE, nicht aus dem Seitentext', () => {
    const inhalt = neu();
    expect(inhalt).toContain('ladeGrundlagen');
    expect(inhalt).toMatch(/daten\.grundlagen\.map/u);
    /**
     * Kein hartkodierter Absatz irgendwo in der Datei: sonst gäbe es zwei
     * Listen, und die zweite ist die, die beim nächsten Gesetzesstand stehen
     * bleibt.
     */
    expect(inhalt).not.toMatch(/value="p2_abs_/u);
  });

  it('und es gibt kein Freitextfeld daneben', () => {
    const inhalt = neu();
    expect(inhalt).not.toMatch(/name="grundlage_text"/u);
    expect(inhalt).not.toMatch(/name="grundlage_freitext"/u);
  });

  it('die unbestätigten Katalogzeilen sind als solche gekennzeichnet (K-17, O-23)', () => {
    const inhalt = neu();
    expect(inhalt).toMatch(/ist_platzhalter/u);
    expect(inhalt).toContain('unbestätigter Wert');
  });

  it('die Detailseite zeigt Fundstelle und Platzhalterhinweis ebenfalls', () => {
    const inhalt = seite('projekte/[id]/nachtraege/[nachtragId]/page.tsx');
    expect(inhalt).toMatch(/grundlage_fundstelle/u);
    expect(inhalt).toMatch(/grundlage_platzhalter/u);
  });
});

/* ===========================================================================
 * (3) Die Behinderungsanzeige: Vorlage, Absendedatum, nicht verbundene Kanäle
 * ======================================================================== */

describe('(3) die Behinderungsanzeige an der Oberfläche', () => {
  it('das Formular wählt eine VORLAGE und zeigt deren Wortlaut', () => {
    const inhalt = seite('projekte/[id]/behinderungen/neu/page.tsx');
    expect(inhalt).toMatch(/name="vorlage"/u);
    expect(inhalt).toContain('ladeVorlagen');
    expect(inhalt).toMatch(/data-cse="vorlagentext"/u);
    // Kein freies Textfeld für den Anzeigetext — BAU-06 verlangt die Vorlage.
    expect(inhalt).not.toMatch(/name="anzeigetext"/u);
  });

  it('die Risikosphäre nach § 6 Abs. 2 ist ebenfalls ohne Vorgabewert', () => {
    const inhalt = seite('projekte/[id]/behinderungen/neu/page.tsx');
    expect(inhalt).toMatch(/name="grund_kategorie"/u);
    expect(inhalt).toMatch(/<option value="" disabled>/u);
  });

  it('die Detailseite zeigt Absendedatum, Kanal und das archivierte Schreiben', () => {
    const inhalt = seite('projekte/[id]/behinderungen/[bid]/page.tsx');
    expect(inhalt).toMatch(/data-cse="angezeigt-am"/u);
    expect(inhalt).toMatch(/versandart/u);
    expect(inhalt).toMatch(/versand_dokument_id/u);
  });

  it('E-Mail und Portal stehen als „nicht verbunden" und sind NICHT wählbar', () => {
    const inhalt = seite('projekte/[id]/behinderungen/[bid]/page.tsx');
    expect(inhalt).toContain('ELEKTRONISCHE_KANAELE');
    expect(inhalt).toContain('nicht verbunden');
    /**
     * Ein ausgeblendeter Kanal sieht aus, als gäbe es ihn nicht; ein
     * gesperrter sagt, warum. Und kein vorgetäuschter Versand: CLAUDE.md.
     */
    expect(inhalt).toMatch(/<option key=\{k\} value=\{k\} disabled>/u);
  });

  it('und der Versand verlangt im Formular eine Freigabe (Invariante 7)', () => {
    const inhalt = seite('projekte/[id]/behinderungen/[bid]/page.tsx');
    expect(inhalt).toMatch(/name="freigabe"/u);
  });
});

/* ===========================================================================
 * Der Rahmen: jede neue Adresse steht im Manifest, mit einem echten Recht
 * ======================================================================== */

describe('die sieben neuen Adressen tragen ihr Recht', () => {
  const ERWARTET: readonly (readonly [string, string])[] = [
    ['api/bau/nachtraege', 'bau.nachtrag_anmelden'],
    ['api/bau/nachtraege/[id]/anmelden', 'bau.nachtrag_anmelden'],
    ['api/bau/nachtraege/[id]/einreichen', 'bau.nachtrag_einreichen'],
    ['api/bau/nachtrag-warnungen', 'bau.lesen'],
    ['api/bau/behinderungen', 'bau.behinderung_erstellen'],
    ['api/bau/behinderungen/[id]/versenden', 'bau.behinderung_erstellen'],
    ['api/bau/behinderungen/[id]/wegfall', 'bau.behinderung_erstellen'],
  ];

  it.each(ERWARTET)('%s → %s', (pfad, recht) => {
    const eintrag = ROUTEN.find((r) => r.pfad === pfad);
    expect(eintrag, pfad).toBeDefined();
    // Keine bewusst offene Route: hier schreibt und liest niemand ohne Recht.
    expect(eintrag?.recht, pfad).toBe(recht);
  });
});
