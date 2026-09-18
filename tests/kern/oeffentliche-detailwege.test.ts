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
import { istLeistungsseite } from '../../src/server/inhalt/seiten-daten.js';
import { beitragSegment, NEUIGKEITS_ARTEN }
  from '../../src/server/services/social/dienst.js';
import { seitenService } from '../../src/server/services/inhalt/jsonld.js';
import { LEISTUNGSSEITEN } from '../../src/server/db/seed/inhalt.js';
import { LEISTUNGSSEITEN_EN } from '../../src/server/db/seed/inhalt-en.js';
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

/**
 * **Der Bestand, ohne den die Route nie läuft.**
 *
 * `/leistungen/[slug]` hatte keine einzige `seite`-Zeile und antwortete
 * deshalb für jeden Slug 404 — mit der Folge, dass `istLeistungsseite()`, die
 * `besitzer`-Abfrage in `seiten-daten.ts` und der `Service`-Block aus
 * `seitenService()` zur Laufzeit nie ausgeführt wurden. Fertig gemeldet und
 * ungesehen ist der schlechteste Zustand, den Code haben kann.
 *
 * Geprüft wird deshalb der SCHLUSS der Kette, nicht eine Attrappe davon: der
 * Pfad jeder Demo-Zeile muss durch `leistungsPfad()` gehen UND von
 * `istLeistungsseite()` erkannt werden, in beiden Sprachen.
 */
describe('die Leistungsseiten des Demonstrationsbestands', () => {
  it('es gibt mindestens eine, in beiden Sprachen unter demselben Pfad (D-82)', () => {
    expect(LEISTUNGSSEITEN.length).toBeGreaterThan(0);
    expect(LEISTUNGSSEITEN_EN.map((s) => s.pfad))
      .toEqual(LEISTUNGSSEITEN.map((s) => s.pfad));
  });

  it.each(LEISTUNGSSEITEN.map((s) => s.pfad))(
    '%s trifft die Route und gilt als Leistungsseite', (pfad) => {
      const slug = pfad.slice('/leistungen/'.length);
      expect(leistungsPfad(slug)).toBe(pfad);
      expect(istLeistungsseite(pfad)).toBe(true);
      // Und die englische Adresse, die dieselbe Zeile in `sprache='en'` liest.
      expect(istLeistungsseite(`/en${pfad}`)).toBe(true);
    },
  );

  it('sie nennt keine Gesellschaft als Anbieter, solange O-652 offen ist', () => {
    /*
     * `mandant_id` bleibt NULL, also liefert die `besitzer`-Abfrage `null`,
     * also bleibt `provider` weg. Ein `provider` auf ein Dach, das es als
     * Rechtsträger nicht gibt, wäre eine falsche Aussage in strukturierten
     * Daten — und sähe vollständig aus.
     */
    const ohne = seitenService('Unterhaltsreinigung', 'Wiederkehrende Reinigung.',
                               'https://example.test', null);
    expect(ohne['provider']).toBeUndefined();
    expect(ohne['@type']).toBe('Service');

    // Und sobald jemand entscheidet, trägt derselbe Block ihn — die Frage ist
    // die Redaktion, nicht der Code.
    const mit = seitenService('Unterhaltsreinigung', null,
                              'https://example.test', 'reinigung');
    expect(mit['provider'])
      .toEqual({ '@id': 'https://example.test/unternehmen/reinigung#unternehmen' });
  });
});

/**
 * **Zwei Adressen fuer eine Zeile, und genau eine ist die kanonische.**
 *
 * `/unternehmen/<b>/news/<slug>` und `/unternehmen/<b>/beitraege/<slug>`
 * liefern dieselbe `beitrag`-Zeile — `oeffentlicherBeitragNachSlug` kennt
 * keinen Artenfilter. Die Sitemap meldete einmal nur `neuigkeit` und
 * `aktualisierung` unter `/news/` und liess die anderen zwei Arten ganz weg;
 * die beiden Detailseiten setzten gar kein `canonical`. Beides zusammen
 * ergibt die Doppelung, wegen der die kurzen Gesellschaftsadressen einmal
 * geloescht worden sind (SEITENKARTE §2.2, §2.5).
 *
 * Geprueft wird die EINE Funktion, die beide Seiten der Sache fragen — die
 * Sitemap-SQL ueber `NEUIGKEITS_ARTEN` als Parameter, `beitragsMetadaten()`
 * ueber `beitragSegment()` direkt.
 */
describe('das kanonische Segment eines Beitrags', () => {
  it('ankuendigende Arten gehen auf /news/, alles andere auf /beitraege/', () => {
    expect(beitragSegment('neuigkeit')).toBe('news');
    expect(beitragSegment('aktualisierung')).toBe('news');
    expect(beitragSegment('beitrag')).toBe('beitraege');
    expect(beitragSegment('projektschau')).toBe('beitraege');
  });

  it('jede der VIER Arten des Enums bekommt ein Segment — keine faellt weg', () => {
    // Die Liste ist die von `beitrag_art` (0170). Ein Filter statt einer
    // Abbildung liess zwei davon sitemaplos; eine Abbildung kann das nicht.
    for (const art of ['beitrag', 'projektschau', 'neuigkeit', 'aktualisierung']) {
      expect(['news', 'beitraege'], art).toContain(beitragSegment(art));
    }
  });

  it('und die Grenze ist genau `NEUIGKEITS_ARTEN`, nicht eine zweite Liste', () => {
    for (const art of NEUIGKEITS_ARTEN) expect(beitragSegment(art)).toBe('news');
  });
});
