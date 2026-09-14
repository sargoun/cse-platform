import 'server-only';
import {
  QuelleFehler, alsCent, alsZeitpunkt, type RohBekanntmachung,
} from './quelle.js';

/**
 * TED v3 lesen — die europäische Quelle (RAD-02).
 *
 * **Was TED anders macht als OCDS.** Die Suchschnittstelle liefert Felder,
 * keine Dokumente: `notices[]` mit Werten, die je nach Feld als Zeichenkette,
 * als Liste oder als Sprachkarte (`{ deu: "…", eng: "…" }`) kommen. Genau
 * diese drei Formen sind die Stelle, an der ein Leser still falsch wird —
 * deshalb geht jedes Feld durch dieselbe Entpackung, und was nicht passt,
 * bleibt leer statt falsch.
 *
 * **Die Sprache ist eine Tatsache der Bekanntmachung, keine Annahme.** Eine
 * belgische Ausschreibung auf Französisch bekommt `sprache = 'fr'`, und die
 * Volltextsuche in der Datenbank benutzt dann die französische Konfiguration
 * (`ausschreibung.ts_konfiguration`). Alles auf Deutsch zu stellen, hiesse,
 * die halbe EU-Quelle unauffindbar zu machen.
 *
 * **Oberhalb des Schwellenwerts: ja, aber weil TED es sagt.** Eine
 * EU-Bekanntmachung liegt per Definition oberhalb — das ist keine Rechnung
 * dieses Codes, sondern die Eigenschaft der Quelle, und sie steht deshalb
 * als `true` da statt als berechneter Vergleich mit einer Zahl, die sich
 * alle zwei Jahre ändert.
 */

function istObjekt(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/**
 * Ein TED-Feld in Text verwandeln.
 *
 * Drei Formen, eine Antwort: Zeichenkette → sie selbst; Liste → der erste
 * brauchbare Eintrag; Sprachkarte → die bevorzugte Sprache, sonst die erste.
 * Alles andere → `null`. Kein `String(x)` auf ein Objekt: daraus würde
 * `[object Object]`, und das stünde dann als Titel in der Liste.
 */
export function tedText(roh: unknown, sprache = 'deu'): string | null {
  if (typeof roh === 'string') return roh.trim() === '' ? null : roh.trim();
  if (typeof roh === 'number') return String(roh);
  if (Array.isArray(roh)) {
    for (const e of roh) {
      const t = tedText(e, sprache);
      if (t !== null) return t;
    }
    return null;
  }
  if (istObjekt(roh)) {
    const bevorzugt = roh[sprache];
    const t = bevorzugt === undefined ? null : tedText(bevorzugt, sprache);
    if (t !== null) return t;
    for (const wert of Object.values(roh)) {
      const w = tedText(wert, sprache);
      if (w !== null) return w;
    }
  }
  return null;
}

/** Dieselbe Entpackung, aber alle Treffer — für CPV- und NUTS-Listen. */
export function tedListe(roh: unknown): readonly string[] {
  if (typeof roh === 'string') return roh.trim() === '' ? [] : [roh.trim()];
  if (Array.isArray(roh)) return roh.flatMap((e) => tedListe(e));
  if (istObjekt(roh)) return Object.values(roh).flatMap((e) => tedListe(e));
  return [];
}

const CPV = /^[0-9]{8}(-[0-9])?$/u;
const NUTS = /^[A-Z]{2}[0-9A-Z]{0,3}$/u;

/** ISO-639-3 („deu") auf zwei Zeichen („de") — die Spalte hält zwei. */
function sprachKuerzel(roh: string | null): string {
  const karte: Readonly<Record<string, string>> = {
    deu: 'de', eng: 'en', fra: 'fr', nld: 'nl', pol: 'pl', ita: 'it', spa: 'es',
    ces: 'cs', dan: 'da', swe: 'sv', fin: 'fi', por: 'pt', ell: 'el', hun: 'hu',
  };
  if (roh === null) return 'de';
  const klein = roh.toLowerCase();
  return karte[klein] ?? (klein.length >= 2 ? klein.slice(0, 2) : 'de');
}

export function liesTed(text: string): readonly RohBekanntmachung[] {
  let daten: unknown;
  try {
    daten = JSON.parse(text);
  } catch {
    throw new QuelleFehler('format', 'Die Antwort ist kein JSON.');
  }
  if (!istObjekt(daten)) throw new QuelleFehler('format', 'Eine TED-Antwort ist ein Objekt.');
  const notices = (daten as { notices?: unknown }).notices;
  if (!Array.isArray(notices)) {
    throw new QuelleFehler('format', 'Der TED-Antwort fehlt "notices".');
  }

  const zeilen: RohBekanntmachung[] = [];
  for (const roh of notices) {
    if (!istObjekt(roh)) continue;
    const quellId = tedText(roh['publication-number'] ?? roh['ND'] ?? roh['noticeId']);
    const sprache = sprachKuerzel(tedText(roh['notice-language'] ?? roh['LG']));
    const titel = tedText(roh['notice-title'] ?? roh['TI'], sprache === 'de' ? 'deu' : 'eng');
    if (quellId === null || titel === null) continue;

    const cpvAlle = tedListe(roh['classification-cpv'] ?? roh['PC'])
      .map((c) => c.trim()).filter((c) => CPV.test(c));
    const haupt = tedText(roh['main-classification-cpv'] ?? roh['classification-cpv-main']);
    const cpvHaupt = haupt !== null && CPV.test(haupt) ? haupt : cpvAlle[0] ?? null;
    const weitere = [...new Set(cpvAlle.filter((c) => c !== cpvHaupt))].sort();

    const nuts = [...new Set(
      tedListe(roh['place-of-performance'] ?? roh['RC'] ?? roh['nuts'])
        .map((n) => n.trim().toUpperCase()).filter((n) => NUTS.test(n)),
    )].sort();

    const wertRoh = tedText(roh['total-value'] ?? roh['estimated-value'] ?? roh['value']);
    const waehrung = tedText(roh['total-value-currency'] ?? roh['currency']);
    const art = tedText(roh['procedure-type'] ?? roh['PR'], sprache === 'de' ? 'deu' : 'eng');
    const form = (tedText(roh['form-type'] ?? roh['TD']) ?? '').toLowerCase();

    zeilen.push({
      quelle: 'ted',
      quellId,
      quellUrl: tedText(roh['links'] ?? roh['url'])
        ?? `https://ted.europa.eu/udl?uri=TED:NOTICE:${quellId}:TEXT:DE:HTML`,
      titel,
      beschreibung: tedText(roh['description-procurement'] ?? roh['notice-description'],
        sprache === 'de' ? 'deu' : 'eng'),
      sprache,
      vergabestelleName: tedText(roh['buyer-name'] ?? roh['AU']),
      vergabestelleOrt: tedText(roh['buyer-city'] ?? roh['TW']),
      vergabestellePlz: tedText(roh['buyer-postal-code']),
      cpvHaupt,
      cpvWeitere: weitere,
      nutsCodes: nuts,
      verfahrensartRoh: art,
      /* TED veroeffentlicht oberhalb der Schwellenwerte — Eigenschaft der Quelle, keine Rechnung. */
      oberhalbSchwellenwert: true,
      wertCent: alsCent(wertRoh),
      waehrung: waehrung?.toUpperCase() ?? null,
      veroeffentlichtAm: alsZeitpunkt(tedText(roh['publication-date'] ?? roh['PD'])),
      fristTeilnahme: alsZeitpunkt(tedText(roh['deadline-receipt-request'])),
      fristAngebot: alsZeitpunkt(tedText(roh['deadline-receipt-tender'] ?? roh['DT'])),
      fristFragen: null,
      loseAnzahl: null,
      istBerichtigung: form.includes('corrigendum') || form.includes('change'),
      aufgehoben: form.includes('cancel'),
    });
  }
  return zeilen;
}
