import 'server-only';
import { notFound, redirect } from 'next/navigation';
import type postgres from 'postgres';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { pruefeZugang, rechtepruefer, PORTAL_START } from '@/server/auth/zugang';
import { bindeAnfrage, gruppenMandanten, rolleImMandanten } from '@/server/kontext/index';
import { NAVIGATION } from '@/server/registry/navigation';
import { modulAktiv } from '@/server/registry/module';
import { findeRoute } from '@/server/registry/routen';
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
   * Je NAVIGATIONS-Schluessel (`crm`, `objekte`, …): haelt die Sitzung das
   * Recht dieses Punktes?
   *
   * **Geschluesselt nach `schluessel`, nicht nach `recht`** — beide Leser,
   * `SeitenNavigation` am Schreibtisch und das `Mehr`-Blatt am Telefon,
   * schlagen unter dem Schluessel des Eintrags nach. Der Name des Feldes
   * sagt „Rechte", der Schluessel ist es nicht.
   *
   * Das fuenfte Ziel der Tab-Leiste ist `Mehr` und zeigt genau diesen Baum
   * (SEITENKARTE §11.2). Ohne die Rechte hier waere er entweder vollstaendig
   * — und fuehrte auf 404 — oder gar nicht da.
   */
  readonly navigationsRechte: Readonly<Record<string, boolean>>;
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
  /** Ist das Modul dieser Seite in dieser Gesellschaft gar nicht gebucht? */
  readonly modulGesperrt: boolean;
}

interface Befund {
  readonly entscheidung: Awaited<ReturnType<typeof pruefeZugang>>;
  readonly rolle: string | null;
  readonly mandanten: readonly string[];
  readonly sichtbareTabs: Readonly<Record<string, boolean>>;
  readonly navigationsRechte: Readonly<Record<string, boolean>>;
  readonly mandantSlug: string | null;
  readonly modulGesperrt: boolean;
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
    /**
   * Ein nicht gebuchtes Modul sieht von aussen aus wie eine Seite, die es
   * nicht gibt — und fuer diese Gesellschaft ist es das auch.
   */
  if (befund.modulGesperrt) notFound();
  if (entscheidung.art !== 'erlaubt') {
      return {
        entscheidung, rolle: null, mandanten, sichtbareTabs: {}, navigationsRechte: {},
        mandantSlug: null, modulGesperrt: false,
      } satisfies Befund;
    }

    const rolle = await rolleImMandanten(tx, sitzung);
    /**
     * Slug UND gebuchte Module in EINER Abfrage — sie stehen in derselben
     * Zeile, und eine zweite Rundreise fuer eine Spalte daneben waere eine
     * Rundreise auf jedem Seitenaufruf.
     */
    const [m] = sitzung.aktiverMandantId === null ? [] : await abfrage<{
      slug: string; module: readonly string[] | null;
    }>(`select slug, module from mandant where id = $1`, [sitzung.aktiverMandantId]);
    /**
     * Die Leiste wird IN dieser Transaktion bewertet, nicht danach: die
     * Bindung steht nur hier, und `app.hat_recht` ohne sie antwortet `false`
     * auf alles. Und in EINER Abfrage: fuenf Rundreisen auf jedem
     * Seitenaufruf fuer eine Frage, die eine beantwortet, sind fuenfmal zu
     * viel.
     */
    const ziele = tableiste(leisteFuer(sitzung.portal, sitzung.ansicht, rolle)).ziele;
    /**
     * Die Rechte der Tab-Leiste UND die des Navigationsbaums in EINER Frage.
     *
     * Das fuenfte Ziel der Leiste ist `Mehr` und zeigt den vollstaendigen
     * Baum (SEITENKARTE §11.2). Dessen Rechte hier mitzufragen kostet nichts —
     * sie stehen in derselben Abfrage; sie spaeter zu fragen kostete eine
     * zweite Rundreise auf jedem Seitenaufruf, und ausserhalb dieser
     * gebundenen Transaktion antwortete `app.hat_recht` ohnehin `false`.
     */
    const gefragt = [...new Set([
      ...ziele.map((z) => z.recht).filter((r): r is string => r !== null),
      ...NAVIGATION.map((n) => n.recht),
    ])];
    const gehalten = await pruefer.hatRechte(gefragt, sitzung.aktiverMandantId);
    /**
     * **Recht UND Modul** — die Schnittmenge, wie 0008 sie fuer
     * `benutzer_mandant.module` bildet.
     *
     * Das Recht allein reichte nicht, und das war der Befund des Mandanten:
     * `admin` und `leitung` halten `reinigung.lesen` mit
     * `rolle.mandant_id is null`, also in jedem Bereich. Ohne die zweite
     * Frage sah der Hochbau-Admin die Reinigung — und die Bauleitung der
     * Reinigung das Wachbuch.
     *
     * Im GRUPPEN-Scope gibt es keine Buchung, die entscheiden koennte: die
     * Ansicht umfasst mehrere Gesellschaften mit verschiedenen Modulen. Dort
     * bleibt es beim Recht; was die Gruppenansicht zeigt, ist ohnehin lesend
     * (Invariante 10) und je Zeile mandantengebunden.
     */
    const module = sitzung.ansicht === 'gruppe' ? [] : (m?.module ?? []);
    const frei = (recht: string | null): boolean =>
      recht === null || modulAktiv(module, recht);

    const sichtbareTabs: Record<string, boolean> = {};
    for (const z of ziele) {
      sichtbareTabs[z.schluessel] =
        (z.recht === null || gehalten.has(z.recht)) && frei(z.recht);
    }
    /*
     * **Geschluesselt nach `schluessel`, nicht nach `recht`.**
     *
     * Hier stand `navigationsRechte[n.recht] = …` — also `crm.lesen` als
     * Schluessel. `SeitenNavigation` schlaegt aber unter `z.schluessel` nach,
     * also `crm`. Jede Abfrage lief damit ins Leere, `undefined !== false`
     * war wahr, und die Sidebar zeigte JEDEN Punkt — auch den, dessen Recht
     * der Benutzer nicht haelt.
     *
     * Das ist genau der Fall, den das Register verhindern soll (AUT-06): ein
     * Menuepunkt, der auf einen 404 fuehrt, verraet die Existenz dessen, was
     * er nicht zeigen darf. Gemerkt haette man es nie, denn ein sichtbarer
     * Punkt zu viel sieht aus wie ein vollstaendiges Menue.
     */
    const navigationsRechte: Record<string, boolean> = {};
    for (const n of NAVIGATION) {
      navigationsRechte[n.schluessel] = gehalten.has(n.recht) && frei(n.recht);
    }

    /**
     * Und dieselbe Frage fuer die SEITE, nicht nur fuer das Menue.
     *
     * Ein ausgeblendeter Menuepunkt ist keine Sperre — die Adresse tippen
     * kann jeder. Ohne diese Zeile antwortete `/portal/bau/reinigung/reviere`
     * weiterhin 200, und das Menue haette die Luecke nur unsichtbar gemacht.
     * 404 und nicht 403: ein 403 bestaetigt, dass es die Seite gibt (AUT-06).
     */
    const route = findeRoute(pfad);
    const bewachung = route?.bewachung;
    const modulGesperrt = bewachung !== undefined && bewachung.art === 'recht'
      && [...bewachung.lesen, ...bewachung.schreiben].some((r) => !modulAktiv(module, r));
    return {
      entscheidung, rolle, mandanten, sichtbareTabs, navigationsRechte,
      mandantSlug: m?.slug ?? null, modulGesperrt,
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
    navigationsRechte: befund.navigationsRechte,
    mandantSlug: befund.mandantSlug,
    modulGesperrt: befund.modulGesperrt,
  };
}

export { PORTAL_START };
