/**
 * V-212 — ein DATEV-Stapel umfasst höchstens ein Wirtschaftsjahr.
 *
 * Das Belegdatum steht im Stapel als `TTMM`; das Jahr kommt aus dem
 * WJ-Beginn im Kopf. Ein Zeitraum über die WJ-Grenze schriebe eine Buchung
 * in das falsche Jahr. Gegen die Datenbank (Dienst und Pruefbedingung 0445)
 * prüft `tests/isolation/datev-export.test.ts`; hier steht die Rechnung.
 */
import { describe, expect, it } from 'vitest';
import {
  ExportFehler, pruefeEinWirtschaftsjahr, wirtschaftsjahrGrenzeIm,
} from '../../src/server/services/buchhaltung/datev/export.js';

describe('wirtschaftsjahrGrenzeIm', () => {
  it('Kalender-WJ: Dezember bis Januar überschreitet den 1. Januar', () => {
    expect(wirtschaftsjahrGrenzeIm('2025-12-01', '2026-01-31', 1, 1)).toBe('2026-01-01');
  });

  it('Kalender-WJ: ein Monat, ein Jahr — keine Grenze', () => {
    expect(wirtschaftsjahrGrenzeIm('2026-08-01', '2026-08-31', 1, 1)).toBeNull();
    expect(wirtschaftsjahrGrenzeIm('2026-01-01', '2026-12-31', 1, 1)).toBeNull();
  });

  it('abweichendes WJ ab 1. Juli: Dezember bis Januar bleibt in einem WJ', () => {
    expect(wirtschaftsjahrGrenzeIm('2025-12-01', '2026-01-31', 7, 1)).toBeNull();
  });

  it('abweichendes WJ ab 1. Juli: Juni bis Juli überschreitet den 1. Juli', () => {
    expect(wirtschaftsjahrGrenzeIm('2026-06-15', '2026-07-15', 7, 1)).toBe('2026-07-01');
  });

  it('der erste Tag des WJ gehört zum neuen, der Vortag zum alten', () => {
    expect(wirtschaftsjahrGrenzeIm('2026-07-01', '2026-07-01', 7, 1)).toBeNull();
    expect(wirtschaftsjahrGrenzeIm('2026-06-30', '2026-07-01', 7, 1)).toBe('2026-07-01');
  });
});

describe('pruefeEinWirtschaftsjahr', () => {
  it('wirft mit Grund und einem Satz in der Hausschreibweise', () => {
    let fehler: unknown = null;
    try {
      pruefeEinWirtschaftsjahr('2025-12-01', '2026-01-31', 1, 1);
    } catch (e) {
      fehler = e;
    }
    expect(fehler).toBeInstanceOf(ExportFehler);
    expect((fehler as ExportFehler).grund).toBe('wirtschaftsjahr');
    expect((fehler as ExportFehler).message).toContain('01.01.2026');
    expect((fehler as ExportFehler).message).toContain('01.12.2025 bis 31.01.2026');
  });

  it('lässt einen Zeitraum in einem Wirtschaftsjahr durch', () => {
    expect(() => pruefeEinWirtschaftsjahr('2026-08-01', '2026-08-31', 1, 1)).not.toThrow();
  });
});
