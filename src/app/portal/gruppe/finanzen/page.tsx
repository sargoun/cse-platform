import { DataTable } from '@/components/ui/DataTable';
import { KpiStat } from '@/components/ui/KpiStat';
import { formatiereGeld, type Cent } from '@/server/services/finanz/geld';
import { gruppenFinanzen, type MonatsZeile } from '@/server/services/gruppe/finanzen';
import {
  BereichMarke, GruppenAntwort, GruppenHinweis, GruppenRahmen, gruppenLesen, gruppenTor, KeinRecht,
  type Suchparameter,
} from '../tor';

/**
 * `/portal/gruppe/finanzen` — Umsatz, Aufwand und Saldo je Gesellschaft und
 * fuer die Gruppe (FIN-17, REP-01, ACC-08), lesend.
 *
 * Alle Betraege sind Summen aus der Datenbank, netto, in Cent. Der Saldo ist
 * die Differenz aus fakturierten Ausgangs- und freigegebenen bzw. gebuchten
 * Eingangsrechnungen — keine Gewinn-und-Verlust-Rechnung, und die Seite sagt
 * das (`gruppenFinanzen`).
 */
export const dynamic = 'force-dynamic';

function Betrag({ wert }: { readonly wert: Cent | null }) {
  if (wert === null) return <KeinRecht />;
  return <span className={wert < 0n ? 'text-danger' : ''}>{formatiereGeld(wert)}</span>;
}

async function jahrAus(suchparameter: Suchparameter, vorgabe: number): Promise<number> {
  const roh = (await suchparameter)['jahr'];
  const jahr = typeof roh === 'string' && /^\d{4}$/u.test(roh) ? Number(roh) : vorgabe;
  return jahr >= 2000 && jahr <= 2100 ? jahr : vorgabe;
}

export default async function GruppenFinanzen({ searchParams }: { searchParams: Suchparameter }) {
  const tor = await gruppenTor('/portal/gruppe/finanzen');
  if (tor.art !== 'ok') return <GruppenAntwort tor={tor} />;

  const daten = await gruppenLesen(tor.zugang, async (kontext) => {
    const [h] = await kontext.abfrage<{ jahr: number }>(
      `select extract(year from (now() at time zone 'Europe/Berlin'))::int as jahr`);
    const laufend = h?.jahr ?? new Date().getUTCFullYear();
    const jahr = await jahrAus(searchParams, laufend);
    return { laufend, ...(await gruppenFinanzen(kontext, jahr)) };
  });
  const { jahr, laufend, bereiche, summe } = daten;

  const monatsSpalten = [
    { schluessel: 'monat', kopf: 'Monat', zelle: (z: MonatsZeile) => z.label },
    ...bereiche.map((b, i) => ({
      schluessel: b.slug, kopf: b.name, numerisch: true,
      zelle: (z: MonatsZeile) => <Betrag wert={z.werte[i] ?? null} />,
    })),
    { schluessel: 'summe', kopf: 'Gruppe', numerisch: true,
      zelle: (z: MonatsZeile) => <strong>{formatiereGeld(z.summe)}</strong> },
  ];

  return (
    <GruppenRahmen zugang={tor.zugang} titel="Finanzen" aktiverTab="finanzen">
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Finanzen {String(jahr)}</h1>
        <nav aria-label="Geschäftsjahr" className="flex gap-s2 text-sm">
          <a href={`/portal/gruppe/finanzen?jahr=${String(jahr - 1)}`}
             className="min-h-11 rounded-md border border-line px-s4 py-s3 text-text hover:bg-surface-2">
            ‹ {String(jahr - 1)}
          </a>
          {jahr < laufend ? (
            <a href={`/portal/gruppe/finanzen?jahr=${String(jahr + 1)}`}
               className="min-h-11 rounded-md border border-line px-s4 py-s3 text-text hover:bg-surface-2">
              {String(jahr + 1)} ›
            </a>
          ) : null}
        </nav>
      </div>

      <div data-cse="finanzen-summen"
           className="mb-s6 grid grid-cols-1 gap-s4 sm:grid-cols-2 xl:grid-cols-5">
        <KpiStat label="Fakturiert netto" wert={formatiereGeld(summe.fakturiertCent)} ton="success" icon="rechnung" />
        <KpiStat label="Eingangsrechnungen netto" wert={formatiereGeld(summe.eingangCent)} ton="info" icon="euro" />
        <KpiStat label="Saldo aus Rechnungen"
                 wert={summe.saldoCent === null ? '—' : formatiereGeld(summe.saldoCent)}
                 ton={summe.saldoCent !== null && summe.saldoCent < 0n ? 'danger' : 'muted'} icon="uebersicht" />
        <KpiStat label="Forderungen offen" wert={formatiereGeld(summe.forderungenOffenCent)}
                 ton={summe.forderungenOffenCent > 0n ? 'warning' : 'muted'} icon="warnung" />
        <KpiStat label="Verbindlichkeiten offen" wert={formatiereGeld(summe.verbindlichkeitenOffenCent)}
                 ton="muted" icon="dokument" />
      </div>

      <h2 className="mb-s3 text-h2 text-text">Je Gesellschaft</h2>
      <div data-cse="finanzen-bereiche">
        <DataTable
          beschriftung={`Finanzen ${String(jahr)} je Gesellschaft`}
          zeilen={bereiche}
          schluessel={(b) => b.slug}
          spalten={[
            { schluessel: 'bereich', kopf: 'Gesellschaft',
              zelle: (b) => <BereichMarke slug={b.slug} name={b.name} /> },
            { schluessel: 'fakturiert', kopf: 'Fakturiert netto', numerisch: true,
              zelle: (b) => <Betrag wert={b.fakturiertCent} /> },
            { schluessel: 'rechnungen', kopf: 'Rechnungen', numerisch: true,
              zelle: (b) => (b.rechnungen === null ? <KeinRecht /> : b.rechnungen) },
            { schluessel: 'eingang', kopf: 'Eingang netto', numerisch: true,
              zelle: (b) => <Betrag wert={b.eingangCent} /> },
            { schluessel: 'eingangsrechnungen', kopf: 'Belege', numerisch: true,
              zelle: (b) => (b.eingangsrechnungen === null ? <KeinRecht /> : b.eingangsrechnungen) },
            { schluessel: 'saldo', kopf: 'Saldo', numerisch: true,
              zelle: (b) => <Betrag wert={b.saldoCent} /> },
            { schluessel: 'forderungen', kopf: 'Forderungen offen', numerisch: true,
              zelle: (b) => <Betrag wert={b.forderungenOffenCent} /> },
            { schluessel: 'verbindlichkeiten', kopf: 'Verbindlichkeiten offen', numerisch: true,
              zelle: (b) => <Betrag wert={b.verbindlichkeitenOffenCent} /> },
          ]}
        />
      </div>
      <GruppenHinweis text="Saldo = fakturierte Ausgangsrechnungen − freigegebene und gebuchte Eingangsrechnungen, jeweils netto nach Rechnungsdatum. Das ist keine Gewinn-und-Verlust-Rechnung: Personal, Abschreibungen, Abgrenzungen und Steuern fehlen; den Jahresabschluss erstellt der Steuerberater aus dem DATEV-Export." />

      <h2 className="mb-s3 mt-s6 text-h2 text-text">Fakturiert je Monat</h2>
      <div data-cse="finanzen-monate-fakturiert">
        <DataTable beschriftung={`Fakturiert ${String(jahr)} je Monat und Gesellschaft`}
                   zeilen={daten.fakturiertJeMonat} schluessel={(z) => String(z.monat)}
                   spalten={monatsSpalten} />
      </div>

      <h2 className="mb-s3 mt-s6 text-h2 text-text">Eingangsrechnungen je Monat</h2>
      <div data-cse="finanzen-monate-eingang">
        <DataTable beschriftung={`Eingangsrechnungen ${String(jahr)} je Monat und Gesellschaft`}
                   zeilen={daten.eingangJeMonat} schluessel={(z) => String(z.monat)}
                   spalten={monatsSpalten} />
      </div>
    </GruppenRahmen>
  );
}
