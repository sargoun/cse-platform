import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import { formatiereMenge, mengeAusPostgresOderNull }
  from '@/server/services/finanz/menge';
import { AnmeldungNoetig } from '../../Anmeldung';
import { portalZugang } from '../../zugang';
import { slugTor } from '../../unterseite';
import { haeltRechte } from '../../rechte';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { OBJEKTE_TEXTE } from '@/lib/i18n/verwaltung/objekte';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * `/portal/[mandant]/objekte` — OPS-01, die Objektliste.
 *
 * Die Liste zeigt die Flaeche aus dem Raumbuch mit, weil das die Zahl ist,
 * nach der jemand sucht, wenn er hier steht — und weil ein Objekt mit `0 m²`
 * damit sofort als noch nicht erfasstes Raumbuch zu erkennen ist statt als
 * kleines Objekt.
 *
 * Die Karte (SEITENKARTE: "list + map") fehlt hier mit Absicht: sie braucht
 * einen Kartendienst, und keiner ist eingerichtet. Eine Karte einzubauen, die
 * nichts laedt, waere eine vorgetaeuschte Integration.
 * // TODO(client, O-132): welcher EU-gehostete Kartendienst, unter welchem
 * Auftragsverarbeitungsvertrag? Bis dahin bleibt die Liste eine Liste.
 */
export const dynamic = 'force-dynamic';

interface ObjektZeile {
  readonly id: string;
  readonly objektnummer: string;
  readonly bezeichnung: string;
  readonly plz: string;
  readonly ort: string;
  readonly strasse: string;
  readonly kunde: string | null;
  readonly flaeche: string | null;
  readonly raeume: string;
  readonly archiviert: boolean;
}

export default async function Objektliste(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/objekte`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();
  const darf = await haeltRechte(sitzung, 'objekt.schreiben');
  const t = nachSprache(OBJEKTE_TEXTE, zugang.sprache);

  const zeilen = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => kontext.abfrage<ObjektZeile>(
      /**
       * Die Summe kommt aus demselben `select`, nicht aus einer zweiten
       * Abfrage je Zeile: hundert Objekte waeren sonst hunderteins Abfragen,
       * und die Liste waere genau dann langsam, wenn sie sich lohnt.
       */
      `select o.id, o.objektnummer, o.bezeichnung, o.strasse, o.plz, o.ort,
              k.name as kunde,
              r.flaeche::text as flaeche,
              coalesce(r.raeume, 0)::text as raeume,
              (o.archiviert_am is not null) as archiviert
         from objekt o
         left join kunde k on k.id = o.kunde_id
         left join lateral (
                select sum(flaeche_qm) as flaeche, count(*) as raeume
                  from raum
                 where raum.objekt_id = o.id and raum.archiviert_am is null
              ) r on true
        order by o.archiviert_am nulls first, o.bezeichnung`,
    ))) as Promise<readonly ObjektZeile[]>);

  return (
    <PortalRahmen
      titel="Objekte"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="objekte"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">Objekte</h1>
        <p className="m-0 text-sm text-text-muted">
          {zeilen.length === 1 ? '1 Objekt' : `${String(zeilen.length)} Objekte`}
        </p>
        {darf['objekt.schreiben'] === true && (
          <Link
            href={`/portal/${mandant}/objekte/neu`}
            data-cse="objekt-neu"
            className="ml-auto inline-flex min-h-11 items-center rounded-md bg-brand
                       px-s4 text-sm text-white hover:bg-brand-hover"
          >
            {t.neuesObjekt}
          </Link>
        )}
      </div>

      {zeilen.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Noch kein Objekt erfasst. Objekte sind Orte — ein Gebäude oder ein
          Gelände; die kaufmännische Beziehung hängt am Auftrag, nicht am Ort.
          {darf['objekt.schreiben'] === true && (
            <>
              {' '}
              <Link
                href={`/portal/${mandant}/objekte/neu`}
                className="text-brand underline-offset-2 hover:underline"
              >
                {t.ersteAnlegen}
              </Link>
            </>
          )}
        </p>
      ) : (
        <DataTable
          beschriftung="Objekte dieser Gesellschaft mit Anschrift, Kunde und Fläche"
          zeilen={zeilen}
          schluessel={(z) => z.id}
          spalten={[
            {
              schluessel: 'bezeichnung',
              kopf: 'Objekt',
              zelle: (z) => (
                <Link
                  href={`/portal/${mandant}/objekte/${z.id}`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {z.bezeichnung}
                </Link>
              ),
            },
            { schluessel: 'nummer', kopf: 'Nummer', zelle: (z) => z.objektnummer },
            {
              schluessel: 'anschrift',
              kopf: 'Anschrift',
              zelle: (z) => `${z.strasse}, ${z.plz} ${z.ort}`,
            },
            {
              schluessel: 'kunde',
              kopf: 'Kunde',
              zelle: (z) => z.kunde ?? (
                <span className="text-text-subtle">ohne Kundenbezug</span>
              ),
            },
            {
              schluessel: 'raeume',
              kopf: 'Räume',
              numerisch: true,
              zelle: (z) => z.raeume,
            },
            {
              schluessel: 'flaeche',
              kopf: 'Fläche m²',
              numerisch: true,
              zelle: (z) => (z.flaeche === null
                ? <span className="text-text-subtle">kein Raumbuch</span>
                : formatiereMenge(mengeAusPostgresOderNull(z.flaeche))),
            },
            {
              schluessel: 'status',
              kopf: 'Status',
              zelle: (z) => <StatusPill zustand={z.archiviert ? 'Archiviert' : 'Aktiv'} />,
            },
          ]}
        />
      )}
    </PortalRahmen>
  );
}
