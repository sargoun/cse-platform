/**
 * `?vermerkt=` auf dem Radar-Vorgangsblatt: nur ein Stand, den die
 * Vorgangsroute setzt — nie Text aus der Adresse (V-232, V-271, D-647 Nr. 7,
 * D-733 Nr. 3).
 *
 * **Der Befund.** Das Blatt schrieb den Wert über `beschriftung()`, deren
 * lesbarer Rückfall für einen neuen Enum-Wert aus der Datenbank gedacht ist.
 * `/radar/<id>?vermerkt=Zuschlag_an_uns` stand damit im grünen Kasten als
 * „Vermerkt. Der Stand dieser Bekanntmachung ist jetzt „Zuschlag an uns"" —
 * eine Erfolgsmeldung, die ein Verweis fälschen konnte.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { vermerkterStand } from '../../src/app/portal/[mandant]/radar/[id]/vermerkt.js';
import { SETZBAR } from '../../src/server/services/radar/vorgang.js';

describe('vermerkterStand — nur, was die Route nach einem Erfolg schreibt', () => {
  it('die drei setzbaren Stände als Wort', () => {
    expect(vermerkterStand('geprueft')).toBe('geprüft');
    expect(vermerkterStand('in_bearbeitung')).toBe('in Bearbeitung');
    expect(vermerkterStand('verworfen')).toBe('verworfen');
    for (const stand of SETZBAR) expect(vermerkterStand(stand), stand).not.toMatch(/_/u);
  });

  it('alles andere: kein Kasten — auch ein bekannter Stand, den man hier nicht setzt', () => {
    for (const roh of [
      'Zuschlag_an_uns', 'zuschlag', 'eingereicht', 'neu', 'toString', '__proto__', '',
      'geprueft ', 'GEPRUEFT', ['geprueft'], undefined, null,
    ]) {
      expect(vermerkterStand(roh), JSON.stringify(roh) ?? 'undefined').toBeNull();
    }
  });
});

describe('das Blatt schreibt nur, was die Funktion liefert', () => {
  const seite = readFileSync('src/app/portal/[mandant]/radar/[id]/page.tsx', 'utf8');

  it('der Wert aus der Adresse geht durch vermerkterStand, nicht durch beschriftung', () => {
    expect(seite).toContain("vermerkterStand(suche['vermerkt'])");
    expect(seite).not.toMatch(/beschriftung\(AUSSCHREIBUNG_STATUS_TEXT, vermerkt\)/u);
  });
});
