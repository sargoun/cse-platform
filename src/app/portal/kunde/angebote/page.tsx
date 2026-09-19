import Link from 'next/link';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { formatiereGeld, cent } from '@/server/services/finanz/geld';
import {
  angebotsGesellschaften, bindefristText, bindefristVorbei,
  listeKundenangebote, type Kundenangebot,
} from '@/server/services/kundenportal/angebot';
import { AnmeldungNoetig } from '../../Anmeldung';
import { kundePortal, KundenRahmen } from '../rahmen';
import {
  Gesellschaft, GesellschaftsFilter, KeinZugang, Kopfzeile, Leer, Offen, slugAus,
} from '../bausteine';

/**
 * `/portal/kunde/angebote` — die versendeten Angebote (OPS-08, OPS-09,
 * 04-SEITENKARTE §8).
 *
 * **Ein Entwurf ist hier strukturell unerreichbar.** `t_kunde` UND
 * `p_kunde_decke` auf `angebot` verlangen beide `versendet_am is not null`
 * (0024) — dieselbe Bauart, mit der `rechnung` den Entwurf fernhaelt. Und ein
 * Entwurf traegt keine Nummer (`angebot_nummer_bei_versand`): eine Liste mit
 * „ohne Nummer" waere im Kundenportal nicht nur falsch, sondern
 * unverstaendlich.
 *
 * **Die NETTOSUMME steht in der Liste, die Bruttosumme auf dem Blatt.** Der
 * Grund ist nicht Platz: das Angebot fuehrt `netto_cent` als gepflegte Spalte
 * und die Umsatzsteuer je Steuersatzgruppe in `angebot_steuer` (0024, und
 * ausdruecklich KEIN `brutto_cent` — §0.6 verbietet, die Steuer aus einer
 * Bruttosumme abzuleiten). Eine Bruttospalte in der Liste hiesse, je Zeile
 * eine zweite Abfrage zu stellen oder eine Summe zu bilden, die die Datenbank
 * nicht kennt.
 *
 * **Die Bindefrist ist ein SATZ, kein Zustand.** `bindefristText` formt die
 * Tage, die die Datenbank gegen `app.berlin_heute()` gerechnet hat (K-11), in
 * Worte. Der gespeicherte `status` bleibt daneben unveraendert stehen — ob
 * ein versendetes Angebot nach Fristende von selbst `abgelaufen` wird, ist
 * offen (O-842) und wird hier nicht entschieden.
 */
export const dynamic = 'force-dynamic';

/** `angebot_status` (0024, Platzhalter O-73) auf das feste Vokabular (DESIGN §5). */
const PILLE: Readonly<Record<string, PillZustand>> = {
  versendet: 'Angebot',
  angenommen: 'Abgeschlossen',
  abgelehnt: 'Abgelehnt',
  zurueckgezogen: 'Archiviert',
  abgelaufen: 'Archiviert',
  /*
   * `entwurf` und `in_pruefung` erscheinen im Kundenportal nie — die Policy
   * laesst sie nicht durch. Sie stehen trotzdem in der Karte: faellt die
   * Bedingung eines Tages weg, zeigt die Seite einen richtigen Zustand statt
   * eines stillen Rueckfalls auf „Angebot".
   */
  entwurf: 'Entwurf',
  in_pruefung: 'In Prüfung',
};

const ZUSATZ: Readonly<Record<string, string>> = {
  zurueckgezogen: 'zurückgezogen',
  abgelaufen: 'abgelaufen',
  angenommen: 'angenommen',
};

export default async function Kundenangebote(
  { searchParams }: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const slug = slugAus(await searchParams);

  const ergebnis = await kundePortal('/portal/kunde/angebote', async (kontext) => ({
    angebote: await listeKundenangebote(kontext, { mandantSlug: slug }),
    gesellschaften: await angebotsGesellschaften(kontext),
  }));

  if (ergebnis.art === 'anmeldung') return <AnmeldungNoetig />;
  if (ergebnis.art === 'kein_zugang') {
    return (
      <KundenRahmen basis={ergebnis.basis} titel="Angebote" aktiverTab="angebote">
        <Kopfzeile titel="Angebote" />
        <KeinZugang />
      </KundenRahmen>
    );
  }

  const { basis, daten } = ergebnis;

  return (
    <KundenRahmen basis={basis} titel="Angebote" aktiverTab="angebote">
      <Kopfzeile titel="Angebote" />

      <GesellschaftsFilter
        wurzel="/portal/kunde/angebote"
        gesellschaften={daten.gesellschaften}
        aktiv={slug}
      />

      {daten.angebote.length === 0 ? (
        <Leer text={slug === null
          ? 'Es liegt kein Angebot vor. Ein Angebot erscheint hier, sobald es versendet ist — ein Entwurf, an dem noch gerechnet wird, erscheint nie.'
          : 'Von dieser Gesellschaft liegt kein Angebot vor. Über „Alle" sehen Sie die übrigen.'} />
      ) : (
        <DataTable
          beschriftung="Angebote mit Nummer, Titel, Versanddatum, Bindefrist, Nettobetrag und Gesellschaft"
          zeilen={daten.angebote}
          schluessel={(a: Kundenangebot) => a.id}
          spalten={[
            {
              schluessel: 'nummer',
              kopf: 'Nummer',
              zelle: (a) => (
                <span>
                  <Link
                    href={`/portal/kunde/angebote/${a.id}`}
                    className="text-text underline-offset-2 hover:text-brand hover:underline"
                  >
                    {a.angebotsnummer}
                  </Link>
                  {a.version > 1 && (
                    <span className="block text-xs text-text-subtle">
                      Fassung {a.version}
                      {a.ersetztNummer === null ? '' : ` von ${a.ersetztNummer}`}
                    </span>
                  )}
                </span>
              ),
            },
            { schluessel: 'titel', kopf: 'Titel', zelle: (a) => a.titel },
            {
              schluessel: 'objekt',
              kopf: 'Objekt',
              zelle: (a) => a.objektBezeichnung ?? <span className="text-text-subtle">—</span>,
            },
            {
              schluessel: 'versendet',
              kopf: 'Versendet',
              zelle: (a) => <span className="cse-zahl">{a.versendetAmLokal}</span>,
            },
            {
              schluessel: 'bindefrist',
              kopf: 'Bindefrist',
              zelle: (a) => a.gueltigBisLokal === null
                ? <span className="text-text-subtle">ohne Frist</span>
                : (
                  <span>
                    <span className="cse-zahl">{a.gueltigBisLokal}</span>
                    <span
                      className={`block text-xs ${
                        bindefristVorbei(a.tageBisAblauf) ? 'text-warning' : 'text-text-subtle'}`}
                    >
                      {bindefristText(a.tageBisAblauf)}
                    </span>
                  </span>
                ),
            },
            {
              schluessel: 'positionen',
              kopf: 'Positionen',
              numerisch: true,
              zelle: (a) => a.positionen === 0
                ? <span className="text-text-subtle">—</span>
                : String(a.positionen),
            },
            {
              schluessel: 'netto',
              kopf: 'Netto',
              numerisch: true,
              zelle: (a) => formatiereGeld(cent(BigInt(a.nettoCent))),
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
                  <StatusPill zustand={PILLE[a.status] ?? 'Angebot'} />
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

      <div className="mt-s5 flex flex-col gap-s4">
        <Offen
          nummer="O-74"
          was="Annehmen und ablehnen läuft über Ihre Ansprechpartnerin"
          weg="Die Annahme eines Angebots ist eine Willenserklärung mit
            Rechtsfolge; ob sie ein Kundenzugang im Portal abgeben kann, ist
            noch nicht entschieden."
        />
      </div>
    </KundenRahmen>
  );
}
