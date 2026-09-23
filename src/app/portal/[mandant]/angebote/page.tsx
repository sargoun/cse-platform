import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { formatiereGeld, cent } from '@/server/services/finanz/geld';
import { AnmeldungNoetig } from '../../Anmeldung';
import { portalZugang } from '../../zugang';
import { slugTor } from '../../unterseite';
import { haeltRechte } from '../../rechte';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { Listenfilter } from '@/components/portal/Listenfilter';
import { angebotFilterAus, angebotStaende } from '@/server/services/bericht/mengen';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { KENNZAHL_TEXTE } from '@/lib/i18n/verwaltung/kennzahlen';

/**
 * `/portal/[mandant]/angebote` — die Angebotsliste (OPS-08).
 *
 * Die Statusabbildung steht hier und nicht im Datenmodell: DESIGN §5 fuehrt
 * ein FESTES Vokabular, und ein Zustand des Angebots, der keine Pille hat,
 * waere eine erfundene Beschriftung an der Oberflaeche.
 */
export const dynamic = 'force-dynamic';

const PILLE: Readonly<Record<string, PillZustand>> = {
  entwurf: 'Entwurf',
  in_pruefung: 'In Prüfung',
  versendet: 'Angebot',
  angenommen: 'Aktiv',
  abgelehnt: 'Abgelehnt',
  zurueckgezogen: 'Archiviert',
  abgelaufen: 'Überfällig',
};

interface AngebotZeile {
  readonly id: string;
  readonly angebotsnummer: string | null;
  readonly titel: string;
  readonly kunde: string | null;
  readonly status: string;
  readonly netto_cent: string;
  readonly gueltig_bis: string | null;
  readonly hat_auftrag: boolean;
}

export default async function Angebotsliste(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  /*
   * **Der Filter aus der Kachel** (V-150, DSH-04): „Offene Angebote" führt mit
   * `?status=offen` hierher — Entwurf, in Prüfung, versendet (`mengen.ts`);
   * ein einzelner Stand geht ebenso. Ohne ihn zeigte die Liste alle Stände.
   */
  const filter = angebotFilterAus((await searchParams)['status']);
  const staende = angebotStaende(filter);
  const zugang = await portalZugang(`/portal/${mandant}/angebote`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const darf = await haeltRechte(sitzung, 'angebot.schreiben');
  const tk = nachSprache(KENNZAHL_TEXTE, zugang.sprache);

  const zeilen = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => kontext.abfrage<AngebotZeile>(

      `select a.id, a.angebotsnummer, a.titel, k.name as kunde, a.status::text as status,
              a.netto_cent::text, to_char(a.gueltig_bis, 'DD.MM.YYYY') as gueltig_bis,
              exists (select 1 from auftrag t where t.angebot_id = a.id) as hat_auftrag
         from angebot a left join kunde k on k.id = a.kunde_id
        where a.archiviert_am is null
          and ($1::text[] is null or a.status::text = any($1::text[]))
        order by a.erstellt_am desc`,
      [staende],
    ))) as Promise<readonly AngebotZeile[]>);

  return (
    <PortalRahmen
      titel="Angebote"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="angebote"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-center justify-between gap-s3">
        <div className="flex flex-wrap items-baseline gap-s3">
          <h1 className="m-0 text-h1 text-text">Angebote</h1>
          <p className="m-0 text-sm text-text-muted">
            {zeilen.length === 1 ? '1 Angebot' : `${String(zeilen.length)} Angebote`}
          </p>
        </div>
        {/*
          * **Der zweite Weg zu einem Angebot** (V-047).
          *
          * Der einzige Weg führte über das Raumbuch eines Objekts — richtig
          * für die Reinigung, wo die Kalkulation aus Flächen entsteht, und
          * für Sicherheit und Bau unbrauchbar: dort gibt es kein Raumbuch.
          * `/angebote/neu` ist seit je gebaut und stand in keiner Leiste.
          *
          * Das Recht ist `angebot.schreiben` — dasselbe, das die Route im
          * Register trägt (AUT-06, D-581).
          */}
        {darf['angebot.schreiben'] === true && (
          <Link
            href={`/portal/${mandant}/angebote/neu`}
            data-cse="angebot-neu"
            className="inline-flex min-h-11 items-center rounded-md bg-brand px-s4
                       text-sm font-semibold text-white hover:bg-brand-hover"
          >
            Neues Angebot
          </Link>
        )}
      </div>

      {filter === null ? null : (
        <Listenfilter sprache={zugang.sprache}
                      beschreibung={filter === 'offen'
                        ? tk.angebotOffen : tk.angebotStatus[filter] ?? tk.keinTreffer}
                      alleZiel={`/portal/${mandant}/angebote`} />
      )}

      {zeilen.length === 0 && filter !== null ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          {tk.keinTreffer}
        </p>
      ) : zeilen.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Noch kein Angebot. Ein Reinigungsangebot entsteht aus dem Raumbuch
          eines Objekts — dort steht der Knopf; für Sicherheit und Bau führt der
          Weg über
          {darf['angebot.schreiben'] === true ? (
            <>
              {' '}
              <Link
                href={`/portal/${mandant}/angebote/neu`}
                className="underline underline-offset-2 hover:text-text"
              >
                Neues Angebot
              </Link>
              .
            </>
          ) : ' „Neues Angebot" — dafür fehlt Ihnen angebot.schreiben.'}
        </p>
      ) : (
        <DataTable
          beschriftung="Angebote dieser Gesellschaft mit Kunde, Status und Nettosumme"
          zeilen={zeilen}
          schluessel={(z) => z.id}
          spalten={[
            {
              schluessel: 'titel',
              kopf: 'Angebot',
              zelle: (z) => (
                <Link
                  href={`/portal/${mandant}/angebote/${z.id}`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {z.titel}
                </Link>
              ),
            },
            {
              schluessel: 'nummer',
              kopf: 'Nummer',
              zelle: (z) => z.angebotsnummer ?? (
                <span className="text-text-subtle">ohne — Entwurf</span>
              ),
            },
            { schluessel: 'kunde', kopf: 'Kunde', zelle: (z) => z.kunde ?? '—' },
            {
              schluessel: 'netto',
              kopf: 'Netto',
              numerisch: true,
              zelle: (z) => formatiereGeld(cent(BigInt(z.netto_cent))),
            },
            {
              schluessel: 'gueltig',
              kopf: 'Bindefrist',
              zelle: (z) => z.gueltig_bis ?? <span className="text-text-subtle">—</span>,
            },
            {
              schluessel: 'status',
              kopf: 'Status',
              zelle: (z) => (
                <span className="inline-flex flex-wrap items-center gap-s2">
                  <StatusPill zustand={PILLE[z.status] ?? 'Entwurf'} />
                  {z.hat_auftrag ? (
                    <span className="text-xs text-text-muted">→ Auftrag</span>
                  ) : null}
                </span>
              ),
            },
          ]}
        />
      )}
    </PortalRahmen>
  );
}
