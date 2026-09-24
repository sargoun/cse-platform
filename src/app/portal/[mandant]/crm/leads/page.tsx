import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import { LEAD_PILLE } from '@/lib/vorgang-pille';
import { cent, formatiereGeld } from '@/server/services/finanz/geld';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { haeltRechte } from '../../../rechte';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { CRM_WEGE_TEXTE } from '@/lib/i18n/verwaltung/crm';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * `/portal/[mandant]/crm/leads` — der Posteingang (CRM-07).
 *
 * Die Liste ist nach FRIST sortiert, nicht nach Eingang: was zuerst
 * beantwortet werden muss, steht oben. Ein Posteingang nach Datum sortiert
 * sieht ordentlich aus und laesst die eilige Anfrage unten liegen.
 *
 * `punktzahl` steht mit ihrer BEGRUENDUNG da. Eine Bewertung ohne Begruendung
 * ist eine Zahl, der man glauben muss — und niemand widerspricht ihr, weil
 * niemand weiss, woraus sie entstand.
 */
export const dynamic = 'force-dynamic';

interface LeadZeile {
  readonly id: string;
  readonly leadnummer: string;
  readonly betreff: string | null;
  readonly firma_name: string | null;
  readonly quelle: string;
  readonly status: string;
  readonly prioritaet: string;
  readonly punktzahl: number | null;
  readonly punktzahl_begruendung: string | null;
  readonly wert: string | null;
  readonly frist: string | null;
  readonly frist_ueberschritten: boolean;
  readonly naechste_aktion_text: string | null;
  readonly naechste_aktion_am: string | null;
  readonly besitzer: string | null;
}

export default async function Leadliste(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const zugang = await portalZugang(`/portal/${mandant}/crm/leads`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const zeilen = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => kontext.abfrage<LeadZeile>(
      `select l.id, l.leadnummer, l.betreff, l.firma_name, l.quelle::text as quelle,
              l.status::text as status, l.prioritaet::text as prioritaet,
              l.punktzahl, l.punktzahl_begruendung,
              l.geschaetzter_wert_cent::text as wert,
              to_char(l.sla_frist_am at time zone 'Europe/Berlin', 'DD.MM. HH24:MI') as frist,
              (l.sla_frist_am is not null and l.erste_reaktion_am is null
               and l.sla_frist_am < now()) as frist_ueberschritten,
              l.naechste_aktion_text,
              to_char(l.naechste_aktion_am at time zone 'Europe/Berlin', 'DD.MM.YYYY')
                as naechste_aktion_am,
              b.name as besitzer
         from lead l
         left join benutzer b on b.id = l.besitzer_benutzer_id
        where l.archiviert_am is null
        order by (l.status in ('gewonnen','verloren','kein_bedarf')),
                 l.sla_frist_am nulls last, l.erstellt_am desc`,
    ))) as Promise<readonly LeadZeile[]>);

  const offen = zeilen.filter((z) => !['gewonnen', 'verloren', 'kein_bedarf'].includes(z.status));

  /*
   * V-036: die Maske „Neuer Lead" war gebaut und von nirgends verlinkt — der
   * Weg fuer die Anfrage, die am Telefon oder auf einer Messe kam.
   */
  const darf = await haeltRechte(sitzung, 'crm.schreiben');
  const tCrm = nachSprache(CRM_WEGE_TEXTE, zugang.sprache);

  return (
    <PortalRahmen
      titel="Leads"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="crm"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Leads</h1>
        <p className="m-0 text-sm text-text-muted">
          {`${String(offen.length)} offen von ${String(zeilen.length)}`}
        </p>
        {darf['crm.schreiben'] === true && (
          <Link
            href={`/portal/${mandant}/crm/leads/neu`}
            data-cse="lead-neu"
            className="ml-auto inline-flex min-h-11 items-center rounded-md bg-brand
                       px-s4 text-sm text-white hover:bg-brand-hover"
          >
            {tCrm.neuerLead}
          </Link>
        )}
      </div>

      {zeilen.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Kein Lead im Posteingang. Anfragen aus dem Angebotsformular der
          Website landen hier.
          {darf['crm.schreiben'] === true && (
            <>
              {' '}
              <Link
                href={`/portal/${mandant}/crm/leads/neu`}
                className="text-brand underline-offset-2 hover:underline"
              >
                {tCrm.erstenLeadAnlegen}
              </Link>
            </>
          )}
        </p>
      ) : (
        <DataTable
          beschriftung="Leads nach Frist, offene zuerst"
          zeilen={zeilen}
          schluessel={(z) => z.id}
          spalten={[
            { schluessel: 'nummer', kopf: 'Nr.', zelle: (z) => z.leadnummer },
            {
              schluessel: 'betreff',
              kopf: 'Anfrage',
              zelle: (z) => (
                <span>
                  <Link
                    href={`/portal/${mandant}/crm/leads/${z.id}`}
                    className="text-text underline-offset-2 hover:text-brand hover:underline"
                  >
                    {z.betreff ?? 'Anfrage'}
                  </Link>
                  <span className="block text-xs text-text-muted">
                    {z.firma_name ?? 'ohne Firma'}
                  </span>
                </span>
              ),
            },
            {
              schluessel: 'frist',
              kopf: 'Frist',
              zelle: (z) => (z.frist === null ? '—' : (
                <span className={z.frist_ueberschritten ? 'text-danger' : 'text-text'}>
                  {z.frist}
                </span>
              )),
            },
            {
              schluessel: 'punktzahl',
              kopf: 'Punkte',
              numerisch: true,
              zelle: (z) => (z.punktzahl === null ? '—' : (
                <span title={z.punktzahl_begruendung ?? undefined}>
                  {String(z.punktzahl)}
                </span>
              )),
            },
            {
              schluessel: 'wert',
              kopf: 'Wert',
              numerisch: true,
              zelle: (z) => (z.wert === null
                ? <span className="text-text-subtle">—</span>
                : formatiereGeld(cent(BigInt(z.wert)))),
            },
            {
              schluessel: 'naechste',
              kopf: 'Nächster Schritt',
              zelle: (z) => (z.naechste_aktion_text === null ? (
                <span className="text-warning">nicht festgelegt</span>
              ) : (
                <span>
                  {z.naechste_aktion_text}
                  {z.naechste_aktion_am === null ? null : (
                    <span className="block text-xs text-text-muted">{z.naechste_aktion_am}</span>
                  )}
                </span>
              )),
            },
            { schluessel: 'besitzer', kopf: 'Zuständig', zelle: (z) => z.besitzer ?? '—' },
            {
              schluessel: 'status',
              kopf: 'Status',
              zelle: (z) => <StatusPill zustand={LEAD_PILLE[z.status] ?? 'Offen'} />,
            },
          ]}
        />
      )}
    </PortalRahmen>
  );
}
