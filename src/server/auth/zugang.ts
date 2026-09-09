import 'server-only';
import { familie, findeRoute, type Familie, type RoutenEintrag }
  from '../registry/routen.js';
import type { Sitzung } from '../kontext/index.js';

/**
 * Das Routen-Tor (AUT-04, AUT-06, SEC-A1, SEC-A3).
 *
 * **Die Entscheidung faellt gegen das Manifest, nicht gegen eine Fallliste.**
 * `04-SEITENKARTE.md` sagt fuer jede der 432 Routen, welches Recht sie
 * verlangt und in welchem Scope sie liest. Eine neue Route ist damit
 * automatisch bewacht — und eine Route, die im Manifest fehlt, ist keine
 * Route: sie faellt in `unbekannt` und damit auf 404.
 *
 * **404, nie 403** (AUT-06). Ein 403 bestaetigt, dass es die Sache gibt. Bei
 * `/portal/reinigung/crm/kunden/[id]` ist genau das die Auskunft, die niemand
 * bekommen soll: dass dieser Kunde existiert.
 *
 * **Das ist die ERSTE Linie, nicht die einzige.** RLS ist die zweite: selbst
 * wenn dieses Tor eine Route durchliesse, gaebe die Datenbank keine fremde
 * Zeile heraus. AUT-04 verlangt beides — die Pruefung im Layout UND im Dienst.
 */

export type Entscheidung =
  | { readonly art: 'erlaubt' }
  /** Die Route gibt es nicht (im Manifest). */
  | { readonly art: 'unbekannt' }
  /** Angemeldet sein genuegt nicht — ein Recht fehlt. */
  | { readonly art: 'kein_recht'; readonly fehlend: readonly string[] }
  /** Die Route gehoert zu einem anderen Portal (K-04-Decke). */
  | { readonly art: 'falsches_portal'; readonly ziel: string }
  /** Nicht angemeldet. */
  | { readonly art: 'anmeldung' }
  /** Ein zweiter Faktor fehlt (K-15). */
  | { readonly art: 'zweiter_faktor' };

/**
 * Welche Portalfamilien ein Portal betreten darf.
 *
 * `konto` fehlt in keiner Zeile: `/portal/konto` liest die eigenen
 * Kontozeilen ueber `benutzer_id` und loest sich in jedem Scope gleich auf
 * (SEITENKARTE §1.3, `USR`). Waere es je Portal gesperrt, koennte ein
 * Arbeiter sein eigenes Passwort nicht aendern.
 */
const ERLAUBTE_FAMILIEN: Readonly<Record<string, readonly Familie[]>> = {
  intern: ['mandant', 'gruppe', 'konto', 'oeffentlich', 'auth', 'api'],
  mitarbeiter: ['mein', 'konto', 'oeffentlich', 'auth', 'api', 'checkin'],
  kunde: ['kunde', 'konto', 'oeffentlich', 'auth', 'api'],
};

/** Wohin ein Portal geschickt wird, das die falsche Familie betritt. */
export const PORTAL_START: Readonly<Record<string, string>> = {
  intern: '/portal',
  mitarbeiter: '/portal/mein',
  kunde: '/portal/kunde',
};

export interface Rechtepruefer {
  /** `app.hat_recht(schluessel, mandant)` — der Mandant gehoert dazu (K-03). */
  hatRecht(schluessel: string, mandantId: string | null): Promise<boolean>;
}

/**
 * Darf diese Sitzung diese URL sehen?
 *
 * Die Reihenfolge ist bewusst: erst "gibt es die Route", dann "gehoert sie in
 * dieses Portal", dann "reicht der zweite Faktor", zuletzt "reichen die
 * Rechte". Jede Stufe frueher spart eine Datenbankabfrage, und keine von
 * ihnen verraet mehr als die naechste.
 */
export async function pruefeZugang(
  pfad: string,
  sitzung: Sitzung | null,
  pruefer: Rechtepruefer,
): Promise<Entscheidung> {
  const route = findeRoute(pfad);
  if (route === undefined) return { art: 'unbekannt' };

  const f = familie(route.pfad);
  if (f === 'oeffentlich' || route.bewachung.art === 'offen') return { art: 'erlaubt' };
  // Der Check-in-Pfad traegt ein Token und keine Sitzung (§4); er wird nicht
  // hier entschieden, sondern von der K-08-Registerfunktion.
  if (route.bewachung.art === 'token') return { art: 'erlaubt' };

  if (sitzung === null) return { art: 'anmeldung' };

  const erlaubt = ERLAUBTE_FAMILIEN[sitzung.portal] ?? [];
  if (!erlaubt.includes(f)) {
    return { art: 'falsches_portal', ziel: PORTAL_START[sitzung.portal] ?? '/portal' };
  }

  if (route.bewachung.art === 'sitzung' || route.bewachung.art === 'selbst') {
    // `S` ist Selbstzugriff ueber `app.person_id` — kein Recht, auch nicht fuer
    // `super_admin`. Die Zeilenauswahl macht die Policy, nicht dieses Tor.
    return { art: 'erlaubt' };
  }
  if (route.bewachung.art === 'infrastruktur') return { art: 'unbekannt' };

  if (route.bewachung.aal2 && sitzung.aal !== 'aal2') return { art: 'zweiter_faktor' };

  /**
   * Der Mandant, gegen den gefragt wird.
   *
   * `app.hat_recht` NIMMT einen Mandanten (K-03): ein globales Praedikat truege
   * ein in einer Gesellschaft erteiltes Recht in jede andere, und genau das
   * ist der Leak, gegen den RLS existiert. In den mandantenuebergreifenden
   * Ansichten ist er NULL, und die Gruppenschluessel (`gruppe.<modul>.lesen`)
   * sind global gebunden.
   */
  const fehlend: string[] = [];
  for (const schluessel of route.bewachung.lesen) {
    if (!(await pruefer.hatRecht(schluessel, sitzung.aktiverMandantId))) {
      fehlend.push(schluessel);
    }
  }
  if (fehlend.length > 0) return { art: 'kein_recht', fehlend };

  return { art: 'erlaubt' };
}

/**
 * Dieselbe Frage, eine Antwort: sehen oder nicht.
 *
 * Fuer die Navigation und fuer die Rollenprobe — dort zaehlt nur, ob eine
 * Zeile erscheint. Ein Menuepunkt, der auf 404 fuehrt, ist schlechter als
 * keiner: er verraet die Existenz dessen, was er nicht zeigen darf (AUT-06).
 */
export async function darfSehen(
  pfad: string, sitzung: Sitzung | null, pruefer: Rechtepruefer,
): Promise<boolean> {
  return (await pruefeZugang(pfad, sitzung, pruefer)).art === 'erlaubt';
}

/** Der Prüfer über einem gebundenen Kontext. */
export function rechtepruefer(
  abfrage: <T>(sql: string, werte?: readonly unknown[]) => Promise<readonly T[]>,
): Rechtepruefer {
  return {
    hatRecht: async (schluessel, mandantId) => {
      const zeilen = await abfrage<{ ok: boolean }>(
        `select app.hat_recht($1, $2::uuid) as ok`, [schluessel, mandantId],
      );
      return zeilen[0]?.ok === true;
    },
  };
}

export type { RoutenEintrag };
