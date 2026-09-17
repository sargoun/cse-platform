/**
 * Zwei öffentliche Wege, zwei Zusicherungen, die beide leicht wegfallen.
 *
 *  1. **`/leistungen/<slug>` nimmt nur Slugs, die eine `seite`-Zeile treffen
 *     KÖNNEN.** `seite.pfad` trägt `CHECK (pfad ~ '^/[a-z0-9/-]*$')`; ein
 *     Slug mit Grossbuchstaben, Punkt oder Schrägstrich kann keine Zeile
 *     treffen. Ihn trotzdem in eine Abfrage zu geben heisst, auf eine leere
 *     Antwort zu warten, statt sofort 404 zu sagen — und eine leere Seite
 *     sieht aus wie „noch nicht fertig" und wird indexiert.
 *
 *  2. **`/werbewiderspruch/` ist gesperrt.** `04-SEITENKARTE.md` §2.5 verlangt
 *     es ausdrücklich, und `AUSGESCHLOSSEN` hielt nur vier der fünf Präfixe.
 *     Das war kein Schönheitsfehler: unter `/werbewiderspruch/<token>` liegen
 *     Adressen, die ein Trägergeheimnis TRAGEN. Ein Crawler, der ihnen folgt,
 *     macht den Widerspruch eines Fremden auffindbar; und weil dieselbe
 *     Konstante der Sitemap-Filter ist, war die Fläche als gesperrt
 *     beschrieben und in beiden Richtungen offen.
 */
import { describe, expect, it } from 'vitest';
import { leistungsPfad } from '../../src/app/(public)/_gruppe/LeistungSlug.js';
import { AUSGESCHLOSSEN, istAusgeschlossen }
  from '../../src/server/services/inhalt/sitemap.js';

describe('der Pfad einer Leistungsseite', () => {
  it('ein gewöhnlicher Slug ergibt den Pfad', () => {
    expect(leistungsPfad('unterhaltsreinigung')).toBe('/leistungen/unterhaltsreinigung');
    expect(leistungsPfad('glas-und-rahmenreinigung'))
      .toBe('/leistungen/glas-und-rahmenreinigung');
  });

  it('alles, was keine `seite`-Zeile treffen kann, ist `null` — also 404', () => {
    for (const krumm of [
      'Unterhaltsreinigung',      // Grossbuchstabe
      'unterhalts_reinigung',     // Unterstrich
      'unterhalts.reinigung',     // Punkt
      'unterhalts/reinigung',     // zweites Segment
      '-fuehrend',                // Bindestrich am Anfang
      'endet-',                   // Bindestrich am Ende
      'doppel--strich',           // zwei Striche
      '',                         // leer
      '../datenschutz',           // Ausbruchsversuch
    ]) {
      expect(leistungsPfad(krumm), krumm).toBeNull();
    }
  });

  it('ein gesperrtes Präfix kommt nicht durch', () => {
    // Es gibt keine `seite`-Zeile unter `/leistungen/api`, aber die Prüfung
    // steht hier, damit sie auch dann hält, wenn `AUSGESCHLOSSEN` wächst.
    expect(leistungsPfad('api')).toBe('/leistungen/api');
    // `istAusgeschlossen` prüft das PRÄFIX des ganzen Pfades, und der beginnt
    // mit `/leistungen` — ein Slug namens `api` ist deshalb erlaubt und
    // trifft einfach keine Zeile. Das ist die richtige Trennung: die
    // Sperrliste sperrt Flächen, keine Wörter.
    expect(istAusgeschlossen('/leistungen/api')).toBe(false);
  });
});

describe('die Sperrliste der öffentlichen Flächen', () => {
  it('führt alle fünf Präfixe, die die Karte nennt', () => {
    for (const p of ['/api', '/portal', '/auth', '/check-in', '/werbewiderspruch']) {
      expect(AUSGESCHLOSSEN, p).toContain(p);
    }
  });

  it('`/werbewiderspruch/<token>` ist ausgeschlossen — Fläche UND Wurzel', () => {
    expect(istAusgeschlossen('/werbewiderspruch')).toBe(true);
    expect(istAusgeschlossen('/werbewiderspruch/abc123')).toBe(true);
  });

  it('und eine Adresse, die nur so ANFÄNGT, ist es nicht', () => {
    // `startsWith('/werbewiderspruch/')` und nicht `startsWith('/werbewiderspruch')`:
    // sonst fiele eine künftige Seite `/werbewiderspruch-info` mit hinein.
    expect(istAusgeschlossen('/werbewiderspruch-info')).toBe(false);
  });

  it('die öffentlichen Detailwege bleiben in der Sitemap erlaubt', () => {
    expect(istAusgeschlossen('/unternehmen/operations/news/eine-meldung')).toBe(false);
    expect(istAusgeschlossen('/leistungen/unterhaltsreinigung')).toBe(false);
  });
});
