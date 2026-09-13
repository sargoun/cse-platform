import type postgres from 'postgres';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../../unterseite';

/**
 * `/portal/[mandant]/einstellungen/rollen/[rolle]` — die Matrix einer Rolle
 * in dieser Gesellschaft (AUT-03): jedes Recht des Katalogs, ob es gilt, und
 * ob das die Vorgabe oder eine Abweichung dieses Bereichs ist.
 */
export const dynamic = 'force-dynamic';

const SCHLUESSEL = /^[a-z][a-z0-9_]{1,63}$/u;
const RISIKO: Readonly<Record<string, string>> = { niedrig: 'niedrig', mittel: 'mittel', hoch: 'hoch' };

interface Kopf {
  readonly schluessel: string;
  readonly bezeichnung: string;
  readonly beschreibung: string | null;
  readonly portal: string;
  readonly erfordert_2fa: boolean;
}

interface Recht {
  readonly schluessel: string;
  readonly modul: string;
  readonly bezeichnung: string;
  readonly aktion: string;
  readonly risiko: string;
  readonly erfordert_2fa: boolean;
  readonly nur_global: boolean;
  /** `null` = nicht vergeben; sonst ob gewaehrt. */
  readonly gewaehrt: boolean | null;
  readonly abweichung: boolean;
}

export default async function Rollenblatt(
  { params }: { params: Promise<{ mandant: string; rolle: string }> },
) {
  const { mandant, rolle } = await params;
  if (!SCHLUESSEL.test(rolle)) notFound();
  const tor = await mandantTor(`/portal/${mandant}/einstellungen/rollen/${rolle}`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang, mandantId } = tor;

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => {
      const [kopf] = await kontext.abfrage<Kopf>(
        `select r.schluessel, r.bezeichnung, r.beschreibung, r.portal, r.erfordert_2fa
           from rolle r
          where r.schluessel = $1 and r.archiviert_am is null
            and (r.mandant_id is null or r.mandant_id = $2)
          order by r.mandant_id nulls last limit 1`, [rolle, mandantId]);
      if (kopf === undefined) return null;
      const rechte = await kontext.abfrage<Recht>(
        `select b.schluessel, b.modul, b.bezeichnung, b.aktion::text as aktion, b.risiko::text as risiko,
                b.erfordert_2fa, b.nur_global,
                coalesce(hier.gewaehrt, vorgabe.gewaehrt) as gewaehrt,
                (hier.gewaehrt is not null) as abweichung
           from berechtigung b
           join rolle r on r.schluessel = $1 and r.archiviert_am is null
                       and (r.mandant_id is null or r.mandant_id = $2)
           left join rolle_berechtigung vorgabe
                  on vorgabe.rolle_id = r.id and vorgabe.berechtigung_id = b.id and vorgabe.mandant_id is null
           left join rolle_berechtigung hier
                  on hier.rolle_id = r.id and hier.berechtigung_id = b.id and hier.mandant_id = $2
          order by b.modul, b.sortierung, b.schluessel`, [rolle, mandantId]);
      return { kopf, rechte };
    })) as Promise<{ kopf: Kopf; rechte: readonly Recht[] } | null>);
  if (daten === null) notFound();
  const { kopf, rechte } = daten;
  const gewaehrt = rechte.filter((r) => r.gewaehrt === true);

  return (
    <PortalRahmen
      titel={kopf.bezeichnung}
      wurzelTitel="Rollen"
      bereich={mandant as BereichSchluessel}
      nurLesen
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}/einstellungen/rollen`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s3 text-h1 text-text">{kopf.bezeichnung}</h1>
      <p data-cse="rolle-zaehler" data-gewaehrt={gewaehrt.length} className="mb-s5 max-w-[72ch] text-sm text-text-muted">
        <code>{kopf.schluessel}</code> · {kopf.portal}
        {kopf.erfordert_2fa ? ' · Zwei-Faktor-Pflicht' : ''} —{' '}
        {String(gewaehrt.length)} von {String(rechte.length)} Rechten des Katalogs gelten in dieser
        Gesellschaft{kopf.beschreibung === null ? '' : `. ${kopf.beschreibung}`}
      </p>
      <div data-cse="rechte-matrix">
        <DataTable
          beschriftung={`Rechte der Rolle ${kopf.bezeichnung} in dieser Gesellschaft`}
          zeilen={rechte}
          schluessel={(r) => r.schluessel}
          spalten={[
            { schluessel: 'modul', kopf: 'Modul', zelle: (r) => r.modul },
            { schluessel: 'recht', kopf: 'Recht',
              zelle: (r) => (
                <span>
                  {r.bezeichnung}
                  <span className="ml-s2 text-xs text-text-subtle"><code>{r.schluessel}</code></span>
                </span>
              ) },
            { schluessel: 'risiko', kopf: 'Risiko',
              zelle: (r) => <span className={r.risiko === 'hoch' ? 'text-danger' : ''}>{RISIKO[r.risiko] ?? r.risiko}</span> },
            { schluessel: 'faktor', kopf: '2FA', zelle: (r) => (r.erfordert_2fa ? 'Pflicht' : '—') },
            { schluessel: 'gilt', kopf: 'Gilt',
              zelle: (r) => (r.gewaehrt === true
                ? <span data-gilt="ja" className="text-success">ja</span>
                : r.gewaehrt === false
                  ? <span data-gilt="nein" className="text-danger">verweigert</span>
                  : <span data-gilt="offen" className="text-text-subtle">nicht vergeben</span>) },
            { schluessel: 'quelle', kopf: 'Quelle',
              zelle: (r) => (r.gewaehrt === null ? '—' : r.abweichung ? 'Abweichung dieser Gesellschaft' : 'Plattformvorgabe') },
          ]}
        />
      </div>
    </PortalRahmen>
  );
}
