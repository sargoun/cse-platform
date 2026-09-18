import type postgres from 'postgres';
import Link from 'next/link';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill } from '@/components/ui/StatusPill';
import { Button } from '@/components/ui/Button';
import { haeltRechte } from '@/app/portal/rechte';
import {
  KATEGORIEN, KATEGORIE_TEXT, WARNSTUFEN_VORGABE, ladeQualifikationen,
  type QualifikationZeile,
} from '@/server/services/stammdaten/qualifikation';
import { SPRACHEN, SPRACHE_TEXT, pflegbar, sperrgrund }
  from '@/server/services/stammdaten/katalog';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../unterseite';

/**
 * `/portal/[mandant]/stammdaten/qualifikationen` — der Katalog, auf den sich
 * Nachweise und Posten berufen (SEC-01, SEC-04, EMP-08, LEG-04; O-107, O-144,
 * O-341, O-343; SEITENKARTE §5.13).
 *
 * **Ein Schalter auf dieser Seite sperrt Einteilungen.** `blockiert_einsatz`
 * wird nicht von einem Dienst durchgesetzt, sondern von
 * `app.einsatz_qualifikation_erfuellt` (0031): ab dem Moment, in dem der
 * Schalter steht, scheitert jede Zuweisung auf einem Posten, der diese
 * Qualifikation verlangt und für den kein gültiger Nachweis vorliegt. Wer ihn
 * ohne die Zahl der betroffenen Nachweise und Anforderungen davor umlegt,
 * erfährt die Folge vom Dienstplan. Die Zahlen stehen deshalb in der Zeile —
 * und wo das Recht fehlt, steht dort „nicht lesbar" und nicht „0".
 *
 * **Drei leere Felder sind offene Fragen, keine vergessenen Eingaben.**
 * `standard_gueltigkeit_monate` bleibt leer, bis O-341 die Frist des
 * Bewacherausweises beantwortet; `erfordert_dokument` hängt an O-343 (gehören
 * die Urkunden in die Plattform); die Kategorien warten auf O-144. Sie tragen
 * ihre Nummer sichtbar.
 *
 * **`nachweis_art_id` ist hier kein Feld.** Die Spalte wird von keiner
 * Codezeile gelesen; ein Formularfeld dafür pflegte einen toten Wert und sähe
 * aus wie eine Zuordnung, auf die sich etwas stützt (O-107).
 *
 * // TODO(client, O-691): Wer pflegt in der Gruppe den PLATTFORM-Katalog
 * (Qualifikationen, Abwesenheits- und Antragsarten) — und braucht eine
 * Änderung daran eine zweite Zustimmung?
 */
export const dynamic = 'force-dynamic';

export default async function Qualifikationen(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const { hinweis } = await searchParams;
  const pfad = `/portal/${mandant}/stammdaten/qualifikationen`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  /*
   * Die Reichweite ist rechtegebunden: `nachweis` liest mit
   * `personal.nachweis_lesen`, `einsatzanforderung` mit `security.lesen`. Das
   * Recht wird VOR der Abfrage gefragt — eine leere RLS-Antwort waere sonst
   * eine 0, und auf eine 0 stuetzte sich dann die Entscheidung ueber
   * `blockiert_einsatz`.
   */
  const darf = await haeltRechte(
    zugang.sitzung, 'personal.nachweis_lesen', 'security.lesen');

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => ({
      liste: await ladeQualifikationen(kontext, {
        nachweise: darf['personal.nachweis_lesen'] === true,
        anforderungen: darf['security.lesen'] === true,
      }),
      chef: await kontext.abfrage<{ ja: boolean }>(`select app.ist_super_admin() as ja`),
    }))) as Promise<{
      liste: readonly QualifikationZeile[];
      chef: readonly { ja: boolean }[];
    }>);
  const liste = daten.liste;
  const istChef = daten.chef[0]?.ja === true;

  const laufend = liste.filter((q) => q.archiviertAm === null);
  const ohneFrist = laufend.filter(
    (q) => q.laeuftAb && q.standardGueltigkeitMonate === null).length;
  const sperrend = laufend.filter((q) => q.blockiertEinsatz).length;

  const feld = 'mt-s2 min-h-11 w-full rounded-md border border-line bg-surface-3 '
    + 'p-s3 text-sm text-text';
  const klein = 'w-full rounded-md border border-line bg-surface px-s3 py-s2 text-sm text-text';

  return (
    <PortalRahmen
      titel="Qualifikationen"
      wurzelTitel="Stammdaten"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s3 text-h1 text-text">Qualifikationen</h1>

      {typeof hinweis === 'string' && hinweis !== '' ? (
        <p data-cse="stammdaten-hinweis"
           className="mb-s5 rounded-lg border border-line bg-surface-3 p-s4 text-sm text-text">
          {hinweis}
        </p>
      ) : null}

      <p data-cse="qualifikationen-offen" data-ohne-frist={String(ohneFrist)}
         className="mb-s5 max-w-prose rounded-lg border border-warning bg-warning-soft p-s4 text-sm text-warning">
        Vier Fragen hängen an genau den Feldern dieser Seite und sind offen: die
        Ablauffrist des Bewacherausweises (O-341 — deshalb bleibt die
        Standardgültigkeit bei {String(ohneFrist)} ablaufender Qualifikation(en)
        leer), ob die Urkunden in der Plattform liegen sollen (O-343), welche
        Kategorien die Nachweisberichte führen (O-144) und welche Nachweise die
        Gewerke überhaupt verlangen (O-107). Ein geratener Vorgabewert trüge sich in
        jeden neu erfassten Nachweis ein und sähe dort aus wie eine geprüfte Angabe.
      </p>

      <Hinweis art="warnung" cse="qualifikationen-sperre" className="mb-s7 max-w-[72ch]">
        <strong>„Blockiert Einsatz" ist eine harte Sperre.</strong> Sie wirkt ab dem
        Moment des Speicherns und wird in der Datenbank durchgesetzt
        (<code>app.einsatz_qualifikation_erfuellt</code>, SEC-04): eine Einteilung auf
        einem Posten, der die Qualifikation verlangt, scheitert ohne gültigen
        Nachweis — im Dienstplan und in der Eventbesetzung.
        {' '}{sperrend === 0
          ? 'Derzeit sperrt keine Qualifikation.'
          : `Derzeit sperren ${String(sperrend)} Qualifikation(en).`}
        {' '}Die Zahl der Nachweise und der Posten-Anforderungen steht in jeder Zeile:
        sie sagt, wie viele Einteilungen ein Häkchen betrifft.
      </Hinweis>

      <section aria-labelledby="katalog-titel" className="mb-s7">
        <h2 id="katalog-titel" className="mb-s3 text-h2 text-text">Katalog</h2>
        {liste.length === 0 ? (
          <p data-cse="qualifikationen-leer"
             className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            Es ist keine Qualifikation hinterlegt. Ohne Katalog verlangt kein Posten
            einen Nachweis — und die SEC-04-Prüfung findet nichts zu prüfen.
          </p>
        ) : (
          <div data-cse="qualifikationen">
            <DataTable
              beschriftung="Qualifikationen mit Kategorie, Rechtsgrundlage, Ablauf, Sperrwirkung und Reichweite"
              zeilen={[...liste]}
              schluessel={(q) => q.id}
              spalten={[
                {
                  schluessel: 'bezeichnung', kopf: 'Bezeichnung',
                  zelle: (q) => (
                    <span data-cse="qualifikation-zeile" data-schluessel={q.schluessel}>
                      <span className="text-text">{q.bezeichnung}</span>
                      <code className="ml-s2 text-xs text-text-subtle">{q.schluessel}</code>
                      {Object.keys(q.bezeichnungI18n).length > 1 ? (
                        <span className="ml-s2 text-xs text-text-subtle">
                          {Object.keys(q.bezeichnungI18n).filter((s) => s !== 'de').join(' · ')}
                        </span>
                      ) : null}
                    </span>
                  ),
                },
                {
                  schluessel: 'kategorie', kopf: 'Kategorie',
                  zelle: (q) => (
                    <span className="text-xs text-text-muted">
                      {KATEGORIE_TEXT[q.kategorie] ?? q.kategorie}
                    </span>
                  ),
                },
                {
                  schluessel: 'herkunft', kopf: 'Herkunft',
                  zelle: (q) => (
                    <span className="text-xs text-text-muted">
                      {q.istPlattform ? 'Plattform (gesetzlich)' : 'diese Gesellschaft'}
                    </span>
                  ),
                },
                {
                  schluessel: 'grundlage', kopf: 'Rechtsgrundlage',
                  zelle: (q) => (q.rechtsgrundlage === null
                    ? <span className="text-text-subtle">—</span>
                    : <span className="text-xs text-text-muted">{q.rechtsgrundlage}</span>),
                },
                {
                  schluessel: 'ablauf', kopf: 'Ablauf',
                  zelle: (q) => (!q.laeuftAb
                    ? <span className="text-xs text-text-muted">läuft nicht ab</span>
                    : q.standardGueltigkeitMonate === null
                      ? (
                        <span className="flex items-center gap-s2">
                          <StatusPill zustand="Offen" />
                          <span className="text-xs text-warning">Frist offen (O-341)</span>
                        </span>
                      )
                      : (
                        <span className="text-xs text-text">
                          {String(q.standardGueltigkeitMonate)} Monate
                        </span>
                      )),
                },
                {
                  schluessel: 'warnung', kopf: 'Warnt nach',
                  zelle: (q) => (
                    <span className="text-xs text-text-muted">
                      {q.warnungTage.length === 0 ? '—' : `${q.warnungTage.join(' / ')} Tage`}
                    </span>
                  ),
                },
                {
                  schluessel: 'sperre', kopf: 'Sperrt',
                  /*
                   * KEINE Statuspille. Das feste Vokabular aus DESIGN §5 kennt kein
                   * Wort fuer „gesperrt"; „Überfällig" stand hier und heisst dort
                   * „Frist verstrichen" — gelesen ergab die Zeile „Überfällig
                   * Einteilung", also einen Zustand, den diese Zeile nicht hat.
                   * Ein neues Pill-Wort waere zuerst eine Aenderung an DESIGN.md,
                   * nie umgekehrt; bis dahin traegt der Text die Aussage, wie es
                   * die Seite bei den Platzhaltermarken auch tut.
                   */
                  zelle: (q) => (q.blockiertEinsatz
                    ? (
                      <span className="text-xs text-danger" data-cse="qualifikation-sperrt">
                        sperrt die Einteilung (SEC-04)
                      </span>
                    )
                    : <span className="text-xs text-text-muted">warnt nur</span>),
                },
                {
                  schluessel: 'dokument', kopf: 'Urkunde',
                  /*
                   * `erfordert_dokument` ist `boolean not null default false` —
                   * ZWEI Zustaende. „offen (O-343)" an jedem ausgeschalteten
                   * Haekchen behauptete, die Frage sei fuer diese Zeile
                   * unbeantwortet, und machte ein bewusstes „nein" von „noch
                   * niemand gefragt" ununterscheidbar. Genau diese Verwechslung
                   * vermeidet `abwesenheitsart.bezahlt` mit drei Zustaenden.
                   * O-343 steht deshalb in der Frage VOR der Liste, nicht in
                   * jeder Zeile; dreiwertig zu werden waere eine Migration und
                   * gehoert hinter die Antwort.
                   */
                  zelle: (q) => (q.erfordertDokument
                    ? <span className="text-xs text-text">Pflicht</span>
                    : <span className="text-xs text-text-muted">nicht verlangt</span>),
                },
                {
                  schluessel: 'reichweite', kopf: 'Reichweite', numerisch: true,
                  zelle: (q) => (
                    <span className="text-xs text-text-muted">
                      {q.nachweise === null ? 'n. l.' : String(q.nachweise)} N ·{' '}
                      {q.anforderungen === null ? 'n. l.' : String(q.anforderungen)} A
                    </span>
                  ),
                },
                {
                  schluessel: 'zustand', kopf: 'Zustand',
                  zelle: (q) => (q.archiviertAm === null
                    ? <StatusPill zustand="Aktiv" />
                    : <StatusPill zustand="Archiviert" />),
                },
                {
                  schluessel: 'handlung', kopf: '',
                  zelle: (q) => {
                    if (q.archiviertAm !== null) {
                      return <span className="text-text-subtle">—</span>;
                    }
                    const grund = sperrgrund(q, istChef);
                    if (!pflegbar(q, istChef) && grund !== null) {
                      return (
                        <span data-cse="qualifikation-gesperrt" className="text-xs text-text-muted">
                          {grund}
                        </span>
                      );
                    }
                    return (
                      <details data-cse="qualifikation-bearbeiten">
                        <summary className="cursor-pointer text-sm text-brand">Bearbeiten</summary>
                        <form method="post"
                              action={`/api/stammdaten/qualifikationen?was=aendern&mandant=${mandant}`}
                              className="mt-s3 flex w-64 flex-col gap-s2">
                          <input type="hidden" name="id" value={q.id} />
                          <input type="hidden" name="schluessel" value={q.schluessel} />
                          <input type="hidden" name="plattform"
                                 value={q.istPlattform ? 'ja' : 'nein'} />
                          <label className="text-xs text-text-muted" htmlFor={`bez-${q.id}`}>
                            Bezeichnung (deutsch)
                          </label>
                          <input id={`bez-${q.id}`} name="bezeichnung" type="text" required
                                 defaultValue={q.bezeichnung} className={klein} />
                          {SPRACHEN.filter((s) => s !== 'de').map((s) => (
                            <span key={s} className="flex flex-col gap-s1">
                              <label className="text-xs text-text-subtle"
                                     htmlFor={`i18n-${s}-${q.id}`}>
                                {SPRACHE_TEXT[s]}
                              </label>
                              <input id={`i18n-${s}-${q.id}`} name={`i18n_${s}`} type="text"
                                     defaultValue={q.bezeichnungI18n[s] ?? ''} className={klein} />
                            </span>
                          ))}
                          <label className="text-xs text-text-muted" htmlFor={`kat-${q.id}`}>
                            Kategorie (O-144)
                          </label>
                          <select id={`kat-${q.id}`} name="kategorie" className={klein}
                                  defaultValue={q.kategorie}>
                            {KATEGORIEN.map((k) => (
                              <option key={k} value={k}>{KATEGORIE_TEXT[k]}</option>
                            ))}
                          </select>
                          <label className="text-xs text-text-muted" htmlFor={`rg-${q.id}`}>
                            Rechtsgrundlage (Anzeigetext)
                          </label>
                          <input id={`rg-${q.id}`} name="rechtsgrundlage" type="text"
                                 className={klein} defaultValue={q.rechtsgrundlage ?? ''} />
                          <label className="flex items-center gap-s2 text-xs text-text">
                            <input type="checkbox" name="laeuftAb" value="ja"
                                   defaultChecked={q.laeuftAb} />
                            läuft ab
                          </label>
                          <label className="text-xs text-text-muted" htmlFor={`mon-${q.id}`}>
                            Standardgültigkeit in Monaten (leer = offen, O-341)
                          </label>
                          <input id={`mon-${q.id}`} name="standardGueltigkeitMonate"
                                 type="number" min={1} step={1} className={klein}
                                 defaultValue={q.standardGueltigkeitMonate ?? ''} />
                          <label className="text-xs text-text-muted" htmlFor={`warn-${q.id}`}>
                            Warnstufen in Tagen
                          </label>
                          <input id={`warn-${q.id}`} name="warnungTage" type="text"
                                 className={klein} defaultValue={q.warnungTage.join(', ')} />
                          <label className="flex items-center gap-s2 text-xs text-text">
                            <input type="checkbox" name="blockiertEinsatz" value="ja"
                                   defaultChecked={q.blockiertEinsatz} />
                            blockiert die Einteilung (SEC-04)
                          </label>
                          <label className="flex items-center gap-s2 text-xs text-text">
                            <input type="checkbox" name="erfordertDokument" value="ja"
                                   defaultChecked={q.erfordertDokument} />
                            Nachweis nur mit hinterlegter Urkunde (O-343)
                          </label>
                          <p className="text-xs text-text-subtle">
                            Der Schlüssel bleibt, wie er ist — er steht in Berichten
                            und Exporten (Auslöser in 0030).
                          </p>
                          <Button type="submit" variante="primary" className="mt-s2">
                            Speichern
                          </Button>
                        </form>
                        <form method="post"
                              action={`/api/stammdaten/qualifikationen?was=archivieren&mandant=${mandant}`}
                              className="mt-s3">
                          <input type="hidden" name="id" value={q.id} />
                          <Button type="submit" variante="secondary">Archivieren</Button>
                        </form>
                      </details>
                    );
                  },
                },
              ]}
            />
            <p className="mt-s3 text-xs text-text-subtle">
              Reichweite: N = Nachweise von Menschen, A = Anforderungen an Posten.
              „n. l." heisst nicht lesbar mit Ihren Rechten — nicht „keine".
            </p>
          </div>
        )}
      </section>

      <section aria-labelledby="neu-titel"
               className="max-w-prose rounded-lg border border-line bg-surface p-s5">
        <h2 id="neu-titel" className="text-h2 text-text">Qualifikation anlegen</h2>
        <p className="mt-s2 text-xs text-text-muted">
          Eine neue Qualifikation gehört dieser Gesellschaft
          {istChef ? ' — oder, wenn angehakt, der Plattform und damit allen vier' : ''}.
          Gesetzliche Nachweise gehören auf die Plattformstufe: ein §34a-Nachweis
          gehört dem MENSCHEN und muss in jeder Gesellschaft benennbar sein, in der
          er arbeitet (D-09).
        </p>
        <form method="post"
              action={`/api/stammdaten/qualifikationen?was=anlegen&mandant=${mandant}`}>
          <label className="mt-s4 block text-sm text-text" htmlFor="neu-schluessel">
            Schlüssel
          </label>
          <input id="neu-schluessel" name="schluessel" type="text" required className={feld}
                 placeholder="hausordnung" />

          <label className="mt-s4 block text-sm text-text" htmlFor="neu-bezeichnung">
            Bezeichnung (deutsch)
          </label>
          <input id="neu-bezeichnung" name="bezeichnung" type="text" required className={feld} />

          {SPRACHEN.filter((s) => s !== 'de').map((s) => (
            <span key={s}>
              <label className="mt-s4 block text-sm text-text" htmlFor={`neu-i18n-${s}`}>
                Bezeichnung {SPRACHE_TEXT[s]}
              </label>
              <input id={`neu-i18n-${s}`} name={`i18n_${s}`} type="text" className={feld} />
            </span>
          ))}

          <label className="mt-s4 block text-sm text-text" htmlFor="neu-kategorie">
            Kategorie (O-144)
          </label>
          <select id="neu-kategorie" name="kategorie" required className={feld}
                  defaultValue="fachlich">
            {KATEGORIEN.map((k) => <option key={k} value={k}>{KATEGORIE_TEXT[k]}</option>)}
          </select>

          <label className="mt-s4 block text-sm text-text" htmlFor="neu-grundlage">
            Rechtsgrundlage (Anzeigetext)
          </label>
          <input id="neu-grundlage" name="rechtsgrundlage" type="text" className={feld}
                 placeholder="§34a Abs. 1a GewO" />
          <p className="mt-s2 text-xs text-text-muted">
            Anzeigetext und nie Grundlage einer Entscheidung: die maschinenlesbare
            Hälfte von §34a ist die Registerpflicht an der Posten-Anforderung.
          </p>

          <label className="mt-s4 block text-sm text-text" htmlFor="neu-beschreibung">
            Beschreibung
          </label>
          <input id="neu-beschreibung" name="beschreibung" type="text" className={feld} />

          <label className="mt-s4 flex min-h-11 items-center gap-s3 text-sm text-text">
            <input type="checkbox" name="laeuftAb" value="ja" />
            läuft ab
          </label>

          <label className="mt-s4 block text-sm text-text" htmlFor="neu-monate">
            Standardgültigkeit in Monaten (leer = offen, O-341)
          </label>
          <input id="neu-monate" name="standardGueltigkeitMonate" type="number" min={1}
                 step={1} className={feld} />
          <p className="mt-s2 text-xs text-text-muted">
            Leer lassen, wenn die Frist am einzelnen Nachweis steht — dort kommt sie
            her, aus dem Ausweis. Eine geratene Vorgabe trägt sich in jeden neuen
            Nachweis ein.
          </p>

          <label className="mt-s4 block text-sm text-text" htmlFor="neu-warn">
            Warnstufen in Tagen
          </label>
          <input id="neu-warn" name="warnungTage" type="text" className={feld}
                 defaultValue={WARNSTUFEN_VORGABE.join(', ')} />
          <p className="mt-s2 text-xs text-text-muted">
            SPEC §14 nennt 60, 30 und 7 Tage. Der Ablaufwächter meldet je Stufe genau
            einmal.
          </p>

          <label className="mt-s4 flex min-h-11 items-center gap-s3 text-sm text-text">
            <input type="checkbox" name="blockiertEinsatz" value="ja" />
            blockiert die Einteilung (SEC-04)
          </label>
          <label className="flex min-h-11 items-center gap-s3 text-sm text-text">
            <input type="checkbox" name="erfordertDokument" value="ja" />
            Nachweis nur mit hinterlegter Urkunde (O-343)
          </label>

          {istChef ? (
            <label className="mt-s4 flex min-h-11 items-center gap-s3 text-sm text-text">
              <input type="checkbox" name="plattform" value="ja" />
              als Plattform-Qualifikation für alle vier Gesellschaften
            </label>
          ) : null}

          <Button type="submit" variante="primary" className="mt-s5">
            Qualifikation anlegen
          </Button>
        </form>
      </section>

      <p className="mt-s5 max-w-prose text-sm text-text-muted">
        Die Nachweise der Menschen selbst — mit Gültigkeit, Urkunde und
        Ablaufwarnung — stehen
        {darf['personal.nachweis_lesen'] === true ? (
          <>
            {' '}im{' '}
            <Link href={`/portal/${mandant}/personal/nachweise`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline">
              Nachweisregister
            </Link>
            .
          </>
        ) : ' im Nachweisregister (dafür fehlt Ihrer Rolle das Leserecht).'}
      </p>
    </PortalRahmen>
  );
}
