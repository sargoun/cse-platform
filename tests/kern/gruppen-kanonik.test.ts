/**
 * Die drei kurzen Gruppenadressen und ihre EINE kanonische Adresse
 * (SEITENKARTE §2.1, §2.2).
 *
 * **Der Fehler, gegen den diese Datei steht, ist der stille.** `/news/<slug>`
 * und `/unternehmen/operations/news/<slug>` liefern dieselbe Zeile. §2.2 legt
 * fest, dass jede Meldung, jedes Projekt und jede Leistung GENAU EINE
 * kanonische Adresse hat, nämlich die unter `/unternehmen/<bereich>/`. Fehlt
 * `rel=canonical`, entsteht die Doppelung, wegen der die kurzen Adressen
 * einmal gelöscht worden sind — zwei indexierbare Fassungen eines Textes, die
 * sich im Suchergebnis gegenseitig verdrängen. Bemerken würde das niemand
 * ausser einer Suchmaschine, und die sagt es nicht.
 *
 * Geprüft wird deshalb ZWEIERLEI:
 *  1. die reine Funktion, die die kanonische Adresse rechnet, und
 *  2. dass alle sechs Seitendateien (drei Segmente, zwei Sprachen) sie wirklich
 *     benutzen — als QUELLTEXTPRÜFUNG, weil `generateMetadata` eine Anfrage
 *     und eine Datenbank braucht und eine Prüfung mit Attrappen nur sagt, dass
 *     die Attrappe funktioniert.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GRUPPEN_GESELLSCHAFT, kanonischerDetailpfad,
} from '../../src/app/(public)/_gruppe/kanonik.js';
import { ROUTEN, findeRoute } from '../../src/server/registry/routen.js';

const WURZEL = resolve(import.meta.dirname, '../..');

function quelle(pfad: string): string {
  return readFileSync(resolve(WURZEL, pfad), 'utf8');
}

describe('die kanonische Adresse zeigt auf die GESELLSCHAFT', () => {
  it('deutsch', () => {
    expect(kanonischerDetailpfad('news', 'zeiterfassung-nach-17-milog', 'de'))
      .toBe('/unternehmen/operations/news/zeiterfassung-nach-17-milog');
    expect(kanonischerDetailpfad('projekte', 'digitale-betriebsplattform', 'de'))
      .toBe('/unternehmen/operations/projekte/digitale-betriebsplattform');
  });

  it('englisch — mit Sprachpräfix, gleicher Pfad (D-82)', () => {
    expect(kanonischerDetailpfad('news', 'eine-meldung', 'en'))
      .toBe('/en/unternehmen/operations/news/eine-meldung');
  });

  it('sie zeigt NIE auf sich selbst', () => {
    // Genau das wäre die Doppelung: `canonical` auf die kurze Adresse gesetzt
    // erklärt beide Fassungen für eigenständig.
    for (const segment of ['news', 'projekte', 'leistungen'] as const) {
      expect(kanonischerDetailpfad(segment, 'x', 'de'))
        .not.toBe(`/${segment}/x`);
    }
  });

  it('die Gruppengesellschaft ist `operations` und steht an EINER Stelle', () => {
    // §2.2: „`/news/[slug]` exists only for items whose owning mandant is
    // `operations`". Ein zweiter Ort für diese Konstante wäre der, an dem
    // jemand `reinigung` einsetzt und es funktioniert.
    expect(GRUPPEN_GESELLSCHAFT).toBe('operations');
  });
});

describe('alle sechs Seitendateien setzen eine kanonische Adresse', () => {
  /** Die VIER, die auf die Gesellschaftsadresse zeigen; die beiden
   *  Leistungsseiten stehen darunter, weil ihre kanonische Adresse sie selbst
   *  ist. Vier plus zwei sind die sechs des Blocktitels. */
  const SEITEN = [
    'src/app/(public)/news/[slug]/page.tsx',
    'src/app/(public)/en/news/[slug]/page.tsx',
    'src/app/(public)/projekte/[slug]/page.tsx',
    'src/app/(public)/en/projekte/[slug]/page.tsx',
  ] as const;

  it.each(SEITEN)('%s ruft `gruppenDetailMetadaten`', (pfad) => {
    const text = quelle(pfad);
    expect(text).toContain('generateMetadata');
    expect(text).toContain('gruppenDetailMetadaten');
  });

  /**
   * **`/leistungen/[slug]` ist die Ausnahme, und sie ist begründet.**
   *
   * Eine Leistungsseite ist eine EIGENE redaktionelle Seite mit eigener
   * `seite`-Zeile je Sprache — keine zweite Fassung einer
   * Gesellschaftsseite. Ihre kanonische Adresse ist sie selbst, und
   * `metadatenFuer` setzt sie samt `hreflang`-Paaren. Ein
   * Fremd-`canonical` hier hiesse, eine Seite für eine Kopie zu erklären, die
   * es nicht gibt.
   */
  it.each([
    'src/app/(public)/leistungen/[slug]/page.tsx',
    'src/app/(public)/en/leistungen/[slug]/page.tsx',
  ])('%s setzt `canonical` über `metadatenFuer` auf sich selbst', (pfad) => {
    const text = quelle(pfad);
    expect(text).toContain('metadatenFuer');
    expect(text).not.toContain('gruppenDetailMetadaten');
  });
});

describe('die drei Routen stehen in der Karte und sind nicht mehr offen', () => {
  it.each(['/leistungen/[slug]', '/news/[slug]', '/projekte/[slug]'])(
    '%s steht im Register', (pfad) => {
      expect(ROUTEN.some((r) => r.pfad === pfad), pfad).toBe(true);
    },
  );

  it('und eine konkrete Adresse findet ihre Route', () => {
    expect(findeRoute('/news/zeiterfassung-nach-17-milog')?.pfad).toBe('/news/[slug]');
    expect(findeRoute('/projekte/digitale-betriebsplattform')?.pfad).toBe('/projekte/[slug]');
    expect(findeRoute('/leistungen/unterhaltsreinigung')?.pfad).toBe('/leistungen/[slug]');
  });

  it('ein Segment zu viel passt nicht — Muster sind keine Präfixe', () => {
    expect(findeRoute('/news/eine-meldung/bearbeiten')).toBeUndefined();
  });
});
