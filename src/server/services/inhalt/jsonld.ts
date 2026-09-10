/**
 * Strukturierte Daten (PUB-11).
 *
 * **Was hier NICHT passiert: Inhalt erfinden.** Ein `Service`-Block mit
 * ausgedachten Leistungsnamen und eine `FAQPage` mit ausgedachten Antworten
 * sehen im Quelltext vollstaendig aus und stehen anschliessend als Aussage des
 * Unternehmens in einer Suchmaschine. Deshalb baut dieses Modul jeden Block
 * ausschliesslich aus gepflegten Daten und gibt `null` zurueck, wenn es keine
 * gibt. Kein Block ist besser als ein leerer: ein `FAQPage` ohne Fragen ist
 * für eine Suchmaschine kein Angebot, sondern ein Fehler im Markup.
 *
 * **Woher die Daten kommen.**
 * - `LocalBusiness` — aus `mandant` ueber `napAus()`, also aus derselben
 *   Quelle wie Impressum, Kontaktseite und Fussbereich (PUB-12). Zwei
 *   Schreibweisen derselben Adresse sind fuer eine Suchmaschine zwei
 *   Unternehmen.
 * - `Service` — aus einem `abschnitt` der Art `leistungen`, Feld
 *   `daten.leistungen`.
 * - `FAQPage` — aus `daten.faq` eines beliebigen Abschnitts.
 *
 * Beides sind gepflegte Felder im vorhandenen `jsonb` und brauchen keine
 * Migration.
 */
import { z } from 'zod';
import { localBusinessJsonLd, type NapQuelle } from './nap.js';

/** Der `@id`, auf den `Service.provider` zeigt. Ein Bereich, eine Identitaet. */
export function localBusinessId(basis: string, slug: string): string {
  return `${basis}/unternehmen/${slug}#unternehmen`;
}

export interface LeistungEintrag {
  readonly name: string;
  readonly beschreibung?: string | undefined;
}

export interface FaqEintrag {
  readonly frage: string;
  readonly antwort: string;
}

/* ── Was als gepflegter Eintrag zaehlt ──────────────────────────────────── */

/**
 * Ein leerer Name ist kein Eintrag.
 *
 * Ohne diese Pruefung wandert ein versehentlich leeres Feld als
 * `"name": ""` in die strukturierten Daten — gueltig nach Schema, wertlos in
 * der Suche, und niemandem faellt es auf.
 */
const LEISTUNG = z.object({
  name: z.string().trim().min(1),
  beschreibung: z.string().trim().min(1).optional(),
});

const FAQ = z.object({
  frage: z.string().trim().min(1),
  antwort: z.string().trim().min(1),
});

export function leistungenAus(daten: unknown): readonly LeistungEintrag[] {
  const roh = (daten as { leistungen?: unknown } | null)?.leistungen;
  const geprueft = z.array(LEISTUNG).safeParse(roh);
  return geprueft.success ? geprueft.data : [];
}

export function faqAus(daten: unknown): readonly FaqEintrag[] {
  const roh = (daten as { faq?: unknown } | null)?.faq;
  const geprueft = z.array(FAQ).safeParse(roh);
  return geprueft.success ? geprueft.data : [];
}

/* ── Die Blöcke ─────────────────────────────────────────────────────────── */

export interface BereichsQuelle {
  readonly slug: string;
  readonly mandant: NapQuelle;
}

/** `LocalBusiness` je Gesellschaft — mit `@id`, damit `Service` darauf zeigt. */
export function localBusiness(
  bereich: BereichsQuelle, basis: string,
): Record<string, unknown> {
  const url = `${basis}/unternehmen/${bereich.slug}`;
  return {
    ...localBusinessJsonLd(bereich.mandant, url),
    '@id': localBusinessId(basis, bereich.slug),
    areaServed: { '@type': 'City', name: 'Berlin' },
  };
}

/**
 * Eine `Service`-Liste, oder `null`.
 *
 * `provider` zeigt auf den `@id` des Bereichs und nicht auf die Gruppe: die
 * Leistung erbringt die Gesellschaft, und lokale Autoritaet gehoert dorthin.
 */
export function services(
  bereich: BereichsQuelle, basis: string, eintraege: readonly LeistungEintrag[],
): readonly Record<string, unknown>[] | null {
  if (eintraege.length === 0) return null;
  return eintraege.map((l) => ({
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: l.name,
    ...(l.beschreibung === undefined ? {} : { description: l.beschreibung }),
    provider: { '@id': localBusinessId(basis, bereich.slug) },
    areaServed: { '@type': 'City', name: 'Berlin' },
  }));
}

/** Eine `FAQPage`, oder `null`. Ein leerer Block waere ein Fehler im Markup. */
export function faqPage(
  eintraege: readonly FaqEintrag[],
): Record<string, unknown> | null {
  if (eintraege.length === 0) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: eintraege.map((f) => ({
      '@type': 'Question',
      name: f.frage,
      acceptedAnswer: { '@type': 'Answer', text: f.antwort },
    })),
  };
}

/** Die Website selbst. Sie hat einen Namen und braucht keine Rechtsform. */
export function webSite(
  name: string, basis: string, sprachen: readonly string[] = ['de-DE'],
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${basis}#website`,
    url: basis,
    name,
    /**
     * `inLanguage` nennt ALLE Sprachen der Website, nicht die der Seite.
     *
     * Der `@id` ist `#website` — ein Objekt fuer den ganzen Auftritt. Stuende
     * hier je Aufruf eine andere Sprache, gaebe es dieselbe `@id` mit
     * widersprechenden Angaben, und eine Suchmaschine entschiede selbst,
     * welche gilt. Welche Sprache eine einzelne SEITE hat, sagt `<html lang>`
     * und `hreflang`.
     */
    inLanguage: sprachen.length === 1 ? sprachen[0] : [...sprachen],
  };
}

/**
 * Die Dachorganisation — nur, wenn es sie als Rechtstraeger wirklich gibt.
 *
 * **Deshalb nimmt diese Funktion einen NAP und keinen Bereich.** Ein
 * `Organization`-Block mit Anschrift ist die Aussage, an dieser Adresse gebe es
 * ein Unternehmen dieses Namens. Ob "CSE Gruppe" ein Rechtstraeger ist oder nur
 * eine Klammer ueber vier eigenstaendige Gesellschaften, ist offen (O-206) —
 * und den ersten Mandanten dafuer einzusetzen hiesse, die Gruppe sei die
 * CSE Dienstleistungen GmbH und deren Tochter zugleich.
 *
 * Solange die Frage offen ist, entsteht der Block nicht. Vier vollstaendige
 * `LocalBusiness`-Eintraege sind eine korrekte Auszeichnung; ein erfundenes
 * Dach darueber waere es nicht.
 */
export function organisation(
  gruppe: NapQuelle, basis: string, bereiche: readonly BereichsQuelle[],
): Record<string, unknown> {
  return {
    ...localBusinessJsonLd(gruppe, basis),
    '@type': 'Organization',
    '@id': `${basis}#gruppe`,
    // Die vier Gesellschaften sind eigenstaendig, nicht Marken einer Firma
    // (D-11). `subOrganization` sagt genau das.
    subOrganization: bereiche.map((b) => ({ '@id': localBusinessId(basis, b.slug) })),
  };
}

export function breadcrumb(
  basis: string, glieder: readonly { readonly name: string; readonly pfad: string }[],
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: glieder.map((g, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: g.name,
      item: `${basis}${g.pfad}`,
    })),
  };
}

/* ── Die Formprüfung ────────────────────────────────────────────────────── */

const POSTAL = z.object({
  '@type': z.literal('PostalAddress'),
  streetAddress: z.string().min(1),
  postalCode: z.string().min(1),
  addressLocality: z.string().min(1),
  addressCountry: z.string().length(2),
});

const SCHEMAS: Readonly<Record<string, z.ZodType>> = {
  LocalBusiness: z.object({
    '@context': z.literal('https://schema.org'),
    '@type': z.literal('LocalBusiness'),
    '@id': z.string().url(),
    name: z.string().min(1),
    url: z.string().url(),
    telephone: z.string().min(1),
    address: POSTAL,
  }).passthrough(),
  Organization: z.object({
    '@context': z.literal('https://schema.org'),
    '@type': z.literal('Organization'),
    '@id': z.string().min(1),
    name: z.string().min(1),
    address: POSTAL,
  }).passthrough(),
  WebSite: z.object({
    '@context': z.literal('https://schema.org'),
    '@type': z.literal('WebSite'),
    url: z.string().url(),
    name: z.string().min(1),
  }).passthrough(),
  Service: z.object({
    '@context': z.literal('https://schema.org'),
    '@type': z.literal('Service'),
    name: z.string().min(1),
    provider: z.object({ '@id': z.string().url() }),
  }).passthrough(),
  FAQPage: z.object({
    '@context': z.literal('https://schema.org'),
    '@type': z.literal('FAQPage'),
    mainEntity: z.array(z.object({
      '@type': z.literal('Question'),
      name: z.string().min(1),
      acceptedAnswer: z.object({
        '@type': z.literal('Answer'),
        text: z.string().min(1),
      }),
    })).min(1),
  }).passthrough(),
  BreadcrumbList: z.object({
    '@context': z.literal('https://schema.org'),
    '@type': z.literal('BreadcrumbList'),
    itemListElement: z.array(z.object({
      '@type': z.literal('ListItem'),
      position: z.number().int().positive(),
      name: z.string().min(1),
      item: z.string().url(),
    })).min(1),
  }).passthrough(),
};

export class JsonLdFehler extends Error {
  constructor(typ: string, grund: string) {
    super(
      `JSON-LD ${typ}: ${grund}. Ein fehlerhafter Block wird von der Suchmaschine `
      + 'stillschweigend verworfen — die Seite sieht ausgezeichnet aus und ist es nicht.',
    );
    this.name = 'JsonLdFehler';
  }
}

/**
 * Prueft einen Block gegen seine Form.
 *
 * Das ist keine vollstaendige schema.org-Validierung — die kann nur Google.
 * Es ist die Teilmenge, deren Fehlen den Block wertlos macht: fehlende
 * Pflichtfelder, ein unbekannter `@type`, eine halbe Adresse.
 */
export function pruefeJsonLd(block: Record<string, unknown>): void {
  const typ = block['@type'];
  if (typeof typ !== 'string') throw new JsonLdFehler('(ohne @type)', 'kein `@type`');
  const schema = SCHEMAS[typ];
  if (schema === undefined) throw new JsonLdFehler(typ, 'unbekannter Typ in diesem Projekt');
  const ergebnis = schema.safeParse(block);
  if (!ergebnis.success) {
    const pfade = ergebnis.error.issues
      .map((i) => `${i.path.join('.')} (${i.message})`)
      .join(', ');
    throw new JsonLdFehler(typ, pfade);
  }
}
