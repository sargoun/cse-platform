import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { haeltRechte } from '../../../rechte';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { CRM_WEGE_TEXTE } from '@/lib/i18n/verwaltung/crm';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * `/portal/[mandant]/crm/kunden` — die Kundenliste (CRM-01).
 *
 * Sie zeigt die RECHTSGRUNDLAGE mit, und das ist kein Beiwerk: § 7 UWG
 * verbietet elektronische Werbung ohne vorherige ausdrueckliche Einwilligung,
 * auch im B2B. Eine Liste, die den Zustand nicht zeigt, laedt dazu ein, ihn
 * zu vergessen — und die Abmahnung kommt Monate spaeter.
 *
 * Die Zahlungskonditionen stehen NICHT hier: sie sind `cse_app` entzogen
 * (K-05) und kommen ueber `app.zahlungskondition_lesen`, das sein eigenes
 * Recht prueft und den Zugriff protokolliert.
 */
export const dynamic = 'force-dynamic';

const GRUNDLAGE_PILLE: Readonly<Record<string, PillZustand>> = {
  einwilligung: 'Aktiv',
  bestandskunde: 'Bereit',
  anfrage: 'In Prüfung',
  keine: 'Fehler',
};

const GRUNDLAGE_TEXT: Readonly<Record<string, string>> = {
  einwilligung: 'Einwilligung',
  bestandskunde: 'Bestandskunde',
  anfrage: 'Anfrage',
  keine: 'keine',
};

interface KundeZeile {
  readonly id: string;
  readonly kundennummer: string;
  readonly name: string;
  readonly ort: string | null;
  readonly status: string;
  readonly rechtsgrundlage: string;
  readonly widerspruch: boolean;
  readonly objekte: string;
  readonly auftraege: string;
}

export default async function Kundenliste(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const zugang = await portalZugang(`/portal/${mandant}/crm/kunden`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const zeilen = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => kontext.abfrage<KundeZeile>(
      `select k.id, k.kundennummer, k.name, k.ort, k.status::text as status,
              k.rechtsgrundlage::text as rechtsgrundlage,
              (k.widerspruch_am is not null or k.werbewiderspruch_am is not null)
                as widerspruch,
              (select count(*) from objekt o
                where o.kunde_id = k.id and o.archiviert_am is null)::text as objekte,
              (select count(*) from auftrag a where a.kunde_id = k.id)::text as auftraege
         from kunde k
        where k.archiviert_am is null
        order by k.name`,
    ))) as Promise<readonly KundeZeile[]>);

  /*
   * V-035: die Maske „Neuer Kunde" war gebaut und von nirgends verlinkt. Das
   * Recht ist `crm.schreiben` — dasselbe, das die Zielseite verlangt; ein
   * Pfeil auf eine 404 verriete, was er nicht zeigen darf (AUT-06, D-581).
   */
  const darf = await haeltRechte(sitzung, 'crm.schreiben');
  const tCrm = nachSprache(CRM_WEGE_TEXTE, zugang.sprache);

  return (
    <PortalRahmen
      titel="Kunden"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="dashboard"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Kunden</h1>
        <p className="m-0 text-sm text-text-muted">
          {zeilen.length === 1 ? '1 Kunde' : `${String(zeilen.length)} Kunden`}
        </p>
        {darf['crm.schreiben'] === true && (
          <Link
            href={`/portal/${mandant}/crm/kunden/neu`}
            data-cse="kunde-neu"
            className="ml-auto inline-flex min-h-11 items-center rounded-md bg-brand
                       px-s4 text-sm text-white hover:bg-brand-hover"
          >
            {tCrm.neuerKunde}
          </Link>
        )}
      </div>

      {zeilen.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Noch kein Kunde erfasst.
          {darf['crm.schreiben'] === true && (
            <>
              {' '}
              <Link
                href={`/portal/${mandant}/crm/kunden/neu`}
                className="text-brand underline-offset-2 hover:underline"
              >
                {tCrm.erstenKundenAnlegen}
              </Link>
            </>
          )}
        </p>
      ) : (
        <DataTable
          beschriftung="Kunden dieser Gesellschaft mit Rechtsgrundlage und Bestand"
          zeilen={zeilen}
          schluessel={(z) => z.id}
          spalten={[
            {
              schluessel: 'name',
              kopf: 'Kunde',
              zelle: (z) => (
                <Link
                  href={`/portal/${mandant}/crm/kunden/${z.id}`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {z.name}
                </Link>
              ),
            },
            { schluessel: 'nummer', kopf: 'Nummer', zelle: (z) => z.kundennummer },
            { schluessel: 'ort', kopf: 'Ort', zelle: (z) => z.ort ?? '—' },
            { schluessel: 'objekte', kopf: 'Objekte', numerisch: true, zelle: (z) => z.objekte },
            {
              schluessel: 'auftraege', kopf: 'Aufträge', numerisch: true,
              zelle: (z) => z.auftraege,
            },
            {
              schluessel: 'grundlage',
              kopf: 'Werbung',
              zelle: (z) => (
                <span className="inline-flex flex-wrap items-center gap-s2">
                  <StatusPill
                    zustand={z.widerspruch
                      ? 'Abgelehnt'
                      : GRUNDLAGE_PILLE[z.rechtsgrundlage] ?? 'Fehler'}
                  />
                  <span className="text-xs text-text-muted">
                    {z.widerspruch
                      ? 'Widerspruch'
                      : GRUNDLAGE_TEXT[z.rechtsgrundlage] ?? z.rechtsgrundlage}
                  </span>
                </span>
              ),
            },
          ]}
        />
      )}

      <p className="mt-s5 max-w-prose text-xs text-text-muted">
        § 7 UWG: elektronische Werbung braucht eine vorherige ausdrückliche
        Einwilligung — auch gegenüber Unternehmen. Ein Widerspruch (Art. 21
        DSGVO) schließt jede Werbung aus, unabhängig von der Grundlage. Was
        hier nicht aufgezeichnet ist, kann nicht gesendet werden.
      </p>
    </PortalRahmen>
  );
}
