/**
 * PR 16 Akzeptanz (3) — `LocalBusiness`, `Service` und `FAQPage` je Bereich.
 *
 * Geprueft wird gegen die Formpruefung, die auch beim Rendern laeuft. Das ist
 * der Punkt: `pruefeJsonLd` ist nicht Zierde in einer Komponente, sondern die
 * Bedingung, unter der ein Block ueberhaupt ausgeliefert wird — und derselbe
 * Massstab entscheidet hier und dort.
 */
import { describe, expect, it } from 'vitest';
import {
  breadcrumb, faqAus, faqPage, JsonLdFehler, leistungenAus, localBusiness,
  localBusinessId, organisation, pruefeJsonLd, seitenService, services, webSite,
  type BereichsQuelle,
} from '../../src/server/services/inhalt/jsonld.js';

const BASIS = 'https://beispiel.test';

/** Die vier Bereiche, mit der Anschrift, die der Seed setzt. */
const BEREICHE: readonly BereichsQuelle[] = [
  ['reinigung', 'CSE Dienstleistungen GmbH'],
  ['security', 'Select Security Event GmbH'],
  ['bau', 'REALTIME Service GmbH'],
  ['operations', 'CSE Operations'],
].map(([slug, firma]) => ({
  slug: slug!,
  mandant: {
    firma: firma!, strasse: 'Kurfürstendamm 21', plz: '10719', ort: 'Berlin',
    land: 'DE', telefon: '+49 30 555 0100', email: `kontakt@${slug!}.cse-gruppe.de`,
  },
}));

describe('(3) je Bereich: LocalBusiness, Service und FAQPage halten der Form stand', () => {
  it.each(BEREICHE.map((b) => [b.slug, b] as const))(
    'LocalBusiness für %s', (_slug, bereich) => {
      const block = localBusiness(bereich, BASIS);
      expect(() => pruefeJsonLd(block)).not.toThrow();
      // Der `@id` ist der Anker, auf den `Service.provider` zeigt. Ohne ihn
      // haengt die Leistung an niemandem.
      expect(block['@id']).toBe(localBusinessId(BASIS, bereich.slug));
    },
  );

  it.each(BEREICHE.map((b) => [b.slug, b] as const))(
    'Service für %s zeigt auf genau dieses Unternehmen', (_slug, bereich) => {
      const bloecke = services(bereich, BASIS, [
        { name: 'Unterhaltsreinigung', beschreibung: 'Wiederkehrend, nach Leistungsverzeichnis.' },
        { name: 'Glasreinigung' },
      ]);
      expect(bloecke).not.toBeNull();
      for (const b of bloecke!) {
        expect(() => pruefeJsonLd(b)).not.toThrow();
        expect(b['provider']).toEqual({ '@id': localBusinessId(BASIS, bereich.slug) });
      }
    },
  );

  it.each(BEREICHE.map((b) => [b.slug] as const))('FAQPage für %s', () => {
    const block = faqPage([
      { frage: 'Arbeiten Sie auch am Wochenende?', antwort: 'Nach Vereinbarung.' },
    ]);
    expect(block).not.toBeNull();
    expect(() => pruefeJsonLd(block!)).not.toThrow();
  });

  it('WebSite und BreadcrumbList ebenso', () => {
    expect(() => pruefeJsonLd(webSite('CSE Gruppe', BASIS))).not.toThrow();
    expect(() => pruefeJsonLd(breadcrumb(BASIS, [
      { name: 'Start', pfad: '/' }, { name: 'Kontakt', pfad: '/kontakt' },
    ]))).not.toThrow();
  });
});

describe('kein Block ohne gepflegte Daten — ein leerer wäre ein Fehler im Markup', () => {
  it('ohne Leistungen entsteht KEIN Service-Block', () => {
    expect(services(BEREICHE[0]!, BASIS, [])).toBeNull();
  });

  it('ohne Fragen entsteht KEINE FAQPage', () => {
    expect(faqPage([])).toBeNull();
  });

  it('ein leerer Name ist kein Eintrag', () => {
    // Ohne diese Regel wandert ein versehentlich leeres Feld als `"name": ""`
    // in die strukturierten Daten: schemakonform, in der Suche wertlos.
    expect(leistungenAus({ leistungen: [{ name: '   ' }] })).toEqual([]);
    expect(faqAus({ faq: [{ frage: 'Wann?', antwort: '' }] })).toEqual([]);
  });

  it('unbekannte Datenformen werden nicht halb übernommen', () => {
    expect(leistungenAus(null)).toEqual([]);
    expect(leistungenAus({ leistungen: 'Reinigung' })).toEqual([]);
    expect(faqAus({})).toEqual([]);
  });
});

describe('die Formprüfung ist falsifizierbar — sie lässt Unvollständiges NICHT durch', () => {
  it('ein LocalBusiness ohne Telefon fällt durch', () => {
    const ohne = { ...localBusiness(BEREICHE[0]!, BASIS) };
    delete (ohne as Record<string, unknown>)['telephone'];
    expect(() => pruefeJsonLd(ohne)).toThrow(JsonLdFehler);
  });

  it('eine halbe Anschrift fällt durch', () => {
    const block = localBusiness(BEREICHE[0]!, BASIS) as Record<string, unknown>;
    block['address'] = { '@type': 'PostalAddress', streetAddress: 'Kurfürstendamm 21' };
    expect(() => pruefeJsonLd(block)).toThrow(JsonLdFehler);
  });

  it('eine FAQPage mit einer Frage ohne Antwort fällt durch', () => {
    expect(() => pruefeJsonLd({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: [{ '@type': 'Question', name: 'Wann?' }],
    })).toThrow(JsonLdFehler);
  });

  it('ein unbekannter Typ fällt durch — nicht stillschweigend durchgereicht', () => {
    expect(() => pruefeJsonLd({ '@type': 'Recipe' })).toThrow(JsonLdFehler);
    expect(() => pruefeJsonLd({ name: 'ohne Typ' })).toThrow(JsonLdFehler);
  });
});

describe('O-206: ohne gepflegten Rechtsträger entsteht kein Dach über den vieren', () => {
  it('die Organisation nennt die vier als subOrganization — wenn es sie gibt', () => {
    const dach = organisation(
      { firma: 'CSE Holding GmbH', strasse: 'Kurfürstendamm 21', plz: '10719',
        ort: 'Berlin', land: 'DE', telefon: '+49 30 555 0100', email: null },
      BASIS, BEREICHE,
    );
    expect(() => pruefeJsonLd(dach)).not.toThrow();
    expect(dach['subOrganization']).toEqual(
      BEREICHE.map((b) => ({ '@id': localBusinessId(BASIS, b.slug) })),
    );
  });
});

/**
 * Gefunden, als der Durchlauf durch den Produktionsbau jede Adresse der
 * Sitemap aufrief: `/leistungen/unterhaltsreinigung` endete auf Deutsch und
 * Englisch mit 500. `seitenService` lässt `provider` weg, solange keine
 * Gesellschaft die Seite verantwortet (O-652) — und die Formprüfung verlangte
 * ihn. Beide Seiten der Zusage stehen jetzt hier.
 */
describe('Service einer Leistungsseite: ohne entschiedene Gesellschaft kein provider — und kein Fehler', () => {
  it('ohne Gesellschaft: gültig, ohne provider', () => {
    const block = seitenService('Unterhaltsreinigung', 'Täglich, wöchentlich', BASIS, null);
    expect(block['provider']).toBeUndefined();
    expect(() => pruefeJsonLd(block)).not.toThrow();
  });

  it('mit Gesellschaft: provider zeigt auf ihr LocalBusiness', () => {
    const block = seitenService('Unterhaltsreinigung', null, BASIS, 'reinigung');
    expect(block['provider']).toEqual({ '@id': localBusinessId(BASIS, 'reinigung') });
    expect(() => pruefeJsonLd(block)).not.toThrow();
  });

  it('ein provider OHNE gültige Adresse fällt weiter durch', () => {
    const block = seitenService('Unterhaltsreinigung', null, BASIS, 'reinigung');
    block['provider'] = { '@id': 'keine adresse' };
    expect(() => pruefeJsonLd(block)).toThrow(JsonLdFehler);
  });
});
