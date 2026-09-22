import 'server-only';
import { notFound, redirect } from 'next/navigation';
import type postgres from 'postgres';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { pruefeZugang, rechtepruefer, PORTAL_START } from '@/server/auth/zugang';
import { bindeAnfrage, gruppenMandanten, rolleImMandanten } from '@/server/kontext/index';
import {
  GRUPPEN_NAVIGATION, KUNDEN_NAVIGATION, NAVIGATION,
} from '@/server/registry/navigation';
import { modulAktiv, type Modulbuchung } from '@/server/registry/modul';
import { familie, findeRoute } from '@/server/registry/routen';
import { leisteFuer, tableiste, type LeistenSchluessel }
  from '@/server/registry/tableiste';
import { istPortalSprache, type PortalSprache } from '@/lib/i18n/texte';
import type { Sitzung } from '@/server/kontext/index';
import { merkeHuelle } from './huellen-speicher';
import { rueckwegFuer, rueckwegRechte, type RueckwegZiel }
  from '@/server/registry/rueckweg';

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
  /**
   * Die gewaehlte Sprache dieser Sitzung (EMP-12, D-592) — `null` heisst
   * „keine Wahl getroffen", nicht „Deutsch".
   *
   * **Jedes Portal, nicht mehr nur das der Arbeiterin.** Sie kam urspruenglich
   * fuer die Huellen, die nicht durch `MeinRahmen` gehen und trotzdem von
   * einer Arbeiterin erreicht werden (`/portal/konto/profil`,
   * `/portal/mein/nachrichten`). Seit das interne Portal zweisprachig ist,
   * liest sie auch dort — `internSprache()` bildet die vier Portalsprachen auf
   * die zwei internen ab.
   *
   * **Woher der Wert kommt, ist eine Regel und keine Formalie.** Hat das Konto
   * eine Person, gilt `person.sprache`; hat es keine — ein reines
   * Verwaltungskonto —, gilt `benutzer.sprache`. Genau so steht es seit 0007
   * im Kommentar der Spalte, und genau so schreibt `konto/sprache.ts`
   * zurueck. Beide Seiten muessen dieselbe Spalte meinen, sonst speichert der
   * Umschalter dorthin, wo niemand liest.
   */
  readonly sprache: PortalSprache | null;
  /** Die Adresse, fuer die dieses Tor gefragt wurde — der Rueckweg nach einem Wechsel. */
  readonly pfad: string;
  /**
   * Eine Gruppensitzung auf einer Mandantsseite: der Bereich, in den sie
   * wechseln KOENNTE (D-474) — oder `null`, wenn das hier keine Frage ist.
   *
   * Steht er, hat das Tor das Recht der Seite NICHT geprueft: in der
   * Gruppenansicht antwortet `app.hat_recht` auf alles ausser Lesen mit
   * `false` (0008, Invariante 10), und die Frage „darf ich diese Seite
   * sehen" ist erst im Bereich sinnvoll gestellt. `slugTor` macht daraus das
   * Wechselblatt; die Seite selbst rendert nichts von ihrem Inhalt.
   */
  readonly wechselZiel: WechselZiel | null;
  /**
   * Der Weg zurueck — abgeleitet aus der Adresse, geprueft gegen die Rechte
   * seines Ziels (DESIGN §5 „The way back", D-613, V-108).
   *
   * `null` heisst „hier gehoert keiner hin" ODER „das Ziel darf diese Sitzung
   * nicht oeffnen". Die Huelle unterscheidet beides nicht und soll es auch
   * nicht: in beiden Faellen steht kein Pfeil da.
   */
  readonly rueckweg: RueckwegZiel | null;
}

export interface WechselZiel {
  readonly slug: string;
  readonly name: string;
}

interface Befund {
  readonly entscheidung: Awaited<ReturnType<typeof pruefeZugang>>;
  readonly rolle: string | null;
  readonly mandanten: readonly string[];
  readonly sichtbareTabs: Readonly<Record<string, boolean>>;
  readonly navigationsRechte: Readonly<Record<string, boolean>>;
  readonly mandantSlug: string | null;
  readonly modulGesperrt: boolean;
  readonly sprache: PortalSprache | null;
  readonly wechselZiel: WechselZiel | null;
  readonly rueckweg: RueckwegZiel | null;
}

/**
 * Der Slug einer `/portal/[mandant]/…`-Adresse — oder `null` fuer jede andere
 * Familie. Gefragt wird die ROUTE aus dem Manifest, nicht die rohe Adresse:
 * `/portal/gruppe/auftraege` beginnt auch mit `/portal/`.
 */
function mandantSlugAus(pfad: string): string | null {
  const route = findeRoute(pfad);
  if (route === undefined || familie(route.pfad) !== 'mandant') return null;
  const teile = pfad.split('?')[0]?.split('/').filter((t) => t !== '') ?? [];
  return teile[0] === 'portal' && teile[1] !== undefined ? teile[1] : null;
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

    /**
     * **Eine Gruppensitzung auf einer Mandantsseite bekommt das Wechselblatt
     * — bevor irgendein Recht gefragt wird (D-474).**
     *
     * Vorher lief hier `pruefeZugang`, und das fragte `app.hat_recht` im
     * Gruppen-Scope. Dort antwortet die Funktion auf jede Aktion ausser
     * `lesen` und `exportieren` mit `false` (0008, Invariante 10) — richtig
     * fuer die Gruppenansicht, aber die Person wollte gar nicht in der
     * Gruppenansicht handeln: sie hat die Adresse eines Bereichs getippt oder
     * aus einem Chat kopiert. Die Antwort war 404 fuer eine Seite, die sie
     * nach einem Klick haette sehen duerfen.
     *
     * Das Blatt verraet nichts, was der Switcher nicht ohnehin zeigt:
     * `app.mandant_fuer_wechsel` antwortet nur fuer Bereiche, die diese
     * Anmeldung wechseln darf, und fuer alles andere `null` — dann geht es
     * unten weiter, und das Tor antwortet wie bisher (404, nie 403). Ob die
     * SEITE im Bereich sichtbar ist, entscheidet das Tor erst nach dem
     * Wechsel, im richtigen Scope — ein GET wechselt ihn nicht (§4.5).
     */
    const zielSlug = sitzung.ansicht === 'gruppe' ? mandantSlugAus(pfad) : null;
    if (zielSlug !== null) {
      const [z] = await abfrage<{ id: string | null; name: string | null }>(
        `select z.id, m.name
           from app.mandant_fuer_wechsel($1) as z(id)
           left join mandant m on m.id = z.id`,
        [zielSlug],
      );
      if (z?.id !== null && z?.id !== undefined) {
        return {
          entscheidung: { art: 'erlaubt' }, rolle: null, mandanten, sichtbareTabs: {},
          navigationsRechte: {}, mandantSlug: null, modulGesperrt: false, sprache: null,
          wechselZiel: { slug: zielSlug, name: z.name ?? zielSlug }, rueckweg: null,
        } satisfies Befund;
      }
    }

    const pruefer = rechtepruefer(abfrage);
    const entscheidung = await pruefeZugang(pfad, sitzung, pruefer);
    if (entscheidung.art !== 'erlaubt') {
      return {
        entscheidung, rolle: null, mandanten, sichtbareTabs: {}, navigationsRechte: {},
        mandantSlug: null, modulGesperrt: false, sprache: null, wechselZiel: null,
        rueckweg: null,
      } satisfies Befund;
    }

    const rolle = await rolleImMandanten(tx, sitzung);
    /*
     * Die Sprache der Person — in DERSELBEN gebundenen Transaktion, unter
     * `t_person_lesen`: die eigene Zeile darf jede Sitzung lesen. Faellt die
     * Abfrage leer aus, bleibt es bei Deutsch statt bei einem Fehler.
     */
    const [sp] = sitzung.personId !== null
      ? await abfrage<{ sprache: string | null }>(
        `select sprache from person where id = $1`, [sitzung.personId])
      /*
       * Kein Mensch hinter dem Konto: dann ist `benutzer.sprache` die Quelle.
       * Die eigene Zeile darf jede Sitzung lesen (`t_benutzer_lesen`,
       * `id = app.aktueller_benutzer()`) — und nur die eigene, weshalb hier
       * kein `where` auf eine fremde id moeglich waere.
       */
      : await abfrage<{ sprache: string | null }>(
        `select sprache from benutzer where id = $1`, [sitzung.benutzerId]);
    const rohSprache = sp?.sprache ?? '';
    const sprache = istPortalSprache(rohSprache) ? rohSprache : null;
    /**
     * Slug UND gebuchte Module in EINER Abfrage — sie stehen in derselben
     * Zeile, und eine zweite Rundreise fuer eine Spalte daneben waere eine
     * Rundreise auf jedem Seitenaufruf.
     */
    const [m] = sitzung.aktiverMandantId === null ? [] : await abfrage<{
      slug: string; module: readonly string[] | null; module_gepflegt: boolean;
    }>(`select slug, module, module_gepflegt from mandant where id = $1`,
      [sitzung.aktiverMandantId]);
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
    const rueckweg = rueckwegFuer(pfad);
    const gefragt = [...new Set([
      ...ziele.map((z) => z.recht).filter((r): r is string => r !== null),
      ...NAVIGATION.map((n) => n.recht),
      /*
       * Und die GRUPPEN-Rechte dazu. Sie sind andere Schluessel
       * (`gruppe.objekt.lesen` gegen `objekt.lesen`, 0004/0009) und wurden
       * hier nie gefragt — in der Gruppenansicht war `navigationsRechte`
       * damit fuer jeden Gruppenpunkt `undefined`. Heute traegt keine
       * Gruppenleiste ein `Mehr`-Blatt, das danach fragt; sobald eines
       * dazukaeme, waere es leer, und niemand saehe warum.
       */
      ...GRUPPEN_NAVIGATION.map((n) => n.recht),
      /*
       * **Und die Rechte des KUNDENbaums** (V-043).
       *
       * Er war der dritte, den niemand fragte — und die Folge war dieselbe
       * wie bei den Gruppenrechten: jeder Punkt `undefined`, also
       * unsichtbar. `zusatzRecht` kommt mit, weil zwei Kundenrouten ZWEI
       * Leserechte verlangen (`rechnungen`, `nachweise`) und `pruefeZugang`
       * sie mit UND verknuepft; ein Punkt, der nur das erste prueft, fuehrte
       * auf 404 (AUT-06, D-581).
       */
      ...KUNDEN_NAVIGATION.flatMap(
        (n) => (n.zusatzRecht === undefined ? [n.recht] : [n.recht, n.zusatzRecht])),
      /*
       * **Und die Rechte des RUECKWEGZIELS** (AUT-06, D-613, V-108).
       *
       * Der Rueckweg wird aus der Adresse abgeleitet (`rueckwegFuer`), nicht
       * je Seite geschrieben. Sein Ziel ist aber eine echte Seite mit einem
       * echten Recht — ein Pfeil darauf, den der Benutzer nicht oeffnen darf,
       * fuehrt auf einen 404 und verraet damit, dass es sie gibt.
       *
       * Gefragt wird HIER und nicht in der Huelle: das Tor haelt die Sitzung
       * und die gebundene Transaktion, die Huelle keines von beiden. Und es
       * kostet nichts — die Schluessel wandern in dieselbe Rundreise, die
       * ohnehin laeuft.
       */
      ...(rueckweg === null ? [] : rueckwegRechte(rueckweg.muster)),
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
    const buchung: Modulbuchung = sitzung.ansicht === 'gruppe'
      ? { module: [], gepflegt: false }
      : { module: m?.module ?? [], gepflegt: m?.module_gepflegt === true };
    const frei = (recht: string | null): boolean =>
      recht === null || modulAktiv(buchung, recht);

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
    /**
     * **Die Liste haengt am SCOPE, und beide zusammenzuwerfen war ein
     * Fehler.**
     *
     * Hier stand `[...NAVIGATION, ...GRUPPEN_NAVIGATION]`. Beide Register
     * benutzen dieselben Schluessel — `objekte`, `auftraege`, `rechnungen`,
     * `dokumente`, `dienstplan`, `freigaben`, `agenten`, `berichte` — mit
     * VERSCHIEDENEN Rechten: `objekt.lesen` gegen `gruppe.objekt.lesen`. Der
     * zweite Durchlauf ueberschrieb damit den ersten, und eine `leitung` im
     * Mandanten verlor jeden Punkt, dessen Gruppenrecht sie nicht haelt — das
     * `Mehr`-Blatt am Telefon war um acht Ziele aermer. Gefunden hat es
     * `crm.spec.ts`, das genau diesen Punkt sucht.
     *
     * Eine Sitzung ist entweder im Gruppen-Scope oder nicht. Gefragt wird
     * deshalb die Liste, die zu ihr gehoert — und nicht beide in eine Karte.
     */
    const navigationsRechte: Record<string, boolean> = {};
    /*
     * DREI Baeume, nicht zwei (V-043). Eine Sitzung gehoert zu genau einem:
     * Gruppenansicht, Kundenportal oder internes Portal. Beide anderen in
     * dieselbe Karte zu legen waere ein Punkt, der in der falschen Leiste
     * auftaucht.
     */
    const baum = sitzung.ansicht === 'gruppe' ? GRUPPEN_NAVIGATION
      : sitzung.portal === 'kunde' ? KUNDEN_NAVIGATION
      : NAVIGATION;
    for (const n of baum) {
      navigationsRechte[n.schluessel] = gehalten.has(n.recht) && frei(n.recht)
        /* Beide Rechte, wo die Route beide verlangt — UND, nicht ODER. */
        && (n.zusatzRecht === undefined
          || (gehalten.has(n.zusatzRecht) && frei(n.zusatzRecht)));
    }

    /**
     * Und dieselbe Frage fuer die SEITE, nicht nur fuer das Menue.
     *
     * Ein ausgeblendeter Menuepunkt ist keine Sperre — die Adresse tippen
     * kann jeder. Ohne diese Zeile antwortete `/portal/bau/reinigung/reviere`
     * weiterhin 200, und das Menue haette die Luecke nur unsichtbar gemacht.
     * 404 und nicht 403: ein 403 bestaetigt, dass es die Seite gibt (AUT-06).
     *
     * Geprueft werden LESE- und SCHREIBRECHTE der Route, obwohl `pruefeZugang`
     * nur die Leserechte fuer den Zugang heranzieht. Das ist eine Stufe
     * strenger und mit Absicht: eine Seite, die man lesen darf und deren
     * Schaltflaeche in ein nicht gebuchtes Gewerk schreibt, waere ein Knopf,
     * der beim Druecken 404 gibt. Heute unterscheidet keine Route die beiden
     * Seiten — nachgemessen ueber alle Manifestzeilen —, also kostet die
     * Strenge nichts und faengt den Tag ab, an dem eine dazukommt.
     *
     * `some` und nicht `every`: mehrere Leserechte sind eine UND-Verknuepfung
     * (`zugang.ts` sammelt jedes fehlende in `fehlend`), also genuegt ein
     * ungebuchtes Modul, um die Seite unerreichbar zu machen. Dieselbe
     * Semantik, nur eine Frage frueher.
     */
    /*
     * Der Rueckweg gilt nur, wenn ALLE Leserechte seines Ziels gehalten
     * werden UND das Modul gebucht ist — dieselbe UND-Verknuepfung wie beim
     * Menuepunkt. Faellt eines, gibt es keinen Pfeil; eine Seite ohne
     * Rueckweg ist unbequem, ein Pfeil auf einen 404 ist eine Auskunft.
     */
    const rueckwegErlaubt = rueckweg !== null
      && rueckwegRechte(rueckweg.muster).every((r) => gehalten.has(r) && frei(r));

    const route = findeRoute(pfad);
    const bewachung = route?.bewachung;
    const modulGesperrt = bewachung !== undefined && bewachung.art === 'recht'
      && [...bewachung.lesen, ...bewachung.schreiben].some((r) => !modulAktiv(buchung, r));
    return {
      entscheidung, rolle, mandanten, sichtbareTabs, navigationsRechte,
      mandantSlug: m?.slug ?? null, modulGesperrt, sprache, wechselZiel: null,
      rueckweg: rueckwegErlaubt ? rueckweg : null,
    } satisfies Befund;
  }) as Promise<Befund>);

  const { entscheidung } = befund;
  /**
   * **Ein nicht gebuchtes Modul sieht aus wie eine Seite, die es nicht gibt**
   * — und fuer diese Gesellschaft ist es das auch (D-377, AUT-06).
   *
   * Diese Zeile stand zuerst IM Rueckruf der Transaktion und griff dort auf
   * `befund` zu — also auf das Ergebnis eben jener Transaktion, die gerade
   * laeuft. TypeScript sieht das nicht: in einer Closure ist die Bindung im
   * Gueltigkeitsbereich, nur zur Laufzeit noch nicht belegt. Der Build war
   * sauber, und JEDE Portalseite antwortete mit 500
   * („Cannot access 'c' before initialization"). Gefunden hat es der
   * Browserlauf, nicht der Typpruefer.
   */
  if (befund.modulGesperrt) notFound();
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

  /*
   * Die Sprache in den Anfragespeicher, damit `PortalRahmen` sie ohne
   * Eigenschaft findet (D-592). NACH den Abbruechen: eine Seite, die auf 404
   * faellt, rendert keine Huelle, und ein Wert im Kasten waere dort nur ein
   * Rest der vorigen Zeile im Code.
   */
  merkeHuelle(befund.sprache, pfad, befund.rueckweg === null ? null : {
    ziel: befund.rueckweg.ziel, segment: befund.rueckweg.segment,
  });

  return {
    sitzung,
    rolle: befund.rolle,
    leiste: leisteFuer(sitzung.portal, sitzung.ansicht, befund.rolle),
    gruppenMandanten: befund.mandanten,
    sichtbareTabs: befund.sichtbareTabs,
    navigationsRechte: befund.navigationsRechte,
    rueckweg: befund.rueckweg,
    mandantSlug: befund.mandantSlug,
    modulGesperrt: befund.modulGesperrt,
    sprache: befund.sprache,
    pfad,
    wechselZiel: befund.wechselZiel,
  };
}

export { PORTAL_START };
