import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { formatiereGeld } from '@/server/services/finanz/geld';
import { eingangsrechnungen } from '@/server/services/finanz/eingangsrechnung';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * `/portal/[mandant]/finanzen/eingangsrechnungen` — was hereinkommt (FIN-14,
 * ACC-05).
 *
 * **Die Statusabbildung steht hier und nicht im Datenmodell.** DESIGN §5
 * führt ein FESTES Pillenvokabular; `in_pruefung`, `freigegeben` und
 * `gebucht` stehen nicht darin. Sie hier zu erfinden hiesse, an DESIGN.md
 * vorbei eine Beschriftung einzuführen, die der Rest der Plattform nicht
 * kennt — also wird abgebildet, und der Zustand steht ausgeschrieben daneben.
 */
export const dynamic = 'force-dynamic';

const PILLE: Readonly<Record<string, PillZustand>> = {
  eingegangen: 'Entwurf',
  in_pruefung: 'In Prüfung',
  // „Bereit" und nicht „Freigegeben": das Wort fehlt DESIGN §5, und die
  // Bedeutung stimmt — freigegeben heisst hier bereit zum Buchen. Der Zustand
  // steht ausgeschrieben in der Spalte daneben.
  freigegeben: 'Bereit',
  gebucht: 'Abgeschlossen',
  abgelehnt: 'Abgelehnt',
};

const ZUSTAND: Readonly<Record<string, string>> = {
  eingegangen: 'eingegangen',
  in_pruefung: 'in Prüfung',
  freigegeben: 'freigegeben',
  gebucht: 'gebucht',
  abgelehnt: 'abgelehnt',
};

/** `DD.MM.YYYY` oder `YYYY-MM-DD` → `YYYY-MM`; die Zeile traegt das Datum in der Anzeigeform. */
function monatVon(datum: string | null): string | null {
  if (datum === null) return null;
  if (/^\d{4}-\d{2}-\d{2}/u.test(datum)) return datum.slice(0, 7);
  if (/^\d{2}\.\d{2}\.\d{4}$/u.test(datum)) return `${datum.slice(6, 10)}-${datum.slice(3, 5)}`;
  return null;
}

export default async function Eingangsrechnungen(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  /* Der Monat aus den Monatszahlen (DSH-04): `?monat=YYYY-MM` filtert nach Rechnungsdatum. */
  const suche = await searchParams;
  const monatRoh = typeof suche['monat'] === 'string' ? suche['monat'] : null;
  const monat = monatRoh !== null && /^\d{4}-\d{2}$/u.test(monatRoh) ? monatRoh : null;
  const zugang = await portalZugang(`/portal/${mandant}/finanzen/eingangsrechnungen`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const alle = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) =>
      eingangsrechnungen(kontext))) as ReturnType<typeof eingangsrechnungen>);
  const zeilen = monat === null ? alle : alle.filter((z) => monatVon(z.rechnungsdatum) === monat);

  return (
    <PortalRahmen
      titel="Eingangsrechnungen"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="eingangsrechnungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">Eingangsrechnungen</h1>
        {monat === null ? null : (
          <p data-cse="monat-filter" className="text-sm text-text-muted">
            Rechnungsdatum im Monat <strong>{monat.slice(5, 7)}/{monat.slice(0, 4)}</strong>{' '}
            <Link href={`/portal/${mandant}/finanzen/eingangsrechnungen`} className="underline underline-offset-2">alle zeigen</Link>
          </p>
        )}
        <Link
          href={`/portal/${mandant}/finanzen/eingangsrechnungen/neu`}
          className="min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-sm text-text hover:bg-surface-2"
        >
          Rechnung erfassen
        </Link>
      </div>

      {zeilen.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Noch keine Eingangsrechnung erfasst. Jede braucht ihr Dokument — ohne
          Beleg wird nichts gebucht (ACC-03).
        </p>
      ) : (
        <DataTable
          beschriftung="Eingangsrechnungen mit Belegnummer, Lieferant, Betrag und Zustand"
          zeilen={zeilen}
          schluessel={(z) => z.id}
          spalten={[
            {
              schluessel: 'beleg',
              kopf: 'Beleg',
              zelle: (z) => (
                <Link
                  href={`/portal/${mandant}/finanzen/eingangsrechnungen/${z.id}`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {z.interneBelegnummer
                    ?? <span className="text-text-subtle">ohne — noch nicht gebucht</span>}
                </Link>
              ),
            },
            { schluessel: 'lieferant', kopf: 'Lieferant', zelle: (z) => z.lieferant ?? '—' },
            {
              schluessel: 'nummer', kopf: 'Nr. des Lieferanten',
              zelle: (z) => z.rechnungsnummerLieferant ?? '—',
            },
            {
              schluessel: 'brutto', kopf: 'Brutto', numerisch: true,
              zelle: (z) => (z.bruttoCent === null ? '—' : formatiereGeld(z.bruttoCent)),
            },
            { schluessel: 'faellig', kopf: 'Fällig', zelle: (z) => z.faelligAm ?? '—' },
            {
              schluessel: 'zustand',
              kopf: 'Zustand',
              zelle: (z) => (
                <span className="inline-flex items-center gap-s2">
                  <StatusPill zustand={PILLE[z.status] ?? 'Entwurf'} />
                  <span className="text-xs text-text-muted">
                    {z.abgelehntGrund ?? ZUSTAND[z.status] ?? z.status}
                  </span>
                </span>
              ),
            },
          ]}
        />
      )}
    </PortalRahmen>
  );
}
