import type postgres from 'postgres';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { bindeAnfrage } from '@/server/kontext/index';
import { AnmeldungNoetig } from '../../portal/Anmeldung';
import { Marke } from '@/components/marke/Marke';
import { StatusPill } from '@/components/ui/StatusPill';
import { istBereich } from '@/lib/design/theme';
import { internSprache } from '@/lib/i18n/intern';
import type { PortalSprache } from '@/lib/i18n/texte';
import { BEREICHSWECHSEL_TEXTE, unterzeile } from '@/lib/i18n/verwaltung/bereichswechsel';
import { leseEigeneSprache } from '@/server/konto/sprache';
import {
  umschalterStand, zaehltFuer, type UmschalterEintrag,
} from '@/server/services/mandant/umschalter';

/**
 * `/auth/bereich` — die Bereichswahl (03-AUTH §4.4, SEITENKARTE §11.3).
 *
 * **Jede Zeile ist ein eigenes Formular mit Absendeknopf, kein Link.** Genau
 * das verlangt §11.3, und aus demselben Grund wie ueberall: koennte ein GET
 * den aktiven Bereich aendern, WAERE die URL der Mandantenzustand. Enter auf
 * einer Zeile loest damit eine Formularuebermittlung aus und keine Navigation.
 *
 * **Nichts ist vorausgewaehlt.** §4.4 sagt es woertlich: bei mehr als einer
 * Mitgliedschaft wird nichts automatisch gewaehlt. `ist_standard` ist ein
 * Hinweis auf die Reihenfolge, nie eine Wahl.
 *
 * **Jede Zeile traegt ihren Live-Zaehler** (TEN-10, V-165): „Reinigung · 24
 * laufende Auftraege" — aus `app.mandant_kennzahlen()` (0417, 0418), nur fuer
 * eine interne Sitzung und nur, wo dieser Mensch im jeweiligen Bereich intern
 * arbeitet und das Leserecht haelt (D-660). Der Gruppeneintrag traegt
 * sichtbar `NUR LESEN` (DESIGN §6 Regel 3) und nennt die WIRKLICHE Zahl der
 * Gesellschaften, nicht „vier".
 */
export const dynamic = 'force-dynamic';

interface Wahl {
  readonly bereiche: readonly UmschalterEintrag[];
  readonly gruppe: boolean;
  /** Der Slug des AKTIVEN Bereichs — der Weg zurueck, falls es einen gibt. */
  readonly aktiv: string | null;
  readonly sprache: PortalSprache | null;
}

async function wahl(sitzung: Parameters<typeof bindeAnfrage>[1]): Promise<Wahl> {
  return db().begin(async (tx: postgres.TransactionSql) => {
    await bindeAnfrage(tx, sitzung);
    const abfrage = async <T,>(q: string, w: readonly unknown[] = []): Promise<readonly T[]> =>
      (await tx.unsafe(q, w as never[])) as unknown as readonly T[];
    /**
     * `switcher_mandanten()` und nicht `sichtbare_mandanten()` (B14): ein
     * archivierter Bereich bleibt lesbar, wird aber nicht mehr als
     * Arbeitskontext angeboten. `umschalterStand` fragt
     * `app.umschalter_bereiche()`, `app.darf_gruppenansicht()` und
     * `app.mandant_kennzahlen()` — alle `security definer`, alle auf
     * `switcher_mandanten()` beschraenkt, und dieselben wie in der Kopfzeile
     * jeder Portalseite.
     *
     * **Die Zaehler nur fuer eine interne Sitzung** (D-660). Diese Seite
     * erreicht auch das Kundenportal: seine Kopfzeile verweist bei zwei
     * Bereichen hierher. Ohne diese Angabe sah ein Kundenkonto hier den
     * Auftragsbestand jeder Gesellschaft ueber alle Kunden. Der
     * Gruppeneintrag wird fuer jede Sitzung gefragt, wie vor V-165: ob sie
     * ihn betreten darf, sagt `app.darf_gruppenansicht()`, nicht ihr Portal.
     */
    const stand = await umschalterStand({ abfrage }, {
      gruppe: true, zaehler: zaehltFuer(sitzung),
    });
    const sprache = await leseEigeneSprache({
      abfrage, personId: sitzung.personId, benutzerId: sitzung.benutzerId,
    });
    /*
     * `switcher_bereiche()` sagt, WOHIN gewechselt werden kann, nicht, wo man
     * gerade steht. Ohne diese Zeile wusste die Seite nicht, ob es ueberhaupt
     * ein Zurueck gibt — und bot deshalb keines an.
     */
    const [a] = sitzung.aktiverMandantId === null ? [] : (await tx.unsafe(
      `select slug from mandant where id = $1`, [sitzung.aktiverMandantId],
    )) as { slug: string }[];
    return { bereiche: stand.bereiche, gruppe: stand.gruppe, aktiv: a?.slug ?? null, sprache };
  }) as Promise<Wahl>;
}

export default async function Bereichswahl() {
  const sitzung = await aktuelleSitzung();
  if (sitzung === null) return <AnmeldungNoetig />;
  const { bereiche, gruppe, aktiv, sprache } = await wahl(sitzung);
  const s = internSprache(sprache);
  const t = BEREICHSWECHSEL_TEXTE[s];
  /*
   * **Diese Seite war eine Sackgasse.**
   *
   * Sie rendert ein blankes `main` ohne Portalhuelle — richtig, denn wer den
   * Bereich noch nicht gewaehlt hat, hat auch keine Navigation, die sich aus
   * ihm ergaebe. Nur stand dann auf dem Bildschirm: eine Ueberschrift, eine
   * Zeile je Mitgliedschaft und sonst nichts. Wer die Seite aus einer
   * laufenden Sitzung heraus oeffnete — die Kopfzeile jeder Portalseite bietet
   * sie an —, kam ohne den Zurueck-Knopf des Browsers nicht mehr weg.
   *
   * `zurueck` ist deshalb nur dann gesetzt, wenn es wirklich ein Zurueck gibt:
   * ein aktiver Bereich oder die Gruppenansicht. Direkt nach der Anmeldung
   * gibt es keines, und dann steht hier auch keiner — ein Knopf, der auf eine
   * Seite fuehrt, die man nicht sehen darf, waere schlechter als keiner.
   */
  const zurueck = sitzung.ansicht === 'gruppe' ? '/portal/gruppe'
    : aktiv === null ? null : `/portal/${aktiv}`;

  return (
    <div className="relative min-h-dvh">
      <div aria-hidden="true"
           className="pointer-events-none fixed inset-0 bg-wash-brand" />

      <main className="relative mx-auto flex min-h-dvh w-full max-w-wahl flex-col
                       justify-start gap-s5 p-s5 sm:justify-center sm:p-s6">
        <a href="/" className="group inline-flex items-center gap-s3 self-start rounded-md p-s1">
          <Marke art="gruppe" groesse="lg" />
          <span className="flex flex-col">
            <span className="text-base font-semibold text-text">{t.gruppe}</span>
            <span className="text-xs text-text-subtle transition-colors duration-fast
                             ease-brand group-hover:text-text-muted">
              <span aria-hidden="true">←</span> {t.zurWebsite}
            </span>
          </span>
        </a>

        <section className="flex flex-col gap-s5 rounded-xl border border-line
                            bg-surface p-s5 sm:p-s6">
          <header className="flex flex-col gap-s2">
            <h1 className="m-0 text-h1 text-text">{t.titel}</h1>
            <p className="m-0 max-w-[58ch] text-base text-text-muted">{t.einleitung}</p>
          </header>

          {bereiche.length === 0 ? (
            <p data-cse="kein-bereich"
               className="m-0 rounded-lg border border-line bg-surface-2 p-s4 text-base
                          text-text-muted">
              {t.keinBereich}
            </p>
          ) : (
            /*
              * **Die ganze Zeile ist der Knopf** (DESIGN §5 „Chooser rows").
              *
              * Hier standen `secondary`-Knoepfe in voller Breite, einer je
              * Gesellschaft — vier graue Balken untereinander, alle gleich,
              * unterschieden nur durch ein Wort. Und das ist der Bildschirm,
              * auf dem jemand entscheidet, in WELCHER GmbH er gleich eine
              * Rechnung schreibt.
              *
              * Jede Zeile traegt jetzt ihr Zeichen in der Identitaetsfarbe
              * (§1) — genau der Unterschied, den §1 als Grund fuer die vier
              * Farben nennt: „a user working in three of them cannot tell at
              * a glance which one they are in".
              */
            <ul data-cse="bereichswahl" className="m-0 flex list-none flex-col gap-s3 p-0">
              {bereiche.map((b) => {
                const zeile = unterzeile(b.gewerke, b.zaehler, s);
                return (
                <li key={b.slug}>
                  <form method="post" action="/api/sitzung/mandant" className="m-0">
                    <input type="hidden" name="mandantSlug" value={b.slug} />
                    <button type="submit" data-bereich={b.slug}
                            className="flex min-h-16 w-full items-center gap-s4 rounded-lg
                                       border border-line bg-surface-2 p-s4 text-left
                                       transition-all duration-base ease-brand
                                       hover:-translate-y-px hover:border-line-strong">
                      <Marke art={istBereich(b.slug) ? b.slug : 'gruppe'} groesse="lg" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-base font-semibold text-text">
                          {b.name}
                        </span>
                        {zeile !== null && (
                          <span className="truncate text-sm text-text-muted"
                                data-cse="bereich-zaehler">
                            {zeile}
                          </span>
                        )}
                        <span className="text-sm text-text-muted">
                          {b.slug === aktiv ? t.aktuell : t.hierhin}
                        </span>
                      </span>
                      <span aria-hidden="true" className="shrink-0 text-text-subtle">→</span>
                    </button>
                  </form>
                </li>
                );
              })}
              {gruppe && (
                <li>
                  <form method="post" action="/api/sitzung/mandant" className="m-0">
                    <input type="hidden" name="gruppe" value="true" />
                    <button type="submit" data-bereich="gruppe"
                            className="flex min-h-16 w-full items-center gap-s4 rounded-lg
                                       border border-line bg-surface-2 p-s4 text-left
                                       transition-all duration-base ease-brand
                                       hover:-translate-y-px hover:border-line-strong">
                      <Marke art="gruppe" groesse="lg" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="text-base font-semibold text-text">
                          {t.gruppenuebersicht}
                        </span>
                        <span className="text-sm text-text-muted">
                          {t.gruppeZeile(bereiche.length)}
                        </span>
                      </span>
                      {/* DESIGN §6 Regel 3: sichtbar, nicht nur im Fliesstext. */}
                      <span data-cse="gruppe-nur-lesen" className="shrink-0">
                        <StatusPill zustand="Nur Lesen" sprache={sprache} />
                      </span>
                      <span aria-hidden="true" className="shrink-0 text-text-subtle">→</span>
                    </button>
                  </form>
                </li>
              )}
            </ul>
          )}
        </section>

        <nav aria-label={t.ausgang} data-cse="bereich-ausgang"
             className="flex flex-wrap items-center gap-s3 px-s2">
          {zurueck !== null && (
            <a href={zurueck} data-cse="bereich-zurueck"
               className="flex min-h-11 items-center rounded-md px-s2 text-sm text-text-muted
                          transition-colors duration-fast ease-brand hover:bg-surface-2
                          hover:text-text">
              ‹ {t.zurueckOhneWechsel}
            </a>
          )}
          <a href="/"
             className="flex min-h-11 items-center rounded-md px-s2 text-sm text-text-muted
                        transition-colors duration-fast ease-brand hover:bg-surface-2
                        hover:text-text">
            {t.website}
          </a>
          <span aria-hidden="true" className="h-5 w-px shrink-0 bg-line" />
          {/* Ein FORMULAR, kein Verweis: eine Abmeldung ändert Zustand. */}
          <form method="post" action="/api/abmelden" className="m-0">
            <button type="submit"
                    className="flex min-h-11 items-center rounded-md px-s2 text-sm
                               text-text-muted transition-colors duration-fast ease-brand
                               hover:bg-danger-soft hover:text-danger">
              {t.abmelden}
            </button>
          </form>
        </nav>
      </main>
    </div>
  );
}
