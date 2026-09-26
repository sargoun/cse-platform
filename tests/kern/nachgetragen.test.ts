import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MEIN_TEXTE, PORTAL_SPRACHEN } from '../../src/lib/i18n/texte.js';

/**
 * **„nachgetragen" wurde an sechs Stellen ANGEZEIGT und von keiner
 * geschrieben** (V-078, TIM-09).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Vier Tabellen führen die Spalte — `wachbuch_eintrag` und
 * `schluessel_ereignis` (`0070`), `qualitaetspruefung` (`0068`),
 * `leistungsnachweis_signatur` (`0066`). Sechs Seiten zeigen den Vermerk. Bei
 * zweien nahm der Dienst ihn seit je entgegen und kein Formular schickte ihn;
 * bei den anderen kannte ihn nicht einmal die Route.
 *
 * Was auf dem Bildschirm stand, war also nie die Aussage eines Menschen,
 * sondern der Vorgabewert der Spalte — und zwar in genau der Richtung, die
 * niemandem auffällt: alles sah so aus, als wäre es im Augenblick des
 * Geschehens erfasst worden.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Und was es NICHT ist.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Keine Uhrabweichung. `0070` sagt es wörtlich: „wer beides in eine Spalte
 * legt, kann eine um 14:00 verfasste und um 22:00 uebertragene Seite nicht
 * mehr von einer um 22:00 verfassten unterscheiden". Die Abweichung misst die
 * GERÄTEZEIT; dieses Häkchen ist die Aussage eines Menschen über den VORGANG.
 * Deshalb wird es angekreuzt und nicht abgeleitet.
 */

const WURZEL = 'src/app';

function alleSeiten(verzeichnis: string): readonly string[] {
  const gefunden: string[] = [];
  for (const eintrag of readdirSync(verzeichnis)) {
    const voll = join(verzeichnis, eintrag);
    if (statSync(voll).isDirectory()) gefunden.push(...alleSeiten(voll));
    else if (eintrag.endsWith('.tsx')) gefunden.push(voll);
  }
  return gefunden;
}

describe('(1) jede der vier Erfassungen kann es sagen', () => {
  it.each([
    ['Wachbuch', 'src/app/portal/mein/schichten/[zuordnungId]/wachbuch/page.tsx'],
    ['Schlüsselquittung',
      'src/app/portal/[mandant]/security/schluessel/[id]/quittung/page.tsx'],
    ['Qualitätsprüfung', 'src/app/portal/[mandant]/qualitaet/pruefungen/neu/page.tsx'],
    ['Unterschrift',
      'src/app/portal/[mandant]/reinigung/leistungsnachweise/[id]/unterschrift/page.tsx'],
  ])('%s schickt `nachgetragen`', (_name, datei) => {
    expect(readFileSync(datei, 'utf8')).toContain('name="nachgetragen"');
  });

  it.each([
    ['Wachbuch', 'src/app/api/sicherheit/wachbuch/route.ts'],
    /*
     * Die Route, an die das Formular der WACHE schickt (oben die erste
     * Seite). Sie reichte das Häkchen bis V-180 nicht weiter — und stand
     * deshalb nicht in dieser Liste, die genau das hätte bemerken sollen.
     * Dass es im Dienst ankommt, prüft `wachbuch-schicht-route.test.ts` (1).
     */
    ['Wachbuch der Schicht', 'src/app/api/mein/schichten/[zuordnungId]/wachbuch/route.ts'],
    ['Schlüsselquittung', 'src/app/api/sicherheit/schluessel/[id]/quittung/route.ts'],
    ['Qualitätsprüfung', 'src/app/api/qualitaet/pruefungen/route.ts'],
    ['Unterschrift', 'src/app/api/reinigung/leistungsnachweise/route.ts'],
  ])('%s nimmt es entgegen', (_name, datei) => {
    expect(readFileSync(datei, 'utf8')).toContain("daten.get('nachgetragen')");
  });

  it.each([
    ['Qualitätsprüfung', 'src/server/services/reinigung/qualitaet.ts'],
    ['Unterschrift', 'src/server/services/reinigung/leistungsnachweis.ts'],
    ['Wachbuch', 'src/server/services/security/wachbuch.ts'],
    ['Schlüsselquittung', 'src/server/services/security/schluessel.ts'],
  ])('%s schreibt es in die Spalte', (_name, datei) => {
    const quelle = readFileSync(datei, 'utf8');
    expect(quelle).toContain('nachgetragen');
    // Nicht nur gelesen: die Spalte steht in einer INSERT-Spaltenliste.
    expect(quelle).toMatch(/insert into[\s\S]{0,600}nachgetragen/u);
  });
});

describe('(2) es wird angekreuzt, nicht abgeleitet', () => {
  it('keine Seite rechnet es aus der Zeitabweichung aus', () => {
    /*
     * Die Versuchung liegt nahe, seit die Gerätezeit wirklich ankommt
     * (V-060): „Abweichung gross ⇒ nachgetragen". Das ist genau der Fehler,
     * den `0070` benennt — eine falsch gehende Uhr und ein später getippter
     * Eintrag sind zwei verschiedene Tatsachen.
     */
    const schuldig = alleSeiten(WURZEL).filter((d) => {
      const q = readFileSync(d, 'utf8');
      return /nachgetragen[^\n]{0,80}(zeitabweichung|abweichungSek|geraeteZeit)/iu.test(q);
    });
    expect(schuldig).toEqual([]);
  });

  it('und der Satz daneben sagt, was es bedeutet — in vier Sprachen', () => {
    for (const sprache of PORTAL_SPRACHEN) {
      const t = MEIN_TEXTE[sprache];
      expect(t.nachgetragen.trim()).not.toBe('');
      expect(t.nachgetragenHinweis.trim()).not.toBe('');
    }
    // Der deutsche Satz nennt beides: dass die Zeit die des Servers bleibt,
    // und dass sie nicht die Zeit des Vorgangs ist.
    expect(MEIN_TEXTE.de.nachgetragenHinweis).toMatch(/Servers/u);
  });
});
