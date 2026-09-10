import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { KpiStat } from '@/components/ui/KpiStat';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { AnmeldungNoetig } from '../../Anmeldung';
import { portalZugang } from '../../zugang';
import { slugTor } from '../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import type { IconName } from '@/lib/design/icons';
import { berlinHeute } from '@/server/db/heute';
import { montag, tagePlus } from '@/lib/datum/kalendertag';
import { stundenAusMinuten } from '@/lib/datum/stunden';
import {
  istMerkmal, ladeZeitfenster, MERKMALE, MERKMAL_TEXT, type ZeitZeile,
} from './daten';

/**
 * `/portal/[mandant]/zeiten` — die erfasste Zeit einer Woche (TIM-08, TIM-12,
 * TIM-13, LEG-02).
 *
 * **Was hier steht, ist die AUFZEICHNUNG, nicht der Plan.** Der Dienstplan
 * sagt, wer arbeiten sollte; diese Liste sagt, wer gestempelt hat. Die beiden
 * gehen auseinander, und genau die Differenz ist der Grund, warum es diesen
 * Bildschirm gibt: eine vergessene Abmeldung, eine Schicht ohne Auftrag, eine
 * nachträglich behauptete Zeit.
 *
 * **Drei Dinge sind hier nicht Gestaltung, sondern Zusage:**
 *
 *  - Jede Uhrzeit ist Berliner Ortszeit, gerechnet in der Datenbank
 *    (Invariante 2). Die Spalte „bis" trägt ein `+1`, wenn die Schicht über
 *    Mitternacht ging — ohne das läse `22:00 – 06:00` wie sechs Stunden
 *    rückwärts.
 *  - Ein stornierter Eintrag verschwindet nicht, er steht durchgestrichen da
 *    (Invariante 8). Eine Zeile, die weg ist, ist eine Zeile, über die
 *    niemand mehr streiten kann.
 *  - Die Kennzahlen oben zählen GENAU die Zeilen darunter — dieselbe Abfrage,
 *    dasselbe Fenster (DSH-04). Eine Kachel, die etwas anderes sagt als ihre
 *    Liste, macht beide unglaubwürdig.
 *
 * **Kein Lohn, nirgends** (K-05): weder Stundensatz noch Betrag. Diese Seite
 * beantwortet die Frage „wann", nicht die Frage „wie viel".
 */
export const dynamic = 'force-dynamic';

const STATUS_TEXT: Readonly<Record<string, string>> = {
  laufend: 'Läuft',
  abgeschlossen: 'Abgeschlossen',
  offen_nacherfassung: 'Nacherfassung offen',
  storniert: 'Storniert',
};

function einzeln(wert: string | string[] | undefined): string | null {
  return typeof wert === 'string' && wert !== '' ? wert : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export default async function Zeitliste({
  params, searchParams,
}: {
  params: Promise<{ mandant: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/zeiten`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={mandant} zielSlug={tor.ziel} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const frage = await searchParams;
  const heute = await berlinHeute();
  const rohWoche = einzeln(frage['woche']);
  const anker = rohWoche !== null && /^\d{4}-\d{2}-\d{2}$/u.test(rohWoche) ? rohWoche : heute;
  const von = montag(anker);
  const bis = tagePlus(von, 6);

  /**
   * Ein unbekannter Wert wird VERWORFEN, nicht durchgereicht: `person=';--`
   * darf keine Bedingung werden, und ein Merkmal, das es nicht gibt, soll die
   * Liste nicht stumm leeren, sondern schlicht nicht filtern.
   */
  const rohPerson = einzeln(frage['person']);
  const rohObjekt = einzeln(frage['objekt']);
  const rohMerkmal = einzeln(frage['merkmal']);
  const filter = {
    von,
    bis,
    personId: rohPerson !== null && UUID.test(rohPerson) ? rohPerson : null,
    objektId: rohObjekt !== null && UUID.test(rohObjekt) ? rohObjekt : null,
    merkmal: istMerkmal(rohMerkmal) ? rohMerkmal : null,
  };

  const { zeilen, auswahl } = await ladeZeitfenster(sitzung, filter);

  const nettoSumme = zeilen.reduce((s, z) => s + (z.nettoMinuten ?? 0), 0);
  const laufend = zeilen.filter((z) => z.status === 'laufend').length;
  const ohneAuftrag = zeilen.filter((z) => z.ohneAuftrag && !z.storniert).length;
  const nacherfasst = zeilen.filter((z) => z.nacherfasst).length;

  const mitFilter = (aenderung: Readonly<Record<string, string | null>>): string => {
    const p = new URLSearchParams();
    const basis: Record<string, string | null> = {
      woche: von,
      person: filter.personId,
      objekt: filter.objektId,
      merkmal: filter.merkmal,
      ...aenderung,
    };
    for (const [k, v] of Object.entries(basis)) if (v !== null) p.set(k, v);
    return `${pfad}?${p.toString()}`;
  };

  return (
    <PortalRahmen
      titel="Zeiten"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="zeiten"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Zeiten</h1>
        <p className="m-0 text-sm text-text-muted">
          {zeilen.length === 1 ? '1 Eintrag' : `${String(zeilen.length)} Einträge`}
          {' · '}
          <span className="tabular-nums">{von}</span> bis <span className="tabular-nums">{bis}</span>
        </p>
      </div>

      <nav aria-label="Woche wechseln" className="mb-s4 flex flex-wrap items-center gap-s2">
        <Sprung ziel={mitFilter({ woche: tagePlus(von, -7) })} text="← Vorige Woche" />
        <Sprung ziel={mitFilter({ woche: montag(heute) })} text="Diese Woche" />
        <Sprung ziel={mitFilter({ woche: tagePlus(von, 7) })} text="Nächste Woche →" />
        <span className="grow" />
        <Sprung ziel={`${pfad}/live`} text="Aktuell im Einsatz" icon="uhr" />
        <Sprung ziel={`${pfad}/korrekturen`} text="Korrekturen" icon="stift" />
        <Sprung ziel={`${pfad}/einwaende`} text="Einwände" icon="warnung" />
        <Sprung ziel={`${pfad}/milog`} text="MiLoG" icon="dokument" />
      </nav>

      <div className="mb-s5 grid grid-cols-1 gap-s4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiStat label="Einträge" wert={String(zeilen.length)} icon="zeit" ton="info" />
        <KpiStat
          label="Netto erfasst"
          wert={stundenAusMinuten(nettoSumme)}
          icon="uebersicht"
          ton="info"
        />
        <KpiStat
          label="Ohne Auftrag"
          wert={String(ohneAuftrag)}
          icon="auftrag"
          ton={ohneAuftrag === 0 ? 'muted' : 'warning'}
        />
        <KpiStat
          label="Nacherfasst"
          wert={String(nacherfasst)}
          icon="stift"
          ton={nacherfasst === 0 ? 'muted' : 'warning'}
        />
      </div>

      {laufend > 0 && (
        <p className="mb-s4 rounded-lg border border-line bg-surface p-s4 text-sm text-text-muted">
          <Icon name="uhr" groesse="sm" className="mr-s2 inline-block align-[-2px] text-warning" />
          {laufend === 1
            ? 'Ein Eintrag läuft noch — seine Netto-Dauer steht erst mit der Abmeldung fest.'
            : `${String(laufend)} Einträge laufen noch — ihre Netto-Dauer steht erst mit der `
              + 'Abmeldung fest.'}
          {' '}
          <Link href={`/portal/${mandant}/zeiten/live`} className="underline hover:text-text">
            Aktuell im Einsatz
          </Link>
        </p>
      )}

      {/*
        Ein gewöhnliches GET-Formular: die Auswahl steht danach in der Adresse,
        lässt sich verschicken und als Lesezeichen ablegen — und sie
        funktioniert, bevor JavaScript geladen ist. Ein Filter, der auf einem
        Baustellentelefon erst nach drei Sekunden reagiert, wird nicht benutzt.
      */}
      <form
        method="get"
        action={pfad}
        className="mb-s5 flex flex-wrap items-end gap-s3 rounded-lg border border-line bg-surface p-s4"
      >
        <input type="hidden" name="woche" value={von} />
        <Auswahl
          name="person"
          label="Person"
          wert={filter.personId}
          eintraege={auswahl.personen}
          leer="Alle Personen"
        />
        <Auswahl
          name="objekt"
          label="Objekt"
          wert={filter.objektId}
          eintraege={auswahl.objekte}
          leer="Alle Objekte"
        />
        <Auswahl
          name="merkmal"
          label="Merkmal"
          wert={filter.merkmal}
          eintraege={MERKMALE.map((m) => ({ id: m, name: MERKMAL_TEXT[m] }))}
          leer="Alle Einträge"
        />
        <Button type="submit" variante="secondary">Filtern</Button>
        {(filter.personId !== null || filter.objektId !== null || filter.merkmal !== null) && (
          <Link
            href={`/portal/${mandant}/zeiten?woche=${von}`}
            className="min-h-11 self-center text-sm text-text-muted underline hover:text-text"
          >
            Filter zurücksetzen
          </Link>
        )}
      </form>

      {zeilen.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Für diese Woche ist nichts erfasst
          {filter.personId !== null || filter.objektId !== null || filter.merkmal !== null
            ? ' — jedenfalls nichts, das dem Filter entspricht.'
            : '. Das heißt: niemand hat gestempelt — nicht, dass niemand gearbeitet hätte.'}
        </p>
      ) : (
        <DataTable
          beschriftung={`Zeiteinträge vom ${von} bis ${bis}`}
          zeilen={zeilen}
          schluessel={(z) => z.id}
          spalten={[
            {
              schluessel: 'person',
              kopf: 'Person',
              zelle: (z) => (
                <Link
                  href={`/portal/${mandant}/zeiten/${z.id}`}
                  data-cse="zeiteintrag"
                  data-zeiteintrag={z.id}
                  className={`text-text underline-offset-2 hover:underline ${
                    z.storniert ? 'line-through opacity-60' : ''
                  }`}
                >
                  {z.person}
                </Link>
              ),
            },
            {
              schluessel: 'zeit',
              kopf: 'Von – bis',
              zelle: (z) => (
                <span className="tabular-nums">
                  {z.beginnLokal}
                  {' – '}
                  {z.endeLokal ?? '…'}
                  {z.endeFolgetag && <span className="text-text-subtle"> +1</span>}
                </span>
              ),
            },
            {
              schluessel: 'pause',
              kopf: 'Pause',
              numerisch: true,
              zelle: (z) => (z.pauseMinuten === 0 ? '—' : `${String(z.pauseMinuten)} min`),
            },
            {
              schluessel: 'netto',
              kopf: 'Netto',
              numerisch: true,
              zelle: (z) => (
                z.nettoMinuten !== null
                  ? stundenAusMinuten(z.nettoMinuten)
                  : z.laufendMinuten !== null
                    ? <span className="text-warning">{stundenAusMinuten(z.laufendMinuten)} …</span>
                    : '—'
              ),
            },
            {
              schluessel: 'auftrag',
              kopf: 'Auftrag',
              zelle: (z) => (z.auftragsnummer !== null
                ? (
                  <span title={z.leistung ?? undefined}>
                    {z.auftragsnummer}
                    {z.leistung !== null && (
                      <span className="text-text-muted"> · {z.leistung}</span>
                    )}
                  </span>
                )
                : <span className="text-warning">ohne Auftrag</span>),
            },
            {
              schluessel: 'objekt',
              kopf: 'Objekt',
              zelle: (z) => z.objekt ?? '—',
            },
            {
              schluessel: 'status',
              kopf: 'Status',
              zelle: (z) => <Marken zeile={z} />,
            },
          ]}
        />
      )}

      <p className="mt-s5 max-w-prose text-sm text-text-muted">
        Angezeigt wird die jeweils aktuelle Fassung eines Eintrags. Frühere
        Fassungen sind nicht verschwunden — sie stehen in der Korrekturspur des
        Eintrags, mit dem Grund und der Person, die korrigiert hat (TIM-11).
      </p>
    </PortalRahmen>
  );
}

function Marken({ zeile }: { readonly zeile: ZeitZeile }) {
  return (
    <span className="flex flex-wrap items-center gap-s2 text-xs">
      <span className={zeile.storniert ? 'text-danger' : 'text-text-muted'}>
        {STATUS_TEXT[zeile.status] ?? zeile.status}
      </span>
      {zeile.nacherfasst && <span className="text-warning">nacherfasst</span>}
      {zeile.gesperrt && <span className="text-text-subtle">Monat gesperrt</span>}
      {zeile.abgerechnet
        ? <span className="text-text-subtle">abgerechnet</span>
        : zeile.freigegeben && <span className="text-success">freigegeben</span>}
    </span>
  );
}

function Auswahl({
  name, label, wert, eintraege, leer,
}: {
  readonly name: string;
  readonly label: string;
  readonly wert: string | null;
  readonly eintraege: readonly { readonly id: string; readonly name: string }[];
  readonly leer: string;
}) {
  return (
    <label>
      <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
        {label}
      </span>
      <select
        name={name}
        defaultValue={wert ?? ''}
        className="min-h-11 rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
      >
        <option value="">{leer}</option>
        {eintraege.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
      </select>
    </label>
  );
}

function Sprung({
  ziel, text, icon,
}: {
  readonly ziel: string; readonly text: string; readonly icon?: IconName;
}) {
  return (
    <a
      href={ziel}
      className="inline-flex min-h-11 items-center gap-s2 rounded-md border border-line px-s3 text-sm text-text-muted transition-colors duration-fast hover:border-line-strong hover:text-text"
    >
      {icon !== undefined && <Icon name={icon} groesse="sm" />}
      {text}
    </a>
  );
}
