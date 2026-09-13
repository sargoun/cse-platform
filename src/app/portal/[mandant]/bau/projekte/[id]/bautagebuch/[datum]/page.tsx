import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { StatusPill } from '@/components/ui/StatusPill';
import { wetterPort } from '@/server/versand/dwd';
import {
  WETTER_NICHT_VERFUEGBAR, WETTER_QUELLENHINWEIS, leseWetterAnzeige, type WetterAnzeige,
} from '@/server/services/bau/wetter';
import {
  HERKUNFT_TEXT, POSITION_ART_TEXT, alsStunden, findeBautagZuDatum, gleicheMannstundenAb,
  istKalendertag, leseMannstunden, lesePositionen, leseTagesfotos, listeGewerke,
  type BautagKopfZeile, type GewerkZeile, type MannstundenAbgleich, type MannstundenZeile,
  type PositionZeile, type TagesfotoZeile,
} from '@/server/services/bau/bautagebuch';
import { findeProjekt, type ProjektZeile } from '@/server/services/bau/lv';
import { BAUTAG_PILLE, BAUTAG_STATUS_TEXT, WETTER_QUELLE_TEXT }
  from '../../../../bautagebuch-anzeige';
import { AnmeldungNoetig } from '../../../../../../Anmeldung';
import { portalZugang } from '../../../../../../zugang';
import { slugTor } from '../../../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * `/portal/[mandant]/bau/projekte/[id]/bautagebuch/[datum]` — der Bautag
 * (BAU-07, BAU-08, TIM-10, Seitenkarte §5.9).
 *
 * **`[datum]` ist ein BERLINER Kalendertag** (K-11), keine Kennung und kein
 * Zeitpunkt. Ein Bautag, der an UTC-Mitternacht aufgeteilt wird, verschiebt
 * ein bis zwei Stunden Mannstunden jeden Tag in den Nachbartag — in der
 * Sommerzeit zwei.
 *
 * **Die Seite kommt ohne JavaScript aus.** Das ist keine Sparsamkeit: sie
 * wird auf einem Telefon im Rohbau benutzt, und eine Seite, die erst nach
 * einem Skriptdownload absendet, sendet dort gar nicht ab. Jedes Formular ist
 * ein gewoehnliches `POST` auf `/api/bau/bautagebuch`.
 *
 * **Vier Dinge stehen hier nebeneinander, und keines verdeckt das andere:**
 *
 *  1. Das Wetter — mit Station und BEOBACHTUNGSZEIT, oder mit dem woertlichen
 *     Satz „Wetterdaten nicht verfügbar". Kein Vorgabewetter (BAU-08).
 *  2. Die Mannstunden je Gewerk, samt Korrekturspur: die stornierte Zeile
 *     bleibt lesbar neben ihrer Richtigstellung stehen.
 *  3. Geräte, Lieferungen und Vorkommnisse — je eine Zeile, damit sie
 *     auswertbar bleiben statt in Fließtext zu verschwinden.
 *  4. Der ABGLEICH gegen die Zeiterfassung. Eine Abweichung wird benannt,
 *     nicht geglättet — das ist die Zusage, wegen der er existiert.
 */
export const dynamic = 'force-dynamic';

interface Seitendaten {
  readonly projekt: ProjektZeile;
  readonly kopf: BautagKopfZeile | null;
  readonly gewerke: readonly GewerkZeile[];
  readonly mannstunden: readonly MannstundenZeile[];
  readonly positionen: readonly PositionZeile[];
  readonly fotos: readonly TagesfotoZeile[];
  readonly wetter: WetterAnzeige | null;
  readonly abgleich: MannstundenAbgleich | null;
}

const FELD =
  'min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text';
const BESCHRIFTUNG =
  'mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted';
const KOPFZELLE =
  'px-s4 py-s3 text-left text-micro uppercase tracking-[0.08em] text-text-subtle';

export default async function Bautag(
  { params }: { params: Promise<{ mandant: string; id: string; datum: string }> },
) {
  const { mandant, id, datum } = await params;
  if (!istKalendertag(datum)) notFound();

  const pfad = `/portal/${mandant}/bau/projekte/${id}/bautagebuch/${datum}`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  /**
   * Die Seite LEGT NICHTS AN. Ein GET, das eine Zeile erzeugt, legt bei jedem
   * Vorschaulauf eines Linkprüfers einen Bautag an — der Tag entsteht erst
   * mit dem ersten Eintrag, über `POST /api/bau/bautagebuch`.
   */
  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const projekt = await findeProjekt(kontext, id);
      if (projekt === null) return null;
      const kopf = await findeBautagZuDatum(kontext, id, datum);
      const gewerke = await listeGewerke(kontext);
      if (kopf === null) {
        return {
          projekt, kopf: null, gewerke,
          mannstunden: [], positionen: [], fotos: [], wetter: null, abgleich: null,
        };
      }
      return {
        projekt,
        kopf,
        gewerke,
        mannstunden: await leseMannstunden(kontext, kopf.id),
        positionen: await lesePositionen(kontext, kopf.id),
        fotos: await leseTagesfotos(kontext, kopf.id),
        wetter: await leseWetterAnzeige(kontext, kopf.id),
        abgleich: await gleicheMannstundenAb(kontext, kopf.id),
      };
    }),
  ) as Promise<Seitendaten | null>);

  // AUT-06: ein fremdes Projekt ist nicht vorhanden, nicht verboten.
  if (daten === null) notFound();

  const kopf = daten.kopf;
  const offen = kopf === null || (!kopf.storniert && kopf.abgeschlossen_lokal === null);
  const quelle = wetterPort();
  const [jahr, monat, tag] = datum.split('-');
  const datumLokal = `${tag ?? ''}.${monat ?? ''}.${jahr ?? ''}`;

  /** Die versteckten Felder, die jedes Formular dieser Seite mitträgt. */
  const Bezug = () => (
    <>
      <input type="hidden" name="mandant" value={mandant} />
      <input type="hidden" name="projekt" value={id} />
      <input type="hidden" name="datum" value={datum} />
      {kopf !== null && <input type="hidden" name="bautag" value={kopf.id} />}
    </>
  );

  return (
    <PortalRahmen
      titel={`Bautag ${datumLokal}`}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="bau"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-start justify-between gap-s3">
        <div>
          <h1 className="m-0 text-h1 text-text">Bautag {datumLokal}</h1>
          <p className="m-0 mt-s1 text-sm text-text-muted">
            {daten.projekt.nummer} · {daten.projekt.bezeichnung}
            {kopf?.abgeschlossen_lokal != null
              && ` · abgeschlossen ${kopf.abgeschlossen_lokal}`}
            {kopf?.gegengezeichnet_lokal != null
              && ` · gegengezeichnet von ${kopf.gegengezeichnet_von_name ?? ''} am ${kopf.gegengezeichnet_lokal}`}
          </p>
        </div>
        <span className="inline-flex items-center gap-s2">
          <StatusPill
            zustand={kopf === null
              ? 'Entwurf'
              : kopf.storniert ? 'Archiviert' : BAUTAG_PILLE[kopf.status] ?? 'Entwurf'}
          />
          <span className="text-sm text-text-muted">
            {kopf === null
              ? 'Noch nicht begonnen'
              : kopf.storniert ? 'Storniert' : BAUTAG_STATUS_TEXT[kopf.status] ?? kopf.status}
          </span>
        </span>
      </div>

      {kopf?.storniert === true && (
        <p className="mb-s5 rounded-lg border border-line bg-warning-soft p-s4 text-sm text-warning">
          Dieser Tag ist storniert: {kopf.storno_grund ?? 'ohne Grund'}. Er bleibt
          lesbar stehen — die Richtigstellung trägt der Ersatztag.
        </p>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* 1. Wetter (BAU-08).                                                 */}
      {/* ------------------------------------------------------------------ */}
      <section className="mb-s6 rounded-lg border border-line bg-surface p-s5">
        <h2 className="m-0 mb-s3 text-h3 text-text">Wetter</h2>

        {daten.wetter === null || daten.wetter.quelle === 'keine' ? (
          <p className="m-0 text-sm text-text-muted" data-cse="wetter-fehlt">
            {WETTER_NICHT_VERFUEGBAR}
          </p>
        ) : (
          <dl className="m-0 grid gap-s3 text-sm md:grid-cols-4" data-cse="wetter-werte">
            <div>
              <dt className={BESCHRIFTUNG}>Quelle</dt>
              <dd className="m-0 text-text">
                {WETTER_QUELLE_TEXT[daten.wetter.quelle] ?? daten.wetter.quelle}
              </dd>
            </div>
            <div>
              <dt className={BESCHRIFTUNG}>Station</dt>
              <dd className="m-0 text-text">{daten.wetter.station ?? '—'}</dd>
            </div>
            <div>
              <dt className={BESCHRIFTUNG}>Beobachtet</dt>
              <dd className="m-0 text-text">{daten.wetter.beobachtetAmLokal ?? '—'}</dd>
            </div>
            <div>
              <dt className={BESCHRIFTUNG}>Temperatur · Niederschlag</dt>
              <dd className="m-0 text-text">
                {daten.wetter.temperaturMin ?? '—'} bis {daten.wetter.temperaturMax ?? '—'} °C
                {' · '}{daten.wetter.niederschlag ?? '—'} mm
              </dd>
            </div>
          </dl>
        )}

        {/* Die Namensnennung ist Bedingung der Nutzung, keine Höflichkeit
            (07-INTEGRATIONEN §16). */}
        {daten.wetter?.quelle === 'dwd' && (
          <p className="m-0 mt-s2 text-xs text-text-subtle">{WETTER_QUELLENHINWEIS}</p>
        )}

        {!quelle.verbunden && (
          <p className="m-0 mt-s3 text-xs text-text-subtle" data-cse="wetter-nicht-verbunden">
            {quelle.bezeichnung}: nicht verbunden. Es wird kein Wetter erfunden — der
            Bautag speichert trotzdem, und das Feld bleibt leer.
          </p>
        )}

        {kopf !== null && offen && quelle.verbunden && (
          <form
            action={`/api/bau/bautagebuch/${kopf.id}/wetter`}
            method="post"
            className="mt-s4"
            data-cse="wetter-holen"
          >
            <Bezug />
            <Button type="submit" variante="secondary">Wetter vom DWD nachtragen</Button>
          </form>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* 2. Mannstunden je Gewerk — mit Korrekturspur.                       */}
      {/* ------------------------------------------------------------------ */}
      <section className="mb-s6">
        <h2 className="mb-s3 text-h3 text-text">Mannstunden je Gewerk</h2>

        {daten.mannstunden.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            Für diesen Tag sind noch keine Mannstunden erfasst.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full border-collapse text-sm" data-cse="mannstunden">
              <caption className="sr-only">Mannstunden je Gewerk, mit Korrekturspur</caption>
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className={KOPFZELLE}>Gewerk</th>
                  <th scope="col" className={KOPFZELLE}>Herkunft</th>
                  <th scope="col" className={KOPFZELLE}>Tätigkeit</th>
                  <th scope="col" className={`${KOPFZELLE} text-right`}>Personen</th>
                  <th scope="col" className={`${KOPFZELLE} text-right`}>Minuten</th>
                  <th scope="col" className={`${KOPFZELLE} text-right`}>Mannstunden</th>
                  <th scope="col" className={KOPFZELLE}>Spur</th>
                </tr>
              </thead>
              <tbody>
                {daten.mannstunden.map((m) => (
                  <tr
                    key={m.id}
                    className="border-b border-line last:border-0"
                    data-storniert={m.storniert ? 'ja' : 'nein'}
                  >
                    <td className="px-s4 py-s3 text-text">
                      <span className={m.storniert ? 'line-through text-text-subtle' : ''}>
                        {m.gewerk_code} · {m.gewerk}
                      </span>
                    </td>
                    <td className="px-s4 py-s3 text-text-muted">
                      {HERKUNFT_TEXT[m.herkunft] ?? m.herkunft}
                      {m.nachunternehmer !== null && ` · ${m.nachunternehmer}`}
                    </td>
                    <td className="px-s4 py-s3 text-text-muted">{m.taetigkeit ?? '—'}</td>
                    <td className="px-s4 py-s3 text-right text-text">{m.anzahl_personen}</td>
                    <td className="px-s4 py-s3 text-right text-text">{m.dauer_minuten}</td>
                    <td className="px-s4 py-s3 text-right font-mono text-text">
                      {m.mannstunden.replace('.', ',')} h
                    </td>
                    <td className="px-s4 py-s3 text-xs">
                      {m.storniert ? (
                        <span className="text-warning">
                          storniert: {m.storno_grund ?? 'ohne Grund'}
                        </span>
                      ) : m.ersetzt_id !== null ? (
                        <span className="text-text-muted">Richtigstellung</span>
                      ) : (
                        <span className="text-text-subtle">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-s2 max-w-prose text-xs text-text-subtle">
          Eine falsche Zeile wird nicht geändert, sondern storniert und durch eine
          neue ersetzt, die sie nennt. Dass zuerst etwas anderes dastand, gehört zur
          Wahrheit des Tages (LEG-01).
        </p>

        {offen && (
          <form
            action="/api/bau/bautagebuch"
            method="post"
            className="mt-s4 rounded-lg border border-line bg-surface p-s5"
            data-cse="mannstunden-formular"
          >
            <Bezug />
            <input type="hidden" name="vorgang" value="mannstunden" />
            {daten.gewerke.length === 0 ? (
              <p className="m-0 text-sm text-warning" data-cse="ohne-gewerk">
                Es sind keine Gewerke hinterlegt. Der Katalog wird leer ausgeliefert,
                bis feststeht, welche Gewerke im Bautagebuch geführt werden und ob die
                Liste den STLB-Bau-Leistungsbereichen folgt (O-159). Solange lässt sich
                keine Mannstundenzeile anlegen — geraten wird hier nichts.
              </p>
            ) : (
              <>
                <div className="grid gap-s4 md:grid-cols-4">
                  <label>
                    <span className={BESCHRIFTUNG}>Gewerk</span>
                    <select name="gewerk" required defaultValue="" className={FELD}>
                      <option value="" disabled>bitte wählen</option>
                      {daten.gewerke.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.code} · {g.bezeichnung}{g.istPlatzhalter ? ' (unbestätigt)' : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className={BESCHRIFTUNG}>Herkunft</span>
                    <select name="herkunft" defaultValue="eigen" className={FELD}>
                      <option value="eigen">eigene Kräfte</option>
                      <option value="nachunternehmer">Nachunternehmer</option>
                    </select>
                  </label>
                  <label>
                    <span className={BESCHRIFTUNG}>Personen</span>
                    <input type="number" name="personen" min="1" required className={FELD} />
                  </label>
                  <label>
                    <span className={BESCHRIFTUNG}>Dauer in Minuten</span>
                    <input
                      type="number" name="minuten" min="0" max="1440" required
                      className={FELD}
                    />
                  </label>
                </div>
                <div className="mt-s4 grid gap-s4 md:grid-cols-3">
                  <label>
                    <span className={BESCHRIFTUNG}>Nachunternehmer (Name)</span>
                    <input name="nachunternehmer" className={FELD} />
                  </label>
                  <label>
                    <span className={BESCHRIFTUNG}>Tätigkeit</span>
                    <input name="taetigkeit" placeholder="Schalung Achse C" className={FELD} />
                  </label>
                  <label>
                    <span className={BESCHRIFTUNG}>Bereich</span>
                    <input name="bereich" placeholder="OG 1" className={FELD} />
                  </label>
                </div>
                <p className="mt-s2 max-w-prose text-xs text-text-subtle">
                  Die Dauer wird in ganzen Minuten erfasst — nicht in Stunden mit Komma.
                  Die Grenze 0…1440 ist eine Eingabeplausibilität und ausdrücklich keine
                  ArbZG-Grenze: die gilt je Person über alle Gesellschaften.
                </p>
                <div className="mt-s4">
                  <Button type="submit" variante="primary">Mannstunden anfügen</Button>
                </div>
              </>
            )}
          </form>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* 3. Der Abgleich gegen die Zeiterfassung (Abnahme 3).                */}
      {/* ------------------------------------------------------------------ */}
      {daten.abgleich !== null && (
        <section
          className="mb-s6 rounded-lg border border-line bg-surface p-s5"
          data-cse="abgleich"
          data-befund={daten.abgleich.befund}
        >
          <h2 className="m-0 mb-s3 text-h3 text-text">Abgleich mit der Zeiterfassung</h2>
          <dl className="m-0 grid gap-s3 text-sm md:grid-cols-4">
            <div>
              <dt className={BESCHRIFTUNG}>Tagebuch, eigene Kräfte</dt>
              <dd className="m-0 font-mono text-text" data-cse="abgleich-tagebuch">
                {alsStunden(daten.abgleich.tagebuchEigenMinuten)} h
              </dd>
            </div>
            <div>
              <dt className={BESCHRIFTUNG}>Zeiterfassung (netto)</dt>
              {/*
                * Bei `zeit_nicht_lesbar` steht hier ein Strich und keine Null:
                * „0,00 h" waere eine Aussage ueber die Zeiterfassung, die
                * dieser Zugang gar nicht lesen durfte — und sie sähe aus wie
                * eine hundertprozentige Abweichung.
                */}
              <dd className="m-0 font-mono text-text" data-cse="abgleich-zeit">
                {daten.abgleich.befund === 'zeit_nicht_lesbar'
                  ? '—'
                  : `${alsStunden(daten.abgleich.zeiteintragMinuten)} h`}
              </dd>
            </div>
            <div>
              <dt className={BESCHRIFTUNG}>Abweichung</dt>
              <dd
                className={`m-0 font-mono ${
                  daten.abgleich.befund === 'abweichung' ? 'text-warning' : 'text-text'}`}
                data-cse="abgleich-abweichung"
              >
                {daten.abgleich.befund === 'zeit_nicht_lesbar'
                  ? '—'
                  : `${daten.abgleich.abweichungMinuten > 0 ? '+' : ''}`
                    + `${alsStunden(daten.abgleich.abweichungMinuten)} h`}
              </dd>
            </div>
            <div>
              <dt className={BESCHRIFTUNG}>Nachunternehmer</dt>
              <dd className="m-0 font-mono text-text">
                {alsStunden(daten.abgleich.tagebuchNachunternehmerMinuten)} h
              </dd>
            </div>
          </dl>
          <p className="m-0 mt-s3 max-w-prose text-sm text-text-muted">
            {daten.abgleich.text}
          </p>
          <p className="m-0 mt-s2 max-w-prose text-xs text-text-subtle">
            Verglichen werden die EIGENEN Stunden gegen die Nettozeit dieses Berliner
            Kalendertags — Nachunternehmer erzeugen keinen Zeiteintrag. Ob die
            Mannstunden brutto oder netto zählen und ab welcher Differenz der Abgleich
            als auffällig gilt, ist offen (O-280, O-281); bis dahin wird jede Differenz
            ab einer Minute gemeldet und keine geglättet.
          </p>
        </section>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* 4. Geräte, Lieferungen, Vorkommnisse.                               */}
      {/* ------------------------------------------------------------------ */}
      <section className="mb-s6">
        <h2 className="mb-s3 text-h3 text-text">Geräte, Lieferungen, Vorkommnisse</h2>

        {daten.positionen.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            Für diesen Tag ist nichts erfasst.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full border-collapse text-sm" data-cse="positionen">
              <caption className="sr-only">Geräte, Lieferungen und Vorkommnisse des Tages</caption>
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className={KOPFZELLE}>Art</th>
                  <th scope="col" className={KOPFZELLE}>Bezeichnung</th>
                  <th scope="col" className={`${KOPFZELLE} text-right`}>Menge</th>
                  <th scope="col" className={KOPFZELLE}>Lieferschein</th>
                  <th scope="col" className={KOPFZELLE}>Zeitpunkt</th>
                  <th scope="col" className={KOPFZELLE}>Spur</th>
                </tr>
              </thead>
              <tbody>
                {daten.positionen.map((q) => (
                  <tr
                    key={q.id}
                    className="border-b border-line last:border-0"
                    data-storniert={q.storniert ? 'ja' : 'nein'}
                  >
                    <td className="px-s4 py-s3 text-text-muted">
                      {POSITION_ART_TEXT[q.art] ?? q.art}
                    </td>
                    <td className="px-s4 py-s3 text-text">
                      <span className={q.storniert ? 'line-through text-text-subtle' : ''}>
                        {q.bezeichnung}
                      </span>
                      {q.beschreibung !== null && (
                        <span className="block text-xs text-text-muted">{q.beschreibung}</span>
                      )}
                    </td>
                    <td className="px-s4 py-s3 text-right font-mono text-text">
                      {q.menge === null ? '—' : `${q.menge.replace('.', ',')} ${q.einheit ?? ''}`}
                    </td>
                    <td className="px-s4 py-s3 text-text-muted">
                      {q.lieferschein_nummer ?? '—'}
                      {q.lieferant !== null && ` · ${q.lieferant}`}
                    </td>
                    <td className="px-s4 py-s3 text-text-muted">{q.zeitpunkt_lokal ?? '—'}</td>
                    <td className="px-s4 py-s3 text-xs">
                      {q.storniert ? (
                        <span className="text-warning">
                          storniert: {q.storno_grund ?? 'ohne Grund'}
                        </span>
                      ) : q.ersetzt_id !== null ? (
                        <span className="text-text-muted">Richtigstellung</span>
                      ) : (
                        <span className="text-text-subtle">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {offen && (
          <form
            action="/api/bau/bautagebuch"
            method="post"
            encType="multipart/form-data"
            className="mt-s4 rounded-lg border border-line bg-surface p-s5"
            data-cse="position-formular"
          >
            <Bezug />
            <input type="hidden" name="vorgang" value="position" />
            <div className="grid gap-s4 md:grid-cols-4">
              <label>
                <span className={BESCHRIFTUNG}>Art</span>
                <select name="art" defaultValue="geraet" className={FELD}>
                  <option value="geraet">Gerät</option>
                  <option value="lieferung">Lieferung</option>
                  <option value="vorkommnis">Vorkommnis</option>
                </select>
              </label>
              <label>
                <span className={BESCHRIFTUNG}>Bezeichnung</span>
                <input name="bezeichnung" required placeholder="Turmdrehkran" className={FELD} />
              </label>
              <label>
                <span className={BESCHRIFTUNG}>Menge</span>
                <input name="menge" placeholder="3,000" className={FELD} />
              </label>
              <label>
                <span className={BESCHRIFTUNG}>Einheit</span>
                <input name="einheit" placeholder="t" className={FELD} />
              </label>
            </div>
            <div className="mt-s4 grid gap-s4 md:grid-cols-2">
              <label>
                <span className={BESCHRIFTUNG}>Lieferschein</span>
                <input name="lieferschein" className={FELD} />
              </label>
              <label>
                <span className={BESCHRIFTUNG}>Beschreibung (bei Vorkommnis Pflicht)</span>
                <input name="beschreibung" className={FELD} />
              </label>
            </div>
            <label className="mt-s4 block">
              <span className={BESCHRIFTUNG}>Fotos</span>
              <input
                type="file" name="fotos" multiple
                accept="image/jpeg,image/png,image/webp,image/heic"
                className="block w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
              />
              <span className="mt-s1 block text-xs text-text-subtle">
                Die Aufnahmen werden ohne Metadaten in einem privaten Speicher abgelegt;
                erreichbar sind sie nur über eine befristete Adresse. Ist der Speicher
                nicht verbunden, entsteht KEINE Zeile — nichts wird vorgetäuscht.
              </span>
            </label>
            <div className="mt-s4">
              <Button type="submit" variante="primary">Zeile anfügen</Button>
            </div>
          </form>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* 5. Fotos.                                                           */}
      {/* ------------------------------------------------------------------ */}
      <section className="mb-s6">
        <h2 className="mb-s3 text-h3 text-text">Fotos</h2>
        {daten.fotos.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            Zu diesem Tag ist keine Aufnahme abgelegt.
          </p>
        ) : (
          <ul className="m-0 list-none rounded-lg border border-line bg-surface p-s5 text-sm">
            {daten.fotos.map((f) => (
              <li key={f.id} className="text-text-muted">
                {f.erfasst_lokal} · {f.mime_typ}
                {f.beschreibung !== null && ` · ${f.beschreibung}`}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* 6. Abschluss, Gegenzeichnung, Ersatztag.                            */}
      {/* ------------------------------------------------------------------ */}
      {kopf !== null && !kopf.storniert && (
        <section className="mb-s6 grid gap-s4 md:grid-cols-2">
          {offen && (
            <form
              action="/api/bau/bautagebuch"
              method="post"
              className="rounded-lg border border-line bg-surface p-s5"
              data-cse="abschluss-formular"
            >
              <Bezug />
              <input type="hidden" name="vorgang" value="abschluss" />
              <h2 className="m-0 mb-s2 text-h3 text-text">Tag abschließen</h2>
              <p className="m-0 mb-s3 max-w-prose text-sm text-text-muted">
                Ab dem Abschluss ist der Tag ein Dokument und kein Formular mehr: es
                kommt keine Zeile mehr hinzu, und keine bewegt sich. Korrigiert wird
                danach durch Storno und einen Ersatztag. Den Zeitpunkt setzt die
                Serveruhr.
              </p>
              <Button type="submit" variante="primary">Tag abschließen</Button>
            </form>
          )}

          {!offen && kopf.status === 'abgeschlossen' && (
            <form
              action="/api/bau/bautagebuch"
              method="post"
              className="rounded-lg border border-line bg-surface p-s5"
              data-cse="gegenzeichnung-formular"
            >
              <Bezug />
              <input type="hidden" name="vorgang" value="gegenzeichnung" />
              <h2 className="m-0 mb-s2 text-h3 text-text">Gegenzeichnung</h2>
              <p className="m-0 mb-s3 max-w-prose text-sm text-text-muted">
                Die Bauleitung des AUFTRAGGEBERS erkennt den Tag an. Das ist etwas
                anderes als ein abgeschlossener Tag und trägt anderes Beweisgewicht.
              </p>
              <label className="block">
                <span className={BESCHRIFTUNG}>Name der Bauleitung (Auftraggeber)</span>
                <input name="name" required className={FELD} />
              </label>
              <div className="mt-s3">
                <Button type="submit" variante="secondary">Gegenzeichnung eintragen</Button>
              </div>
            </form>
          )}

          <form
            action="/api/bau/bautagebuch"
            method="post"
            className="rounded-lg border border-line bg-surface p-s5"
            data-cse="ersatztag-formular"
          >
            <Bezug />
            <input type="hidden" name="vorgang" value="ersatztag" />
            <h2 className="m-0 mb-s2 text-h3 text-text">Tag stornieren und ersetzen</h2>
            <p className="m-0 mb-s3 max-w-prose text-sm text-text-muted">
              Der alte Tag bleibt lesbar stehen und zeigt auf seinen Ersatz. Der Inhalt
              wird NICHT übernommen: was am falschen Tag stand, war falsch.
            </p>
            <label className="block">
              <span className={BESCHRIFTUNG}>Grund</span>
              <input name="grund" required minLength={5} className={FELD} />
            </label>
            <div className="mt-s3">
              <Button type="submit" variante="danger">Stornieren und ersetzen</Button>
            </div>
          </form>
        </section>
      )}

      <Link
        href={`/portal/${mandant}/bau/projekte/${id}/bautagebuch`}
        className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
      >
        Zurück zu allen Bautagen
      </Link>
    </PortalRahmen>
  );
}
