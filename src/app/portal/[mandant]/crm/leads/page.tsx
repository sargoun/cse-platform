import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { cent, formatiereGeld } from '@/server/services/finanz/geld';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { haeltRechte } from '../../../rechte';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { CRM_WEGE_TEXTE } from '@/lib/i18n/verwaltung/crm';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { Listenfilter } from '@/components/portal/Listenfilter';
import { KENNZAHL_TEXTE } from '@/lib/i18n/verwaltung/kennzahlen';
import { leadFristAus, leadStatusAus } from '@/server/services/bericht/mengen';
import { listeLeads, type LeadZeile } from '@/server/services/bericht/listen';

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

const STATUS_PILLE: Readonly<Record<string, PillZustand>> = {
  neu: 'Offen',
  in_bearbeitung: 'In Arbeit',
  qualifiziert: 'Bereit',
  angebot: 'Angebot',
  gewonnen: 'Abgeschlossen',
  verloren: 'Abgelehnt',
  kein_bedarf: 'Archiviert',
};

export default async function Leadliste(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  /*
   * **Die Filter der Kacheln** (V-152, DSH-04): „Neue Anfragen" führt mit
   * `?status=neu` hierher, „Frist überschritten" mit `?frist=ueberschritten`.
   * Ohne sie zeigte die Liste alle Leads, und die Zahl der Kachel stand
   * nirgends. Beide gegen die Werteliste geprüft — ein fremdes Wort ist kein
   * Filter.
   */
  const suche = await searchParams;
  const filter = { status: leadStatusAus(suche['status']), frist: leadFristAus(suche['frist']) };
  const zugang = await portalZugang(`/portal/${mandant}/crm/leads`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  /* Die Abfrage steht im Dienst (`listeLeads`) und wird dort gegen die Kacheln geprüft. */
  const zeilen = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, (kontext) => listeLeads(kontext, filter))) as
    Promise<readonly LeadZeile[]>);
  const tk = nachSprache(KENNZAHL_TEXTE, zugang.sprache);
  const gefiltert = filter.status !== null || filter.frist !== null;
  const filterSatz = [
    filter.status === null ? null : (tk.leadStatus[filter.status] ?? tk.keinTreffer),
    filter.frist === null ? null : tk.fristUeberschritten,
  ].filter((t): t is string => t !== null).join(' · ');

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

      {gefiltert ? (
        <Listenfilter sprache={zugang.sprache} beschreibung={filterSatz}
                      alleZiel={`/portal/${mandant}/crm/leads`} />
      ) : null}

      {zeilen.length === 0 && gefiltert ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          {tk.keinTreffer}
        </p>
      ) : zeilen.length === 0 ? (
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
              zelle: (z) => <StatusPill zustand={STATUS_PILLE[z.status] ?? 'Offen'} />,
            },
          ]}
        />
      )}
    </PortalRahmen>
  );
}
