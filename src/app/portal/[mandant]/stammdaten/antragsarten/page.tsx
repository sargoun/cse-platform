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
  SCHALTER, ladeAntragsarten, type AntragsartZeile,
} from '@/server/services/stammdaten/antragsart';
import { SPRACHEN, SPRACHE_TEXT, pflegbar, sperrgrund }
  from '@/server/services/stammdaten/katalog';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../unterseite';

/**
 * `/portal/[mandant]/stammdaten/antragsarten` — welche Anträge es überhaupt
 * gibt und was jeder verlangt (EMP-10, EMP-12, K-17, O-142; SEITENKARTE §5.13).
 *
 * **Dieser Katalog ist nicht unvollständig, er ist unbeantwortet.** Drei Arten
 * stehen im Bestand — Urlaub, Krankmeldung, Schichttausch —, und alle drei
 * sind Systemzeilen: an ihnen hängen zwei Datenbank-Auslöser und damit die
 * Kette Antrag → Abwesenheit. Welche WEITEREN Arten die Gruppe führt, hat
 * niemand gesagt (O-142). Bis dahin gibt es hier nichts zu ändern und alles
 * anzulegen.
 *
 * **Vier der sechs Schalter steuern das Antragsformular, zwei nicht** — und
 * die zwei sind die teureren: `erzeugt_abwesenheit` wirkt erst bei der
 * GENEHMIGUNG, `ist_stammdatenaenderung` ausschliesslich im Auslöser
 * `kern.antrag_pflichtfelder`. Diese Seite schreibt an jeden Schalter, WO er
 * wirkt; eine Liste mit sechs gleich aussehenden Häkchen wäre für die zwei
 * falsch.
 */
export const dynamic = 'force-dynamic';

const WO_TEXT: Readonly<Record<string, string>> = {
  formular: 'Antragsformular',
  entscheidung: 'erst bei der Genehmigung',
  datenbank: 'nur im Datenbank-Auslöser',
};

export default async function Antragsarten(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const { hinweis } = await searchParams;
  const pfad = `/portal/${mandant}/stammdaten/antragsarten`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  /*
   * Die Zahl der Antraege je Art liest nur, wer Antraege lesen darf
   * (`t_mandant` auf `antrag` verlangt `zeit.abwesenheit_lesen`). Das Recht
   * wird VOR der Abfrage gefragt: eine leere RLS-Antwort waere sonst eine 0,
   * und die saehe aus wie „diese Art benutzt niemand".
   */
  const darf = await haeltRechte(
    zugang.sitzung, 'zeit.abwesenheit_lesen', 'zeit.antrag_entscheiden');

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => ({
      arten: await ladeAntragsarten(kontext, darf['zeit.abwesenheit_lesen'] === true),
      chef: await kontext.abfrage<{ ja: boolean }>(`select app.ist_super_admin() as ja`),
    }))) as Promise<{
      arten: readonly AntragsartZeile[];
      chef: readonly { ja: boolean }[];
    }>);
  const arten = daten.arten;
  const istChef = daten.chef[0]?.ja === true;
  const pflegbare = arten.filter(
    (a) => a.archiviertAm === null && pflegbar(a, istChef)).length;

  const feld = 'mt-s2 min-h-11 w-full rounded-md border border-line bg-surface-3 '
    + 'p-s3 text-sm text-text';
  const klein = 'w-full rounded-md border border-line bg-surface px-s3 py-s2 text-sm text-text';

  return (
    <PortalRahmen
      titel="Antragsarten"
      wurzelTitel="Stammdaten"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s3 text-h1 text-text">Antragsarten</h1>

      {typeof hinweis === 'string' && hinweis !== '' ? (
        <p data-cse="stammdaten-hinweis"
           className="mb-s5 rounded-lg border border-line bg-surface-3 p-s4 text-sm text-text">
          {hinweis}
        </p>
      ) : null}

      <p data-cse="antragsarten-offen" data-pflegbar={String(pflegbare)}
         className="mb-s5 max-w-prose rounded-lg border border-warning bg-warning-soft p-s4 text-sm text-warning">
        Unbeantwortete Frage: welche weiteren Antragsarten führt die Gruppe —
        unbezahlte Freistellung, Freizeitausgleich, Schichtabgabe,
        Stammdatenänderung (O-142)? Die drei vorhandenen Arten stammen aus der
        Leistungsbeschreibung (EMP-10) und sind Systemzeilen; geändert werden sie
        nicht.
        {pflegbare === 0
          ? ' Solange die Frage offen ist, gibt es hier keine pflegbare Zeile — nur '
            + 'das Formular, mit dem eine neue Art entsteht.'
          : ` Pflegbar sind derzeit ${String(pflegbare)} Art(en).`}
      </p>

      <Hinweis art="hinweis" cse="antragsarten-schalter" className="mb-s7 max-w-[72ch]">
        <strong>Wo die sechs Schalter wirken.</strong>
        <ul className="mt-s3 space-y-s2">
          {SCHALTER.map((s) => (
            <li key={s.feld} data-cse="schalter" data-wo={s.wo}>
              <span className="text-text">{s.label}</span>
              <span className="ml-s2 text-xs text-text-subtle">{WO_TEXT[s.wo] ?? s.wo}</span>
              <span className="block text-xs text-text-muted">{s.wirkung}</span>
            </li>
          ))}
        </ul>
      </Hinweis>

      <section aria-labelledby="arten-titel" className="mb-s7">
        <h2 id="arten-titel" className="mb-s3 text-h2 text-text">Katalog</h2>
        {arten.length === 0 ? (
          <p data-cse="antragsarten-leer"
             className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            Es ist keine Antragsart hinterlegt. Ohne sie kann im Mitarbeiterportal
            nichts beantragt werden.
          </p>
        ) : (
          <div data-cse="antragsarten">
            <DataTable
              beschriftung="Antragsarten mit Herkunft, Pflichtfeldern, Folgewirkung und Bestand"
              zeilen={[...arten]}
              schluessel={(a) => a.id}
              spalten={[
                {
                  schluessel: 'bezeichnung', kopf: 'Bezeichnung',
                  zelle: (a) => (
                    <span data-cse="antragsart-zeile" data-schluessel={a.schluessel}>
                      <span className="text-text">{a.bezeichnung}</span>
                      <code className="ml-s2 text-xs text-text-subtle">{a.schluessel}</code>
                      {Object.keys(a.bezeichnungI18n).length > 1 ? (
                        <span className="ml-s2 text-xs text-text-subtle">
                          {Object.keys(a.bezeichnungI18n).filter((s) => s !== 'de').join(' · ')}
                        </span>
                      ) : null}
                    </span>
                  ),
                },
                {
                  schluessel: 'herkunft', kopf: 'Herkunft',
                  zelle: (a) => (
                    <span className="text-xs text-text-muted">
                      {a.istPlattform ? 'Plattform' : 'diese Gesellschaft'}
                      {a.istSystem ? ' · System (EMP-10)' : ''}
                    </span>
                  ),
                },
                {
                  schluessel: 'formular', kopf: 'Verlangt im Formular',
                  zelle: (a) => (
                    <span className="text-xs text-text-muted">
                      {[
                        a.erfordertZeitraum ? 'Zeitraum' : null,
                        a.erfordertAbwesenheitsart ? 'Abwesenheitsart' : null,
                        a.erfordertEinsatz ? 'Schicht' : null,
                        a.erfordertTauschpartner ? 'Tauschpartner' : null,
                      ].filter((t) => t !== null).join(' · ') || 'nichts'}
                    </span>
                  ),
                },
                {
                  schluessel: 'folge', kopf: 'Folge',
                  zelle: (a) => (
                    <span className="text-xs text-text-muted">
                      {[
                        a.erzeugtAbwesenheit ? 'Genehmigung erzeugt Abwesenheit' : null,
                        a.istStammdatenaenderung ? 'Änderungswunsch erlaubt' : null,
                      ].filter((t) => t !== null).join(' · ') || '—'}
                    </span>
                  ),
                },
                {
                  schluessel: 'bestand', kopf: 'Anträge', numerisch: true,
                  zelle: (a) => (a.antraege === null
                    ? (
                      <span className="text-xs text-text-subtle"
                            title="Antragsbestand liest, wer zeit.abwesenheit_lesen hält">
                        nicht lesbar
                      </span>
                    )
                    : String(a.antraege)),
                },
                {
                  schluessel: 'zustand', kopf: 'Zustand',
                  zelle: (a) => (a.archiviertAm === null
                    ? <StatusPill zustand="Aktiv" />
                    : <StatusPill zustand="Archiviert" />),
                },
                {
                  schluessel: 'handlung', kopf: '',
                  zelle: (a) => {
                    if (a.archiviertAm !== null) {
                      return <span className="text-text-subtle">—</span>;
                    }
                    const grund = sperrgrund(a, istChef);
                    if (!pflegbar(a, istChef) && grund !== null) {
                      return (
                        <span data-cse="antragsart-gesperrt" className="text-xs text-text-muted">
                          {grund}
                        </span>
                      );
                    }
                    return (
                      <details data-cse="antragsart-bearbeiten">
                        <summary className="min-h-11 cursor-pointer text-sm font-semibold text-text">Bearbeiten</summary>
                        <form method="post"
                              action={`/api/stammdaten/antragsarten?was=aendern&mandant=${mandant}`}
                              className="mt-s3 flex w-64 flex-col gap-s2">
                          <input type="hidden" name="id" value={a.id} />
                          <input type="hidden" name="schluessel" value={a.schluessel} />
                          <input type="hidden" name="plattform"
                                 value={a.istPlattform ? 'ja' : 'nein'} />
                          <label className="text-xs text-text-muted" htmlFor={`bez-${a.id}`}>
                            Bezeichnung (deutsch)
                          </label>
                          <input id={`bez-${a.id}`} name="bezeichnung" type="text" required
                                 defaultValue={a.bezeichnung} className={klein} />
                          {SPRACHEN.filter((s) => s !== 'de').map((s) => (
                            <span key={s} className="flex flex-col gap-s1">
                              <label className="text-xs text-text-subtle"
                                     htmlFor={`i18n-${s}-${a.id}`}>
                                {SPRACHE_TEXT[s]}
                              </label>
                              <input id={`i18n-${s}-${a.id}`} name={`i18n_${s}`} type="text"
                                     defaultValue={a.bezeichnungI18n[s] ?? ''} className={klein} />
                            </span>
                          ))}
                          {SCHALTER.map((s) => (
                            <label key={s.feld} className="flex items-start gap-s2 text-xs text-text">
                              <input type="checkbox" name={s.feld} value="ja"
                                     defaultChecked={a[s.feld as keyof AntragsartZeile] === true} />
                              <span>
                                {s.label}
                                <span className="ml-s2 text-text-subtle">
                                  {WO_TEXT[s.wo] ?? s.wo}
                                </span>
                              </span>
                            </label>
                          ))}
                          <Button type="submit" variante="primary" className="mt-s2">
                            Speichern
                          </Button>
                        </form>
                        <form method="post"
                              action={`/api/stammdaten/antragsarten?was=archivieren&mandant=${mandant}`}
                              className="mt-s3">
                          <input type="hidden" name="id" value={a.id} />
                          <Button type="submit" variante="secondary">Archivieren</Button>
                        </form>
                      </details>
                    );
                  },
                },
              ]}
            />
          </div>
        )}
      </section>

      <section aria-labelledby="neu-titel"
               className="max-w-prose rounded-lg border border-line bg-surface p-s5">
        <h2 id="neu-titel" className="text-h2 text-text">Antragsart anlegen</h2>
        <p className="mt-s2 text-xs text-text-muted">
          Erst mit der Antwort auf O-142 ist klar, welche Arten hier stehen sollen.
          Bis dahin entsteht mit diesem Formular genau die Art, die jemand
          ausdrücklich verlangt — geraten wird keine.
        </p>
        <form method="post"
              action={`/api/stammdaten/antragsarten?was=anlegen&mandant=${mandant}`}>
          <label className="mt-s4 block text-sm text-text" htmlFor="neu-schluessel">
            Schlüssel
          </label>
          <input id="neu-schluessel" name="schluessel" type="text" required className={feld}
                 placeholder="freizeitausgleich" />

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
          <p className="mt-s2 text-xs text-text-muted">
            Die Art erscheint im Antragsformular des Mitarbeiterportals, und das
            spricht vier Sprachen (EMP-12).
          </p>

          {SCHALTER.map((s) => (
            <span key={s.feld}>
              <label className="mt-s4 flex min-h-11 items-start gap-s3 text-sm text-text">
                <input type="checkbox" name={s.feld} value="ja" />
                <span>
                  {s.label}
                  <span className="ml-s2 text-xs text-text-subtle">
                    {WO_TEXT[s.wo] ?? s.wo}
                  </span>
                  <span className="block text-xs text-text-muted">{s.wirkung}</span>
                </span>
              </label>
            </span>
          ))}

          {istChef ? (
            <label className="mt-s4 flex min-h-11 items-center gap-s3 text-sm text-text">
              <input type="checkbox" name="plattform" value="ja" />
              als Plattformart für alle vier Gesellschaften
            </label>
          ) : null}

          <Button type="submit" variante="primary" className="mt-s5">
            Antragsart anlegen
          </Button>
        </form>
      </section>

      <p className="mt-s5 max-w-prose text-sm text-text-muted">
        Welche Abwesenheitsarten zur Wahl stehen, steht in den{' '}
        <Link href={`/portal/${mandant}/stammdaten/abwesenheitsarten`}
              className="text-text underline-offset-2 hover:text-brand hover:underline">
          Abwesenheitsarten
        </Link>
        .
        {darf['zeit.antrag_entscheiden'] === true ? (
          <>
            {' '}Die eingegangenen Anträge stehen unter{' '}
            <Link href={`/portal/${mandant}/personal/antraege`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline">
              Personal · Anträge
            </Link>
            .
          </>
        ) : null}
      </p>
    </PortalRahmen>
  );
}
