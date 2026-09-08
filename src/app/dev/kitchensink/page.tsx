import { AreaBadge, HueBar } from '@/components/ui/AreaBadge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DataTable, type Spalte } from '@/components/ui/DataTable';
import { FilterPill } from '@/components/ui/FilterPill';
import { FormField } from '@/components/ui/FormField';
import { KpiStat } from '@/components/ui/KpiStat';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { geld } from '@/lib/design/format';
import { cent } from '@/server/services/finanz/geld';
import { PLATZHALTER } from '@/lib/placeholder-assets';
import { devFlaechenAn } from '@/lib/dev-flaechen';
import { notFound } from 'next/navigation';

/**
 * Every component of DESIGN §5 on one page, so the design system can be
 * reviewed, contrast-checked and axe-tested as a whole rather than component
 * by component in a story runner.
 *
 * Excluded from production and from the sitemap: this is a development
 * surface, and shipping it would publish an unauthenticated page enumerating
 * the platform's building blocks. The exclusion is a 404, not only a
 * `robots.txt` line — see `lib/dev-flaechen.ts`.
 */
export const dynamic = 'force-static';

interface Zeile {
  readonly id: string;
  readonly objekt: string;
  readonly status: PillZustand;
  readonly betrag: bigint;
}

const ZEILEN: readonly Zeile[] = [
  { id: '1', objekt: 'Kurfürstendamm 21', status: 'In Arbeit', betrag: 123_456n },
  { id: '2', objekt: 'Alexanderplatz 3', status: 'Überfällig', betrag: 8_990n },
  { id: '3', objekt: 'Potsdamer Platz 11', status: 'Abgeschlossen', betrag: 1_234_567n },
];

const SPALTEN: readonly Spalte<Zeile>[] = [
  { schluessel: 'objekt', kopf: 'Objekt', zelle: (z) => z.objekt },
  { schluessel: 'status', kopf: 'Status', zelle: (z) => <StatusPill zustand={z.status} /> },
  {
    schluessel: 'betrag',
    kopf: 'Betrag',
    numerisch: true,
    zelle: (z) => geld(cent(z.betrag)),
  },
];

const ZUSTAENDE: readonly PillZustand[] = [
  'In Arbeit', 'Aktiv', 'Bereit', 'Geplant', 'In Prüfung', 'Entwurf',
  'Angebot', 'Offen', 'Wartet', 'Überfällig', 'Abgelehnt', 'Fehler',
  'Abgeschlossen', 'Archiviert',
];

function Abschnitt({ titel, children }: { titel: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-s4">
      <h2 className="text-h3 text-text">{titel}</h2>
      {children}
    </section>
  );
}

export default function Kitchensink() {
  if (!devFlaechenAn()) notFound();

  return (
    <>
      <HueBar bereich="security" />
      <main className="mx-auto flex max-w-content flex-col gap-s8 p-s7">
        <header className="flex flex-col gap-s2">
          <p className="text-micro uppercase tracking-[0.08em] text-text-muted">
            Entwicklungsansicht
          </p>
          <h1 className="text-h1 text-text">Design-System</h1>
          <p className="max-w-prose text-base text-text-muted">
            Jede Komponente aus DESIGN §5. Diese Seite wird nicht ausgeliefert.
          </p>
        </header>

        <Abschnitt titel="Buttons">
          <div className="flex flex-wrap gap-s3">
            <Button variante="primary">Angebot anfragen</Button>
            <Button variante="secondary">Abbrechen</Button>
            <Button variante="ghost">Mehr anzeigen</Button>
            <Button variante="danger">Stornieren</Button>
            <Button variante="secondary" disabled>
              Nicht verfügbar
            </Button>
          </div>
        </Abschnitt>

        <Abschnitt titel="Bereichsidentität">
          <div className="flex flex-wrap gap-s5">
            <AreaBadge bereich="reinigung" />
            <AreaBadge bereich="security" />
            <AreaBadge bereich="bau" />
            <AreaBadge bereich="operations" />
          </div>
        </Abschnitt>

        <Abschnitt titel="Kennzahlen">
          <div className="grid grid-cols-1 gap-s4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiStat label="Offene Angebote" wert="12" ton="info" />
            <KpiStat
              label="Umsatz Monat"
              wert={geld(cent(4_512_300n))}
              ton="success"
              delta={{ richtung: 'auf', text: '8,2 % ggü. Vormonat' }}
            />
            <KpiStat
              label="Überfällig"
              wert="3"
              ton="danger"
              delta={{ richtung: 'ab', text: '2 weniger als letzte Woche' }}
            />
            <KpiStat label="Einsätze heute" wert="47" ton="warning" />
          </div>
        </Abschnitt>

        <Abschnitt titel="Status-Vokabular">
          <div className="flex flex-wrap gap-s2">
            {ZUSTAENDE.map((z) => (
              <StatusPill key={z} zustand={z} />
            ))}
          </div>
        </Abschnitt>

        <Abschnitt titel="Filter">
          <div className="flex gap-s2 overflow-x-auto">
            <FilterPill label="Alle" aktiv />
            <FilterPill label="Reinigung" />
            <FilterPill label="Sicherheit" />
            <FilterPill label="Bau" />
          </div>
        </Abschnitt>

        <Abschnitt titel="Tabelle">
          <Card>
            <DataTable
              spalten={SPALTEN}
              zeilen={ZEILEN}
              schluessel={(z) => z.id}
              beschriftung="Beispielhafte Objektliste mit Beträgen"
            />
          </Card>
        </Abschnitt>

        <Abschnitt titel="Formular">
          <Card className="max-w-md">
            <div className="flex flex-col gap-s4">
              <FormField label="Objektbezeichnung" placeholder="Kurfürstendamm 21" />
              <FormField
                label="Stundensatz"
                defaultValue="19,90"
                hinweis="Beträge im deutschen Format, mit Komma."
              />
              <FormField label="Kundennummer" fehler="Diese Kundennummer existiert nicht." />
            </div>
          </Card>
        </Abschnitt>

        <Abschnitt titel="Platzhalter">
          <Card>
            <ul className="m-0 flex list-none flex-col gap-s2 p-0" data-cse="platzhalter">
              {PLATZHALTER.map((p) => (
                <li key={p.pfad} className="text-sm text-text-muted">
                  <span className="text-warning">Platzhalter</span> · {p.pfad} — {p.grund}
                  {p.frage !== null && <> ({p.frage})</>}
                </li>
              ))}
            </ul>
          </Card>
        </Abschnitt>
      </main>
    </>
  );
}
