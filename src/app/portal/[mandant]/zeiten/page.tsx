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
import { monatVerschieben, montag, tagePlus } from '@/lib/datum/kalendertag';
import { stundenAusMinuten } from '@/lib/datum/stunden';
import { haeltRechte } from '../../rechte';
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
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;

  /* AUT-06: der MiLoG-Nachweis haengt an `zeit.exportieren`, und eine
     `leitung` haelt es nicht. Ein Knopf dorthin verriete die Seite, die
     er nicht zeigen darf. */
  /*
   * V-033, V-034, V-048: zwei gebaute Schaltstellen standen in keiner Leiste.
   *
   * `/zeiten/checkin-links` gibt die Marken aus, mit denen eine Kraft OHNE
   * Portalkonto ueberhaupt stempeln kann (TIM-07, EMP-01);
   * `/zeiten/nacherfassung` entscheidet ueber Offline-Ansprueche (TIM-09).
   * Beide waren nur ueber die getippte Adresse erreichbar — bezahlt, gebaut,
   * unbenutzt.
   *
   * Jeder Punkt haengt am Recht SEINES ZIELS und nicht an `zeit.lesen`
   * (AUT-06, D-581): ein Knopf auf eine 404 verraet, was er nicht zeigen
   * darf.
   */
  const darf = await haeltRechte(
    sitzung, 'zeit.exportieren', 'zeit.abrechnung_freigeben',
    'zeit.checkin_verwalten', 'zeit.nacherfassung_pruefen');
  if (sitzung.aktiverMandantId === null) notFound();

  const frage = await searchParams;
  const heute = await berlinHeute();
  const rohWoche = einzeln(frage['woche']);
  /**
   * **Ein MONAT statt einer Woche** (V-070).
   *
   * Der Monatsabschluss meldet „3 Zeiteinträge sind nicht freigegeben" und
   * konnte auf nichts zeigen: diese Liste kannte nur Wochen, und ein Verweis
   * auf die erste Woche des Monats zeigte einen Teil der drei und behauptete,
   * es seien alle. Mit `?monat=` spannt das Fenster über den ganzen Monat;
   * die Wochennavigation weicht dann einem Weg zurück in die Wochenansicht.
   *
   * Der Wert wird auf `JJJJ-MM` gezwungen, bevor er ein Datum wird: was aus
   * der Adresszeile kommt, ist eine Behauptung und keine Angabe.
   */
  const rohMonat = einzeln(frage['monat']);
  const monat = rohMonat !== null && /^\d{4}-\d{2}$/u.test(rohMonat) ? rohMonat : null;
  const anker = rohWoche !== null && /^\d{4}-\d{2}-\d{2}$/u.test(rohWoche) ? rohWoche : heute;
  const von = monat === null ? montag(anker) : `${monat}-01`;
  /*
   * Der letzte Tag des Monats: der Tag vor dem Ersten des Folgemonats — in
   * Kalenderarithmetik und nicht mit einer Tabelle „30 Tage hat September",
   * damit der Februar im Schaltjahr stimmt.
   */
  const bis = monat === null
    ? tagePlus(von, 6)
    : tagePlus(monatVerschieben(`${monat}-01`, 1), -1);

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
      /* Im Monatsfenster wandert `monat` mit, sonst `woche` — nie beide: zwei
         Fensterangaben in einer Adresse wären zwei Antworten auf dieselbe
         Frage, und welche gilt, entschiede die Reihenfolge im Rumpf. */
      ...(monat === null ? { woche: von } : { monat }),
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

      <nav aria-label={monat === null ? 'Woche wechseln' : 'Monat wechseln'}
           className="mb-s4 flex flex-wrap items-center gap-s2">
        {monat === null ? (
          <>
            <Sprung ziel={mitFilter({ woche: tagePlus(von, -7) })} text="← Vorige Woche" />
            <Sprung ziel={mitFilter({ woche: montag(heute) })} text="Diese Woche" />
            <Sprung ziel={mitFilter({ woche: tagePlus(von, 7) })} text="Nächste Woche →" />
          </>
        ) : (
          <>
            {/* Im Monatsfenster (V-070) blättert man Monate, nicht Wochen —
                und findet zurück in die Wochenansicht, die der Regelfall
                dieser Seite ist. */}
            <Sprung
              ziel={mitFilter({ monat: monatVerschieben(`${monat}-01`, -1).slice(0, 7) })}
              text="← Voriger Monat"
            />
            <Sprung
              ziel={mitFilter({ monat: monatVerschieben(`${monat}-01`, 1).slice(0, 7) })}
              text="Nächster Monat →"
            />
            <Sprung
              ziel={mitFilter({ monat: null, woche: montag(von) })}
              text="Zur Wochenansicht"
            />
          </>
        )}
        <span className="grow" />
        <Sprung ziel={`${pfad}/live`} text="Aktuell im Einsatz" icon="uhr" />
        <Sprung ziel={`${pfad}/korrekturen`} text="Korrekturen" icon="stift" />
        <Sprung ziel={`${pfad}/einwaende`} text="Einwände" icon="warnung" />
        {darf['zeit.checkin_verwalten'] === true && (
          <Sprung ziel={`${pfad}/checkin-links`} text="Check-in-Links" icon="schloss" />
        )}
        {darf['zeit.nacherfassung_pruefen'] === true && (
          <Sprung ziel={`${pfad}/nacherfassung`} text="Nacherfassung" icon="stift" />
        )}
        {darf['zeit.exportieren'] === true && (
          <Sprung ziel={`${pfad}/milog`} text="MiLoG" icon="dokument" />
        )}
        {/* Die Freigabe zur Abrechnung haengt an `zeit.abrechnung_freigeben` —
            seit D-611/0371 an `super_admin` und `admin` gebunden, fuer
            `leitung` je Gesellschaft anlegbar (D-612, 03-AUTH §12.4). Die
            Bedingung bleibt trotzdem stehen und wird es: ein Knopf auf eine
            404 verraet, was er nicht zeigen darf (AUT-06, D-581) — und fuer
            eine `leitung` ohne die Bindung ist genau das der Fall. */}
        {darf['zeit.abrechnung_freigeben'] === true && (
          <Sprung ziel={`${pfad}/freigabe`} text="Freigabe" icon="freigabe" />
        )}
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

      {/*
        * **Ein Merkmal, das heute keine Zeile trifft — und warum das so
        * bleibt** (V-083).
        *
        * `zeiteintrag_status` führt `offen_nacherfassung` seit `0034`, und
        * NICHTS im Baum schreibt den Wert. Das ist kein Versehen: er wäre der
        * ehrliche Zustand für „von der Planung gesetzt, aber noch nicht
        * bestätigt" — nur beschreibt kein Dokument, wer ihn wieder wegnimmt
        * und was bis dahin gilt (zählt die Stunde ins Stundenkonto? steht sie
        * im Monatsnachweis? darf sie abgerechnet werden?). Ein Eintrag in
        * einem Zustand, aus dem kein Weg herausführt, ist schlimmer als
        * keiner, und die Frage steht als O-890 beim Auftraggeber.
        *
        * Das Merkmal BLEIBT in der Liste: der Satz der Merkmale ist der Satz
        * der Zustände, und eines herauszunehmen hiesse, die Auswahl bei der
        * Antwort wieder zu ändern und bis dahin zu verschweigen, dass es den
        * Zustand gibt. Was fehlte, war der Satz daneben — eine leere Liste
        * sagt nicht, ob niemand gearbeitet hat oder ob dieser Zustand gar
        * nicht entstehen kann.
        */}
      {filter.merkmal === 'offen_nacherfassung' ? (
        <p data-cse="merkmal-ohne-erzeuger"
           className="mb-s4 max-w-prose rounded-lg border border-line bg-surface-2 p-s4 text-sm text-text">
          <strong>Diesen Zustand erzeugt heute nichts.</strong> Ob eine von der
          Verwaltung gesetzte Zeit gegengezeichnet werden muss, bevor sie abrechenbar
          ist, ist offen (O-890) — bis zur Antwort schliesst die Verwaltung nach
          „Abgeschlossen", und die gesetzte Zeit bleibt als solche erkennbar. Wer
          nachgetragene Einträge sucht, filtert nach{' '}
          <strong>{MERKMAL_TEXT['nacherfasst']}</strong>.
        </p>
      ) : null}

      {zeilen.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Für diese Woche ist nichts erfasst
          {filter.merkmal === 'offen_nacherfassung'
            ? ' — und nach diesem Merkmal wird auch in keiner anderen Woche etwas stehen,'
              + ' solange O-890 offen ist.'
            : filter.personId !== null || filter.objektId !== null || filter.merkmal !== null
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
