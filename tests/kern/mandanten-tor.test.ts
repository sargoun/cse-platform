/**
 * Die REIHENFOLGE im Tor einer `/portal/[mandant]/…`-Seite (§4.5, K-20).
 *
 * **Der Befund aus dem Betrieb.** Auf der Gruppenübersicht steht je
 * Gesellschaft ein Knopf „Bereich öffnen". Er führte auf „Diese Seite gibt es
 * hier nicht." Der Grund war eine einzige Zeile zu früh:
 *
 * ```
 * if (sitzung.aktiverMandantId === null) notFound();   // ← stand VORHER
 * const tor = await slugTor(zugang, mandant);          // ← kam nie dran
 * ```
 *
 * In der Gruppenansicht ist der aktive Bereich **immer** null (K-20). Damit
 * fiel jede Gruppensitzung auf 404, bevor `slugTor` das Wechselblatt anbieten
 * konnte — der Knopf, der in eine Gesellschaft führt, führte ins Nichts.
 *
 * **Die Reihenfolge IST die Regel**, nicht ein Stilfrage: wer zuerst prüft,
 * bestimmt, welche Antwort der Mensch liest. Dieselbe Lehre wie bei den
 * nummerierten Auslösern in `0036` — dort nannte die falsche Reihenfolge die
 * falsche Ursache, hier verschluckt sie einen ganzen Weg.
 *
 * Geprüft wird am Quelltext über ALLE Seiten unter `/portal/[mandant]`, nicht
 * an der einen, die es erwischt hat. Eine Regel, die für 165 Seiten gilt und
 * an einer nachgesehen wird, ist keine.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ohneKommentareMitTexten } from './hilfen/quelltext.js';

const WURZEL = 'src/app/portal/[mandant]';

function seiten(verzeichnis: string): readonly string[] {
  const treffer: string[] = [];
  for (const e of readdirSync(verzeichnis)) {
    const voll = join(verzeichnis, e);
    if (statSync(voll).isDirectory()) treffer.push(...seiten(voll));
    else if (e === 'page.tsx') treffer.push(voll);
  }
  return treffer;
}

const ALLE = seiten(WURZEL);

describe('das Slug-Tor kommt vor der Frage nach dem aktiven Bereich', () => {
  it('es gibt überhaupt Seiten zu prüfen', () => {
    // Ohne diese Zusage liefe die Schleife unten über nichts und wäre grün.
    expect(ALLE.length).toBeGreaterThan(100);
  });

  for (const datei of ALLE) {
    const quelle = ohneKommentareMitTexten(readFileSync(datei, 'utf8'));
    const iTor = quelle.search(/\b(?:slugTor|mandantTor)\s*\(/u);
    if (iTor === -1) continue;
    const iNull = quelle.indexOf('aktiverMandantId === null');
    if (iNull === -1) continue;

    it(`${datei.slice(WURZEL.length + 1)}`, () => {
      expect(
        iTor,
        'Das Slug-Tor steht hinter `aktiverMandantId === null` — eine '
        + 'Gruppensitzung faellt damit auf 404, statt das Wechselblatt zu sehen.',
      ).toBeLessThan(iNull);
    });
  }
});

describe('jede Mandantsseite hat überhaupt ein Slug-Tor', () => {
  /**
   * Ohne das Tor gilt der Slug im Pfad als bare Zierde: die Seite liest dann
   * gegen den Bereich der SITZUNG, während die Adresse einen anderen nennt.
   * Wer `/portal/security/rechnungen` öffnet, während die Reinigung aktiv ist,
   * sähe Reinigungszahlen unter der Überschrift der Security.
   */
  const OHNE_EIGENES_TOR: readonly string[] = [
  '[...rest]/page.tsx',
  'agenten/[agent]/aufgaben/page.tsx',
  'angebote/neu/page.tsx',
  'berichte/attribution/page.tsx',
  'berichte/auftraege/page.tsx',
  'berichte/mitarbeiter/page.tsx',
  'berichte/pipeline/page.tsx',
  'berichte/projekte/page.tsx',
  'berichte/umsatz/page.tsx',
  'finanzen/mahnungen/vorschlaege/page.tsx',
  'recruiting/bedarf/page.tsx',
  'recruiting/bewerbungen/[id]/antwort/page.tsx',
  'recruiting/bewerbungen/[id]/page.tsx',
  'recruiting/bewerbungen/page.tsx',
  'recruiting/datenschutz/page.tsx',
  'recruiting/gespraeche/[id]/page.tsx',
  'recruiting/gespraeche/page.tsx',
  'recruiting/kandidaten/[id]/bewertung/page.tsx',
  'recruiting/kandidaten/[id]/entscheidung/page.tsx',
  'recruiting/kandidaten/[id]/page.tsx',
  'recruiting/kandidaten/page.tsx',
  'recruiting/page.tsx',
  'recruiting/stellen/[id]/page.tsx',
  'recruiting/stellen/[id]/veroeffentlichung/page.tsx',
  'recruiting/stellen/neu/page.tsx',
  'recruiting/stellen/page.tsx',
];

  it('und wo nicht, reicht sie an eine Hülle weiter, die eines hat', () => {
    const ohne = ALLE
      .map((d) => d.slice(WURZEL.length + 1))
      .filter((rel) => {
        const quelle = ohneKommentareMitTexten(readFileSync(join(WURZEL, rel), 'utf8'));
        return !/\b(?:slugTor|mandantTor)\s*\(/u.test(quelle);
      });
    expect([...ohne].sort()).toEqual([...OHNE_EIGENES_TOR].sort());
  });

  it('jede Ausnahme reicht wirklich an eine Hülle mit Tor weiter', () => {
    /*
     * Die Liste oben darf nicht verrotten: steht eine Datei darin, die
     * inzwischen selbst rendert, waere sie ungeschuetzt und die Liste
     * behauptete das Gegenteil.
     */
    const huellen = ['MandantUnterseite', 'BerichtsSeite', 'RecruitingSeite', 'redirect'];
    for (const rel of OHNE_EIGENES_TOR) {
      const quelle = ohneKommentareMitTexten(readFileSync(join(WURZEL, rel), 'utf8'));
      expect(huellen.some((h) => quelle.includes(h)), rel).toBe(true);
    }
  });
});
