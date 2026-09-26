import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { berlinHeute } from '@/server/db/heute';
import { tagePlus } from '@/lib/datum/kalendertag';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Card } from '@/components/ui/Card';
import { DataTable } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill } from '@/components/ui/StatusPill';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { stundenAusMinuten } from '@/lib/datum/stunden';
import { lesbareRegel, regelFehler } from '@/lib/datum/regeltext';
import type { BereichSchluessel } from '@/lib/design/theme';
import { haeltRechte } from '@/app/portal/rechte';
import { kennungOder404 } from '../../../../kennung';
import { mandantTor, MandantAntwort } from '../../../../unterseite';
import {
  AUSNAHME_TEXT, findeTurnus, ladeAusnahmen, ladeTurnusEinsaetze, ladeVorschau,
  type AusnahmeZeile, type TurnusBlatt, type TurnusEinsatzZeile,
} from '@/server/services/reinigung/turnus';
import type { VorschauTermin } from '@/server/services/reinigung/turnusvorschau';
import { Recht } from '@/components/ui/Recht';

/**
 * `/portal/[mandant]/reinigung/turnus/[id]` — eine Regel und was aus ihr
 * folgt (CLN-02, CLN-03, TIM-02, K-11).
 *
 * **Die Vorschau ist der Punkt dieser Seite.** Eine RRULE ist nicht lesbar,
 * indem man sie liest; sie ist lesbar, indem man sieht, welche Termine sie
 * ergibt. Deshalb steht hier nicht nur die Regel in Klartext, sondern die
 * nächsten acht Wochen Termin für Termin — mit dem, was ausfällt, und warum.
 *
 * **Drei Spalten, die man leicht weglässt und die den Fall entscheiden:**
 *
 *  - **Der Instant.** Die Wanduhrzeit steht in der Regel; der Zeitpunkt folgt
 *    daraus und ist das, was die Datenbank speichert. In zwei Nächten im Jahr
 *    stimmen die beiden nicht zusammen.
 *  - **Die wirkliche Dauer.** Differenz der beiden Instants (Invariante 2),
 *    nie eine Wanduhr-Subtraktion. Eine 480-Minuten-Schicht ist in der
 *    Vorstellnacht 420 und in der Rückstellnacht 540 Minuten lang, und das
 *    entscheidet über die Vergütung.
 *  - **Die Zeitanomalie.** `dst_luecke` heisst: die Kolonne rückt eine Stunde
 *    später an, als in der Regel steht. Das lautlos zu verschieben wäre der
 *    Fehler, den K-11 verhindert.
 *
 * **Die Felder sind hier NICHT bearbeitbar, und das ist eine Entscheidung
 * gegen eine stille.** Aus diesem Turnus sind Schichten materialisiert, an
 * denen Check-in-Links, Leistungsnachweise und Rechnungen hängen. Was mit
 * ihnen geschieht, wenn jemand Regel, Uhrzeit oder Dauer ändert —
 * nachziehen, nur künftige, oder Serie beenden und neu anlegen — steht in
 * keinem Dokument. Eine still gewählte Variante verändert rückwirkend
 * bezahlte Schichten.
 *
 * // TODO(client, O-701): Was geschieht mit den bereits erzeugten Schichten, wenn Regel, Beginn oder Dauer eines laufenden Turnus geändert werden — werden künftige Schichten nachgezogen, bleibt der Bestand unverändert, oder wird die Serie beendet und eine neue angelegt?
 *
 * Was stattdessen geht, ist der Weg, den 0069 vorsieht: eine **Ausnahme** für
 * einen einzelnen Tag. Sie ändert die Regel nicht und ist deshalb
 * rückwirkungsfrei.
 */
export const dynamic = 'force-dynamic';

/** Das Vorschaufenster: acht Wochen, derselbe Horizont wie der Generator. */
const VORSCHAU_TAGE = 56;

const UNGEPRUEFT = 'nicht geprüft';

const ANOMALIE_TEXT: Readonly<Record<string, string>> = {
  keine: '—',
  dst_luecke: 'Zeitumstellung: diese Uhrzeit gibt es an dem Tag nicht',
  dst_doppelt: 'Zeitumstellung: diese Uhrzeit gibt es an dem Tag zweimal',
};

const AUSFALL_TEXT: Readonly<Record<string, string>> = {
  feiertag: 'fällt aus — Feiertag',
  ausnahme_ausfall: 'fällt aus — Ausnahme',
  ausserhalb_gueltigkeit: 'ausserhalb der Geltung',
};

/** Der Instant, wie er gespeichert wird: UTC, mit Z. Nie stillschweigend lokal. */
function utcText(wert: Date | null): string {
  if (wert === null) return '—';
  return `${wert.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export default async function TurnusBlattSeite(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  const suche = await searchParams;
  const ausnahmeAngelegt = suche['ausnahme'] === '1';
  const fehlerText = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;
  kennungOder404(id);
  const tor = await mandantTor(`/portal/${mandant}/reinigung/turnus/${id}`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const { sitzung } = zugang;

  /* AUT-06: der Dienstplan verlangt `dienstplan.lesen`, das Serienblatt
     dasselbe; dieses Blatt hält nur `reinigung.lesen`. Verweise ohne das Recht
     dahinter führen auf 404 und verraten, was sie nicht zeigen dürfen. */
  const darf = await haeltRechte(sitzung, 'reinigung.schreiben', 'dienstplan.lesen');

  const heute = await berlinHeute();
  const fenster = { vonDatum: heute, bisDatum: tagePlus(heute, VORSCHAU_TAGE) };

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const { blatt, geprueft } = await findeTurnus(kontext, id);
      if (blatt === null) return { blatt: null } as const;
      const kaputt = regelFehler(blatt.rrule);
      return {
        blatt,
        geprueft,
        kaputt,
        ausnahmen: await ladeAusnahmen(kontext, blatt.id),
        // Eine unlesbare Regel hat keine Vorschau — sie wird als Fehler
        // gezeigt und nicht geraten.
        vorschau: kaputt === null ? await ladeVorschau(kontext, blatt, fenster) : null,
        einsaetze: geprueft['dienstplan.lesen'] === true
          ? await ladeTurnusEinsaetze(kontext, blatt.id)
          : null,
      } as const;
    })) as Promise<{
      readonly blatt: TurnusBlatt | null;
      readonly geprueft?: Readonly<Record<string, boolean>>;
      readonly kaputt?: string | null;
      readonly ausnahmen?: readonly AusnahmeZeile[];
      readonly vorschau?: { readonly termine: readonly VorschauTermin[]; readonly bundesland: string } | null;
      readonly einsaetze?: readonly TurnusEinsatzZeile[] | null;
    }>);

  // AUT-06: ein fremder Turnus ist nicht vorhanden, nicht verboten.
  if (daten.blatt === null) notFound();
  const t = daten.blatt;
  const ausnahmen = daten.ausnahmen ?? [];
  const einsaetze = daten.einsaetze ?? null;
  const planbar = daten.geprueft?.['dienstplan.lesen'] === true;
  const termine = daten.vorschau?.termine ?? [];
  const anomalien = termine.filter((v) => v.anomalie !== 'keine').length;
  const abweichendeDauer = termine.filter(
    (v) => v.dauerInstant !== null && v.dauerInstant !== v.dauerNominal).length;

  const feld = 'min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 text-sm text-text';

  return (
    <PortalRahmen
      titel={t.bezeichnung}
      wurzelTitel="Reinigung"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="reinigung"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
      zurueck={{ ziel: `/portal/${mandant}/reinigung/turnus`, text: 'Alle Turnusse' }}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">{t.bezeichnung}</h1>
        <div className="flex flex-wrap items-baseline gap-s3">
          <StatusPill zustand={t.archiviert ? 'Archiviert' : 'Aktiv'} />
          {planbar && t.planungsserieId !== null && (
            <Link
              href={`/portal/${mandant}/dienstplan/serien/${t.planungsserieId}`}
              className="text-sm underline hover:text-text"
            >
              Zur Serie
            </Link>
          )}
        </div>
      </div>

      {ausnahmeAngelegt && (
        <Hinweis art="erfolg" cse="ausnahme-angelegt" className="mb-s5 max-w-prose">
          <strong>Ausnahme erfasst.</strong> Die Vorschau unten rechnet sie schon
          mit ein. Der Generator zieht sie beim nächsten Lauf in die Schichten:{' '}
          <strong className="text-text">künftige</strong> Schichten des Tages
          werden dabei storniert, nicht gelöscht. Schichten, die bereits
          begonnen haben, und solche mit erfasster Zeit bleiben stehen — eine
          geleistete Schicht verschwindet nicht, weil die Regel sich ändert
          (<code>storniereVerwaiste</code>: nur <code>beginn_zeitpunkt &gt;
          now()</code> und ohne Zeiterfassung).
        </Hinweis>
      )}

      {fehlerText !== null && (
        <Hinweis art="warnung" cse="ausnahme-fehler" className="mb-s5 max-w-prose">
          <strong>Nicht gespeichert.</strong> {fehlerText}
        </Hinweis>
      )}

      {/* --- Block 1: der Kopf --------------------------------------------- */}
      <div className="mb-s6 grid grid-cols-1 gap-s4 md:grid-cols-2 xl:grid-cols-3">
        <Card>
          <div className="text-micro uppercase tracking-[0.08em] text-text-muted">Wo</div>
          <p className="m-0 mt-s2 text-sm text-text">
            {t.objekt ?? <span className="text-text-muted">Objekt {UNGEPRUEFT}</span>}
            <br />
            <Link
              href={`/portal/${mandant}/reinigung/reviere/${t.revierId}`}
              className="underline hover:text-text"
            >
              {t.revier}
            </Link>
          </p>
          <p className="m-0 mt-s3 text-sm text-text-muted">
            {t.leistung === null
              ? `Leistung ${UNGEPRUEFT} (Katalog liegt hinter katalog.lesen)`
              : t.leistung}
            {t.leistungIstPlatzhalter === true && (
              <span className="ml-s2 text-warning">· Katalogwert unbestätigt</span>
            )}
          </p>
        </Card>

        <Card>
          <div className="text-micro uppercase tracking-[0.08em] text-text-muted">
            Regel und Zeitfenster
          </div>
          {daten.kaputt === null || daten.kaputt === undefined ? (
            <p className="m-0 mt-s2 text-sm text-text">
              {lesbareRegel(t.rrule)}
              <br />
              <span className="tabular-nums">
                Beginn {t.beginnLokal} (Berliner Wanduhr) · Solldauer{' '}
                {stundenAusMinuten(t.dauerMinuten)}
              </span>
            </p>
          ) : (
            <p className="m-0 mt-s2 text-sm text-danger" data-cse="turnus-regelfehler">
              <Icon name="fehler" groesse="sm" className="mr-s2 inline-block align-[-2px]" />
              Die Regel <code>{t.rrule}</code> lässt sich nicht lesen: {daten.kaputt}
            </p>
          )}
          <p className="m-0 mt-s3 text-sm text-text-muted">
            Am Feiertag: {t.feiertagsregel === 'ausfall' ? 'fällt aus' : 'findet statt'}
            {' · '}
            Gültig {t.gueltigBis === null ? `ab ${t.gueltigAb}` : `${t.gueltigAb} bis ${t.gueltigBis}`}
          </p>
        </Card>

        <Card>
          <div className="text-micro uppercase tracking-[0.08em] text-text-muted">
            Generatorstand
          </div>
          <div className="mt-s1 text-h2 tabular-nums text-text">
            {!planbar ? (
              <span className="text-base text-text-muted">{UNGEPRUEFT}</span>
            ) : t.planungsserieId === null ? (
              <span className="text-base text-warning">keine Serie</span>
            ) : (t.generiertBis ?? <span className="text-base text-warning">nie gelaufen</span>)}
          </div>
          <p className="m-0 mt-s3 text-sm text-text-muted">
            {!planbar
              ? 'Die Planungsserie liegt hinter dienstplan.lesen. Keine Aussage heisst hier nicht „nichts geplant".'
              : t.planungsserieId === null
                ? 'Zu diesem Turnus gibt es keine Planungsserie — der Generator hat ihn noch nie gesehen.'
                : `Der Turnus selbst ist bis ${t.letzteGenerierungBis ?? '—'} fortgeschrieben; `
                  + `Horizont ${t.horizontTage === null ? '—' : String(t.horizontTage)} Tage.`}
          </p>
        </Card>
      </div>

      <Hinweis art="hinweis" cse="turnus-nicht-aenderbar" className="mb-s6 max-w-prose">
        <strong>Regel, Beginn und Dauer sind hier nicht änderbar — offen (O-701).</strong>{' '}
        Aus diesem Turnus sind Schichten entstanden, an denen Check-in-Links,
        Leistungsnachweise und Rechnungen hängen. Ob eine Änderung sie nachzieht,
        nur künftige betrifft oder die Serie beendet, ist nicht entschieden;
        eine still gewählte Variante verändert rückwirkend bezahlte Schichten.
        Für einen einzelnen Tag gibt es stattdessen die Ausnahme unten — sie
        ändert die Regel nicht.
      </Hinweis>

      {/* --- Block 2: die Vorschau ----------------------------------------- */}
      <section className="mb-s6" data-cse="turnus-vorschau">
        <div className="mb-s4 flex flex-wrap items-baseline justify-between gap-s3">
          <h2 className="m-0 text-h3 text-text">
            Vorschau · {fenster.vonDatum} bis {fenster.bisDatum}
          </h2>
          <p className="m-0 text-sm text-text-muted">
            Feiertage {daten.vorschau?.bundesland ?? 'BE'}
            {' · '}
            {termine.length} Termin(e)
          </p>
        </div>

        <p className="mb-s4 max-w-prose text-sm text-text-muted">
          Was die Regel ergibt, Termin für Termin — <strong className="text-text">auch
          das, was ausfällt</strong>. Die Spalte „Dauer wirklich" ist die
          Differenz der beiden Zeitpunkte und nicht die Differenz der Uhrzeiten:
          in den zwei Umstellungsnächten weichen die beiden voneinander ab, und
          das ist der ganze Zweck dieser Spalte.
        </p>

        {(anomalien > 0 || abweichendeDauer > 0) && (
          <Hinweis art="warnung" cse="turnus-dst" className="mb-s4 max-w-prose">
            <strong>Die Zeitumstellung fällt in dieses Fenster.</strong>{' '}
            {anomalien > 0 && `${String(anomalien)} Termin(e) liegen auf einer Uhrzeit, die es an dem Tag nicht oder zweimal gibt. `}
            {abweichendeDauer > 0 && `${String(abweichendeDauer)} Termin(e) sind länger oder kürzer als die Solldauer. `}
            Welcher der beiden Zeitpunkte bei doppelt vorhandener Ortszeit gilt
            und wie die Nacht vergütet wird, ist offen (O-163) — die Vorschau
            zeigt die Vorgabe (der frühere Zeitpunkt) und sagt es hier.
          </Hinweis>
        )}

        {daten.kaputt !== null && daten.kaputt !== undefined ? (
          <p className="rounded-lg border border-danger bg-danger-soft p-s5 text-sm text-danger">
            Ohne lesbare Regel gibt es keine Vorschau. Eine geratene Auslegung
            wäre schlimmer als der Rohtext oben.
          </p>
        ) : termine.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            In den nächsten {VORSCHAU_TAGE} Tagen ergibt diese Regel keinen
            Termin. Bei einem monatlichen Turnus ist das normal; bei einem
            wöchentlichen ist es ein Befund — dann prüfen Sie den Geltungszeitraum.
          </p>
        ) : (
          <DataTable<VorschauTermin>
            beschriftung="Termine der nächsten acht Wochen mit Ortszeit, Zeitpunkt und Zeitanomalie"
            zeilen={termine}
            schluessel={(v) => `${v.planDatum}-${v.beginnLokal}-${v.art}`}
            spalten={[
              {
                schluessel: 'datum',
                kopf: 'Plandatum (Berlin)',
                zelle: (v) => (
                  <span className={v.ausfall === null ? '' : 'text-text-muted line-through'}>
                    <span className="tabular-nums">{v.planDatum}</span>
                    {v.art !== 'regel' && (
                      <span className="ml-s2 text-micro uppercase tracking-[0.08em] text-text-muted">
                        {v.art === 'zusatz' ? 'Zusatz' : 'verschoben'}
                      </span>
                    )}
                  </span>
                ),
              },
              {
                schluessel: 'ortszeit',
                kopf: 'Ortszeit',
                zelle: (v) => (
                  <span className="tabular-nums">
                    {v.beginnLokal} – {v.endeLokal}
                    {v.endetAmFolgetag && (
                      <span className="ml-s2 text-text-muted">(Folgetag)</span>
                    )}
                  </span>
                ),
              },
              {
                schluessel: 'instant',
                kopf: 'Zeitpunkt (gespeichert)',
                zelle: (v) => <span className="tabular-nums">{utcText(v.beginnZeitpunkt)}</span>,
              },
              {
                schluessel: 'dauer',
                kopf: 'Dauer wirklich',
                numerisch: true,
                zelle: (v) => (v.dauerInstant === null ? '—' : (
                  <span
                    className={`tabular-nums ${v.dauerInstant === v.dauerNominal ? '' : 'text-warning'}`}
                  >
                    {stundenAusMinuten(v.dauerInstant)}
                    {v.dauerInstant !== v.dauerNominal
                      && ` (Soll ${stundenAusMinuten(v.dauerNominal)})`}
                  </span>
                )),
              },
              {
                schluessel: 'anomalie',
                kopf: 'Zeitanomalie',
                zelle: (v) => (v.anomalie === 'keine'
                  ? <span className="text-text-muted">—</span>
                  : (
                    <span className="text-warning" data-cse="dst-befund" data-anomalie={v.anomalie}>
                      <Icon name="warnung" groesse="sm" className="mr-s2 inline-block align-[-2px]" />
                      {ANOMALIE_TEXT[v.anomalie] ?? v.anomalie}
                    </span>
                  )),
              },
              {
                schluessel: 'ausfall',
                kopf: 'Findet statt?',
                zelle: (v) => (v.ausfall === null ? (
                  <span className="text-success">ja</span>
                ) : (
                  <span className="text-warning" data-cse="vorschau-ausfall">
                    {AUSFALL_TEXT[v.ausfall] ?? v.ausfall}
                    {v.feiertag !== null && v.ausfall === 'feiertag' && ` (${v.feiertag})`}
                    {v.grund !== null && ` — ${v.grund}`}
                  </span>
                )),
              },
              {
                schluessel: 'feiertag',
                kopf: 'Feiertag',
                zelle: (v) => (v.feiertag === null ? '—' : v.feiertag),
              },
            ]}
          />
        )}
      </section>

      {/* --- Block 3: die Ausnahmen ---------------------------------------- */}
      <section className="mb-s6" data-cse="turnus-ausnahmen">
        <h2 className="mb-s4 text-h3 text-text">Ausnahmen</h2>
        <p className="mb-s4 max-w-prose text-sm text-text-muted">
          Eine Ausnahme gilt für einen einzelnen Tag und ändert die Regel nicht.
          Sie ist damit der rückwirkungsfreie Weg: der Generator liest sie beim
          nächsten Lauf und lässt den Termin aus, verschiebt ihn oder legt einen
          zusätzlichen an.
        </p>

        {ausnahmen.length === 0 ? (
          <p className="mb-s4 rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            Keine Ausnahme erfasst. Jeder Termin folgt der Regel.
          </p>
        ) : (
          <DataTable<AusnahmeZeile>
            beschriftung="Ausnahmen dieses Turnus"
            zeilen={ausnahmen}
            schluessel={(a) => a.id}
            spalten={[
              {
                schluessel: 'datum',
                kopf: 'Datum',
                zelle: (a) => <span className="tabular-nums">{a.datum}</span>,
              },
              { schluessel: 'art', kopf: 'Art', zelle: (a) => AUSNAHME_TEXT[a.art] },
              {
                schluessel: 'beginn',
                kopf: 'Ersatzbeginn',
                zelle: (a) => (a.ersatzBeginnLokal === null
                  ? '—'
                  : <span className="tabular-nums">{a.ersatzBeginnLokal.replace('T', ' ')}</span>),
              },
              {
                schluessel: 'dauer',
                kopf: 'Abweichende Dauer',
                numerisch: true,
                zelle: (a) => (a.dauerMinuten === null
                  ? '—' : stundenAusMinuten(a.dauerMinuten)),
              },
              { schluessel: 'grund', kopf: 'Grund', zelle: (a) => a.grund },
              {
                schluessel: 'abrechnung',
                kopf: 'Abrechnungsrelevant',
                /* NULL heisst UNBEANTWORTET und nicht „nein" — ob ein Ausfall
                   vom Pauschalbetrag abgeht, steht im Vertrag (O-700). */
                zelle: (a) => (a.abrechnungsrelevant === null
                  ? <span className="text-text-muted">offen (O-700)</span>
                  : a.abrechnungsrelevant ? 'ja' : 'nein'),
              },
              {
                schluessel: 'erfasst',
                kopf: 'Erfasst (Berlin)',
                zelle: (a) => <span className="tabular-nums">{a.erstelltAmLokal}</span>,
              },
            ]}
          />
        )}

        {darf['reinigung.schreiben'] === true && (
          <form
            method="post"
            action="/api/reinigung/turnus"
            data-cse="ausnahme-formular"
            className="mt-s5 flex max-w-form flex-col gap-s4 rounded-lg border border-line
                       bg-surface p-s5"
          >
            <input type="hidden" name="mandant" value={mandant} />
            <input type="hidden" name="art" value="ausnahme" />
            <input type="hidden" name="turnus" value={t.id} />
            <h3 className="m-0 text-h3 text-text">Ausnahme erfassen</h3>
            <div className="grid grid-cols-1 gap-s4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-s1 block text-sm text-text">Datum (Berliner Kalendertag)</span>
                <input name="datum" type="date" required defaultValue={heute} className={feld} />
                <span className="mt-s1 block text-xs text-text-subtle">
                  Ein vergangener Tag ist zulässig — er hält die Regel für die
                  Nachwelt fest. Die Schichten dieses Tages werden dann aber{' '}
                  <strong className="text-text">nicht mehr storniert</strong>:
                  der Generator fasst nur künftige und nur zeitlose Schichten an.
                </span>
              </label>
              <label className="block">
                <span className="mb-s1 block text-sm text-text">Art</span>
                <select name="ausnahme_art" required className={feld} defaultValue="ausfall">
                  <option value="ausfall">Ausfall — der Termin entfällt</option>
                  <option value="verschiebung">Verschiebung — andere Uhrzeit</option>
                  <option value="zusatz">Zusatztermin — zusätzlich zur Regel</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-s1 block text-sm text-text">
                  Ersatzbeginn (Pflicht bei Verschiebung)
                </span>
                <input name="ersatz_beginn" type="time" className={feld} />
              </label>
              <label className="block">
                <span className="mb-s1 block text-sm text-text">
                  Abweichende Dauer in Minuten (leer = Solldauer)
                </span>
                <input name="dauer" type="number" min={15} max={1439} step={15} className={feld} />
              </label>
            </div>
            <label className="block">
              <span className="mb-s1 block text-sm text-text">Grund</span>
              <input
                name="grund"
                required
                maxLength={200}
                className={feld}
                placeholder="Objekt geschlossen — Betriebsferien"
              />
            </label>
            <fieldset className="border-0 p-0">
              <legend className="mb-s1 text-sm text-text">Abrechnungsrelevant</legend>
              {/*
                Der Vorgabewert ist „offen" und nicht „nein". Ob ein Ausfall vom
                Pauschalbetrag abgeht, steht im Vertrag und nicht in dieser
                Anwendung (O-700); ein vorausgewähltes „nein" wäre eine
                Vertragsaussage, die niemand getroffen hat.
              */}
              <select name="abrechnungsrelevant" className={feld} defaultValue="">
                <option value="">offen — noch nicht entschieden (O-700)</option>
                <option value="ja">ja — wirkt auf die Abrechnung</option>
                <option value="nein">nein — ohne Wirkung auf die Abrechnung</option>
              </select>
            </fieldset>
            <div>
              <Button type="submit" variante="primary" data-cse="ausnahme-anlegen">
                Ausnahme erfassen
              </Button>
            </div>
          </form>
        )}
      </section>

      {/* --- Block 4: die erzeugten Schichten ------------------------------ */}
      <section data-cse="turnus-einsaetze">
        <div className="mb-s4 flex flex-wrap items-baseline justify-between gap-s3">
          <h2 className="m-0 text-h3 text-text">Erzeugte Schichten</h2>
          {darf['dienstplan.lesen'] === true && (
            <Link
              href={`/portal/${mandant}/dienstplan/woche`}
              className="text-sm underline hover:text-text"
            >
              Zum Dienstplan
            </Link>
          )}
        </div>

        {einsaetze === null ? (
          <Hinweis art="hinweis" cse="einsaetze-ungeprueft" className="max-w-prose">
            <strong>Nicht geprüft.</strong> Die Schichten liegen hinter dem Recht
            <Recht schluessel="dienstplan.lesen" />, das dieses Konto hier nicht hält. Eine
            leere Liste hiesse „keine Schicht" und wäre an dieser Stelle falsch.
          </Hinweis>
        ) : einsaetze.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            Aus diesem Turnus ist noch keine Schicht entstanden.
            {t.planungsserieId === null
              ? ' Es gibt keine Planungsserie — ohne sie läuft der Generator hier nicht.'
              : ' Der Generator läuft nächtlich; die Vorschau oben zeigt, was entstehen wird.'}
          </p>
        ) : (
          <DataTable<TurnusEinsatzZeile>
            beschriftung="Schichten dieses Turnus mit Besetzungsstand"
            zeilen={einsaetze}
            schluessel={(e) => e.id}
            spalten={[
              {
                schluessel: 'datum',
                kopf: 'Plandatum',
                zelle: (e) => (
                  <span className={e.storniert ? 'text-text-muted line-through' : 'tabular-nums'}>
                    {e.planDatum}
                  </span>
                ),
              },
              {
                schluessel: 'zeit',
                kopf: 'Ortszeit',
                zelle: (e) => (
                  <span className="tabular-nums">{e.beginnLokal} – {e.endeLokal}</span>
                ),
              },
              {
                schluessel: 'besetzung',
                kopf: 'Besetzung',
                numerisch: true,
                zelle: (e) => (
                  <span className={e.besetzt < e.soll ? 'tabular-nums text-warning' : 'tabular-nums'}>
                    {e.besetzt} von {e.soll}
                  </span>
                ),
              },
              {
                schluessel: 'anomalie',
                kopf: 'Zeitanomalie',
                zelle: (e) => (e.zeitanomalie === 'keine'
                  ? '—'
                  : <span className="text-warning">{ANOMALIE_TEXT[e.zeitanomalie] ?? e.zeitanomalie}</span>),
              },
              {
                schluessel: 'status',
                kopf: 'Status',
                zelle: (e) => (e.storniert
                  ? <StatusPill zustand="Archiviert" />
                  : <span className="text-sm text-text-muted">{e.status}</span>),
              },
            ]}
          />
        )}
      </section>
    </PortalRahmen>
  );
}
