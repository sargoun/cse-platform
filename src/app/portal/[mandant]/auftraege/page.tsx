import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { cent, formatiereGeld } from '@/server/services/finanz/geld';
import { AnmeldungNoetig } from '../../Anmeldung';
import { portalZugang } from '../../zugang';
import { slugTor } from '../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { haeltRechte } from '../../rechte';
import { Listenfilter } from '@/components/portal/Listenfilter';
import { auftragStatusAus } from '@/server/services/bericht/mengen';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { KENNZAHL_TEXTE } from '@/lib/i18n/verwaltung/kennzahlen';

/** `/portal/[mandant]/auftraege` — was diese Gesellschaft ausfuehrt (OPS-05). */
export const dynamic = 'force-dynamic';

const PILLE: Readonly<Record<string, PillZustand>> = {
  angelegt: 'Geplant', aktiv: 'In Arbeit', pausiert: 'Wartet',
  abgeschlossen: 'Abgeschlossen', storniert: 'Abgelehnt',
};

interface Zeile {
  readonly id: string;
  readonly auftragsnummer: string;
  readonly bezeichnung: string;
  readonly kunde: string | null;
  readonly objekt: string | null;
  readonly art: string;
  readonly status: string;
  readonly wert: string | null;
  readonly start: string;
  readonly laufzeit_bis: string | null;
}

export default async function Auftragsliste(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  /*
   * **Der Stand aus der Kachel** (V-150, DSH-04). „Aktive Aufträge" führt
   * mit `?status=aktiv` hierher; ohne den Filter zeigte die Liste alle
   * Stände, und die Zahl auf der Kachel stand hier nirgends. Geprüft gegen
   * die Werteliste — ein fremdes Wort ist keine Störung, sondern kein Filter.
   */
  const status = auftragStatusAus((await searchParams)['status']);
  const zugang = await portalZugang(`/portal/${mandant}/auftraege`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  /*
   * `/auftraege/neu` verlangt laut Manifest `auftrag.schreiben`; diese
   * Liste oeffnet mit `auftrag.lesen`. Wer lesen darf, darf nicht
   * zwangslaeufig anlegen — der Knopf fuehrte dann auf 404 und verriet,
   * was er nicht zeigen darf (AUT-06, Copilot-Runde auf PR 16 / D-581).
   */
  const darf = await haeltRechte(sitzung, 'auftrag.schreiben');

  const zeilen = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => kontext.abfrage<Zeile>(
      `select a.id, a.auftragsnummer, a.bezeichnung, k.name as kunde,
              o.bezeichnung as objekt, a.art::text as art, a.status::text as status,
              a.auftragswert_netto_cent::text as wert,
              to_char(a.start_datum, 'DD.MM.YYYY') as start,
              to_char(a.laufzeit_bis, 'DD.MM.YYYY') as laufzeit_bis
         from auftrag a
         left join kunde k on k.id = a.kunde_id
         left join objekt o on o.id = a.objekt_id
        where a.archiviert_am is null
          and ($1::text is null or a.status::text = $1)
        order by a.start_datum desc`,
      [status],
    ))) as Promise<readonly Zeile[]>);
  const tk = nachSprache(KENNZAHL_TEXTE, zugang.sprache);

  return (
    <PortalRahmen
      titel="Aufträge"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="auftraege"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Aufträge</h1>
        {darf['auftrag.schreiben'] === true && (
          <Link
            href={`/portal/${mandant}/auftraege/neu`}
            data-cse="auftrag-neu"
            className="inline-flex min-h-11 items-center rounded-md bg-brand px-s5 text-sm text-white hover:bg-brand-hover"
          >
            Neuer Auftrag
          </Link>
        )}
      </div>

      {status === null ? null : (
        <Listenfilter sprache={zugang.sprache}
                      beschreibung={tk.auftragStatus[status] ?? tk.keinTreffer}
                      alleZiel={`/portal/${mandant}/auftraege`} />
      )}

      {zeilen.length === 0 && status !== null ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          {tk.keinTreffer}
        </p>
      ) : zeilen.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Noch kein Auftrag. Ein angenommenes Angebot wird mit einem Klick zu
          einem — oder Sie legen hier einen an.
        </p>
      ) : (
        <DataTable
          beschriftung="Aufträge dieser Gesellschaft"
          zeilen={zeilen}
          schluessel={(z) => z.id}
          spalten={[
            {
              schluessel: 'bezeichnung',
              kopf: 'Auftrag',
              zelle: (z) => (
                <Link
                  href={`/portal/${mandant}/auftraege/${z.id}`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {z.bezeichnung}
                </Link>
              ),
            },
            { schluessel: 'nummer', kopf: 'Nummer', zelle: (z) => z.auftragsnummer },
            { schluessel: 'kunde', kopf: 'Kunde', zelle: (z) => z.kunde ?? '—' },
            { schluessel: 'objekt', kopf: 'Objekt', zelle: (z) => z.objekt ?? '—' },
            {
              schluessel: 'wert', kopf: 'Wert netto', numerisch: true,
              zelle: (z) => (z.wert === null
                ? <span className="text-text-subtle">offen</span>
                : formatiereGeld(cent(BigInt(z.wert)))),
            },
            { schluessel: 'start', kopf: 'Start', zelle: (z) => z.start },
            {
              schluessel: 'status', kopf: 'Status',
              zelle: (z) => <StatusPill zustand={PILLE[z.status] ?? 'Geplant'} />,
            },
          ]}
        />
      )}
    </PortalRahmen>
  );
}
