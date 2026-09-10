import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { berlinHeute } from '@/server/db/heute';
import { stundenAusMinuten } from '@/lib/datum/stunden';
import { berlinAnzeige } from '@/server/services/zeit/dauer';
import type { MiLoGZeile } from '@/server/services/zeit/milog';
import { ladeAnstellungenMitZeit, ladeNachweis } from '../daten';

/**
 * `/portal/[mandant]/zeiten/milog` — die Aufzeichnung nach § 17 MiLoG
 * (TIM-13, LEG-02, ACC-12).
 *
 * § 17 Abs. 1 MiLoG verlangt Beginn, Ende und Dauer der täglichen Arbeitszeit,
 * aufgezeichnet binnen sieben Tagen und zwei Jahre aufbewahrt. Diese Seite
 * zeigt sie — sie erzeugt sie nicht: gerechnet wird im Dienst, gespeichert in
 * `milog_aufzeichnung`, und was hier steht, ist dieselbe Zeile.
 *
 * **Ein gesperrter Monat wird aus seinem ARTEFAKT beantwortet.** Nicht aus
 * einer frisch gerechneten Liste, die vielleicht zufällig dieselbe wäre: eine
 * Aufzeichnung, die sich beim zweiten Aufruf ändert, ist keine. Fehlt das
 * Artefakt zu einem gesperrten Monat, sagt die Seite genau das —
 * „ungeprägt" — und rechnet nichts still nach.
 *
 * **Die Gegenprobe steht dabei.** Die Summe der Aufzeichnung und die Summe der
 * Zeiteinträge werden getrennt gelesen und verglichen. Stimmen sie nicht
 * überein, ist das die wichtigste Zeile auf diesem Bildschirm — eine
 * Aufzeichnung, die von den Einträgen abweicht, ist gegenüber dem Zoll wertlos.
 */
export const dynamic = 'force-dynamic';

const QUELLE_TEXT: Readonly<Record<string, string>> = {
  live: 'offener Monat — vorläufig gerechnet',
  artefakt: 'gesperrter Monat — geprägtes Artefakt',
  ungepraegt: 'gesperrter Monat OHNE Artefakt',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** `2026-09-10` → `2026-09-01`; ein Monat wird über seinen Ersten benannt. */
function monatsErster(tag: string): string {
  return `${tag.slice(0, 7)}-01`;
}

function monatVerschieben(monat: string, um: number): string {
  const jahr = Number(monat.slice(0, 4));
  const m = Number(monat.slice(5, 7));
  const gesamt = jahr * 12 + (m - 1) + um;
  const neuJahr = Math.floor(gesamt / 12);
  const neuMonat = (gesamt % 12) + 1;
  return `${String(neuJahr).padStart(4, '0')}-${String(neuMonat).padStart(2, '0')}-01`;
}

const MONATSNAMEN = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
] as const;

/** `2026-09-01` → `September 2026`. Ohne `TM`: das hinge an `lc_time`. */
function monatsName(monat: string): string {
  const m = Number(monat.slice(5, 7));
  return `${MONATSNAMEN[m - 1] ?? monat.slice(5, 7)} ${monat.slice(0, 4)}`;
}

export default async function MiLoGAufzeichnung({
  params, searchParams,
}: {
  params: Promise<{ mandant: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/zeiten/milog`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={mandant} zielSlug={tor.ziel} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const frage = await searchParams;
  const rohMonat = typeof frage['monat'] === 'string' ? frage['monat'] : null;
  const monat = rohMonat !== null && /^\d{4}-\d{2}-\d{2}$/u.test(rohMonat)
    ? monatsErster(rohMonat)
    : monatsErster(await berlinHeute());

  const rohAnstellung = typeof frage['anstellung'] === 'string' ? frage['anstellung'] : null;
  const anstellungId = rohAnstellung !== null && UUID.test(rohAnstellung) ? rohAnstellung : null;

  const anstellungen = await ladeAnstellungenMitZeit(sitzung, monat);
  const gewaehlt = anstellungen.find((a) => a.id === anstellungId) ?? null;
  const befund = gewaehlt === null ? null : await ladeNachweis(sitzung, gewaehlt.id, monat);

  const abweichung = befund !== null
    && befund.nachweis.summeBruttoMinuten !== befund.gegenprobe.bruttoMinuten;

  return (
    <PortalRahmen
      titel="§ 17 MiLoG"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="zeiten"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Aufzeichnung § 17 MiLoG</h1>
        <p className="m-0 text-sm text-text-muted">{monatsName(monat)}</p>
      </div>

      <nav aria-label="Monat wechseln" className="mb-s5 flex flex-wrap items-center gap-s2">
        <Sprung mandant={mandant} monat={monatVerschieben(monat, -1)} text="← Voriger Monat" />
        <Sprung mandant={mandant} monat={monatVerschieben(monat, 1)} text="Nächster Monat →" />
        <Link
          href={`/portal/${mandant}/zeiten`}
          className="inline-flex min-h-11 items-center rounded-md border border-line px-s3 text-sm text-text-muted transition-colors duration-fast hover:border-line-strong hover:text-text"
        >
          Zu den Zeiten
        </Link>
      </nav>

      {anstellungen.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Für {monatsName(monat)} ist keine Zeit aufgezeichnet. Das heißt: es
          gibt keinen abgeschlossenen Eintrag in diesem Monat — laufende
          Einträge tragen noch keine Dauer.
        </p>
      ) : (
        <div className="mb-s6">
          <h2 className="mb-s3 mt-0 text-h3 text-text">Anstellung wählen</h2>
          <ul className="m-0 flex list-none flex-wrap gap-s2 p-0">
            {anstellungen.map((a) => (
              <li key={a.id}>
                <Link
                  href={`/portal/${mandant}/zeiten/milog?monat=${monat}&anstellung=${a.id}`}
                  data-cse="anstellung"
                  data-anstellung={a.id}
                  className={`inline-flex min-h-11 items-center rounded-full px-s4 text-sm transition-colors duration-fast ${
                    a.id === gewaehlt?.id
                      ? 'bg-white text-ink'
                      : 'bg-surface-3 text-text-muted hover:text-text'
                  }`}
                >
                  {a.person}
                  {a.personalnummer !== null && (
                    <span className="ml-s2 text-xs tabular-nums">{a.personalnummer}</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {befund !== null && gewaehlt !== null && (
        <section data-cse="nachweis">
          <div className="mb-s4 rounded-lg border border-line bg-surface p-s5">
            <h2 className="mb-s4 mt-0 text-h3 text-text">
              {gewaehlt.person} · {monatsName(monat)}
            </h2>
            <dl className="m-0 grid grid-cols-1 gap-s4 sm:grid-cols-2 xl:grid-cols-4">
              <Feld
                label="Summe brutto"
                wert={stundenAusMinuten(befund.nachweis.summeBruttoMinuten)}
              />
              <Feld
                label="Summe netto"
                wert={stundenAusMinuten(befund.nachweis.summeNettoMinuten)}
              />
              <Feld label="Zeilen" wert={String(befund.nachweis.zeilen.length)} />
              <Feld
                label="Herkunft"
                wert={QUELLE_TEXT[befund.nachweis.quelle] ?? befund.nachweis.quelle}
                zahl={false}
              />
            </dl>
            <p className="m-0 mt-s4 break-all text-xs text-text-subtle">
              Digest der Zeilen: <span className="tabular-nums">{befund.nachweis.hash}</span>
            </p>
            {befund.nachweis.gesperrtAm !== null && (
              <p className="m-0 mt-s2 text-sm text-text-muted">
                Monat gesperrt am {berlinAnzeige(befund.nachweis.gesperrtAm)} — eine
                Korrektur wirkt ab hier nur noch als Gegenbuchung im Folgemonat.
              </p>
            )}
          </div>

          {befund.nachweis.quelle === 'ungepraegt' && (
            <p className="mb-s4 rounded-lg border border-warning bg-warning-soft p-s4 text-sm text-warning">
              Der Monat ist gesperrt, aber es gibt noch kein geprägtes Artefakt.
              Was hier steht, ist deshalb eine Rechnung von jetzt und keine
              Zusage — geprägt wird sie beim Export, und danach ist sie
              byte-gleich.
            </p>
          )}

          {abweichung ? (
            <p className="mb-s4 rounded-lg border border-danger bg-danger-soft p-s4 text-sm text-danger">
              <strong>Die Gegenprobe weicht ab.</strong> Die Aufzeichnung nennt{' '}
              {stundenAusMinuten(befund.nachweis.summeBruttoMinuten)}, die Summe der
              Zeiteinträge {stundenAusMinuten(befund.gegenprobe.bruttoMinuten)}. Diese
              Aufzeichnung ist so nicht vorlagefähig; die Differenz gehört
              geklärt, bevor jemand sie exportiert.
            </p>
          ) : (
            <p className="mb-s4 rounded-lg border border-line bg-surface p-s4 text-sm text-text-muted">
              Gegenprobe stimmt: Aufzeichnung und Summe der Zeiteinträge nennen
              dieselbe Brutto-Dauer. Beide wurden getrennt gelesen — eine
              Gegenprobe aus derselben Quelle wäre keine.
            </p>
          )}

          <DataTable
            beschriftung={`Aufzeichnung ${gewaehlt.person}, ${monatsName(monat)}`}
            zeilen={befund.nachweis.zeilen}
            schluessel={(z: MiLoGZeile) => `${z.zeiteintragId}:${z.anteilBeginn}`}
            spalten={[
              {
                schluessel: 'tag',
                kopf: 'Tag',
                zelle: (z) => <span className="tabular-nums">{z.kalendertag}</span>,
              },
              {
                schluessel: 'beginn',
                kopf: 'Beginn',
                zelle: (z) => (
                  <span className="tabular-nums">{berlinAnzeige(new Date(z.beginn))}</span>
                ),
              },
              {
                schluessel: 'ende',
                kopf: 'Ende',
                zelle: (z) => (
                  <span className="tabular-nums">{berlinAnzeige(new Date(z.ende))}</span>
                ),
              },
              {
                schluessel: 'pause',
                kopf: 'Pause',
                numerisch: true,
                zelle: (z) => `${String(z.pauseMinuten)} min`,
              },
              {
                schluessel: 'dauer',
                kopf: 'Dauer',
                numerisch: true,
                zelle: (z) => stundenAusMinuten(z.nettoMinuten),
              },
              {
                schluessel: 'anteil',
                kopf: 'Anteil im Monat',
                numerisch: true,
                zelle: (z) => (
                  z.anteilBruttoMinuten === z.bruttoMinuten
                    ? <span className="text-text-subtle">vollständig</span>
                    : stundenAusMinuten(z.anteilBruttoMinuten)
                ),
              },
              {
                schluessel: 'art',
                kopf: 'Erfassung',
                /**
                 * „erfasst" und nicht „gestempelt": die Zeile weiss nur, dass
                 * sie NICHT nachträglich behauptet wurde — ob sie aus einem
                 * Check-in-Link, aus dem Portal oder aus einem Import stammt,
                 * steht in `erfassungsart` und gehört auf das Einzelblatt.
                 * Ein Wort, das mehr behauptet als die Spalte weiss, ist auf
                 * einer Zoll-Aufzeichnung genau falsch.
                 */
                zelle: (z) => (z.nacherfasst
                  ? <span className="text-warning">nacherfasst</span>
                  : <span className="text-text-subtle">erfasst</span>),
              },
            ]}
          />

          <p className="mt-s5 max-w-prose text-sm text-text-muted">
            Eine Schicht über den Monatswechsel steht in BEIDEN Monaten, jeweils
            mit ihrem tatsächlichen Anteil — nicht doppelt und nicht halbiert.
            Die Spalte „Anteil im Monat" zeigt den Ausschnitt, „Dauer" den
            ganzen Eintrag. Aufbewahrt wird die Aufzeichnung zwei Jahre
            (§ 17 Abs. 2 MiLoG); gelöscht werden kann sie nicht — die Datenbank
            weist ein `DELETE` ab.
          </p>
        </section>
      )}
    </PortalRahmen>
  );
}

function Feld({ label, wert, zahl = true }: {
  readonly label: string; readonly wert: string; readonly zahl?: boolean;
}) {
  return (
    <div>
      <dt className="text-micro uppercase tracking-[0.08em] text-text-muted">{label}</dt>
      <dd className={`m-0 mt-s1 text-sm text-text ${zahl ? 'tabular-nums' : ''}`}>{wert}</dd>
    </div>
  );
}

function Sprung({ mandant, monat, text }: {
  readonly mandant: string; readonly monat: string; readonly text: string;
}) {
  return (
    <Link
      href={`/portal/${mandant}/zeiten/milog?monat=${monat}`}
      className="inline-flex min-h-11 items-center rounded-md border border-line px-s3 text-sm text-text-muted transition-colors duration-fast hover:border-line-strong hover:text-text"
    >
      {text}
    </Link>
  );
}
