import Link from 'next/link';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import {
  auftragsGesellschaften, listeKundenauftraege, type Kundenauftrag,
} from '@/server/services/kundenportal/auftrag';
import { AnmeldungNoetig } from '../../Anmeldung';
import { kundePortal, KundenRahmen } from '../rahmen';
import {
  Gesellschaft, GesellschaftsFilter, KeinZugang, Kopfzeile, Leer, slugAus,
} from '../bausteine';

/**
 * `/portal/kunde/auftraege` — die eigenen Auftraege (OPS-05, OPS-11, CRM-06,
 * 04-SEITENKARTE §8).
 *
 * **Diese Route stand in der Tab-Leiste, bevor die Seite existierte** — sie
 * endete in der Auffangroute `[...rest]` und zeigte „dieses Modul wird noch
 * gebaut". Ein sichtbarer Menuepunkt, hinter dem nichts steht, ist die
 * teuerste Art, eine Luecke zu zeigen; sie ist damit geschlossen.
 *
 * **Anders als beim Angebot gibt es hier keinen Entwurfszustand, den der
 * Kunde nicht sehen duerfte** — das sagt 0025 woertlich, und deshalb traegt
 * `t_kunde` auf `auftrag` auch keine Zusatzbedingung. Ein Auftrag entsteht,
 * weil er vereinbart wurde; `angelegt` heisst „noch nicht gestartet", nicht
 * „noch nicht beschlossen".
 *
 * **Keine Auftragssumme, keine Besetzung, kein Verantwortlicher.** Die
 * Spalten stehen in keiner Abfrage (`services/kundenportal/auftrag.ts`); die
 * Begruendung je Spalte steht dort, und O-840 haelt die Frage nach der
 * Auftragssumme offen.
 *
 * **Der Zustand wird auf DESIGN §5 abgebildet, nicht erfunden.** Das feste
 * Pillenvokabular kennt kein „Pausiert" und kein „Storniert"; beide werden
 * auf den naechstliegenden Zustand abgebildet UND im Klartext daneben
 * genannt, damit die Farbe nicht das einzige Signal ist (§9).
 */
export const dynamic = 'force-dynamic';

/** `auftrag_art` (0025, Platzhalter O-73). */
const ART: Readonly<Record<string, string>> = {
  einzelauftrag: 'Einzelauftrag',
  rahmenvertrag: 'Rahmenvertrag',
  dauerauftrag: 'Dauerauftrag',
  projekt: 'Projekt',
};

/** `auftrag_status` (0025, Platzhalter O-73) auf das feste Vokabular. */
const PILLE: Readonly<Record<string, PillZustand>> = {
  angelegt: 'Geplant',
  aktiv: 'Aktiv',
  pausiert: 'Wartet',
  abgeschlossen: 'Abgeschlossen',
  storniert: 'Abgelehnt',
};

/**
 * Der Klartext neben der Pille, wo das Vokabular von DESIGN den Zustand nicht
 * woertlich kennt. „Wartet" allein sagt nicht, dass der Vertrag ruht.
 */
const ZUSATZ: Readonly<Record<string, string>> = {
  pausiert: 'pausiert',
  storniert: 'storniert',
};

export default async function Kundenauftraege(
  { searchParams }: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const slug = slugAus(await searchParams);

  const ergebnis = await kundePortal('/portal/kunde/auftraege', async (kontext) => ({
    auftraege: await listeKundenauftraege(kontext, { mandantSlug: slug }),
    gesellschaften: await auftragsGesellschaften(kontext),
  }));

  if (ergebnis.art === 'anmeldung') return <AnmeldungNoetig />;
  if (ergebnis.art === 'kein_zugang') {
    return (
      <KundenRahmen basis={ergebnis.basis} titel="Aufträge" aktiverTab="auftraege">
        <Kopfzeile titel="Aufträge" />
        <KeinZugang />
      </KundenRahmen>
    );
  }

  const { basis, daten } = ergebnis;

  return (
    <KundenRahmen basis={basis} titel="Aufträge" aktiverTab="auftraege">
      <Kopfzeile titel="Aufträge" />

      <GesellschaftsFilter
        wurzel="/portal/kunde/auftraege"
        gesellschaften={daten.gesellschaften}
        aktiv={slug}
      />

      {daten.auftraege.length === 0 ? (
        <Leer text={slug === null
          ? 'Für diesen Zugang ist kein Auftrag hinterlegt. Ein abgeschlossener Auftrag bleibt hier stehen; erst das Archivieren nimmt ihn aus der Liste.'
          : 'Von dieser Gesellschaft liegt kein Auftrag vor. Über „Alle" sehen Sie die übrigen.'} />
      ) : (
        <DataTable
          beschriftung="Aufträge mit Nummer, Bezeichnung, Art, Laufzeit, Objekt und Gesellschaft"
          zeilen={daten.auftraege}
          schluessel={(a: Kundenauftrag) => a.id}
          spalten={[
            {
              schluessel: 'nummer',
              kopf: 'Nummer',
              zelle: (a) => (
                <Link
                  href={`/portal/kunde/auftraege/${a.id}`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {a.auftragsnummer}
                </Link>
              ),
            },
            { schluessel: 'bezeichnung', kopf: 'Bezeichnung', zelle: (a) => a.bezeichnung },
            { schluessel: 'art', kopf: 'Art', zelle: (a) => ART[a.art] ?? a.art },
            {
              schluessel: 'objekt',
              kopf: 'Objekt',
              /*
               * „—" heisst hier NICHT „kein Standort": ein Rahmenvertrag
               * fuehrt seine Liegenschaften an den Leistungszeilen (0050) und
               * traegt im Kopf keine. Der Satz dazu steht auf dem Blatt; in
               * einer Spalte waere er zu lang.
               */
              zelle: (a) => a.objektBezeichnung ?? <span className="text-text-subtle">—</span>,
            },
            {
              schluessel: 'start',
              kopf: 'Beginn',
              zelle: (a) => <span className="cse-zahl">{a.startDatumLokal}</span>,
            },
            {
              schluessel: 'laufzeit',
              kopf: 'Laufzeit bis',
              zelle: (a) => a.laufzeitBisLokal === null
                ? <span className="text-text-subtle">unbefristet</span>
                : <span className="cse-zahl">{a.laufzeitBisLokal}</span>,
            },
            {
              schluessel: 'leistungen',
              kopf: 'Leistungen',
              numerisch: true,
              zelle: (a) => a.leistungenAktiv === 0
                ? <span className="text-text-subtle">—</span>
                : String(a.leistungenAktiv),
            },
            {
              schluessel: 'gesellschaft',
              kopf: 'Gesellschaft',
              zelle: (a) => <Gesellschaft slug={a.mandantSlug} name={a.mandantName} />,
            },
            {
              schluessel: 'status',
              kopf: 'Zustand',
              zelle: (a) => (
                <span className="inline-flex flex-wrap items-center gap-s2">
                  <StatusPill zustand={PILLE[a.status] ?? 'Geplant'} />
                  {ZUSATZ[a.status] === undefined ? null : (
                    <span data-cse="zustand-zusatz" className="text-xs text-text-muted">
                      {ZUSATZ[a.status]}
                    </span>
                  )}
                </span>
              ),
            },
          ]}
        />
      )}
    </KundenRahmen>
  );
}
