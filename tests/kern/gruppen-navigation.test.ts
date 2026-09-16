/**
 * Die Gruppennavigation zeigt auf Seiten, die es gibt (TEN-05, AUT-06).
 *
 * **Der Befund, den dieser Test festhält.** `GRUPPEN_NAVIGATION` war
 * `NAVIGATION.filter((n) => n.gruppe)` — die MANDANTEN-Module mit ihren
 * Mandantenpfaden, ausgegeben unter `/portal/gruppe`. Von vierzehn so
 * entstandenen Zielen führten **elf auf 404**: `dienstplan/woche`, `zeiten`,
 * `personal/anstellungen`, `angebote`, `finanzen/rechnungen`, `bau/projekte`,
 * `reinigung/reviere`, `qualitaet/reklamationen`, `social` und zwei weitere
 * Finanzpfade gibt es dort nicht.
 *
 * Und die Rechte waren die falschen dazu: die Gruppenrouten verlangen
 * `gruppe.objekt.lesen` und Geschwister, nicht `objekt.lesen`.
 *
 * Ein Menüpunkt, der auf 404 führt, ist schlechter als keiner — er verrät die
 * Existenz dessen, was er nicht zeigen darf. Dass jeder Punkt trägt, ist
 * deshalb keine Sorgfaltsfrage, sondern eine Eigenschaft, die geprüft gehört.
 */
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GRUPPEN_NAVIGATION, NAVIGATION } from '../../src/server/registry/navigation.js';
import { ROUTEN as SEITEN } from '../../src/server/registry/routen.generiert.js';
import { KATALOG } from '../../src/server/auth/katalog.generiert.js';

const GRUPPENROUTEN = new Set(
  SEITEN.map((r) => r.pfad).filter((p) => p.startsWith('/portal/gruppe')));

describe('jedes Gruppenziel hat eine Route UND eine Seite', () => {
  for (const n of GRUPPEN_NAVIGATION) {
    const pfad = n.pfad === '' ? '/portal/gruppe' : `/portal/gruppe/${n.pfad}`;
    it(`${n.schluessel} → ${pfad}`, () => {
      expect(GRUPPENROUTEN.has(pfad), `${pfad} steht in keiner Manifestzeile`).toBe(true);
      const datei = `src/app${pfad}/page.tsx`;
      expect(existsSync(datei), `${datei} fehlt — der Punkt führt auf 404`).toBe(true);
    });
  }

  it('die Liste ist nicht leer und nicht aus NAVIGATION abgeleitet', () => {
    /*
     * Der eigentliche Fehler war die ABLEITUNG, nicht der einzelne falsche
     * Pfad: eine Gruppenseite fasst vier Gesellschaften zusammen und ist
     * deshalb eine andere Seite, nicht dieselbe mit mehr Zeilen. Fällt jemand
     * auf den Filter zurück, fallen die Fälle oben um — und dieser hier sagt,
     * warum.
     */
    expect(GRUPPEN_NAVIGATION.length).toBeGreaterThan(8);
    const mandantenpfade = new Set(NAVIGATION.map((n) => n.pfad));
    const geerbt = GRUPPEN_NAVIGATION
      .filter((n) => n.pfad !== '' && mandantenpfade.has(n.pfad) && n.pfad.includes('/'));
    expect(geerbt.map((n) => n.pfad)).toEqual([]);
  });
});

describe('jedes Gruppenziel verlangt ein GRUPPEN-Recht', () => {
  it('jedes `recht` beginnt mit `gruppe.`', () => {
    /*
     * `app.hat_recht('objekt.lesen', m)` beantwortet im Gruppen-Scope eine
     * andere Frage als `gruppe.objekt.lesen` (0004/0009). Wer nur die
     * Gruppenrechte hält — das Publikum, für das TEN-05 diese Ansicht gebaut
     * hat — sah mit den Mandantenrechten eine leere Schiene.
     */
    const fremd = GRUPPEN_NAVIGATION.filter((n) => !n.recht.startsWith('gruppe.'));
    expect(fremd.map((n) => `${n.schluessel}: ${n.recht}`)).toEqual([]);
  });

  it('und jedes davon steht im Rechtekatalog (K-19)', () => {
    const katalog = new Set(KATALOG.map((k) => k.schluessel));
    const unbekannt = GRUPPEN_NAVIGATION
      .map((n) => n.recht).filter((r) => !katalog.has(r));
    expect(unbekannt).toEqual([]);
  });

  it('das Recht der Route und das Recht des Punktes sind dasselbe', () => {
    /*
     * Ein Punkt, der ein anderes Recht prüft als seine Seite, ist entweder
     * ein unsichtbarer Punkt oder ein 404 — je nachdem, welches der beiden
     * strenger ist. Beides fällt erst im Betrieb auf.
     */
    for (const n of GRUPPEN_NAVIGATION) {
      const pfad = n.pfad === '' ? '/portal/gruppe' : `/portal/gruppe/${n.pfad}`;
      const route = SEITEN.find((r) => r.pfad === pfad);
      const bewachung = route?.bewachung;
      if (bewachung === undefined || bewachung.art !== 'recht') continue;
      expect(bewachung.lesen, `${pfad}`).toContain(n.recht);
    }
  });
});
