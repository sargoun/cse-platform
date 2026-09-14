import 'server-only';
import {
  QuelleFehler, alsCent, alsZeitpunkt, type RohBekanntmachung,
} from './quelle.js';

/**
 * OCDS lesen — die nationale Quelle (RAD-01).
 *
 * **Warum national zuerst.** Unterhalb der EU-Schwellenwerte liegt das
 * Geschäft dieses Betriebs: Reinigung eines Bezirksamts, Objektschutz einer
 * Schule, ein Umbau im Bestand. TED sieht davon nichts. oeffentlichevergabe.de
 * veröffentlicht diese Bekanntmachungen als OCDS — Open Contracting Data
 * Standard, ein Release-Package mit `releases[]`.
 *
 * **Was dieser Leser NICHT tut.** Er erfindet keine Felder. Fehlt die Frist,
 * bleibt sie leer; nennt die Quelle keinen Wert, entsteht keiner. Und er
 * normalisiert die Verfahrensart nicht in ein eigenes Vokabular: VOB/A, VgV
 * und UVgO sprechen verschieden, und eine erfundene Vereinheitlichung wäre
 * eine Behauptung über Vergaberecht.
 *
 * Gelesen wird TEXT, nicht das Netz: derselbe Leser läuft im Job und im Test.
 */

interface OcdsWert { readonly amount?: string | number; readonly currency?: string }

interface OcdsRelease {
  readonly ocid?: string;
  readonly id?: string;
  readonly date?: string;
  readonly language?: string;
  readonly tag?: readonly string[];
  readonly tender?: {
    readonly title?: string;
    readonly description?: string;
    readonly status?: string;
    readonly procurementMethodDetails?: string;
    readonly value?: OcdsWert;
    readonly minValue?: OcdsWert;
    readonly numberOfLots?: number;
    readonly lots?: readonly unknown[];
    readonly classification?: { readonly scheme?: string; readonly id?: string };
    readonly additionalClassifications?: readonly { readonly scheme?: string; readonly id?: string }[];
    readonly items?: readonly {
      readonly classification?: { readonly scheme?: string; readonly id?: string };
      readonly deliveryAddresses?: readonly { readonly region?: string; readonly postalCode?: string }[];
    }[];
    readonly tenderPeriod?: { readonly endDate?: string };
    readonly enquiryPeriod?: { readonly endDate?: string };
    readonly participationFees?: unknown;
    readonly submissionMethodDetails?: string;
  };
  readonly buyer?: { readonly name?: string };
  readonly parties?: readonly {
    readonly roles?: readonly string[];
    readonly name?: string;
    readonly address?: { readonly locality?: string; readonly postalCode?: string; readonly region?: string };
  }[];
  readonly links?: { readonly self?: string };
}

function istObjekt(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** NUTS-Codes sehen so aus: zwei Buchstaben, bis zu drei Zeichen. Alles andere ist keiner. */
function alsNuts(roh: unknown): string | null {
  if (typeof roh !== 'string') return null;
  const wert = roh.trim().toUpperCase();
  return /^[A-Z]{2}[0-9A-Z]{0,3}$/u.test(wert) ? wert : null;
}

function alsCpv(roh: unknown): string | null {
  if (typeof roh !== 'string') return null;
  const wert = roh.trim();
  return /^[0-9]{8}(-[0-9])?$/u.test(wert) ? wert : null;
}

/**
 * Ein OCDS-Release-Package zu Bekanntmachungen.
 *
 * `ocid` ist die Identität über alle Fassungen hinweg — eine Berichtigung
 * trägt dieselbe und ist deshalb dieselbe Bekanntmachung, nicht eine zweite
 * (RAD-03).
 */
export function liesOcds(text: string): readonly RohBekanntmachung[] {
  let daten: unknown;
  try {
    daten = JSON.parse(text);
  } catch {
    throw new QuelleFehler('format', 'Die Antwort ist kein JSON.');
  }
  if (!istObjekt(daten)) throw new QuelleFehler('format', 'Ein OCDS-Paket ist ein Objekt.');
  const releases = (daten as { releases?: unknown }).releases;
  if (!Array.isArray(releases)) {
    throw new QuelleFehler('format', 'Dem OCDS-Paket fehlt "releases".');
  }

  const zeilen: RohBekanntmachung[] = [];
  for (const roh of releases) {
    if (!istObjekt(roh)) continue;
    const r = roh as unknown as OcdsRelease;
    const quellId = (r.ocid ?? r.id ?? '').trim();
    const titel = (r.tender?.title ?? '').trim();
    if (quellId === '' || titel === '') {
      /* Ohne Kennung oder Titel ist die Zeile nicht speicherbar — und stillschweigend
         eine zu erfinden, wäre schlimmer als sie zu überspringen. Der Lauf zählt sie. */
      continue;
    }

    const beschaffer = r.parties?.find((p) => (p.roles ?? []).includes('buyer'));
    const adresse = beschaffer?.address;
    const orte = (r.tender?.items ?? []).flatMap((i) => i.deliveryAddresses ?? []);

    const nuts = new Set<string>();
    for (const o of orte) {
      const n = alsNuts(o.region);
      if (n !== null) nuts.add(n);
    }
    const ausAdresse = alsNuts(adresse?.region);
    if (ausAdresse !== null) nuts.add(ausAdresse);

    const weitere = new Set<string>();
    for (const z of r.tender?.additionalClassifications ?? []) {
      const c = alsCpv(z.id);
      if (c !== null && (z.scheme ?? 'CPV').toUpperCase().startsWith('CPV')) weitere.add(c);
    }
    for (const i of r.tender?.items ?? []) {
      const c = alsCpv(i.classification?.id);
      if (c !== null) weitere.add(c);
    }
    const haupt = alsCpv(r.tender?.classification?.id);
    if (haupt !== null) weitere.delete(haupt);

    const wert = r.tender?.value ?? r.tender?.minValue;
    const tags = (r.tag ?? []).map((t) => t.toLowerCase());

    zeilen.push({
      quelle: 'oeffentlichevergabe',
      quellId,
      quellUrl: r.links?.self ?? null,
      titel,
      beschreibung: r.tender?.description?.trim() ?? null,
      sprache: (r.language ?? 'de').slice(0, 2).toLowerCase(),
      vergabestelleName: (beschaffer?.name ?? r.buyer?.name ?? null)?.trim() ?? null,
      vergabestelleOrt: adresse?.locality?.trim() ?? null,
      vergabestellePlz: adresse?.postalCode?.trim() ?? null,
      cpvHaupt: haupt,
      cpvWeitere: [...weitere].sort(),
      nutsCodes: [...nuts].sort(),
      verfahrensartRoh: r.tender?.procurementMethodDetails?.trim() ?? null,
      /* Die nationale Quelle sagt es nicht — und geraten wird hier nichts (die
         Schwellenwerte aendern sich alle zwei Jahre). */
      oberhalbSchwellenwert: null,
      wertCent: alsCent(wert?.amount),
      waehrung: wert?.currency?.trim().toUpperCase() ?? null,
      veroeffentlichtAm: alsZeitpunkt(r.date),
      fristTeilnahme: null,
      fristAngebot: alsZeitpunkt(r.tender?.tenderPeriod?.endDate),
      fristFragen: alsZeitpunkt(r.tender?.enquiryPeriod?.endDate),
      loseAnzahl: r.tender?.numberOfLots
        ?? (Array.isArray(r.tender?.lots) ? r.tender.lots.length : null),
      istBerichtigung: tags.includes('tenderamendment') || tags.includes('tenderupdate'),
      aufgehoben: (r.tender?.status ?? '').toLowerCase() === 'cancelled'
        || tags.includes('tendercancellation'),
    });
  }
  return zeilen;
}
