import { describe, expect, it } from 'vitest';
import {
  GRUPPEN_NAVIGATION, KUNDEN_NAVIGATION, NAVIGATION,
} from '../../src/server/registry/navigation';
import { ROUTEN } from '../../src/server/registry/routen';
import { OHNE_MEHR, tableiste } from '../../src/server/registry/tableiste';

/**
 * Der dritte Navigationsbaum — und warum er keiner der anderen sein darf
 * (V-043, AUT-06).
 *
 * **Der Befund hatte zwei Hälften, und die zweite war die schlimmere.**
 *
 *  1. `KUNDEN_NAVIGATION` war vollständig gebaut und wurde von NICHTS
 *     gerendert: sechs fertige Kundenbereiche standen in keiner Leiste.
 *  2. Die Kundenleiste trägt sehr wohl ein `Mehr` — `OHNE_MEHR` führt nur
 *     `mitarbeiter` und `gruppe`. Das Blatt gab damit den **internen** Baum
 *     unter `/portal/kunde` aus. Ein Kundenkonto mit `objekt.lesen` sah dort
 *     Punkte, die auf 404 führen, und jeder davon verriet die Existenz
 *     dessen, was er nicht zeigen darf.
 *
 * Diese Datei hält beides fest: dass der Baum die richtigen Adressen nennt,
 * und dass er NICHT der interne ist.
 */

const muster = ROUTEN.map((r) => r.pfad.split('/').filter((t) => t !== ''));

function istRoute(adresse: string): boolean {
  const teile = adresse.split('/').filter((t) => t !== '');
  return muster.some((m) => m.length === teile.length
    && m.every((seg, i) => seg.startsWith('[') || seg === teile[i]));
}

describe('(1) jeder Kundenpunkt führt auf eine Route, die es gibt', () => {
  it('kein Punkt zeigt ins Leere', () => {
    const tot = KUNDEN_NAVIGATION
      .map((n) => `/portal/kunde${n.pfad === '' ? '' : `/${n.pfad}`}`)
      .filter((a) => !istRoute(a));
    expect(tot).toEqual([]);
  });

  it('und der Baum ist nicht leer — sonst prüft (1) nichts', () => {
    expect(KUNDEN_NAVIGATION.length).toBeGreaterThanOrEqual(10);
  });
});

describe('(2) der Kundenbaum ist NICHT der interne', () => {
  it('kein interner Pfad steht im Kundenbaum', () => {
    /*
     * Der eigentliche Fehler: `finanzen/rechnungen`, `qualitaet/reklamationen`
     * und `bau/projekte` gibt es unter `/portal/kunde` nicht. Ein Blatt, das
     * sie anbietet, ist ein Blatt voller 404.
     */
    const intern = new Set(NAVIGATION.map((n) => n.pfad));
    const ueberschneidung = KUNDEN_NAVIGATION
      .filter((n) => n.pfad !== '' && intern.has(n.pfad))
      .map((n) => n.pfad);
    /*
     * `auftraege` und `objekte` heissen in beiden Baeumen gleich und fuehren
     * in beiden auf eine echte Route — das ist erlaubt. Was NICHT vorkommen
     * darf, ist ein zusammengesetzter interner Pfad.
     */
    expect(ueberschneidung.filter((p) => p.includes('/'))).toEqual([]);
  });

  it('die Kundenleiste trägt ein `Mehr` — der Baum dahinter muss also stimmen', () => {
    /*
     * Diese Zeile ist der Grund, warum (2) keine Formalie ist. Stuende
     * `kunde` in `OHNE_MEHR`, waere der falsche Baum unsichtbar geblieben;
     * so war er es nicht.
     */
    expect(OHNE_MEHR).not.toContain('kunde');
    expect(tableiste('kunde').ziele.length).toBeGreaterThan(0);
  });
});

describe('(3) zwei Kundenrouten verlangen ZWEI Leserechte', () => {
  it('`rechnungen` und `nachweise` tragen ein `zusatzRecht`', () => {
    /*
     * `pruefeZugang` verknuepft die Leserechte einer Route mit UND. Ein
     * Punkt, der nur das erste prueft, fuehrte auf 404 — deshalb das
     * optionale Feld, und deshalb diese Zeile.
     */
    for (const schluessel of ['rechnungen', 'nachweise']) {
      const n = KUNDEN_NAVIGATION.find((e) => e.schluessel === schluessel);
      expect(n?.zusatzRecht, schluessel).toBeDefined();
    }
  });

  it('und jedes `zusatzRecht` steht auch im Register der Route', () => {
    for (const n of KUNDEN_NAVIGATION) {
      if (n.zusatzRecht === undefined) continue;
      const adresse = `/portal/kunde${n.pfad === '' ? '' : `/${n.pfad}`}`;
      const route = ROUTEN.find((r) => r.pfad === adresse);
      expect(route, adresse).toBeDefined();
      const lesen = route?.bewachung.art === 'recht' ? route.bewachung.lesen : [];
      expect(lesen, adresse).toContain(n.zusatzRecht);
      expect(lesen, adresse).toContain(n.recht);
    }
  });
});

describe('(4) die drei Bäume bleiben getrennt', () => {
  it('jeder Baum hat eindeutige Schlüssel', () => {
    for (const baum of [NAVIGATION, GRUPPEN_NAVIGATION, KUNDEN_NAVIGATION]) {
      const schluessel = baum.map((n) => n.schluessel);
      expect(new Set(schluessel).size).toBe(schluessel.length);
    }
  });
});
