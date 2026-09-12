import { describe, expect, it } from 'vitest';
import { familie, findeRoute } from '../../src/server/registry/routen.js';

/**
 * `[mandant]` darf keinen reservierten Namen schlucken.
 *
 * **Was passiert war.** Der Mustervergleich liess ein Parametersegment JEDES
 * konkrete Segment nehmen. `/portal/konto` traf damit auf `/portal/[mandant]`
 * — die Wurzel des Mandanten-Dashboards. Die Adresse wurde unter DEREN
 * Bedingung geprueft (`bericht.dashboard_lesen`) und mit DEREN Auskunft
 * beantwortet: „dieses Modul entsteht in Phase 3", ueber einer Seitenleiste
 * der Gesellschaft, in der man gerade stand. `familie()` wusste seit jeher,
 * dass `konto` keine Gesellschaft ist; der Mustervergleich wusste es nicht.
 *
 * **Warum das kein Anzeigefehler ist.** Eine Route unter der falschen Wache
 * kann zu eng oder zu weit stehen, und welches von beidem, entscheidet die
 * Rechtevergabe — nicht die Absicht. Hier fiel es auf, weil die Kopfzeile den
 * Punkt „Konto" anbietet; bei `/portal/kunde` haette es niemand gesehen.
 *
 * Die Prüfung laeuft ueber `familie()` und nicht ueber eine zweite Liste: so
 * kann ein fuenfter reservierter Name nicht in der einen stehen und in der
 * anderen fehlen.
 */
describe('reservierte Namen unter /portal/', () => {
  const RESERVIERT = ['gruppe', 'mein', 'kunde', 'konto'] as const;

  for (const name of RESERVIERT) {
    it(`\`${name}\` ist kein Mandantenslug`, () => {
      // Erst die Annahme selbst: `familie()` haelt den Namen fuer reserviert.
      expect(familie(`/portal/${name}`)).not.toBe('mandant');

      const treffer = findeRoute(`/portal/${name}`);
      // Entweder es gibt eine EIGENE Route dafuer — dann ist sie es auch —
      // oder gar keine. Was es nicht geben darf, ist `/portal/[mandant]`.
      expect(treffer?.pfad, `/portal/${name} traf auf ${treffer?.pfad ?? '—'}`)
        .not.toBe('/portal/[mandant]');
    });

    it(`\`${name}\` schluckt auch tiefer keine Mandantenroute`, () => {
      /*
       * Eine Ebene tiefer ist der Fall derselbe und faellt noch schlechter
       * auf: `/portal/konto/zeiten` sieht aus wie eine Zeitenseite und waere
       * die Zeitenseite EINER GESELLSCHAFT, nur ohne Gesellschaft.
       */
      const treffer = findeRoute(`/portal/${name}/zeiten`);
      expect(treffer?.pfad).not.toBe('/portal/[mandant]/zeiten');
    });
  }

  it('ein echter Mandantenslug trifft weiterhin', () => {
    // Die Gegenprobe: ohne sie liesse sich die Regel „nichts trifft je" nicht
    // von „die Regel wirkt" unterscheiden.
    expect(findeRoute('/portal/reinigung')?.pfad).toBe('/portal/[mandant]');
    expect(findeRoute('/portal/security/zeiten')?.pfad).toBe('/portal/[mandant]/zeiten');
  });
});
