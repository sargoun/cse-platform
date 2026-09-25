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
  FARBTOKEN, ladeAbwesenheitsarten, type AbwesenheitsartZeile,
} from '@/server/services/stammdaten/abwesenheitsart';
import { SPRACHEN, SPRACHE_TEXT, pflegbar, sperrgrund }
  from '@/server/services/stammdaten/katalog';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../unterseite';

/**
 * `/portal/[mandant]/stammdaten/abwesenheitsarten` — der Katalog, auf den sich
 * jede Krankmeldung und jeder Urlaubsantrag beruft (EMP-05, EMP-10, K-17,
 * O-139; SEITENKARTE §5.13).
 *
 * **Diese Seite ist der Ort, an dem O-139 beantwortet wird.** Sieben Arten
 * stehen im Bestand, und bei allen sieben ist `bezahlt` NULL — ungeklaert, mit
 * Absicht und ohne Default (0073). Der Abwesenheitsdienst weist die Verwendung
 * einer ungeklaerten Art ab (`ArtUngeklaertFehler`); bis die Frage beantwortet
 * ist, kann also niemand Urlaub melden. Deshalb steht die Frage VOR der Liste
 * und nicht als Fussnote.
 *
 * **„bezahlt" hat drei Zustaende, nie zwei.** Ja, nein, ungeklaert. Eine
 * Oberflaeche mit Haekchen haette zwei, und das fehlende Haekchen hiesse
 * „nein" — also unbezahlter Urlaub, still und plausibel aussehend.
 *
 * **Der Plattformkatalog steht hier lesbar und nicht bearbeitbar.** Die sieben
 * Arten gelten fuer alle vier Gesellschaften (`mandant_id IS NULL`); sie
 * pflegt die Super-Administration mit zweitem Faktor (0275). Ein
 * Bearbeiten-Knopf an diesen Zeilen waere ein Versprechen, das die Datenbank
 * abweist — deshalb steht dort der Grund statt eines Knopfs.
 *
 * // TODO(client, O-690): Führt jede Gesellschaft eigene Abwesenheitsarten,
 * oder gilt der Katalog gruppenweit einheitlich — und muss der
 * Lohnartenschlüssel je Art in allen drei Rechtseinheiten derselbe sein
 * (ACC-12)?
 */
export const dynamic = 'force-dynamic';

const FARBE_TEXT: Readonly<Record<string, string>> = {
  success: 'grün (success)', warning: 'gelb (warning)', danger: 'rot (danger)',
  info: 'blau (info)', neutral: 'grau (neutral)',
};

export default async function Abwesenheitsarten(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const { hinweis } = await searchParams;
  const pfad = `/portal/${mandant}/stammdaten/abwesenheitsarten`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => ({
      arten: await ladeAbwesenheitsarten(kontext),
      /*
       * Ob diese Sitzung Plattformzeilen pflegen darf, entscheidet die
       * Datenbank — hier wird dieselbe Funktion gefragt, die in der Policy
       * steht. Eine zweite Fassung dieser Regel in TypeScript liefe
       * auseinander, und der Knopf saehe dann anders aus als das Ergebnis.
       */
      chef: await kontext.abfrage<{ ja: boolean }>(
        `select app.ist_super_admin() as ja`),
    }))) as Promise<{
      arten: readonly AbwesenheitsartZeile[];
      chef: readonly { ja: boolean }[];
    }>);
  const arten = daten.arten;
  const istChef = daten.chef[0]?.ja === true;

  // Der Verweis auf die Abwesenheiten nur, wo die Sitzung sie auch oeffnen
  // darf — ein Menuepunkt auf 404 verraet, was er nicht zeigen darf (AUT-06).
  const darf = await haeltRechte(zugang.sitzung, 'zeit.abwesenheit_lesen');

  const offen = arten.filter((a) => a.archiviertAm === null && a.bezahlt === null).length;
  const eigene = arten.filter((a) => !a.istPlattform && a.archiviertAm === null).length;

  const feld = 'mt-s2 min-h-11 w-full rounded-md border border-line bg-surface-3 '
    + 'p-s3 text-sm text-text';
  const klein = 'w-full rounded-md border border-line bg-surface px-s3 py-s2 text-sm text-text';

  return (
    <PortalRahmen
      titel="Abwesenheitsarten"
      wurzelTitel="Stammdaten"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s3 text-h1 text-text">Abwesenheitsarten</h1>

      {typeof hinweis === 'string' && hinweis !== '' ? (
        <p data-cse="stammdaten-hinweis"
           className="mb-s5 rounded-lg border border-line bg-surface-3 p-s4 text-sm text-text">
          {hinweis}
        </p>
      ) : null}

      {/*
        * Die offene Frage steht VOR der Liste: wer hier eine Art einem
        * Antragsformular zuordnet, soll vorher wissen, dass die Lohnfolge
        * ungeklaert ist.
        */}
      <p data-cse="arten-offen" data-offen={String(offen)}
         className="mb-s5 max-w-prose rounded-lg border border-warning bg-warning-soft p-s4 text-sm text-warning">
        {offen === 0
          ? 'Für jede laufende Art ist beantwortet, ob sie bezahlt ist (O-139).'
          : `Bei ${String(offen)} laufenden Art(en) ist ungeklärt, ob sie bezahlt `
            + 'sind (O-139). „Ungeklärt" ist nicht „nein": solange die Angabe fehlt, '
            + 'weist die Abwesenheitsmeldung diese Art mit benanntem Grund ab und '
            + 'rät nichts. Zur Antwort gehören ausserdem der Nachweis ab Tag N und '
            + 'der Lohnartenschlüssel je Art (ACC-12).'}
      </p>

      <Hinweis art="hinweis" cse="arten-stufen" className="mb-s7 max-w-[72ch]">
        <strong>Zwei Stufen.</strong> Die Arten mit der Herkunft
        „Plattform" gelten für alle vier Gesellschaften und werden von der
        Super-Administration gepflegt (mit zweitem Faktor) — diese Sitzung
        {istChef ? ' darf das' : ' darf das nicht'}. Eigene Arten gehören dieser
        Gesellschaft; es sind derzeit {String(eigene)}. Ein Schlüssel kann nicht auf
        beiden Stufen gleichzeitig aktiv sein: im Antragsformular stünden sonst zwei
        gleich aussehende Einträge mit verschiedener Lohnfolge.
        {' '}Gelöscht wird hier nichts — das Ende einer Art ist ihre Archivierung,
        damit ein Stundennachweis von vorletztem Jahr lesbar bleibt.
      </Hinweis>

      <section aria-labelledby="arten-titel" className="mb-s7">
        <h2 id="arten-titel" className="mb-s3 text-h2 text-text">Katalog</h2>
        {arten.length === 0 ? (
          <p data-cse="arten-leer"
             className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            Es ist keine Abwesenheitsart hinterlegt. Ohne sie kann niemand Urlaub
            oder eine Krankmeldung melden.
          </p>
        ) : (
          <div data-cse="arten">
            <DataTable
              beschriftung="Abwesenheitsarten mit Herkunft, Lohnfolge, Kontenwirkung und Nachweispflicht"
              zeilen={[...arten]}
              schluessel={(a) => a.id}
              spalten={[
                {
                  schluessel: 'bezeichnung', kopf: 'Bezeichnung',
                  zelle: (a) => (
                    <span data-cse="art-zeile" data-schluessel={a.schluessel}>
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
                  zelle: (a) => (a.istPlattform
                    ? <span className="text-xs text-text-muted">Plattform</span>
                    : <span className="text-xs text-text">diese Gesellschaft</span>),
                },
                {
                  schluessel: 'bezahlt', kopf: 'Bezahlt',
                  zelle: (a) => (a.bezahlt === null
                    ? (
                      <span className="flex items-center gap-s2" data-cse="art-bezahlt" data-wert="offen">
                        <StatusPill zustand="Offen" />
                        <span className="text-xs text-warning">ungeklärt (O-139)</span>
                      </span>
                    )
                    : (
                      <span data-cse="art-bezahlt" data-wert={a.bezahlt ? 'ja' : 'nein'}
                            className="text-sm text-text">
                        {a.bezahlt ? 'ja' : 'nein'}
                      </span>
                    )),
                },
                {
                  schluessel: 'konten', kopf: 'Wirkung',
                  zelle: (a) => (
                    <span className="text-xs text-text-muted">
                      {[
                        a.zaehltAufUrlaubskonto ? 'Urlaubskonto' : null,
                        a.erzeugtStundenkontoBewegung ? 'Stundenkonto' : null,
                        a.istGesundheitsbezogen ? 'Art. 9 DSGVO' : null,
                      ].filter((t) => t !== null).join(' · ') || 'keine'}
                    </span>
                  ),
                },
                {
                  schluessel: 'nachweis', kopf: 'Nachweis ab Tag', numerisch: true,
                  zelle: (a) => (a.nachweisPflichtAbTagen === null
                    ? <span className="text-xs text-warning">offen (O-139)</span>
                    : String(a.nachweisPflichtAbTagen)),
                },
                {
                  schluessel: 'lohnart', kopf: 'Lohnart',
                  zelle: (a) => (a.lohnartSchluessel === null
                    ? <span className="text-xs text-warning">offen (O-139)</span>
                    : <code className="text-xs text-text">{a.lohnartSchluessel}</code>),
                },
                {
                  schluessel: 'farbe', kopf: 'Farbe',
                  zelle: (a) => (
                    <span className="text-xs text-text-muted">
                      {a.farbeToken === null ? '—' : FARBE_TEXT[a.farbeToken] ?? a.farbeToken}
                    </span>
                  ),
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
                        <span data-cse="art-gesperrt" className="text-xs text-text-muted">
                          {grund}
                        </span>
                      );
                    }
                    return (
                      <details data-cse="art-bearbeiten">
                        <summary className="min-h-11 cursor-pointer text-sm font-semibold text-text">Bearbeiten</summary>
                        <form method="post"
                              action={`/api/stammdaten/abwesenheitsarten?was=aendern&mandant=${mandant}`}
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
                          <label className="text-xs text-text-muted" htmlFor={`bezahlt-${a.id}`}>
                            Bezahlt
                          </label>
                          <select id={`bezahlt-${a.id}`} name="bezahlt" className={klein}
                                  defaultValue={a.bezahlt === null ? 'offen' : a.bezahlt ? 'ja' : 'nein'}>
                            <option value="ja">ja</option>
                            <option value="nein">nein</option>
                            <option value="offen">ungeklärt (O-139)</option>
                          </select>
                          <label className="flex items-center gap-s2 text-xs text-text">
                            <input type="checkbox" name="zaehltAufUrlaubskonto" value="ja"
                                   defaultChecked={a.zaehltAufUrlaubskonto} />
                            zählt auf das Urlaubskonto
                          </label>
                          <label className="flex items-center gap-s2 text-xs text-text">
                            <input type="checkbox" name="erzeugtStundenkontoBewegung" value="ja"
                                   defaultChecked={a.erzeugtStundenkontoBewegung} />
                            erzeugt eine Stundenkontobewegung
                          </label>
                          <label className="flex items-center gap-s2 text-xs text-text">
                            <input type="checkbox" name="istGesundheitsbezogen" value="ja"
                                   defaultChecked={a.istGesundheitsbezogen} />
                            gesundheitsbezogen (Art. 9 DSGVO)
                          </label>
                          <p className="text-xs text-text-subtle">
                            Ist die Art schon verwendet, bleiben Schlüssel und
                            Art-9-Einstufung fest — der Versuch wird mit einem Satz
                            abgewiesen. Ob sie verwendet ist, zeigt diese Seite nicht:
                            der Grund einer Abwesenheit ist ein Gesundheitsdatum und
                            hier nicht lesbar.
                          </p>
                          <label className="text-xs text-text-muted" htmlFor={`tage-${a.id}`}>
                            Nachweis ab Tag (leer = offen)
                          </label>
                          <input id={`tage-${a.id}`} name="nachweisAbTagen" type="number"
                                 min={0} step={1} className={klein}
                                 defaultValue={a.nachweisPflichtAbTagen ?? ''} />
                          <label className="text-xs text-text-muted" htmlFor={`lohn-${a.id}`}>
                            Lohnartenschlüssel (leer = offen)
                          </label>
                          <input id={`lohn-${a.id}`} name="lohnartSchluessel" type="text"
                                 className={klein} defaultValue={a.lohnartSchluessel ?? ''} />
                          <label className="text-xs text-text-muted" htmlFor={`farbe-${a.id}`}>
                            Farbe im Kalender
                          </label>
                          <select id={`farbe-${a.id}`} name="farbeToken" className={klein}
                                  defaultValue={a.farbeToken ?? ''}>
                            <option value="">ohne</option>
                            {FARBTOKEN.map((t) => (
                              <option key={t} value={t}>{FARBE_TEXT[t] ?? t}</option>
                            ))}
                          </select>
                          <Button type="submit" variante="primary" className="mt-s2">
                            Speichern
                          </Button>
                        </form>
                        <form method="post"
                              action={`/api/stammdaten/abwesenheitsarten?was=archivieren&mandant=${mandant}`}
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
        <h2 id="neu-titel" className="text-h2 text-text">Art anlegen</h2>
        <p className="mt-s2 text-xs text-text-muted">
          Eine neue Art gehört dieser Gesellschaft
          {istChef ? ' — oder, wenn angehakt, der Plattform und damit allen vier' : ''}.
          Der Schlüssel reist in Exporte und Lohnzuordnungen und ist danach fest.
        </p>
        <form method="post"
              action={`/api/stammdaten/abwesenheitsarten?was=anlegen&mandant=${mandant}`}>
          <label className="mt-s4 block text-sm text-text" htmlFor="neu-schluessel">
            Schlüssel
          </label>
          <input id="neu-schluessel" name="schluessel" type="text" required className={feld}
                 placeholder="unbezahlt_kurz" />
          <p className="mt-s2 text-xs text-text-muted">
            Kleinbuchstaben, Ziffern und Unterstriche, 2 bis 41 Zeichen.
          </p>

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
            spricht vier Sprachen (EMP-12). Ohne hinterlegte Fassung steht dort die
            deutsche Bezeichnung.
          </p>

          <label className="mt-s4 block text-sm text-text" htmlFor="neu-bezahlt">Bezahlt</label>
          <select id="neu-bezahlt" name="bezahlt" required className={feld} defaultValue="offen">
            <option value="ja">ja</option>
            <option value="nein">nein</option>
            <option value="offen">ungeklärt (O-139)</option>
          </select>

          <label className="mt-s4 flex min-h-11 items-center gap-s3 text-sm text-text">
            <input type="checkbox" name="zaehltAufUrlaubskonto" value="ja" />
            zählt auf das Urlaubskonto
          </label>
          <label className="flex min-h-11 items-center gap-s3 text-sm text-text">
            <input type="checkbox" name="erzeugtStundenkontoBewegung" value="ja" />
            erzeugt eine Stundenkontobewegung
          </label>
          <label className="flex min-h-11 items-center gap-s3 text-sm text-text">
            <input type="checkbox" name="istGesundheitsbezogen" value="ja" />
            gesundheitsbezogen (Art. 9 DSGVO)
          </label>
          <p className="text-xs text-text-muted">
            Gesundheitsbezogen färbt jede Zeile, die auf diese Art zeigt: der
            Dienstplan zeigt dann „abwesend" und nie den Grund, und der Zugriff auf
            den Grund steht im Prüfprotokoll.
          </p>

          <label className="mt-s4 block text-sm text-text" htmlFor="neu-tage">
            Nachweis ab Tag (leer = offen)
          </label>
          <input id="neu-tage" name="nachweisAbTagen" type="number" min={0} step={1}
                 className={feld} />

          <label className="mt-s4 block text-sm text-text" htmlFor="neu-lohn">
            Lohnartenschlüssel (leer = offen)
          </label>
          <input id="neu-lohn" name="lohnartSchluessel" type="text" className={feld} />

          <label className="mt-s4 block text-sm text-text" htmlFor="neu-farbe">
            Farbe im Kalender
          </label>
          <select id="neu-farbe" name="farbeToken" className={feld} defaultValue="">
            <option value="">ohne</option>
            {FARBTOKEN.map((t) => <option key={t} value={t}>{FARBE_TEXT[t] ?? t}</option>)}
          </select>
          <p className="mt-s2 text-xs text-text-muted">
            Nur die semantischen Tokens aus DESIGN §1 — ein Hexwert wäre eine
            Gestaltungsentscheidung an der falschen Stelle.
          </p>

          {istChef ? (
            <label className="mt-s4 flex min-h-11 items-center gap-s3 text-sm text-text">
              <input type="checkbox" name="plattform" value="ja" />
              als Plattformart für alle vier Gesellschaften
            </label>
          ) : null}

          <Button type="submit" variante="primary" className="mt-s5">Art anlegen</Button>
        </form>
      </section>

      <p className="mt-s5 max-w-prose text-sm text-text-muted">
        Welche Antragsart welche dieser Arten verlangt, steht in den{' '}
        <Link href={`/portal/${mandant}/stammdaten/antragsarten`}
              className="text-text underline-offset-2 hover:text-brand hover:underline">
          Antragsarten
        </Link>
        .
        {darf['zeit.abwesenheit_lesen'] === true ? (
          <>
            {' '}Die erfassten Abwesenheiten selbst stehen unter{' '}
            <Link href={`/portal/${mandant}/personal/abwesenheiten`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline">
              Personal · Abwesenheiten
            </Link>
            .
          </>
        ) : null}
      </p>
    </PortalRahmen>
  );
}
