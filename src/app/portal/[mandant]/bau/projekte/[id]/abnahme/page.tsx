import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { StatusPill } from '@/components/ui/StatusPill';
import { berlinHeute } from '@/server/db/heute';
import {
  ABNAHME_ART_TEXT, ABNAHME_ARTEN, FRIST_OFFEN_TEXT, ladeMaengel, listeAbnahmen,
  type AbnahmeArt, type AbnahmeZeile, type MangelZeile,
} from '@/server/services/bau/abnahme';
import {
  findeProjektDetail, gruppiereLvAuswahl, ladeLvAuswahl,
  type LvAuswahlZeile, type ProjektDetailZeile,
} from '@/server/services/bau/lv';
import { AnmeldungNoetig } from '../../../../../Anmeldung';
import { portalZugang } from '../../../../../zugang';
import { slugTor } from '../../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { kennungOder404 } from '../../../../../kennung';

/**
 * `/portal/[mandant]/bau/projekte/[id]/abnahme` — das Abnahmeprotokoll nach
 * § 12 VOB/B (BAU-03, OPS-05, Seitenkarte §5.9).
 *
 * **Die Abnahme ist der teuerste Zeitpunkt des Bauvertrags.** Mit ihr geht die
 * Gefahr über (§ 12 Abs. 6), beginnt die Gewährleistungsfrist (§ 13 Abs. 4)
 * und wird die Schlussrechnung fällig (§ 16 Abs. 3). Und ein Anspruch
 * ERLISCHT: nach **§ 11 Abs. 4 VOB/B** verfällt die Vertragsstrafe, wenn sie
 * bei der Abnahme nicht vorbehalten wird. Deshalb sind die zwei Vorbehalte
 * hier zwei GETRENNTE Schalter mit einem Wortlaut daneben und nicht ein
 * Bemerkungsfeld: ein Häkchen ohne Erklärung ist im Streit nichts wert, und
 * ein vergessener Vorbehalt ist ein verlorener Anspruch.
 *
 * **Eine Verweigerung ist ein vollwertiger Datensatz.** § 12 Abs. 3 verlangt
 * die Angabe der Mängel, auf die sie sich stützt — eine „nicht erfolgte"
 * Abnahme, die nirgends steht, ist keine.
 *
 * **Das Protokoll ist ab dem Protokollieren unveränderlich.** Der Server friert
 * Kopf, Vorbehalte, Teilnehmer und Mängelliste als Abzug ein und siegelt sie
 * mit SHA-256 — genau wie beim Aufmass (§10.4). Korrigiert wird durch Storno
 * mit Ersatzprotokoll, nie durch Ändern.
 *
 * **Die Gewährleistungsfrist rechnet diese Seite nicht** (O-154): sie zeigt
 * `projekt.gewaehrleistung_bis`, und solange die Spalte leer ist, steht dort,
 * warum.
 */
export const dynamic = 'force-dynamic';

/**
 * Was nach einer wirksamen Gesamtabnahme noch protokolliert werden kann.
 *
 * Nur die Teilabnahme: jede andere Art waere eine zweite Abnahme derselben
 * Leistung, und die weist `abnahme_gesamt_uk` (0211) ab. Die Liste steht als
 * eigene Konstante da und nicht als Filter im Formular, damit sie sich mit
 * `ABNAHME_ARTEN` zusammen lesen laesst.
 */
const TEILABNAHME_NUR: readonly AbnahmeArt[] = ['teilabnahme'];

export default async function AbnahmeSeite(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const pfad = `/portal/${mandant}/bau/projekte/${id}/abnahme`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();
  /**
   * **Das Recht haengt an der Tuer, nicht im Koerper.** Diese Route traegt
   * `bau.schreiben` als LESERECHT (Seitenkarte §5.9, Routenregister): wer es
   * nicht haelt, sieht die Seite gar nicht — `portalZugang` endet in
   * `notFound()` (AUT-06). Drei Zweige auf `haeltRechte('bau.schreiben')`
   * standen hier und waren unerreichbar; sie lasen sich wie eine Absicherung
   * und waren keine. Wer das Protokoll nur LESEN koennen soll, braucht eine
   * andere Bewachung dieser Route — nicht eine Bedingung in dieser Datei.
   */

  const heute = await berlinHeute();

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const projekt = await findeProjektDetail(kontext, id);
      if (projekt === null) return null;
      const abnahmen = await listeAbnahmen(kontext, { projektId: id });
      /**
       * Die Mängel je Protokoll — eine Abfrage je Kopf und nicht eine über
       * alle: die Liste ist kurz (§ 12-Protokolle je Projekt sind eines oder
       * zwei), und eine Abfrage mit `where abnahme_id = any(...)` müsste
       * danach in TypeScript gruppiert werden, also dieselbe Arbeit an einer
       * Stelle mehr.
       */
      const maengel = new Map<string, readonly MangelZeile[]>();
      for (const a of abnahmen) maengel.set(a.id, await ladeMaengel(kontext, a.id));
      return {
        projekt,
        abnahmen,
        maengel,
        positionen: await ladeLvAuswahl(kontext, id),
      };
    }),
  ) as Promise<{
    projekt: ProjektDetailZeile;
    abnahmen: readonly AbnahmeZeile[];
    maengel: Map<string, readonly MangelZeile[]>;
    positionen: readonly LvAuswahlZeile[];
  } | null>);

  // AUT-06: ein fremdes Projekt ist nicht vorhanden, nicht verboten.
  if (daten === null) notFound();
  const { projekt: p } = daten;

  const lebende = daten.abnahmen.filter((a) => a.storniert_lokal === null);
  const gesamtabnahme = lebende.find((a) => a.abgenommen && a.art !== 'teilabnahme') ?? null;
  /**
   * Steht die Gesamtabnahme, bleibt genau ein Fall uebrig: die Teilabnahme
   * eines ANDEREN, in sich abgeschlossenen Teils (§ 12 Abs. 2 VOB/B). Der
   * Index `abnahme_gesamt_uk` (0211) sieht das genauso — er greift nur fuer
   * `abgenommen and art <> 'teilabnahme'`.
   */
  const nurTeilabnahme = gesamtabnahme !== null;
  const gruppen = gruppiereLvAuswahl(daten.positionen);
  /** Stornierte Protokolle, die noch auf ihr Ersatzprotokoll warten. */
  const ohneErsatz = daten.abnahmen.filter(
    (a) => a.storniert_lokal !== null && a.ersetzt_durch_id === null,
  );
  /** Die Kette in beide Richtungen: Ersatz → storniertes Protokoll. */
  const jeId = new Map(daten.abnahmen.map((a) => [a.id, a]));
  const ersetztProtokoll = new Map<string, AbnahmeZeile>();
  for (const a of daten.abnahmen) {
    if (a.ersetzt_durch_id !== null) ersetztProtokoll.set(a.ersetzt_durch_id, a);
  }

  return (
    <PortalRahmen
      titel={`Abnahme · Projekt ${p.nummer}`}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="bau"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <nav aria-label="Zurück" className="mb-s3">
        <Link
          href={`/portal/${mandant}/bau/projekte/${id}`}
          className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
        >
          ← Projekt {p.nummer}
        </Link>
      </nav>

      <h1 className="mb-s2 text-h1 text-text">Abnahme</h1>
      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        {p.nummer} · {p.bezeichnung} · {p.kunde} ·{' '}
        {p.vertragsgrundlage === 'vob_b' ? 'VOB/B' : 'BGB'}
      </p>

      <section className="mb-s6">
        <p className="m-0 max-w-prose rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Mit der Abnahme geht die Gefahr auf den Auftraggeber über (§ 12 Abs. 6
          VOB/B), beginnt die Gewährleistungsfrist (§ 13 Abs. 4) und wird die
          Schlussrechnung fällig (§ 16 Abs. 3). Und ein Anspruch erlischt:{' '}
          <strong className="text-text">
            die Vertragsstrafe verfällt, wenn sie hier nicht vorbehalten wird
          </strong>{' '}
          (§ 11 Abs. 4). Deshalb wird beides aufgezeichnet — der Vorbehalt und
          sein Fehlen.
        </p>
        <p className="mt-s3 max-w-prose text-sm" data-cse="gewaehrleistung">
          <strong className="text-text">Gewährleistung bis:</strong>{' '}
          {p.gewaehrleistung_bis_lokal ?? (
            <>
              <span className="text-warning">offen (O-154)</span> — {FRIST_OFFEN_TEXT}
            </>
          )}
        </p>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Die Protokolle — mit den stornierten, als Korrekturspur.            */}
      {/* ------------------------------------------------------------------ */}
      <section className="mb-s6" data-cse="abnahme-protokolle">
        <h2 className="mb-s3 text-h3 text-text">Protokolle</h2>
        {daten.abnahmen.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            Für dieses Projekt ist keine Abnahme protokolliert. Solange das so
            ist, sind Gefahr, Gewährleistungsfrist und Fälligkeit nicht
            umgeschlagen.
          </p>
        ) : (
          <ul className="m-0 list-none p-0">
            {daten.abnahmen.map((a) => {
              const maengel = daten.maengel.get(a.id) ?? [];
              const storniert = a.storniert_lokal !== null;
              return (
                <li
                  key={a.id}
                  className="mb-s4 rounded-lg border border-line bg-surface p-s5"
                  data-cse="abnahme"
                  data-abnahme={a.id}
                >
                  <div className="flex flex-wrap items-start justify-between gap-s3">
                    <div>
                      <p className="m-0 text-base font-semibold text-text">
                        {a.abnahme_am_lokal} · {ABNAHME_ART_TEXT[a.art] ?? a.art}
                      </p>
                      <p className="m-0 mt-s1 text-sm text-text-muted">
                        Protokolliert {a.protokolliert_lokal}
                        {a.protokolliert_von !== null && ` · ${a.protokolliert_von}`}
                      </p>
                    </div>
                    <span className="inline-flex flex-wrap items-center gap-s2">
                      <StatusPill
                        zustand={storniert
                          ? 'Archiviert'
                          : a.abgenommen ? 'Bereit' : 'Abgelehnt'}
                      />
                      <span className="text-sm text-text-muted">
                        {storniert
                          ? 'storniert'
                          : a.abgenommen ? 'abgenommen' : 'Abnahme verweigert'}
                      </span>
                    </span>
                  </div>

                  {a.leistungsumfang !== null && (
                    <p className="m-0 mt-s3 text-sm text-text-muted">
                      <strong className="text-text">Leistungsumfang:</strong>{' '}
                      {a.leistungsumfang}
                    </p>
                  )}

                  {!a.abgenommen && a.verweigerung_grund !== null && (
                    <p className="m-0 mt-s3 text-sm text-warning" data-cse="verweigerung">
                      <strong>Verweigert:</strong> {a.verweigerung_grund}
                    </p>
                  )}

                  {/* Die beiden Vorbehalte — getrennt, und BEIDE Zustände sichtbar. */}
                  <dl className="m-0 mt-s4 grid grid-cols-1 gap-s3 sm:grid-cols-2">
                    <div>
                      <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
                        Vorbehalt Vertragsstrafe (§ 11 Abs. 4)
                      </dt>
                      <dd
                        className={`m-0 mt-s1 text-sm ${a.vorbehalt_vertragsstrafe ? 'text-text' : 'text-warning'}`}
                        data-cse="vorbehalt-vertragsstrafe"
                      >
                        {a.vorbehalt_vertragsstrafe
                          ? 'vorbehalten'
                          : 'NICHT vorbehalten — der Anspruch ist damit verfallen'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
                        Vorbehalt Mängel (§ 12 Abs. 3)
                      </dt>
                      <dd className="m-0 mt-s1 text-sm text-text" data-cse="vorbehalt-maengel">
                        {a.vorbehalt_maengel ? 'vorbehalten' : 'nicht vorbehalten'}
                      </dd>
                    </div>
                  </dl>

                  {a.vorbehalt_text !== null && (
                    <p className="m-0 mt-s3 whitespace-pre-line text-sm text-text">
                      <strong>Wortlaut:</strong> {a.vorbehalt_text}
                    </p>
                  )}

                  {a.teilnehmer.length > 0 && (
                    <p className="m-0 mt-s3 text-sm text-text-muted">
                      <strong className="text-text">Teilnehmer:</strong>{' '}
                      {a.teilnehmer.join(' · ')}
                    </p>
                  )}

                  <p className="m-0 mt-s3 font-mono text-xs text-text-subtle">
                    {/* Der Digest ueber den eingefrorenen Abzug — §10.4. */}
                    SHA-256 {a.snapshot_hash.slice(0, 16)}…
                  </p>

                  {/*
                    * **Das unterschriebene Papier ist NICHT angehängt, und das
                    * steht da.** `abnahme.dokument_id` gibt es (die Spalte
                    * wartet auf den Scan), aber in dieser Anwendung ist kein
                    * Dokumentenspeicher verbunden — derselbe Grund, aus dem
                    * die Behinderungsanzeige ohne archiviertes Schreiben
                    * auskommt. Ein selbst erzeugtes PDF mit erfundener
                    * Prüfsumme wäre der vorgetäuschte Beleg, den CLAUDE.md
                    * verbietet: das Protokoll steht hier mit seinem Siegel,
                    * und das Papier liegt im Ordner der Bauleitung.
                    */}
                  {a.dokument_id === null && (
                    <p className="m-0 mt-s1 text-xs text-text-subtle"
                       data-cse="abnahme-dokument-fehlt">
                      Unterschriebenes Protokoll: nicht angehängt — es ist kein
                      Dokumentenspeicher verbunden. Beweiskraft trägt hier der
                      gesiegelte Abzug oben, nicht eine Datei.
                    </p>
                  )}

                  {storniert && (
                    <p className="m-0 mt-s3 text-sm text-text-muted">
                      Storniert {a.storniert_lokal}
                      {a.storno_grund !== null && `: ${a.storno_grund}`}
                      {a.ersetzt_durch_id !== null && (() => {
                        const ersatz = jeId.get(a.ersetzt_durch_id);
                        return ersatz === undefined
                          ? null
                          : ` · ersetzt durch das Protokoll vom ${ersatz.abnahme_am_lokal}`;
                      })()}
                      {a.ersetzt_durch_id === null && (
                        <span className="text-warning">
                          {' '}· ohne Ersatzprotokoll
                        </span>
                      )}
                    </p>
                  )}

                  {ersetztProtokoll.get(a.id) !== undefined && (
                    <p className="m-0 mt-s3 text-sm text-text-muted" data-cse="ersatz-fuer-hinweis">
                      Dieses Protokoll ersetzt das stornierte vom{' '}
                      {ersetztProtokoll.get(a.id)?.abnahme_am_lokal ?? '—'}.
                    </p>
                  )}

                  {/* -------------------------------------------------- */}
                  {/* Die Mängelliste (§ 12 Abs. 3, 03-GEWERKE §7.3).     */}
                  {/* -------------------------------------------------- */}
                  <h3 className="mb-s2 mt-s5 text-sm font-semibold text-text">
                    Mängel und Restleistungen ({String(maengel.length)})
                  </h3>
                  {maengel.length === 0 ? (
                    <p className="m-0 text-sm text-text-muted">
                      Im Protokoll ist kein Mangel aufgenommen.
                    </p>
                  ) : (
                    <ul className="m-0 list-none p-0">
                      {maengel.map((m) => (
                        <li
                          key={m.id}
                          className="mb-s2 rounded-md border border-line bg-surface-3 p-s3 text-sm"
                          data-cse="mangel"
                        >
                          <span className="tabular-nums text-text-subtle">
                            {String(m.reihenfolge)}.
                          </span>{' '}
                          <span className="text-text">{m.beschreibung}</span>
                          {m.oz !== null && (
                            <span className="ml-s2 text-xs text-text-muted">OZ {m.oz}</span>
                          )}
                          <span className="mt-s1 block text-xs text-text-muted">
                            {m.frist_lokal === null
                              ? 'ohne Frist'
                              : `Frist ${m.frist_lokal}`}
                            {m.behoben_lokal !== null && ` · behoben ${m.behoben_lokal}`}
                            {m.ueberfaellig && (
                              <span className="ml-s2 text-danger">Frist abgelaufen</span>
                            )}
                            {m.reklamation_nummer !== null
                              && ` · Reklamation ${m.reklamation_nummer}`}
                          </span>

                          {m.behoben_lokal === null && !storniert && (
                            <form
                              action="/api/bau/abnahmen"
                              method="post"
                              className="mt-s2 flex flex-wrap items-end gap-s3"
                              data-cse="mangel-behoben"
                            >
                              <input type="hidden" name="aktion" value="mangel_behoben" />
                              <input type="hidden" name="mangel" value={m.id} />
                              <input type="hidden" name="mandant" value={mandant} />
                              <input type="hidden" name="projekt" value={id} />
                              <input type="hidden" name="zurueck" value={pfad} />
                              <label>
                                <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
                                  Behoben am
                                </span>
                                <input
                                  type="date"
                                  name="behoben_am"
                                  required
                                  defaultValue={heute}
                                  className="min-h-11 rounded-md border border-line bg-surface px-s3 py-s2 text-sm text-text"
                                />
                              </label>
                              <Button type="submit" variante="secondary">
                                Als behoben melden
                              </Button>
                            </form>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}

                  {!storniert && (
                    <form
                      action="/api/bau/abnahmen"
                      method="post"
                      className="mt-s5 flex flex-wrap items-end gap-s3 border-t border-line pt-s4"
                      data-cse="abnahme-storno"
                    >
                      <input type="hidden" name="aktion" value="stornieren" />
                      <input type="hidden" name="abnahme" value={a.id} />
                      <input type="hidden" name="mandant" value={mandant} />
                      <input type="hidden" name="projekt" value={id} />
                      <input type="hidden" name="zurueck" value={pfad} />
                      <label className="grow">
                        <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
                          Storno mit Grund — das Protokoll bleibt stehen
                        </span>
                        <input
                          name="storno_grund"
                          required
                          placeholder="z. B. Datum falsch protokolliert; Ersatzprotokoll folgt"
                          className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
                        />
                      </label>
                      <Button type="submit" variante="secondary">Stornieren</Button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Protokollieren.                                                     */}
      {/* ------------------------------------------------------------------ */}
      <section>
        <h2 className="mb-s3 text-h3 text-text">Abnahme protokollieren</h2>

        {gesamtabnahme !== null && (
          /*
           * **Der Hinweis nimmt dem Formular nicht den Boden, er schneidet es
           * zu.** Vorher stand hier der Satz „eine weitere Teilabnahme ist
           * nach § 12 Abs. 2 VOB/B möglich" — und darunter kein Formular,
           * mit dem sie sich hätte protokollieren lassen. Der Dienst und der
           * Index `abnahme_gesamt_uk` erlauben beliebig viele Teilabnahmen;
           * einmalig ist nur die wirksame Gesamtabnahme. Also bleibt das
           * Formular stehen und ist auf genau das beschränkt, was noch geht.
           */
          <p
            className="mb-s4 rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted"
            data-cse="schon-abgenommen"
          >
            Die Gesamtleistung ist am {gesamtabnahme.abnahme_am_lokal} abgenommen.
            Eine zweite Abnahme derselben Leistung gibt es nicht — korrigiert wird
            durch Storno mit Ersatzprotokoll. Möglich bleibt die Teilabnahme eines
            anderen, in sich abgeschlossenen Teils der Leistung (§ 12 Abs. 2
            VOB/B); auf sie ist das Formular unten beschränkt.
          </p>
        )}
        <form
          action="/api/bau/abnahmen"
          method="post"
          className="rounded-lg border border-line bg-surface p-s5"
          data-cse="abnahme-formular"
        >
          <input type="hidden" name="mandant" value={mandant} />
          <input type="hidden" name="projekt" value={id} />
          <input type="hidden" name="zurueck" value={pfad} />

          <div className="grid gap-s4 md:grid-cols-2">
            <label>
              <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
                Abnahmeart (§ 12 VOB/B)
              </span>
              <select
                name="art"
                required
                defaultValue={nurTeilabnahme ? 'teilabnahme' : 'foermlich'}
                className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
              >
                {(nurTeilabnahme ? TEILABNAHME_NUR : ABNAHME_ARTEN).map((a) => (
                  <option key={a} value={a}>{ABNAHME_ART_TEXT[a]}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
                Abnahme am (Berliner Kalendertag)
              </span>
              <input
                type="date"
                name="abnahme_am"
                required
                defaultValue={heute}
                className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
              />
            </label>
            <label className="md:col-span-2">
              <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
                Leistungsumfang (bei Teilabnahme Pflicht — welcher Teil?)
              </span>
              <input
                name="leistungsumfang"
                required={nurTeilabnahme}
                placeholder="z. B. Rohbau Bauteil A, Achsen 1–6"
                className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
              />
            </label>
          </div>

          {ohneErsatz.length > 0 && (
            /*
             * **Die Korrekturspur entsteht hier oder nirgends.** „Korrigiert
             * wird durch Storno mit Ersatzprotokoll" ist der Weg dieser
             * Seite — aber ein storniertes Protokoll und sein Ersatz, die
             * unverbunden nebeneinander stehen, belegen nichts. Deshalb sagt
             * das Formular an dieser Stelle, WELCHES Protokoll dieses hier
             * ersetzt; der Dienst verbindet beide in derselben Transaktion.
             */
            <label className="mt-s5 block" data-cse="ersatz-fuer">
              <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
                Ersetzt ein storniertes Protokoll (optional)
              </span>
              <select
                name="ersetzt"
                defaultValue=""
                className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
              >
                <option value="">kein Ersatz — ein eigenständiges Protokoll</option>
                {ohneErsatz.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.abnahme_am_lokal} · {ABNAHME_ART_TEXT[a.art] ?? a.art}
                    {a.storno_grund === null ? '' : ` — storniert: ${a.storno_grund}`}
                  </option>
                ))}
              </select>
            </label>
          )}

          <fieldset className="mt-s5 border-0 p-0">
            <legend className="mb-s2 text-sm font-semibold text-text">
              Ergebnis
            </legend>
            <label className="flex items-center gap-s2 text-sm text-text">
              <input
                type="checkbox"
                name="abgenommen"
                value="ja"
                defaultChecked
                className="size-4"
              />
              Die Leistung wird abgenommen
            </label>
            <label className="mt-s3 block">
              <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
                Grund der Verweigerung (Pflicht, wenn nicht abgenommen wird —
                § 12 Abs. 3 VOB/B)
              </span>
              <input
                name="verweigerung_grund"
                className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
              />
            </label>
          </fieldset>

          <fieldset className="mt-s5 border-0 p-0">
            <legend className="mb-s2 text-sm font-semibold text-text">
              Vorbehalte — rechtlich erheblich
            </legend>
            <label className="flex items-center gap-s2 text-sm text-text">
              <input
                type="checkbox"
                name="vorbehalt_vertragsstrafe"
                value="ja"
                className="size-4"
              />
              Vertragsstrafe wird vorbehalten (§ 11 Abs. 4 VOB/B)
            </label>
            <p className="m-0 mt-s1 max-w-prose text-xs text-warning">
              Ohne diesen Vorbehalt verfällt der Anspruch auf die
              Vertragsstrafe mit der Abnahme — endgültig. Das Protokoll hält
              auch sein Fehlen fest.
            </p>
            <label className="mt-s3 flex items-center gap-s2 text-sm text-text">
              <input
                type="checkbox"
                name="vorbehalt_maengel"
                value="ja"
                className="size-4"
              />
              Mängel werden vorbehalten (§ 12 Abs. 3 VOB/B)
            </label>
            <label className="mt-s3 block">
              <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
                Wortlaut des Vorbehalts (Pflicht, sobald einer erklärt wird)
              </span>
              <textarea
                name="vorbehalt_text"
                rows={3}
                placeholder="wie protokolliert, wörtlich"
                className="w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
              />
            </label>
          </fieldset>

          <fieldset className="mt-s5 border-0 p-0">
            <legend className="mb-s2 text-sm font-semibold text-text">
              Teilnehmer (§ 12 Abs. 4 Nr. 1 VOB/B) — beide Seiten
            </legend>
            {[0, 1, 2, 3].map((i) => (
              <input
                key={i}
                name="teilnehmer"
                placeholder={i === 0
                  ? 'z. B. Frau Beyer (Bauleiterin AG)'
                  : 'weiterer Teilnehmer'}
                className="mb-s2 min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
              />
            ))}
          </fieldset>

          <fieldset className="mt-s5 border-0 p-0">
            <legend className="mb-s2 text-sm font-semibold text-text">
              Mängel und Restleistungen
            </legend>
            <p className="m-0 mb-s3 max-w-prose text-xs text-text-subtle">
              Jede Zeile mit Beschreibung wird aufgenommen; leere Zeilen
              fallen weg. Die Liste steht im gesiegelten Protokoll — ein
              später entdeckter Mangel ist eine Reklamation (§ 13 VOB/B) und
              kein Nachtrag zu diesem Protokoll.
            </p>
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="mb-s3 grid gap-s3 md:grid-cols-[2fr_1fr_1fr]">
                <input
                  name="mangel_beschreibung"
                  placeholder={i === 0 ? 'z. B. Fuge Achse C unvollständig' : 'Beschreibung'}
                  className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
                />
                <input
                  type="date"
                  name="mangel_frist"
                  aria-label="Frist zur Beseitigung"
                  className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
                />
                <select
                  name="mangel_position"
                  aria-label="LV-Position"
                  defaultValue=""
                  className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
                >
                  <option value="">ohne LV-Bezug</option>
                  {/*
                    * Nach Verzeichnis und Fassung gruppiert: `ladeLvAuswahl`
                    * gibt je Verzeichnis nur die JUENGSTE lebende Fassung
                    * heraus, und die Ueberschrift sagt, welche — sonst steht
                    * dieselbe OZ aus Hauptauftrag und Nachtrag zweimal
                    * gleich beschriftet da.
                    */}
                  {gruppen.map((g) => (
                    <optgroup key={g.schluessel} label={g.beschriftung}>
                      {g.zeilen.map((pos) => (
                        <option key={pos.id} value={pos.id}>
                          {pos.oz} · {pos.kurztext}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
            ))}
          </fieldset>

          <p className="mt-s4 max-w-prose text-xs text-text-subtle">
            Mit dem Protokollieren friert der Server das Angezeigte als Abzug
            ein und siegelt es mit SHA-256. Danach ändert sich daran nichts
            mehr; korrigiert wird durch Storno mit Ersatzprotokoll (§ 12
            VOB/B, LEG-01). Die Gewährleistungsfrist wird dabei{' '}
            <strong>nicht</strong> berechnet — sie ist offen (O-154).
          </p>
          <div className="mt-s4">
            <Button type="submit" variante="primary">Abnahme protokollieren</Button>
          </div>
        </form>
      </section>
    </PortalRahmen>
  );
}
