/**
 * Der NAP-Block — Name, Anschrift, Telefon (PUB-08, SEO).
 *
 * Er kommt aus den `mandant`-Zeilen und aus keiner zweiten Quelle. Der Grund
 * ist nicht Ordnungsliebe: fuer lokale Suche zaehlt, dass Name, Anschrift und
 * Telefonnummer ueberall **zeichengleich** stehen. Zwei Schreibweisen derselben
 * Adresse — einmal "Str.", einmal "Straße" — sind fuer eine Suchmaschine zwei
 * Unternehmen, und die Autoritaet verteilt sich auf beide.
 *
 * Deshalb formatiert diese Funktion, und die Seiten setzen nichts selbst
 * zusammen.
 */

export interface NapQuelle {
  readonly firma: string;
  readonly strasse: string | null;
  readonly plz: string | null;
  readonly ort: string | null;
  readonly land: string;
  readonly telefon: string | null;
  readonly email: string | null;
}

export interface Nap {
  readonly name: string;
  readonly strasse: string;
  readonly ort: string;
  readonly telefon: string;
  readonly email: string;
  /** Eine Zeile, wie sie im Fussbereich steht. */
  readonly einzeilig: string;
}

export class NapFehler extends Error {
  constructor(firma: string, fehlend: readonly string[]) {
    super(
      `${firma}: der NAP-Block ist unvollständig (${fehlend.join(', ')}). `
      + 'Eine halbe Adresse ist für die lokale Suche schlechter als keine — sie '
      + 'erzeugt einen zweiten, schwächeren Eintrag.',
    );
    this.name = 'NapFehler';
  }
}

export function napAus(m: NapQuelle): Nap {
  const fehlend = (['strasse', 'plz', 'ort', 'telefon'] as const)
    .filter((k) => m[k] === null || m[k] === '');
  if (fehlend.length > 0) throw new NapFehler(m.firma, fehlend);

  const strasse = m.strasse!;
  const ort = `${m.plz!} ${m.ort!}`;
  return {
    name: m.firma,
    strasse,
    ort,
    telefon: m.telefon!,
    email: m.email ?? '',
    // EINE Schreibweise, ueberall. Zwei sind fuer eine Suchmaschine zwei
    // Unternehmen.
    einzeilig: `${m.firma} · ${strasse} · ${ort}`,
  };
}

/** `LocalBusiness`-JSON-LD je Gesellschaft (PRO-04, SEO). */
export function localBusinessJsonLd(m: NapQuelle, url: string): Record<string, unknown> {
  const nap = napAus(m);
  return {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: nap.name,
    url,
    telephone: nap.telefon,
    ...(nap.email === '' ? {} : { email: nap.email }),
    address: {
      '@type': 'PostalAddress',
      streetAddress: nap.strasse,
      postalCode: m.plz,
      addressLocality: m.ort,
      addressCountry: m.land,
    },
  };
}
