/**
 * Woher ein Besuch kam — für die Angebotsanfrage (REQ-07).
 *
 * **Ohne Speicher im Browser.** Die öffentliche Seite setzt keinen Cookie und
 * nichts in `localStorage` (D-61, PUB-13): es gibt kein Banner, also darf es
 * nichts geben, wofür eines nötig wäre — und eine Kampagnenzuordnung ist
 * nicht „unbedingt erforderlich" im Sinne von § 25 Abs. 2 TDDDG. Die Herkunft
 * reist deshalb in der ADRESSE: die Formularseite liest sie aus ihrem eigenen
 * Aufruf, die Bereichsauswahl reicht sie an die Formularlinks weiter, und das
 * Formular trägt sie als versteckte Felder zur Annahme.
 *
 * **Was dadurch NICHT geht, steht in D-631:** wer über drei Seiten zum
 * Formular klickt, kommt dort mit der vorigen Seite als Einstieg an und ohne
 * die Kampagnenparameter der ersten. Ohne Speicher lässt sich ein Besuch über
 * mehrere Seiten nicht zusammensetzen; die Alternative wäre ein Cookie mit
 * Einwilligung, und die gibt es auf dieser Seite nicht.
 *
 * **Warum die Formularseite den Referrer liest und nicht die Annahme.** Der
 * `Referer` des POST an `/api/anfrage` ist IMMER die eigene Formularseite —
 * genau das stand vorher in jedem Lead. Aussagekräftig ist nur der Kopf der
 * Seite, auf der das Formular geöffnet wurde.
 */

/** Die fünf Kampagnenparameter, wie Werbeplattformen sie anhängen. */
export const UTM_SCHLUESSEL = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
] as const;
export type UtmSchluessel = (typeof UTM_SCHLUESSEL)[number];

/** Die Adressparameter, mit denen die Auswahlseite die Herkunft weiterreicht. */
export const EINSTIEG_PARAM = 'einstieg';
export const EXTERN_PARAM = 'von';

/** Länger ist kein Kampagnenwert, sondern Müll in einer Adresse. */
const UTM_MAX = 200;
const ADRESSE_MAX = 500;

export interface Herkunft {
  readonly utm: Readonly<Partial<Record<UtmSchluessel, string>>>;
  /** Die erste Seite dieses Hauses, die sich ohne Speicher erkennen lässt. */
  readonly landingPage?: string | undefined;
  /** Die fremde Seite, von der der Besuch kam — nie die eigene. */
  readonly referrerExtern?: string | undefined;
}

type Suche = Readonly<Record<string, string | string[] | undefined>>;

function ersterWert(roh: string | string[] | undefined): string | undefined {
  const w = Array.isArray(roh) ? roh[0] : roh;
  return typeof w === 'string' ? w.trim() : undefined;
}

/** Nur druckbare Zeichen: der Wert landet später als Text auf einem Leadblatt. */
function sauber(w: string | undefined, max: number): string | undefined {
  if (w === undefined || w === '' || w.length > max) return undefined;
  return /[\u0000-\u001f\u007f]/u.test(w) ? undefined : w;
}

/**
 * Ein Pfad DIESES Hauses: beginnt mit genau einem `/`.
 *
 * `//fremd.example/x` ist für einen Browser eine fremde Adresse — als
 * „Einstieg" angenommen, stünde auf dem Leadblatt ein Link nach draussen,
 * den jemand in eine Adresse schreiben konnte.
 */
export function eigenerPfad(w: string | undefined): string | undefined {
  const s = sauber(w, ADRESSE_MAX);
  if (s === undefined) return undefined;
  return /^\/(?![/\\])/u.test(s) ? s : undefined;
}

/** Eine fremde http(s)-Adresse — ohne Zugangsdaten, nie der eigene Host. */
export function fremdeAdresse(w: string | undefined, eigenerHost: string | null): string | undefined {
  const s = sauber(w, ADRESSE_MAX);
  if (s === undefined) return undefined;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
  if (eigenerHost !== null && url.host.toLowerCase() === eigenerHost.toLowerCase()) return undefined;
  url.username = '';
  url.password = '';
  return url.toString();
}

/** Die Kampagnenparameter einer Adresse, geprüft. */
export function utmAus(suche: Suche): Partial<Record<UtmSchluessel, string>> {
  const utm: Partial<Record<UtmSchluessel, string>> = {};
  for (const k of UTM_SCHLUESSEL) {
    const w = sauber(ersterWert(suche[k]), UTM_MAX);
    if (w !== undefined) utm[k] = w;
  }
  return utm;
}

function mitUtm(pfad: string, utm: Herkunft['utm']): string {
  const q = new URLSearchParams();
  for (const k of UTM_SCHLUESSEL) {
    const w = utm[k];
    if (w !== undefined) q.set(k, w);
  }
  const s = q.toString();
  return s === '' ? pfad : `${pfad}?${s}`;
}

/**
 * Die Herkunft eines Seitenaufrufs.
 *
 * 1. Reicht die Auswahlseite eine Herkunft weiter (`einstieg`, `von`), gilt
 *    sie — sie hat den Besuch zuerst gesehen.
 * 2. Sonst entscheidet der `Referer` DIESES Aufrufs:
 *    - fremd → das ist der Referrer, und diese Seite ist der Einstieg;
 *    - eigen → die vorige Seite ist der Einstieg (mehr ist ohne Speicher
 *      nicht zu wissen);
 *    - keiner → direkt aufgerufen, diese Seite ist der Einstieg.
 */
export function herkunftAus(
  suche: Suche, referer: string | null, eigenerHost: string | null, pfad: string,
): Herkunft {
  const utm = utmAus(suche);
  const weitergereicht = eigenerPfad(ersterWert(suche[EINSTIEG_PARAM]));
  const externWeiter = fremdeAdresse(ersterWert(suche[EXTERN_PARAM]), eigenerHost);
  if (weitergereicht !== undefined) {
    return { utm, landingPage: weitergereicht, referrerExtern: externWeiter };
  }

  const extern = fremdeAdresse(referer ?? undefined, eigenerHost);
  if (extern !== undefined) {
    return { utm, landingPage: mitUtm(pfad, utm), referrerExtern: extern };
  }
  if (referer !== null && eigenerHost !== null) {
    try {
      const url = new URL(referer);
      if (url.host.toLowerCase() === eigenerHost.toLowerCase()) {
        const vorige = eigenerPfad(`${url.pathname}${url.search}`);
        if (vorige !== undefined) return { utm, landingPage: vorige };
      }
    } catch {
      // Ein kaputter Kopf ist kein Referrer — weiter wie „direkt".
    }
  }
  return { utm, landingPage: mitUtm(pfad, utm) };
}

/**
 * Die Herkunft als Adressparameter — für Links, die zum Formular führen.
 *
 * Die Auswahlseite hängt sie an ihre Bereichslinks, damit die Formularseite
 * nicht die Auswahlseite für den Einstieg hält.
 */
export function herkunftAlsSuche(h: Herkunft): string {
  const q = new URLSearchParams();
  for (const k of UTM_SCHLUESSEL) {
    const w = h.utm[k];
    if (w !== undefined) q.set(k, w);
  }
  if (h.landingPage !== undefined) q.set(EINSTIEG_PARAM, h.landingPage);
  if (h.referrerExtern !== undefined) q.set(EXTERN_PARAM, h.referrerExtern);
  const s = q.toString();
  return s === '' ? '' : `?${s}`;
}
