import { ROUTEN } from './routen.js';

/**
 * Der Rückweg einer Portaladresse — abgeleitet, nicht je Seite geschrieben
 * (DESIGN §5 „The way back", D-613, V-108).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Warum das hier steht und nicht 283-mal in einer Seite.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Gemessen: von **311** Seiten unter `/portal/[mandant]` trugen **zwei** einen
 * Rückweg. Der Mandant hat es an zwei Stellen selbst gefunden — er klickte auf
 * eine Person in der Beschäftigungsliste und stand auf einem Blatt ohne
 * Ausgang; er öffnete das Stundenkonto und fand keinen Weg zurück.
 *
 * 283 Dateien zu ändern wäre einmalig richtig und beim nächsten neuen
 * Bildschirm wieder falsch. Abgeleitet ist es dauerhaft richtig: **jede Seite
 * bekommt den Rückweg, auch die, die es morgen gibt.**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Die Regel: das Ziel ist der nächste VORFAHR, der eine Route ist.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * DESIGN §5 sagt: „the list the page came from, never `history.back()`", und
 * die Begründung dort ist die entscheidende — zwei Menschen erreichen
 * dieselbe Detailseite auf verschiedenen Wegen; das Einzige, was sie teilen,
 * ist der Ort, an dem der Datensatz WOHNT. Genau das ist der Vorfahr in der
 * Adresse.
 *
 * Nicht jeder Vorfahr ist eine Seite: `…/objekte/[id]/raumbuch/[raumId]` hat
 * `…/raumbuch` als Route, `…/bau/projekte/[id]/lv/import` hat `…/lv`. Deshalb
 * wird von unten nach oben gesucht und der ERSTE genommen, den das
 * Routenregister kennt. Eine Adresse, die es nicht gibt, ist ein Rückweg auf
 * einen 404 — schlimmer als keiner.
 *
 * **Die Modulwurzeln bekommen keinen.** `…/objekte` ist selbst ein
 * Navigationspunkt; über ihm liegt nur `/portal/[mandant]`, und dorthin führt
 * bereits das Logo in der Kopfzeile. Zwei Wege zum selben Ziel auf einem
 * Bildschirm sind einer zu viel.
 */

/** Das Muster einer Adresse: `/portal/reinigung/objekte/abc` → `/portal/[mandant]/objekte/[id]`. */
const MUSTER: ReadonlySet<string> = new Set(
  ROUTEN.map((r) => r.pfad).filter((p) => p.startsWith('/portal/')),
);

export interface RueckwegZiel {
  /** Die ECHTE Adresse, mit eingesetztem Mandanten — das, was ins `href` geht. */
  readonly ziel: string;
  /**
   * Das letzte Segment des MUSTERS — `objekte`, `[id]`, `raumbuch`.
   * Die Beschriftung macht daraus `rueckzielName()`; hier steht bewusst kein
   * Wort, weil dieses Register die Sprache nicht kennt.
   */
  readonly segment: string;
  /** Das Muster des Ziels — für die Rechteprüfung gegen das Routenregister. */
  readonly muster: string;
}

/**
 * Passt eine echte Adresse auf ein Muster?
 *
 * Gleiche Segmentzahl, und jedes Segment entweder wörtlich gleich oder im
 * Muster dynamisch (`[…]`). Dieselbe Regel wie `findeRoute`, nur ohne
 * Schärfevergleich — hier ist die Länge schon festgelegt.
 */
function passt(muster: readonly string[], echt: readonly string[]): boolean {
  if (muster.length !== echt.length) return false;
  return muster.every((m, i) => m.startsWith('[') || m === echt[i]);
}

/** Das Muster, auf das diese echte Adresse passt — oder `null`. */
function musterVon(echt: readonly string[]): string | null {
  for (const m of MUSTER) {
    if (passt(m.split('/').filter((s) => s !== ''), echt)) return m;
  }
  return null;
}

/**
 * Der Rückweg für diese Adresse — oder `null`, wenn es keinen geben soll.
 *
 * `null` heisst nicht „nicht gefunden", sondern „hier gehört keiner hin": auf
 * einer Modulwurzel, auf der Portalwurzel selbst, und überall, wo über der
 * Seite keine Route mehr liegt.
 */
export function rueckwegFuer(pfad: string): RueckwegZiel | null {
  const echt = pfad.split('?')[0]?.split('#')[0]?.split('/').filter((s) => s !== '') ?? [];
  /*
   * `portal` + Portalwurzel + mindestens ein Segment darunter. Kürzer heisst
   * Modulwurzel oder Portalwurzel — beide tragen keinen Rückweg.
   */
  if (echt.length < 4 || echt[0] !== 'portal') return null;

  for (let i = echt.length - 1; i >= 3; i -= 1) {
    const kandidat = echt.slice(0, i);
    const muster = musterVon(kandidat);
    if (muster === null) continue;
    const segment = muster.split('/').at(-1) ?? '';
    return { ziel: `/${kandidat.join('/')}`, segment, muster };
  }
  return null;
}

/**
 * Die Leserechte, die das Ziel verlangt — leer, wenn es keine nennt.
 *
 * **Warum das hier steht und nicht in der Hülle.** AUT-06: ein Pfeil auf eine
 * Adresse, die der Benutzer nicht öffnen darf, führt auf einen 404 — und
 * verrät damit, dass es sie gibt. Die Hülle rendert den Rückweg deshalb nur,
 * wenn das Tor diese Rechte vorher bestätigt hat; das Tor hat die Sitzung, die
 * Hülle nicht.
 */
export function rueckwegRechte(muster: string): readonly string[] {
  const route = ROUTEN.find((r) => r.pfad === muster);
  if (route === undefined) return [];
  const w = route.bewachung;
  return w.art === 'recht' ? w.lesen : [];
}
