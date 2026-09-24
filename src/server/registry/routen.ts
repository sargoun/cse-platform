/**
 * Das Routen-Manifest — die Liste, gegen die autorisiert und geprueft wird.
 *
 * Die Eintraege kommen aus `04-SEITENKARTE.md` (erzeugt, siehe
 * `routen.generiert.ts`). Dieses Modul gibt ihnen eine Oberflaeche: eine
 * konkrete URL auf ihre Route abbilden, die Portalfamilie bestimmen, und die
 * Routen einer Phase oder eines Scopes finden.
 *
 * **Warum ueberhaupt ein Manifest.** AUT-04 verlangt, dass die Autorisierung
 * im Layout UND im Dienst laeuft, und AUT-06, dass eine fremde Zeile 404 gibt
 * und nie 403. Beides sind Aussagen ueber JEDE Route. Eine Liste von Faellen,
 * die jemand pflegt, waere beim naechsten Modul unvollstaendig — und zwar
 * genau an der Route, an die niemand gedacht hat. Die Karte ist die Quelle,
 * also ist sie auch die Pruefliste.
 */
import { ROUTEN } from './routen.generiert.js';
import type { RoutenEintrag, Scope } from '../../../scripts/seitenkarte/extrahiere.js';
import { modulAktiv, type Modulbuchung } from './modul.js';

export { ROUTEN };
export type { RoutenEintrag, Scope };

/**
 * Die Portalfamilie einer Route (SEITENKARTE §1.2).
 *
 * Sie entscheidet, welche Shell rendert und welche Decke gilt — nicht die
 * Rolle: eine Rolle kann sich aendern, die Familie einer URL nicht.
 */
export type Familie =
  | 'oeffentlich' | 'auth' | 'checkin'
  | 'mandant' | 'gruppe' | 'mein' | 'kunde' | 'konto' | 'api';

export function familie(pfad: string): Familie {
  if (pfad.startsWith('/api')) return 'api';
  if (pfad.startsWith('/auth')) return 'auth';
  if (pfad.startsWith('/check-in')) return 'checkin';
  if (pfad.startsWith('/portal/gruppe')) return 'gruppe';
  if (pfad.startsWith('/portal/mein')) return 'mein';
  if (pfad.startsWith('/portal/kunde')) return 'kunde';
  if (pfad.startsWith('/portal/konto')) return 'konto';
  if (pfad.startsWith('/portal/')) return 'mandant';
  return 'oeffentlich';
}

/** Segmente ohne leere — `/a//b/` und `/a/b` sind dieselbe Route. */
function segmente(pfad: string): readonly string[] {
  return pfad.split('?')[0]?.split('/').filter((s) => s !== '') ?? [];
}

const IST_PARAMETER = /^\[.+\]$/u;

/**
 * Die Namen, die unter `/portal/` KEINE Gesellschaft bezeichnen.
 *
 * Es sind genau die, die `familie()` eine Zeile vorher aufzaehlt — dieselbe
 * Liste, hier fuer den Mustervergleich.
 */
const RESERVIERT_UNTER_PORTAL: ReadonlySet<string> =
  new Set(['gruppe', 'mein', 'kunde', 'konto']);

/**
 * Passt eine KONKRETE URL auf ein Muster?
 *
 * `[x]` nimmt genau ein Segment — nicht mehrere. Ein Muster, das `[...pfad]`
 * schriebe, gaebe es in der Karte nicht, und eines zu erfinden hiesse, eine
 * Route breiter zu machen, als das Dokument sie erlaubt.
 *
 * **`[mandant]` nimmt keinen reservierten Namen.** Hier stand nur
 * `IST_PARAMETER.test(m)`, also passte JEDES Segment — auch `konto`. Damit
 * traf `/portal/konto` auf `/portal/[mandant]`, die Wurzelroute des
 * Mandanten-Dashboards, und wurde unter DEREN Bedingung geprueft
 * (`bericht.dashboard_lesen`) und mit DEREN Auskunft beantwortet: „dieses
 * Modul entsteht in Phase 3" — fuer eine Adresse, die keine Gesellschaft ist.
 * Wer `konto` heisst, ist keine Gesellschaft; `familie()` weiss das seit jeher,
 * der Mustervergleich wusste es nicht. Eine Route unter der falschen Wache ist
 * kein Anzeigefehler: sie kann zu eng ODER zu weit stehen, und welches von
 * beidem, entscheidet dann der Zufall der Rechtevergabe.
 */
function passt(muster: readonly string[], url: readonly string[]): boolean {
  if (muster.length !== url.length) return false;
  return muster.every((m, i) => {
    if (!IST_PARAMETER.test(m)) return m === url[i];
    const reserviert = i === 1 && url[0] === 'portal'
      && RESERVIERT_UNTER_PORTAL.has(url[i] ?? '');
    return !reserviert;
  });
}

/** Wie viele feste Segmente ein Muster hat — je mehr, desto spezifischer. */
function schaerfe(muster: readonly string[]): number {
  return muster.filter((m) => !IST_PARAMETER.test(m)).length;
}

/**
 * Findet die Route zu einer URL.
 *
 * **Die spezifischere gewinnt.** `/portal/x/crm/kunden/neu` passt sowohl auf
 * `.../kunden/neu` als auch auf `.../kunden/[id]`; nur die erste ist gemeint.
 * Ohne diese Regel griffe fuer eine Anlegen-Seite das Leserecht der
 * Detailseite, und die Route stuende unter der falschen Bedingung offen.
 */
export function findeRoute(pfad: string): RoutenEintrag | undefined {
  const url = segmente(pfad);
  let beste: RoutenEintrag | undefined;
  let besteSchaerfe = -1;
  for (const r of ROUTEN) {
    const muster = segmente(r.pfad);
    if (!passt(muster, url)) continue;
    const s = schaerfe(muster);
    if (s > besteSchaerfe) { beste = r; besteSchaerfe = s; }
  }
  return beste;
}

/** Genau der Eintrag mit diesem Musterpfad — fuer Tests und Werkzeuge. */
export function routeMitPfad(pfad: string): RoutenEintrag | undefined {
  return ROUTEN.find((r) => r.pfad === pfad);
}

export function routenIn(f: Familie): readonly RoutenEintrag[] {
  return ROUTEN.filter((r) => familie(r.pfad) === f);
}

export function routenMitScope(scope: Scope): readonly RoutenEintrag[] {
  return ROUTEN.filter((r) => r.scope === scope);
}

/**
 * Alle Rechteschluessel, die eine Route zum ANSEHEN verlangt.
 *
 * Leer heisst nicht "offen" — es heisst nur, dass kein Modulrecht geprueft
 * wird; `art` sagt, was stattdessen gilt (Selbstzugriff, Sitzung, Token).
 */
export function leserechte(r: RoutenEintrag): readonly string[] {
  return r.bewachung.art === 'recht' ? r.bewachung.lesen : [];
}

/**
 * Ist diese Route in einer Gesellschaft mit dieser Buchung gesperrt (D-377)?
 *
 * **Eine Antwort für zwei Fragesteller.** Die Portal-Pforte
 * (`app/portal/zugang.ts`) beantwortet eine gesperrte Route mit 404; die
 * Übersicht fragt dasselbe VOR dem Verweis, damit keine Kachel auf diesen
 * 404 zeigt (V-151, D-645). Stand die Regel zweimal, lief sie auseinander:
 * die Kachel „Bauprojekte in Arbeit" erschien in der Reinigung und führte
 * auf eine Seite, die es dort nicht gibt.
 *
 * Lese- UND Schreibrechte, `some` und nicht `every` — die Begründung steht an
 * der Pforte: ein einziges nicht gebuchtes Modul macht die Seite
 * unerreichbar. Eine Route ohne Rechtebewachung sperrt keine Buchung.
 */
export function routeGesperrt(
  route: RoutenEintrag | undefined, buchung: Modulbuchung,
): boolean {
  const b = route?.bewachung;
  return b !== undefined && b.art === 'recht'
    && [...b.lesen, ...b.schreiben].some((r) => !modulAktiv(buchung, r));
}
