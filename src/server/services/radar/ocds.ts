import 'server-only';
import {
  QuelleFehler, alsCent, alsZeitpunkt,
  type LeseErgebnis, type RohBekanntmachung, type RohDokument,
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

interface OcdsDokument {
  readonly id?: string;
  readonly title?: string;
  readonly description?: string;
  readonly url?: string;
  readonly documentType?: string;
  readonly format?: string;
  readonly language?: string;
  readonly datePublished?: string;
  readonly accessDetails?: string;
}

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
    readonly documents?: readonly OcdsDokument[];
  };
  readonly documents?: readonly OcdsDokument[];
  readonly buyer?: { readonly name?: string };
  readonly parties?: readonly {
    readonly roles?: readonly string[];
    readonly name?: string;
    readonly address?: { readonly locality?: string; readonly postalCode?: string; readonly region?: string };
  }[];
  readonly links?: { readonly self?: string };
}

/**
 * **`accessDetails` ist der RAD-09-Hinweis, kein Fliesstext zum Wegwerfen.**
 * Steht dort, dass eine Registrierung oder Anmeldung noetig ist, dann ist die
 * Unterlage ohne Freischaltung nicht zu bekommen — und eine Freischaltung
 * dauert Tage bis Wochen. Erkannt werden deutsche und englische Formen; wird
 * nichts erkannt, gilt das Dokument als frei zugaenglich (die vorsichtige
 * Richtung waere hier die falsche: sie faerbte jede Bekanntmachung rot).
 */
const GESPERRT = /\b(registrier|anmeld|login|log-in|account|zugangsdaten|kostenpflichtig)/iu;

function alsDokumente(roh: readonly OcdsDokument[] | undefined): readonly RohDokument[] {
  const raus: RohDokument[] = [];
  const gesehen = new Set<string>();
  for (const d of roh ?? []) {
    const url = d.url?.trim() ?? null;
    /*
     * **`id` ist KEIN Titel.** In OCDS ist er eine interne Kennung („d4",
     * ein Hash) — als Bezeichnung in einer Pruefliste waere er eine Zeile,
     * die niemand lesen kann. Ohne Titel gilt die Adresse; ohne beides ist
     * die Zeile nichts, was man speichern koennte.
     */
    const bezeichnung = (d.title ?? d.description ?? d.documentType ?? '').trim();
    if (bezeichnung === '' && url === null) continue;
    const schluessel = url ?? bezeichnung;
    if (gesehen.has(schluessel)) continue;
    gesehen.add(schluessel);
    const zugang = `${d.accessDetails ?? ''} ${d.description ?? ''}`;
    raus.push({
      bezeichnung: bezeichnung === '' ? (url ?? 'Unterlage') : bezeichnung,
      quellUrl: url,
      dateiname: null,
      /* `format` ist in OCDS bereits ein Medientyp — er wird NICHT geraten. */
      mimeTyp: d.format?.trim() ?? null,
      sprache: d.language?.slice(0, 2).toLowerCase() ?? null,
      veroeffentlichtAm: alsZeitpunkt(d.datePublished),
      zugriffGesperrt: GESPERRT.test(zugang),
    });
  }
  return raus;
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
export function liesOcds(text: string): LeseErgebnis {
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

  /**
   * **Mehrere Releases zu derselben `ocid` sind der Normalfall**, nicht die
   * Ausnahme: die ursprüngliche Bekanntmachung, dann die Änderung, dann die
   * Aufhebung. Sie tragen dieselbe Kennung und sind DIESELBE Vergabe. Wer sie
   * einzeln weiterreicht, importiert die erste, und die zweite prallt am
   * Eindeutigkeitsindex ab — der Stand „aufgehoben" käme nie an. Gewinnt also
   * das jüngste Release je `ocid`.
   */
  /**
   * **Verglichen wird der ZEITPUNKT, nicht die Zeichenkette.**
   *
   * Vorher entschied `datum >= bisher.datum` auf den rohen ISO-Texten. OCDS
   * lässt einen Versatz zu: `2026-03-01T10:00:00+02:00` ist 08:00 UTC,
   * `2026-03-01T09:30:00Z` ist 09:30 UTC — die zweite Fassung ist die jüngere,
   * der Zeichenkettenvergleich hält aber die erste für grösser, weil an
   * Stelle zwölf eine `1` vor einer `0` steht. Damit gewann die ÄLTERE
   * Fassung, und mit ihr ihr Stand und ihre Unterlagen: „aufgehoben" käme nie
   * an. Millisekunden vergleichen sich richtig; `NaN` (unlesbares Datum)
   * verliert gegen alles, behält aber den ersten Fund.
   */
  const alsMillis = (roh: string | undefined): number => {
    const t = Date.parse((roh ?? '').trim());
    return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
  };
  const neueste = new Map<string, { readonly r: OcdsRelease; readonly roh: unknown; readonly datum: number }>();
  let uebersprungen = 0;
  for (const roh of releases) {
    if (!istObjekt(roh)) { uebersprungen += 1; continue; }
    const r = roh as unknown as OcdsRelease;
    const quellId = (r.ocid ?? r.id ?? '').trim();
    const titel = (r.tender?.title ?? '').trim();
    if (quellId === '' || titel === '') {
      /* Ohne Kennung oder Titel ist die Zeile nicht speicherbar — und stillschweigend
         eine zu erfinden, wäre schlimmer als sie zu überspringen. Der Lauf zählt sie. */
      uebersprungen += 1;
      continue;
    }
    const datum = alsMillis(r.date);
    const bisher = neueste.get(quellId);
    if (bisher === undefined || datum >= bisher.datum) {
      neueste.set(quellId, { r, roh, datum });
    }
  }

  const zeilen: RohBekanntmachung[] = [];
  for (const [quellId, eintrag] of neueste) {
    const r = eintrag.r;
    const titel = (r.tender?.title ?? '').trim();

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
    /*
     * Das Schema wird geprüft wie bei den Nebenklassifikationen: ein anderes
     * System mit acht Ziffern (etwa eine nationale Warennummer) landete sonst
     * als CPV in der Bewertung und träfe dort zufällig ein Profil.
     */
    const hauptSchema = (r.tender?.classification?.scheme ?? 'CPV').toUpperCase();
    const haupt = hauptSchema.startsWith('CPV') ? alsCpv(r.tender?.classification?.id) : null;
    if (haupt !== null) weitere.delete(haupt);

    const wert = r.tender?.value ?? r.tender?.minValue;
    const tags = (r.tag ?? []).map((t) => t.toLowerCase());

    zeilen.push({
      quelle: 'oeffentlichevergabe',
      quellId,
      rohJson: JSON.stringify(eintrag.roh),
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
      /* Fristen nur mit Uhrzeit und Zone: ein reines Datum verkürzte den Zähler. */
      fristAngebot: alsZeitpunkt(r.tender?.tenderPeriod?.endDate, { frist: true }),
      fristFragen: alsZeitpunkt(r.tender?.enquiryPeriod?.endDate, { frist: true }),
      loseAnzahl: r.tender?.numberOfLots
        ?? (Array.isArray(r.tender?.lots) ? r.tender.lots.length : null),
      istBerichtigung: tags.includes('tenderamendment') || tags.includes('tenderupdate'),
      aufgehoben: (r.tender?.status ?? '').toLowerCase() === 'cancelled'
        || tags.includes('tendercancellation'),
      dokumente: alsDokumente([...(r.tender?.documents ?? []), ...(r.documents ?? [])]),
    });
  }
  return { zeilen, uebersprungen };
}
