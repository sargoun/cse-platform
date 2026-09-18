import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import {
  ladeKatalog, listePositionsauswahl, preisAus,
} from '@/server/services/katalog/index';
import { formatiereGeld } from '@/server/services/finanz/geld';
import { formatiereMenge, mengeAusPostgresOderNull } from '@/server/services/finanz/menge';
import { berlinKalendertag } from '@/server/services/zeit/dauer';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import { Hinweis } from '@/components/ui/Hinweis';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../unterseite';
import { haeltRechte } from '@/app/portal/rechte';
import { kennungOder404 } from '../../../kennung';
import { FEHLERTEXT, PILLE } from '../daten';
import { PositionsFelder } from './PositionsFelder';

/**
 * `/portal/[mandant]/leistungskatalog/[id]` — eine Fassung mit ihrem
 * Positionsbaum (OPS-06, CLN-05).
 *
 * **Jede Zeile mit `ist_platzhalter` traegt die Warnung, und die Kopfzeile
 * nennt die Zahl.** Aus einer Katalogposition wird eine Angebotszeile, aus der
 * eine Auftragszeile, aus der eine Rechnungsposition. Ein Preis, der aussieht
 * wie ein entschiedener, ist hier der teuerste Fehler.
 *
 * **Was diese Seite NICHT entscheidet: das Steuerkennzeichen.**
 * `steuer_kennzeichen` kennt `regelsatz`, `ermaessigt`, `steuerfrei` und
 * `reverse_charge_13b` — WELCHE Leistung welches traegt, haengt an O-60
 * (innergemeinschaftliche Lieferungen, § 19 UStG) und an der § 13b-Lage des
 * KUNDEN, nicht am Katalog. Vorgabe bleibt der Regelsatz, sichtbar
 * gekennzeichnet.
 *
 * **Hierarchie und Zyklen prueft die Seite nicht.**
 * `kern.pruefe_katalog_hierarchie` weist eine fremde Elternfassung, einen
 * Zyklus und mehr als 64 Stufen ab; der Dienst uebersetzt das in einen
 * benannten Satz. Eine zweite Fassung derselben Pruefung waere eine zweite
 * Stelle, an der sie falsch werden kann.
 *
 * **Ist die Fassung archiviert, rendert die Seite die Werte schreibgeschuetzt**
 * — mit dem Satz, warum. Nicht als Formular, das beim Absenden scheitert.
 */
export const dynamic = 'force-dynamic';

export default async function Katalogfassung(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const suche = await searchParams;
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;

  const pfad = `/portal/${mandant}/leistungskatalog/${id}`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const darf = await haeltRechte(zugang.sitzung, 'katalog.schreiben');

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => {
      const geladen = await ladeKatalog(kontext, id);
      if (geladen === null) return null;
      const auswahl = await listePositionsauswahl(kontext, id);
      return { ...geladen, auswahl };
    })) as Promise<{
      kopf: NonNullable<Awaited<ReturnType<typeof ladeKatalog>>>['kopf'];
      positionen: NonNullable<Awaited<ReturnType<typeof ladeKatalog>>>['positionen'];
      auswahl: Awaited<ReturnType<typeof listePositionsauswahl>>;
    } | null>);

  if (daten === null) notFound();
  const { kopf, positionen, auswahl } = daten;

  const archiviert = kopf.status === 'archiviert';
  const schreiben = darf['katalog.schreiben'] === true
    && zugang.sitzung.ansicht !== 'gruppe' && !archiviert;
  const offen = Number(kopf.platzhalter);

  return (
    <PortalRahmen
      titel={`${kopf.schluessel} v${String(kopf.version)}`}
      wurzelTitel="Leistungskatalog"
      bereich={mandant as BereichSchluessel}
      nurLesen={archiviert || zugang.sitzung.ansicht === 'gruppe'}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <nav aria-label="Zurück" className="mb-s3">
        <Link
          href={`/portal/${mandant}/leistungskatalog`}
          className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
        >
          ← Alle Fassungen
        </Link>
      </nav>

      <div className="mb-s4 flex flex-wrap items-center gap-s3">
        <h1 className="m-0 text-h1 text-text">{kopf.bezeichnung}</h1>
        <StatusPill zustand={PILLE[kopf.status] ?? 'Entwurf'} />
        {offen > 0 ? (
          <span
            data-cse="platzhalter-anzahl"
            className="rounded-full bg-warning-soft px-s3 py-s1 text-xs text-warning"
          >
            {offen} unbestätigt (offen, O-17, O-731)
          </span>
        ) : null}
      </div>

      {fehler === null ? null : (
        <Hinweis art="warnung" cse="katalog-fehler" className="mb-s5">
          <strong>Nichts wurde gespeichert.</strong>{' '}
          {FEHLERTEXT[fehler] ?? 'Der Vorgang wurde abgewiesen.'}
        </Hinweis>
      )}

      <dl className="m-0 mb-s6 grid grid-cols-1 gap-s4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
            Schlüssel
          </dt>
          <dd className="m-0 mt-s1 text-sm text-text">
            <code>{kopf.schluessel}</code>
          </dd>
        </div>
        <div>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Version</dt>
          <dd className="m-0 mt-s1 text-sm text-text">{kopf.version}</dd>
        </div>
        <div>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Gültig</dt>
          <dd className="m-0 mt-s1 text-sm text-text">
            {kopf.gueltig_ab} – {kopf.gueltig_bis ?? 'offen'}
          </dd>
        </div>
        <div>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
            Positionen
          </dt>
          <dd className="m-0 mt-s1 text-sm text-text">{kopf.positionen}</dd>
        </div>
      </dl>

      {archiviert ? (
        <Hinweis art="hinweis" cse="archiviert" className="mb-s6">
          <strong>Diese Fassung ist archiviert.</strong> Ihre Positionen sind
          unveränderlich (<code>kern.pruefe_katalog_offen</code>), und der Weg
          zurück ist gesperrt: er täute das Einfrieren auf, ohne dass es jemand
          sähe. Andere Werte brauchen eine <em>neue Fassung</em> mit demselben
          Schlüssel und der nächsten Versionsnummer. Darum steht hier kein
          Formular, das beim Absenden scheitern würde.
        </Hinweis>
      ) : null}

      {offen > 0 ? (
        <Hinweis art="warnung" cse="platzhalter-hinweis" className="mb-s6">
          <strong>{offen} Position(en) tragen unbestätigte Werte.</strong> Welche
          Zeitwerte und Standardpreise je Position gelten und wer sie freigibt,
          ist nicht entschieden — <strong>offen (O-731)</strong>; die
          Leistungswertfrage je Belagsart ist <strong>offen (O-17)</strong>. Die
          Werte stehen da, weil der CHECK <code>lkp_kalkulierbar</code>{' '}
          mindestens einen verlangt — und sie stehen als{' '}
          <em>gekennzeichnete Platzhalter</em>, nicht als Preise.
        </Hinweis>
      ) : null}

      {positionen.length === 0 ? (
        <p
          data-cse="positionen-leer"
          className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted"
        >
          Diese Fassung trägt noch keine Position.
        </p>
      ) : (
        <DataTable
          beschriftung="Positionen dieser Fassung, eingerückt nach Hierarchie"
          zeilen={positionen}
          schluessel={(p) => p.id}
          spalten={[
            {
              schluessel: 'oz', kopf: 'OZ',
              zelle: (p) => (
                /*
                 * Die Einrueckung kommt aus `tiefe` — gerechnet im
                 * `with recursive` der Datenbank, nicht hier.
                 *
                 * Als Stil und nicht als Tailwind-Klasse: die Tiefe entsteht
                 * zur LAUFZEIT, und `pl-[…]` mit einem eingesetzten Wert
                 * existiert im erzeugten Stylesheet nicht — Tailwind sieht
                 * die Klasse beim Uebersetzen nie. Der Wert ist trotzdem
                 * keiner aus dem Handgelenk: `var(--s3)` ist die
                 * Abstandsstufe s3 (12px) aus DESIGN §3, eine Stufe je Ebene.
                 */
                <span style={{ paddingLeft: `calc(var(--s3) * ${String(p.tiefe)})` }}>
                  {p.tiefe > 0 ? '└ ' : ''}{p.oz}
                </span>
              ),
            },
            {
              schluessel: 'text', kopf: 'Leistung',
              zelle: (p) => (
                <span>
                  {p.kurztext}
                  {p.langtext === null ? null : (
                    <span className="block text-xs text-text-muted">{p.langtext}</span>
                  )}
                </span>
              ),
            },
            { schluessel: 'einheit', kopf: 'Einheit', zelle: (p) => p.einheit },
            {
              schluessel: 'zeitwert', kopf: 'Zeitwert (min)', numerisch: true,
              /*
                * `formatiereMenge` und NICHT `Number(x).toLocaleString`.
                *
                * Postgres liefert `numeric(10,3)` als Text; `Number()` macht
                * daraus eine Fliesskommazahl, und die deutsche Anzeige entsteht
                * dann aus einem Wert, der nicht mehr der gespeicherte ist.
                * `mengeAusPostgresOderNull` liest ganzzahlige Tausendstel —
                * dieselbe Groesse, mit der die Kalkulation rechnet.
                */
              zelle: (p) => (p.zeitwert_minuten === null
                ? <span className="text-text-subtle">—</span>
                : formatiereMenge(mengeAusPostgresOderNull(p.zeitwert_minuten))),
            },
            {
              schluessel: 'lw', kopf: 'Leistung m²/h', numerisch: true,
              zelle: (p) => (p.leistungswert === null
                ? <span className="text-text-subtle">—</span>
                : formatiereMenge(mengeAusPostgresOderNull(p.leistungswert))),
            },
            {
              schluessel: 'preis', kopf: 'Standardpreis', numerisch: true,
              zelle: (p) => {
                const preis = preisAus(p);
                return preis === null
                  ? <span className="text-text-subtle">—</span>
                  : formatiereGeld(preis);
              },
            },
            {
              schluessel: 'kostenart', kopf: 'Kostenart',
              zelle: (p) => p.kostenart ?? <span className="text-text-subtle">—</span>,
            },
            {
              schluessel: 'steuer', kopf: 'Steuer',
              zelle: (p) => (
                <span>
                  {p.steuer_kennzeichen}
                  {p.steuer_kennzeichen === 'regelsatz' ? (
                    <span className="block text-xs text-text-subtle">
                      Vorgabe — offen (O-60)
                    </span>
                  ) : null}
                </span>
              ),
            },
            {
              schluessel: 'stand', kopf: 'Stand',
              zelle: (p) => (p.ist_platzhalter ? (
                <span className="text-warning">unbestätigt (O-17, O-731)</span>
              ) : (
                <StatusPill zustand="Bereit" />
              )),
            },
            {
              schluessel: 'gueltig', kopf: 'Gültig',
              zelle: (p) => `${p.gueltig_ab} – ${p.gueltig_bis ?? 'offen'}`,
            },
          ]}
        />
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Positionen ÄNDERN und AUSSER KRAFT SETZEN.                          */}
      {/*                                                                    */}
      {/* Beide Handlungen gab es in `/api/katalog` und im Routenmanifest    */}
      {/* und auf keiner Seite. Eine falsch angelegte Position liess sich     */}
      {/* damit weder korrigieren noch beenden — und geloescht wird nicht     */}
      {/* (`verhindere_loeschung`, Invariante 8).                             */}
      {/*                                                                    */}
      {/* Als aufklappbare Zeile statt als neunte Tabellenspalte: der         */}
      {/* Feldsatz ist der volle (`aenderePosition` schreibt JEDE Spalte,     */}
      {/* ein kuerzeres Formular loeschte still Werte), und der gehoert       */}
      {/* nicht in eine Tabellenzelle.                                       */}
      {/* ------------------------------------------------------------------ */}
      {schreiben && positionen.length > 0 ? (
        <section aria-labelledby="pflegen" className="mt-s7">
          <h2 id="pflegen" className="text-h2 text-text">Positionen pflegen</h2>
          <p className="mt-s2 max-w-[72ch] text-sm text-text-muted">
            Ändern schreibt <strong>alle</strong> Felder der Zeile — die Maske
            ist deshalb aus dem Bestand vorbelegt und nicht leer. Eine Position
            wird nie gelöscht: sie bekommt ein <strong>Gültig bis</strong>, und
            ihre Ordnungszahl wird damit für eine Nachfolgerin frei
            (<code>lkp_oz_uk</code> gilt nur, solange die Position gilt).
          </p>
          <div className="mt-s4 flex flex-col gap-s3">
            {positionen.map((p) => (
              <details
                key={p.id}
                data-cse="position-pflegen"
                className="rounded-lg border border-line bg-surface"
              >
                <summary className="cursor-pointer list-none p-s4 text-sm text-text">
                  <span className="font-medium">{p.oz}</span>
                  {' · '}{p.kurztext}
                  {p.gueltig_bis === null ? null : (
                    <span className="ml-s3 text-xs text-text-muted">
                      außer Kraft seit {p.gueltig_bis}
                    </span>
                  )}
                </summary>

                <div className="border-t border-line p-s5">
                  <form
                    method="post"
                    action="/api/katalog"
                    data-cse="position-aendern-form"
                    className="max-w-prose"
                  >
                    <input type="hidden" name="aktion" value="position_aendern" />
                    <input type="hidden" name="katalogId" value={id} />
                    <input type="hidden" name="positionId" value={p.id} />
                    <input type="hidden" name="zurueck" value={pfad} />
                    <PositionsFelder praefix={p.id} zeile={p} auswahl={auswahl} />
                    <button
                      type="submit"
                      data-cse="position-aendern"
                      className="mt-s5 inline-flex min-h-11 items-center rounded-md bg-brand px-s5 text-sm text-white hover:bg-brand-hover"
                    >
                      Änderung speichern
                    </button>
                  </form>

                  {p.gueltig_bis === null ? (
                    <form
                      method="post"
                      action="/api/katalog"
                      data-cse="position-ausser-kraft-form"
                      className="mt-s5 max-w-prose border-t border-line pt-s5"
                    >
                      <input type="hidden" name="aktion" value="position_ausser_kraft" />
                      <input type="hidden" name="katalogId" value={id} />
                      <input type="hidden" name="positionId" value={p.id} />
                      <input type="hidden" name="zurueck" value={pfad} />
                      <label
                        className="block text-sm text-text"
                        htmlFor={`${p.id}-gueltigBis`}
                      >
                        Außer Kraft setzen zum
                      </label>
                      <input
                        id={`${p.id}-gueltigBis`}
                        name="gueltigBis"
                        type="date"
                        required
                        min={p.gueltig_ab_iso}
                        defaultValue={berlinKalendertag(new Date())}
                        className="mt-s2 min-h-11 w-full rounded-md border border-line bg-surface-3 p-s3 text-sm text-text sm:w-64"
                      />
                      <p className="mt-s2 max-w-[72ch] text-xs text-text-muted">
                        Das Ende darf nicht vor dem Beginn liegen
                        (<code>lkp_zeitraum_stimmig</code>) — diese Position gilt
                        ab <strong>{p.gueltig_ab}</strong>. Angebots-,
                        Auftrags- und Rechnungszeilen, die auf ihr stehen,
                        bleiben unberührt: was ein Kunde bezahlt hat, behält
                        seine Herkunft.
                      </p>
                      <button
                        type="submit"
                        data-cse="position-ausser-kraft"
                        className="mt-s4 inline-flex min-h-11 items-center rounded-md border border-line px-s5 text-sm text-text hover:bg-surface-2"
                      >
                        Außer Kraft setzen
                      </button>
                    </form>
                  ) : (
                    <p className="mt-s5 border-t border-line pt-s5 text-sm text-text-muted">
                      Diese Position ist seit <strong>{p.gueltig_bis}</strong>{' '}
                      außer Kraft. Ein neues Ende setzt das Formular oben
                      (<em>Gültig bis</em> steht dort nicht — es bleibt, wie es
                      ist).
                    </p>
                  )}
                </div>
              </details>
            ))}
          </div>
        </section>
      ) : null}

      {/* Statuswechsel ---------------------------------------------------- */}
      {darf['katalog.schreiben'] === true && zugang.sitzung.ansicht !== 'gruppe'
        && !archiviert ? (
          <section aria-labelledby="status" className="mt-s7">
            <h2 id="status" className="text-h2 text-text">Status dieser Fassung</h2>
            <div className="mt-s4 flex flex-wrap gap-s4">
              {kopf.status === 'entwurf' ? (
                <form method="post" action="/api/katalog" data-cse="aktivieren-form">
                  <input type="hidden" name="aktion" value="status" />
                  <input type="hidden" name="katalogId" value={id} />
                  <input type="hidden" name="status" value="aktiv" />
                  <input type="hidden" name="zurueck" value={pfad} />
                  <button
                    type="submit"
                    data-cse="katalog-aktivieren"
                    className="inline-flex min-h-11 items-center rounded-md bg-brand px-s5 text-sm text-white hover:bg-brand-hover"
                  >
                    Fassung aktivieren
                  </button>
                </form>
              ) : null}
              <form method="post" action="/api/katalog" data-cse="archivieren-form">
                <input type="hidden" name="aktion" value="status" />
                <input type="hidden" name="katalogId" value={id} />
                <input type="hidden" name="status" value="archiviert" />
                <input type="hidden" name="zurueck" value={pfad} />
                <button
                  type="submit"
                  data-cse="katalog-archivieren"
                  className="inline-flex min-h-11 items-center rounded-md border border-line px-s5 text-sm text-text hover:bg-surface-2"
                >
                  Fassung archivieren
                </button>
              </form>
            </div>
            <p className="mt-s3 max-w-[72ch] text-xs text-text-muted">
              Aktivieren geht nur, wenn <strong>keine andere</strong> Fassung
              dieses Schlüssels gilt (<code>leistungskatalog_aktiv_uk</code>) —
              zuerst die geltende archivieren. Archivieren ist{' '}
              <strong>endgültig</strong>: die Positionen werden unveränderlich,
              und der Weg zurück ist gesperrt.
            </p>
          </section>
        ) : null}

      {/* Position anlegen ------------------------------------------------- */}
      {schreiben ? (
        <section aria-labelledby="neu" className="mt-s7">
          <h2 id="neu" className="text-h2 text-text">Position anlegen</h2>
          <form
            method="post"
            action="/api/katalog"
            data-cse="position-anlegen-form"
            className="mt-s4 max-w-prose rounded-lg border border-line bg-surface p-s5"
          >
            <input type="hidden" name="aktion" value="position_anlegen" />
            <input type="hidden" name="katalogId" value={id} />
            <input type="hidden" name="zurueck" value={pfad} />

            <PositionsFelder praefix="neu" zeile={null} auswahl={auswahl} />

            <button
              type="submit"
              data-cse="position-anlegen"
              className="mt-s5 inline-flex min-h-11 items-center rounded-md bg-brand px-s5 text-sm text-white hover:bg-brand-hover"
            >
              Position anlegen
            </button>
          </form>
        </section>
      ) : archiviert ? null : (
        <p data-cse="nur-lesen" className="mt-s6 text-sm text-text-muted">
          Sie sehen diese Fassung, ändern sie aber nicht: dafür verlangt die
          Plattform <code className="text-text">katalog.schreiben</code>.
        </p>
      )}
    </PortalRahmen>
  );
}
