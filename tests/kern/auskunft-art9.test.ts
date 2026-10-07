/**
 * Die Art.-15-Auskunft mit Stundensatz und — auf Mitgabe — der Art der
 * Abwesenheiten (V-332, O-642, O-643, D-855): was ohne Datenbank entschieden
 * wird. Was die Datenbank hält, steht in
 * `tests/isolation/auskunft-entgelt-art9.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ABDECKUNG, ART9_ZURUECKGEHALTEN, alsMarkdown, geldText, type Auskunft,
} from '../../src/server/services/datenschutz/auskunft.js';
import { cent, formatiereGeld } from '../../src/server/services/finanz/geld.js';

describe('(1) Geld in der Auskunft — ganze Cent, als Euro angezeigt', () => {
  it('eine Ziffernfolge aus der Datenbank wird Euro, nichts sonst', () => {
    expect(geldText('1575')).toBe(formatiereGeld(cent(1575n)));
    expect(geldText(1450n)).toBe(formatiereGeld(cent(1450n)));
    expect(geldText(null)).toBe('—');
    expect(geldText('')).toBe('—');
    // Kein Betrag, kein Rechnen: was keine ganze Zahl ist, bleibt Text.
    expect(geldText('12.50')).toBe('12.50');
  });
});

describe('(2) der nicht mitgegebene Abschnitt steht in der Datei — als Satz', () => {
  const auskunft: Auskunft = {
    mandantId: '00000000-0000-0000-0000-000000000001',
    firma: 'CSE Dienstleistungen GmbH',
    anfrageId: '00000000-0000-0000-0000-000000000002',
    art: 'auskunft',
    betroffener: { art: 'person', id: 'x', name: 'Fatima Yildiz', pfad: null },
    abschnitte: [{
      schluessel: 'abwesenheitsgrund', titel: 'Art der Abwesenheiten (Art. 9 DSGVO)',
      zweck: 'Abwesenheiten', quelle: 'abwesenheit', frist: '3 Jahre',
      recht: 'zeit.abwesenheit_grund_lesen', leseweg: 'definer', gesperrt: false,
      offen: null, zurueckgehalten: ART9_ZURUECKGEHALTEN, kopf: [], zeilen: [],
    }],
    fehlendeRechte: [], offeneFristen: [], vollstaendig: true, art9Mitgegeben: false,
    zeilen: 0, sha256: 'a'.repeat(64), erstelltAm: '07.10.2026, 23:30 MESZ',
  };

  it('die Datei sagt „nicht mitgegeben" — und keine leere Tabelle, kein „nichts gespeichert"', () => {
    const md = alsMarkdown(auskunft);
    expect(md).toContain(ART9_ZURUECKGEHALTEN);
    expect(md).not.toContain('Keine Zeile');
    expect(md).not.toContain('Gesperrt');
  });
});

describe('(3) Verdrahtung', () => {
  it('Abdeckung, Migration, Route und Seite', () => {
    expect(ABDECKUNG.has('anstellung_kondition')).toBe(true);
    const m = readFileSync('drizzle/0538_auskunft_entgelt_abwesenheitsart.sql', 'utf8');
    expect(m).toContain("app.hat_recht('personal.entgelt_lesen', v_mandant)");
    expect(m).toContain("app.hat_recht('zeit.abwesenheit_grund_lesen', v_mandant)");
    expect(m.match(/app\.hat_recht\('datenschutz\.auskunft_erstellen', v_mandant\)/gu)).toHaveLength(2);
    expect(m.match(/owner to cse_definer/gu)).toHaveLength(2);
    const dienst = readFileSync('src/server/services/datenschutz/auskunft.ts', 'utf8');
    expect(dienst).toContain('// TODO(client, O-642): Voreinstellung');
    expect(dienst).toContain('// TODO(client, O-643): Voreinstellung');
    const route = readFileSync('src/app/api/datenschutz/auskunft/route.ts', 'utf8');
    expect(route).toContain("{ art9: p.get('art9') === 'mitgeben' }");
    const seite = readFileSync('src/app/portal/[mandant]/datenschutz/[id]/auskunft/page.tsx', 'utf8');
    expect(seite).toContain("'&art9=mitgeben'");
  });
});
