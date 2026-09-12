/**
 * Der Modulriegel (D-377) — die Regel selbst, ohne Datenbank.
 *
 * Was hier geprueft wird, ist die Entscheidung „Recht UND Buchung"; dass sie
 * in Sidebar, Tab-Leiste und Seite auch ANGEWANDT wird, prueft
 * `tests/isolation/modulriegel.test.ts` gegen echtes Postgres. Beides
 * zusammen, denn eine richtige Regel, die niemand aufruft, ist der Fehler,
 * den dieser Zweig schon einmal gemacht hat.
 */
import { describe, expect, it } from 'vitest';
import {
  GEWERKE, GEWERK_FUER_MODUL, QUERSCHNITT, modulAktiv, modulFuerRecht,
  type Modulbuchung,
} from '../../src/server/registry/module.js';
import { NAVIGATION } from '../../src/server/registry/navigation.js';

/** Eine EINGETRAGENE Buchung — der Normalfall nach dem Seed (0103). */
const gebucht = (module: readonly string[]): Modulbuchung => ({ module, gepflegt: true });

describe('welches Modul ein Recht traegt', () => {
  it('ist der erste Abschnitt des Schluessels — wie in 0008', () => {
    expect(modulFuerRecht('reinigung.lesen')).toBe('reinigung');
    expect(modulFuerRecht('security.schreiben')).toBe('security');
    expect(modulFuerRecht('bericht.dashboard_lesen')).toBe('bericht');
    // Ein Schluessel ohne Punkt ist selbst das Modul.
    expect(modulFuerRecht('system')).toBe('system');
  });
});

describe('die Buchung entscheidet, nicht die Rolle', () => {
  it('der Hochbau sieht die Reinigung nicht — der Befund des Mandanten', () => {
    expect(modulAktiv(gebucht(['bau']), 'reinigung.lesen')).toBe(false);
    expect(modulAktiv(gebucht(['bau']), 'security.lesen')).toBe(false);
    expect(modulAktiv(gebucht(['bau']), 'wachbuch.lesen')).toBe(false);
    expect(modulAktiv(gebucht(['bau']), 'schluessel.lesen')).toBe(false);
    expect(modulAktiv(gebucht(['bau']), 'dienstanweisung.lesen')).toBe(false);
  });

  it('und sein eigenes Gewerk sehr wohl', () => {
    expect(modulAktiv(gebucht(['bau']), 'bau.lesen')).toBe(true);
  });

  /**
   * `wachbuch`, `dienstanweisung` und `schluessel` sind eigene Rechtemodule,
   * aber kein eigenes Gewerk. Ohne diese Zuordnung koennte die Wache ihr
   * eigenes Buch nicht fuehren, obwohl die Gesellschaft Security gebucht hat.
   */
  it('wer Security bucht, bucht Wachbuch, Dienstanweisung und Schluessel mit', () => {
    for (const recht of ['security.lesen', 'wachbuch.schreiben',
      'dienstanweisung.lesen', 'schluessel.lesen']) {
      expect(modulAktiv(gebucht(['security']), recht), recht).toBe(true);
    }
  });

  it('Querschnittsmodule braucht niemand zu buchen', () => {
    for (const recht of ['zeit.lesen', 'dienstplan.lesen', 'finanzen.lesen',
      'personal.lesen', 'objekt.lesen', 'dokument.lesen', 'qualitaet.lesen',
      'bericht.dashboard_lesen', 'system.einstellung_lesen']) {
      expect(modulAktiv(gebucht([]), recht), recht).toBe(true);
      expect(modulAktiv(gebucht(['bau']), recht), recht).toBe(true);
    }
  });

  /**
   * **„Kein Gewerk gebucht" und „noch nicht eingetragen" sind zwei Aussagen**
   * — und eine leere Liste konnte nur eine davon machen (0103).
   *
   * Nicht eingetragen filtert nichts: sonst machte ein vergessener Eintrag
   * beim Anlegen einer Gesellschaft aus einem Datenfehler einen
   * Totalausfall. Eingetragen und leer heisst dagegen: kein Gewerk — das ist
   * CSE Operations, die Gruppensteuerung.
   */
  it('nicht eingetragen filtert NICHT', () => {
    for (const recht of ['reinigung.lesen', 'security.lesen', 'bau.lesen']) {
      expect(modulAktiv({ module: [], gepflegt: false }, recht), recht).toBe(true);
    }
  });

  it('eingetragen und leer heisst KEIN Gewerk — CSE Operations', () => {
    for (const recht of ['reinigung.lesen', 'security.lesen', 'bau.lesen',
      'wachbuch.lesen', 'schluessel.lesen']) {
      expect(modulAktiv(gebucht([]), recht), recht).toBe(false);
    }
    // Und der Betrieb bleibt ihr: sie fuehrt die Gruppe, nicht ein Gewerk.
    for (const recht of ['bericht.dashboard_lesen', 'crm.lesen', 'finanzen.lesen',
      'dokument.lesen', 'personal.lesen']) {
      expect(modulAktiv(gebucht([]), recht), recht).toBe(true);
    }
  });

  it('ein unbekanntes Modul bleibt offen, statt still zu verschwinden', () => {
    expect(modulAktiv(gebucht(['bau']), 'gartenbau.lesen')).toBe(true);
  });
});

describe('die Tabellen bleiben zueinander vollstaendig', () => {
  /**
   * Die Wache gegen das naechste Gewerk: wer eines ergaenzt, ohne es
   * einzuordnen, bekaeme sonst ein Modul, das in JEDER Gesellschaft sichtbar
   * ist — und faende den Grund nie, weil nichts rot wird.
   */
  it('jedes Recht der Navigation ist entweder Querschnitt oder einem Gewerk zugeordnet',
    () => {
      const unklar = NAVIGATION
        .map((n) => modulFuerRecht(n.recht))
        .filter((m) => !QUERSCHNITT.has(m) && GEWERK_FUER_MODUL[m] === undefined);
      expect([...new Set(unklar)]).toEqual([]);
    });

  it('jedes zugeordnete Gewerk gibt es auch', () => {
    for (const gewerk of Object.values(GEWERK_FUER_MODUL)) {
      expect(GEWERKE, gewerk).toContain(gewerk);
    }
  });

  it('und die Gegenprobe: die Navigation fuehrt ueberhaupt Gewerkpunkte', () => {
    const gewerkpunkte = NAVIGATION.filter(
      (n) => GEWERK_FUER_MODUL[modulFuerRecht(n.recht)] !== undefined);
    // Reinigung, Security, Bau, Dienstanweisungen, Schluessel.
    expect(gewerkpunkte.length).toBeGreaterThanOrEqual(5);
  });
});
