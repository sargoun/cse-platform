import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import {
  ladeHerkunft, ladeReviere, ladeRaum, ladeStammauswahl,
} from '@/server/services/raumbuch/raum';
import { ladeRaumRichtzeit } from '@/server/services/kalkulation/raumbuch';
import { alsStundenText } from '@/server/services/kalkulation/richtzeit';
import { formatiereMenge, mengeAusPostgresOderNull } from '@/server/services/finanz/menge';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import { Hinweis } from '@/components/ui/Hinweis';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../../../unterseite';
import { haeltRechte } from '@/app/portal/rechte';
import { kennungOder404 } from '../../../../../kennung';
import { FELD, FEHLERTEXT, deutscheAnzeige } from './daten';

/**
 * `/portal/[mandant]/objekte/[id]/raumbuch/[raumId]` — ein Raum als
 * bearbeitbares Blatt (OPS-02, OPS-03).
 *
 * **Warum diese Seite fehlte und warum sie zaehlt.** Das Raumbuch hatte nur
 * den Massenweg: CSV hoch, Vorschau, Uebernahme. Der Einzelfall ist der
 * haeufigere — eine Flaeche wird nachgemessen, ein Belag getauscht, ein Raum
 * stillgelegt —, und dafuer eine Datei zu bauen ist kein Weg.
 *
 * **Die m²-Eingabe laeuft durch `leseZahl`, nicht durch `Number()`.**
 * `"1.234,5"` sind 1234,5 Quadratmeter; `Number("1.234")` waere 1,234 — ein
 * Tausendstel der Wahrheit, und nichts daran sieht falsch aus. `"12.50"` ist
 * mehrdeutig (deutsch 1250, englisch 12,50) und wird als 12,50 gelesen, wie
 * im Import. Gespeichert wird `numeric(12,3)` aus ganzen Tausendsteln.
 *
 * **Was an diesem Raum haengt, steht unter dem Formular — nicht als Sperre.**
 * `flaeche_qm` und `belagsart_id` speisen jeden Reinigungspreis (OPS-02,
 * OPS-07) und jede Revier-Sollzeit. Eine Aenderung verschiebt Zahlen an
 * anderen Stellen; ein nachgemessener Raum ist aber die Wahrheit, und die
 * Zahlen daneben sind es, die nachziehen muessen. Ob laufende Angebote und
 * Auftraege dabei neu gerechnet werden, ist offen (O-737).
 *
 * **Die Richtzeit wird NICHT hier gerechnet.** `ladeRaumRichtzeit` liest sie
 * ueber `app.leistungswerte_lesen` mit dem Berliner Kalendertag als Stichtag
 * (Invariante 6, D-93).
 */
export const dynamic = 'force-dynamic';

export default async function Raumblatt(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string; raumId: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id, raumId } = await params;
  kennungOder404(id);
  kennungOder404(raumId);
  const suche = await searchParams;
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;

  const pfad = `/portal/${mandant}/objekte/${id}/raumbuch/${raumId}`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const darf = await haeltRechte(zugang.sitzung, 'objekt.lesen', 'reinigung.lesen');

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => {
      const raum = await ladeRaum(kontext, id, raumId);
      if (raum === null) return null;
      const [stamm, reviere, herkunft, richtzeit] = await Promise.all([
        ladeStammauswahl(kontext),
        ladeReviere(kontext, raumId),
        ladeHerkunft(kontext, raumId),
        ladeRaumRichtzeit(kontext, raumId, new Date()),
      ]);
      return { raum, stamm, reviere, herkunft, richtzeit };
    })) as Promise<{
      raum: NonNullable<Awaited<ReturnType<typeof ladeRaum>>>;
      stamm: Awaited<ReturnType<typeof ladeStammauswahl>>;
      reviere: Awaited<ReturnType<typeof ladeReviere>>;
      herkunft: Awaited<ReturnType<typeof ladeHerkunft>>;
      richtzeit: Awaited<ReturnType<typeof ladeRaumRichtzeit>>;
    } | null>);

  if (daten === null) notFound();
  const { raum, stamm, reviere, herkunft, richtzeit } = daten;

  const archiviert = raum.archiviert_am !== null;
  const nurLesen = archiviert || zugang.sitzung.ansicht === 'gruppe';
  const titel = raum.raumnummer ?? raum.bezeichnung ?? 'Raum ohne Bezeichnung';

  return (
    <PortalRahmen
      titel={`${titel} · ${raum.objekt}`}
      wurzelTitel="Raumbuch"
      bereich={mandant as BereichSchluessel}
      nurLesen={nurLesen}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="objekte"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <nav aria-label="Zurück" className="mb-s3">
        <Link
          href={`/portal/${mandant}/objekte/${id}/raumbuch`}
          className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
        >
          ← Raumbuch {raum.objekt}
        </Link>
      </nav>

      <div className="mb-s4 flex flex-wrap items-center gap-s3">
        <h1 className="m-0 text-h1 text-text">{titel}</h1>
        {archiviert ? <StatusPill zustand="Archiviert" /> : null}
      </div>

      {fehler === null ? null : (
        <Hinweis art="warnung" cse="raum-fehler" className="mb-s5">
          <strong>Nichts wurde gespeichert.</strong>{' '}
          {FEHLERTEXT[fehler] ?? 'Der Vorgang wurde abgewiesen.'}
        </Hinweis>
      )}

      {archiviert ? (
        <Hinweis art="hinweis" cse="raum-archiviert" className="mb-s6">
          <strong>Dieser Raum ist archiviert</strong> — {raum.archiviert_am}. Er
          zählt in keiner Kalkulation mehr mit und wird nicht mehr geändert; ein
          wieder genutzter Raum ist eine <em>neue</em> Zeile. Gelöscht wurde er
          nicht: an ihm hängen Angebotszeilen, Kalkulationszeilen und
          Qualitätsprüfungen (Invariante 8).
        </Hinweis>
      ) : null}

      {/* Das Formular ----------------------------------------------------- */}
      {nurLesen ? (
        <section aria-labelledby="stand" className="mb-s7">
          <h2 id="stand" className="text-h2 text-text">Der erfasste Stand</h2>
          <dl className="m-0 mt-s4 grid grid-cols-[auto_1fr] gap-x-s5 gap-y-s3 rounded-lg border border-line bg-surface p-s5">
            <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Etage</dt>
            <dd className="m-0 text-sm text-text">{raum.etage ?? '—'}</dd>
            <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Nummer</dt>
            <dd className="m-0 text-sm text-text">{raum.raumnummer ?? '—'}</dd>
            <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
              Bezeichnung
            </dt>
            <dd className="m-0 text-sm text-text">{raum.bezeichnung ?? '—'}</dd>
            <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
              Nutzungsart
            </dt>
            <dd className="m-0 text-sm text-text">{raum.nutzungsart ?? '—'}</dd>
            <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Fläche</dt>
            <dd className="m-0 cse-zahl text-sm text-text">
              {formatiereMenge(mengeAusPostgresOderNull(raum.flaeche_qm))} m²
            </dd>
            <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Glas</dt>
            <dd className="m-0 cse-zahl text-sm text-text">
              {raum.fenster_flaeche_qm === null
                ? '—'
                : `${formatiereMenge(mengeAusPostgresOderNull(raum.fenster_flaeche_qm))} m²`}
            </dd>
            <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
              Belagsart
            </dt>
            <dd className="m-0 text-sm text-text">{raum.belagsart ?? '—'}</dd>
            <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
              Reinigungsklasse
            </dt>
            <dd className="m-0 text-sm text-text">{raum.reinigungsklasse ?? '—'}</dd>
          </dl>
        </section>
      ) : (
        <section aria-labelledby="pflegen" className="mb-s7">
          <h2 id="pflegen" className="text-h2 text-text">Raum pflegen</h2>
          <form
            method="post"
            action="/api/raum"
            data-cse="raum-form"
            className="mt-s4 max-w-prose rounded-lg border border-line bg-surface p-s5"
          >
            <input type="hidden" name="objektId" value={id} />
            <input type="hidden" name="raumId" value={raumId} />
            <input type="hidden" name="zurueck" value={pfad} />

            <div className="grid grid-cols-1 gap-s4 sm:grid-cols-3">
              <div>
                <label className="block text-sm text-text" htmlFor="etage">Etage</label>
                <input id="etage" name="etage" type="text" defaultValue={raum.etage ?? ''}
                       className={FELD} />
              </div>
              <div>
                <label className="block text-sm text-text" htmlFor="raumnummer">
                  Raumnummer
                </label>
                <input id="raumnummer" name="raumnummer" type="text"
                       defaultValue={raum.raumnummer ?? ''} className={FELD} />
              </div>
              <div>
                <label className="block text-sm text-text" htmlFor="sortierung">
                  Sortierung
                </label>
                <input id="sortierung" name="sortierung" type="number" step="1"
                       defaultValue={String(raum.sortierung)} className={FELD} />
              </div>
            </div>
            <p className="mt-s1 text-xs text-text-muted">
              Nummer <strong>oder</strong> Bezeichnung ist Pflicht: ein Raum ohne
              beides ist in der Liste von jedem anderen unbenannten Raum nicht zu
              unterscheiden. Nummer plus Etage ist je Objekt eindeutig
              (<code>raum_natuerlich_uk</code>).
            </p>

            <div className="mt-s4 grid grid-cols-1 gap-s4 sm:grid-cols-2">
              <div>
                <label className="block text-sm text-text" htmlFor="bezeichnung">
                  Bezeichnung
                </label>
                <input id="bezeichnung" name="bezeichnung" type="text"
                       defaultValue={raum.bezeichnung ?? ''} className={FELD} />
              </div>
              <div>
                <label className="block text-sm text-text" htmlFor="nutzungsart">
                  Nutzungsart
                </label>
                <input id="nutzungsart" name="nutzungsart" type="text"
                       placeholder="Büro, Sanitär, Verkehrsfläche"
                       defaultValue={raum.nutzungsart ?? ''} className={FELD} />
              </div>
            </div>

            <div className="mt-s4 grid grid-cols-1 gap-s4 sm:grid-cols-2">
              <div>
                <label className="block text-sm text-text" htmlFor="flaecheQm">
                  Fläche (m²)
                </label>
                <input
                  id="flaecheQm"
                  name="flaecheQm"
                  type="text"
                  inputMode="decimal"
                  required
                  defaultValue={deutscheAnzeige(raum.flaeche_qm)}
                  className={FELD}
                />
                <p className="mt-s1 text-xs text-text-muted">
                  Deutsch: <code>12,5</code>. Der Punkt ist der Tausendertrenner
                  — <code>1.234,5</code> sind 1234,5 m². Muss größer als null
                  sein (<code>raum_flaeche_positiv</code>).
                </p>
              </div>
              <div>
                <label className="block text-sm text-text" htmlFor="fensterFlaecheQm">
                  Fensterfläche (m²)
                </label>
                <input
                  id="fensterFlaecheQm"
                  name="fensterFlaecheQm"
                  type="text"
                  inputMode="decimal"
                  defaultValue={deutscheAnzeige(raum.fenster_flaeche_qm)}
                  className={FELD}
                />
                <p className="mt-s1 text-xs text-text-muted">
                  Glasreinigung rechnet darauf (CLN-05), nicht auf die Bodenfläche.
                </p>
              </div>
            </div>

            <div className="mt-s4 grid grid-cols-1 gap-s4 sm:grid-cols-2">
              <div>
                <label className="block text-sm text-text" htmlFor="belagsartId">
                  Belagsart
                </label>
                <select id="belagsartId" name="belagsartId"
                        defaultValue={raum.belagsart_id ?? ''} className={FELD}>
                  <option value="">— ohne Belagsart —</option>
                  {stamm.belagsarten.map((b) => (
                    <option key={b.id} value={b.id}>{b.bezeichnung}</option>
                  ))}
                </select>
                <p className="mt-s1 text-xs text-text-muted">
                  Ohne Belagsart gibt es keinen Leistungswert und damit keine
                  Richtzeit — die Fläche fehlt dann in <em>jeder</em> Summe. Zur
                  Wahl stehen nur die heute gültigen (D-93).
                </p>
              </div>
              <div>
                <label className="block text-sm text-text" htmlFor="reinigungsklasseId">
                  Reinigungsklasse
                </label>
                <select id="reinigungsklasseId" name="reinigungsklasseId"
                        defaultValue={raum.reinigungsklasse_id ?? ''} className={FELD}>
                  <option value="">— ohne Klasse —</option>
                  {stamm.klassen.map((k) => (
                    <option key={k.id} value={k.id}>{k.bezeichnung}</option>
                  ))}
                </select>
              </div>
            </div>

            <p className="mt-s4 text-xs text-text-muted">
              <strong>Kein Bemerkungsfeld</strong> — und das mit Absicht:
              <code className="ml-s1 text-text">raum.bemerkung</code> ist der
              Anwendungsrolle entzogen (0021), weil dort interne Notizen an
              einem Ort stünden, den der Kunde im Portal selbst sieht. Ein Feld,
              das sich nicht zurücklesen lässt, wäre schlechter als keines.
            </p>

            <button
              type="submit"
              data-cse="raum-speichern"
              className="mt-s5 inline-flex min-h-11 items-center rounded-md bg-brand px-s5 text-sm text-white hover:bg-brand-hover"
            >
              Raum speichern
            </button>
          </form>

          <form
            method="post"
            action="/api/raum"
            data-cse="raum-archivieren-form"
            className="mt-s4 max-w-prose"
          >
            <input type="hidden" name="objektId" value={id} />
            <input type="hidden" name="raumId" value={raumId} />
            <input type="hidden" name="aktion" value="archivieren" />
            <input type="hidden" name="zurueck" value={pfad} />
            <button
              type="submit"
              data-cse="raum-archivieren"
              className="inline-flex min-h-11 items-center rounded-md border border-line px-s4 text-sm text-text hover:bg-surface-2"
            >
              Raum stilllegen
            </button>
            <p className="mt-s2 max-w-[72ch] text-xs text-text-muted">
              <strong>Stilllegen, nicht löschen</strong> (Invariante 8) — der
              Auslöser weist ein DELETE ohnehin ab. Danach zählt der Raum in
              keiner Kalkulation mehr mit, und seine Nummer wird für einen
              Nachfolger frei.
            </p>
          </form>
        </section>
      )}

      {/* Was an diesem Raum haengt --------------------------------------- */}
      <section aria-labelledby="haengt" className="mb-s7">
        <h2 id="haengt" className="text-h2 text-text">Was an diesem Raum hängt</h2>
        <p className="mb-s4 max-w-[72ch] text-sm text-text-muted">
          Fläche und Belagsart speisen den Reinigungspreis und die Revier-Sollzeit.
          Eine Änderung hier verschiebt Zahlen an anderen Stellen. Ob laufende
          Angebote und Aufträge dabei neu gerechnet und der Kunde informiert
          werden muss, ist nicht entschieden — <strong>offen (O-737)</strong>.
        </p>

        <div className="rounded-lg border border-line bg-surface p-s5">
          <h3 className="mb-s3 text-h3 text-text">Richtzeit dieses Raums</h3>
          {richtzeit.richtzeit === null ? (
            <p data-cse="ohne-richtzeit" className="m-0 text-sm text-warning">
              {richtzeit.grund}
            </p>
          ) : (
            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-s5 gap-y-s2">
              <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
                Leistungswert
              </dt>
              <dd className="m-0 cse-zahl text-sm text-text">
                {formatiereMenge(richtzeit.richtzeit.posten.leistungswert)} m²/h
                {richtzeit.richtzeit.posten.leistungswertIstPlatzhalter === true ? (
                  <span className="ml-s2 text-warning">
                    unbestätigt — offen (O-17)
                  </span>
                ) : null}
              </dd>
              <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
                Je Durchgang
              </dt>
              <dd data-cse="richtzeit" className="m-0 cse-zahl text-sm text-text">
                {alsStundenText(richtzeit.richtzeit.sekundenJeDurchgang)} Std.
              </dd>
              <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
                Herkunft des Werts
              </dt>
              <dd className="m-0 text-sm text-text-muted">
                {richtzeit.richtzeit.posten.leistungswertQuelle
                  ?? 'keine Quelle hinterlegt'}
              </dd>
            </dl>
          )}
          <p className="mt-s3 mb-0 text-xs text-text-muted">
            Gerechnet in <code>services/kalkulation</code>, nicht auf dieser
            Seite (Invariante 6). Stichtag ist der heutige{' '}
            <em>Berliner</em> Kalendertag — an einem Wechseltag gilt sonst der
            Wert von gestern (D-93).
          </p>
        </div>

        <div className="mt-s4">
          <h3 className="mb-s3 text-h3 text-text">Reviere</h3>
          {reviere.length === 0 ? (
            <p className="text-sm text-text-muted">
              Dieser Raum ist keinem Revier zugeordnet.
            </p>
          ) : (
            <DataTable
              beschriftung="Reviere, in denen dieser Raum liegt"
              zeilen={reviere}
              schluessel={(r) => r.revier_id}
              spalten={[
                {
                  schluessel: 'revier', kopf: 'Revier',
                  zelle: (r) => (darf['reinigung.lesen'] === true ? (
                    <Link
                      href={`/portal/${mandant}/reinigung/reviere/${r.revier_id}`}
                      className="text-text underline underline-offset-2 hover:text-brand"
                    >
                      {r.revier}
                    </Link>
                  ) : r.revier),
                },
                {
                  schluessel: 'lw', kopf: 'Leistungswert dieser Zuordnung', numerisch: true,
                  /*
                    * `formatiereMenge`, nicht `Number(x).toLocaleString`: der
                    * Wert kommt als `numeric(10,3)` aus Postgres, und
                    * `Number()` machte daraus eine Fliesskommazahl.
                    */
                  zelle: (r) => (r.leistungswert === null ? (
                    <span className="text-text-subtle">der der Belagsart</span>
                  ) : `${formatiereMenge(mengeAusPostgresOderNull(r.leistungswert))} m²/h`),
                },
                {
                  schluessel: 'soll', kopf: 'Sollzeit (min)', numerisch: true,
                  zelle: (r) => (r.sollzeit_minuten === null
                    ? <span className="text-text-subtle">—</span>
                    : formatiereMenge(mengeAusPostgresOderNull(r.sollzeit_minuten))),
                },
              ]}
            />
          )}
        </div>

        <div className="mt-s4">
          <h3 className="mb-s3 text-h3 text-text">Herkunft</h3>
          {raum.quell_schluessel === null ? null : (
            <p className="mb-s3 text-sm text-text-muted">
              Quellschlüssel: <code className="text-text">{raum.quell_schluessel}</code> —
              daran erkennt ein erneuter Import diese Zeile wieder.
            </p>
          )}
          {herkunft.length === 0 ? (
            <p className="text-sm text-text-muted">
              Kein Importvorgang vermerkt — dieser Raum wurde von Hand erfasst.
            </p>
          ) : (
            <DataTable
              beschriftung="Importvorgänge, die diesen Raum berührt haben"
              zeilen={herkunft}
              schluessel={(h) => h.id}
              spalten={[
                { schluessel: 'was', kopf: 'Vorgang', zelle: (h) => h.aktion },
                { schluessel: 'wann', kopf: 'Zeitpunkt', zelle: (h) => h.zeitpunkt },
                {
                  schluessel: 'quelle', kopf: 'Datei',
                  zelle: (h) => h.quelle ?? <span className="text-text-subtle">—</span>,
                },
              ]}
            />
          )}
          {raum.geaendert === null ? null : (
            <p className="mt-s3 text-xs text-text-muted">
              Zuletzt geändert {raum.geaendert} (Europe/Berlin).
            </p>
          )}
        </div>
      </section>
    </PortalRahmen>
  );
}
