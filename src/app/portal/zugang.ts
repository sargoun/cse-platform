import 'server-only';
import { notFound, redirect } from 'next/navigation';
import type postgres from 'postgres';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { pruefeZugang, rechtepruefer, PORTAL_START } from '@/server/auth/zugang';
import { bindeAnfrage, gruppenMandanten, rolleImMandanten } from '@/server/kontext/index';
import { leisteFuer, tableiste, type LeistenSchluessel }
  from '@/server/registry/tableiste';
import type { Sitzung } from '@/server/kontext/index';

/**
 * Was jede Portalseite zuerst tut: Sitzung holen, Tor fragen, Antwort befolgen.
 *
 * **An EINER Stelle**, weil AUT-04 verlangt, dass die Autorisierung im Layout
 * UND im Dienst laeuft — und weil eine je Seite kopierte Pruefung die Seite
 * vergisst, die als zwoelfte dazukommt. Was hier zurueckkommt, ist entweder
 * eine Sitzung mit Rolle und Leiste oder `null`, und `null` heisst genau eine
 * Sache: nicht angemeldet.
 *
 * **Eine Transaktion, eine Bindung.** Tor und Rollenabfrage laufen in
 * DERSELBEN gebundenen Transaktion. Getrennt gefragt las die Rollenabfrage
 * ohne `app.benutzer_id`, und `t_bm_lesen` verlangt
 * `benutzer_id = app.aktueller_benutzer()` — die Antwort war immer die leere
 * Menge, also immer `null`, also fuer jede Rolle dieselbe Tab-Leiste.
 */
export interface PortalZugang {
  readonly sitzung: Sitzung;
  readonly rolle: string | null;
  readonly leiste: LeistenSchluessel;
  /**
   * Die Bereiche, die dieser Sitzung im Gruppen-Scope offenstehen.
   *
   * Serverseitig abgeleitet (`app.switcher_mandanten()`), damit die Seite sie
   * nicht selbst zusammenstellt. Ausserhalb des Gruppen-Scopes leer.
   */
  readonly gruppenMandanten: readonly string[];
  /**
   * Je Tab-Schluessel: darf diese Sitzung ihn sehen?
   *
   * **Ein Menuepunkt, der auf 404 fuehrt, ist schlechter als keiner.** Er
   * verraet die Existenz dessen, was er nicht zeigen darf — genau die Auskunft,
   * die AUT-06 verweigert. Die Leiste rendert deshalb nur, was hier `true`
   * ist, und die Antwort kommt aus derselben Pruefung wie die Seite selbst:
   * `app.hat_recht`, im richtigen Scope.
   */
  readonly sichtbareTabs: Readonly<Record<string, boolean>>;
  /** Der Slug des aktiven Bereichs — die Portalwurzel haengt daran. */
  readonly mandantSlug: string | null;
}

interface Befund {
  readonly entscheidung: Awaited<ReturnType<typeof pruefeZugang>>;
  readonly rolle: string | null;
  readonly mandanten: readonly string[];
  readonly sichtbareTabs: Readonly<Record<string, boolean>>;
  readonly mandantSlug: string | null;
}

/** Die Portalwurzel, unter der die Leiste ihre relativen Ziele aufloest. */
export function portalWurzel(zugang: PortalZugang): string {
  if (zugang.sitzung.ansicht === 'gruppe') return '/portal/gruppe';
  if (zugang.sitzung.portal === 'mitarbeiter') return '/portal/mein';
  if (zugang.sitzung.portal === 'kunde') return '/portal/kunde';
  /**
   * Ohne Slug gibt es keine Wurzel — und `/portal` ist KEINE Manifestroute.
   * `/auth/bereich` ist die Stelle, an der ein `intern`-Konto seinen Bereich
   * waehlt (§4.4); dorthin zeigt auch `PORTAL_START.intern`.
   */
  return zugang.mandantSlug === null ? '/auth/bereich' : `/portal/${zugang.mandantSlug}`;
}

export async function portalZugang(pfad: string): Promise<PortalZugang | null> {
  const sitzung = await aktuelleSitzung();
  if (sitzung === null) return null;

  const befund = await (db().begin(async (tx: postgres.TransactionSql) => {
    const abfrage = async <T,>(q: string, w: readonly unknown[] = []) =>
      (await tx.unsafe(q, w as never[])) as readonly T[];

    await bindeAnfrage(tx, sitzung);
    /**
     * Im Gruppen-Scope IST `app.mandant_ids` die sichtbare Menge
     * (`0004_rls_baseline.sql`). Sie muss also stehen, BEVOR das Tor fragt —
     * sonst ist `app.sichtbare_mandanten()` leer und jede Gruppenroute faellt
     * auf 404, weil das Recht in keinem Bereich geprueft werden kann.
     */
    const mandanten = sitzung.ansicht === 'gruppe' ? await gruppenMandanten(tx) : [];
    if (mandanten.length > 0) {
      await tx.unsafe(`select set_config('app.mandant_ids', $1, true)`,
        [mandanten.join(',')]);
    }

    const pruefer = rechtepruefer(abfrage);
    const entscheidung = await pruefeZugang(pfad, sitzung, pruefer);
    if (entscheidung.art !== 'erlaubt') {
      return {
        entscheidung, rolle: null, mandanten, sichtbareTabs: {}, mandantSlug: null,
      } satisfies Befund;
    }

    const rolle = await rolleImMandanten(tx, sitzung);
    /**
     * Die Leiste wird IN dieser Transaktion bewertet, nicht danach: die
     * Bindung steht nur hier, und `app.hat_recht` ohne sie antwortet `false`
     * auf alles. Und in EINER Abfrage: fuenf Rundreisen auf jedem
     * Seitenaufruf fuer eine Frage, die eine beantwortet, sind fuenfmal zu
     * viel.
     */
    const ziele = tableiste(leisteFuer(sitzung.portal, sitzung.ansicht, rolle)).ziele;
    const gefragt = [...new Set(
      ziele.map((z) => z.recht).filter((r): r is string => r !== null),
    )];
    const gehalten = await pruefer.hatRechte(gefragt, sitzung.aktiverMandantId);
    const sichtbareTabs: Record<string, boolean> = {};
    for (const z of ziele) {
      sichtbareTabs[z.schluessel] = z.recht === null || gehalten.has(z.recht);
    }
    const [m] = sitzung.aktiverMandantId === null ? [] : await abfrage<{ slug: string }>(
      `select slug from mandant where id = $1`, [sitzung.aktiverMandantId],
    );
    return {
      entscheidung, rolle, mandanten, sichtbareTabs, mandantSlug: m?.slug ?? null,
    } satisfies Befund;
  }) as Promise<Befund>);

  const { entscheidung } = befund;
  if (entscheidung.art === 'anmeldung') return null;
  if (entscheidung.art === 'falsches_portal') {
    /**
     * Die K-04-Decke: eine Arbeiterin, die `/portal/reinigung` tippt, landet
     * in ihrem Portal — nicht auf einem 404, das sie ratlos zurücklässt.
     *
     * Die Ziele stehen als LITERALE da und nicht als `entscheidung.ziel`.
     * `typedRoutes` prüft `redirect()` gegen die bekannten Routen, und ein zur
     * Laufzeit gebauter Pfad ist keine — ein Cast hätte die Prüfung
     * ausgeschaltet, statt sie zu erfüllen. Der Preis ist diese Verzweigung;
     * der Gewinn ist, dass ein Tippfehler im Ziel den Build bricht statt eine
     * Weiterleitung ins Nichts zu bauen.
     */
    if (sitzung.portal === 'mitarbeiter') redirect('/portal/mein');
    if (sitzung.portal === 'kunde') redirect('/portal/kunde');
    // Ein `intern`-Portal hat keine feste Wurzel — der Mandant steht im Pfad.
    // Wer dort in eine fremde Familie greift, bekommt 404 wie alle anderen.
    notFound();
  }
  if (entscheidung.art !== 'erlaubt') {
    /**
     * `unbekannt`, `kein_recht`, `zweiter_faktor` — alle drei enden als 404
     * und NICHT als 403 (AUT-06, SEC-A3). Ein 403 bestätigt, dass es die
     * Sache gibt; genau das ist die Auskunft, die niemand bekommen soll.
     * Deshalb dieselbe Antwort für drei verschiedene Gründe.
     */
    notFound();
  }

  return {
    sitzung,
    rolle: befund.rolle,
    leiste: leisteFuer(sitzung.portal, sitzung.ansicht, befund.rolle),
    gruppenMandanten: befund.mandanten,
    sichtbareTabs: befund.sichtbareTabs,
    mandantSlug: befund.mandantSlug,
  };
}

export { PORTAL_START };
