import type postgres from 'postgres';
import Link from 'next/link';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../unterseite';

/**
 * `/portal/[mandant]/einstellungen/rollen` — die Rollen und ihre Rechte
 * (AUT-03), lesend, mit Zwei-Faktor-Pflicht laut Manifest.
 *
 * Gezaehlt wird, was `rolle_berechtigung` fuer diese Gesellschaft ergibt:
 * die Plattformvorgabe (`mandant_id is null`) und die Abweichungen dieses
 * Bereichs (`mandant_id = aktiver`). Beides ist unter `t_rb_lesen` lesbar;
 * die Matrix selbst steht hinter dem Verweis.
 */
export const dynamic = 'force-dynamic';

const PORTAL: Readonly<Record<string, string>> = {
  intern: 'Verwaltung', mitarbeiter: 'Mitarbeiterportal', kunde: 'Kundenportal',
};

interface Zeile {
  readonly schluessel: string;
  readonly bezeichnung: string;
  readonly beschreibung: string | null;
  readonly geltungsbereich: string;
  readonly portal: string;
  readonly erfordert_2fa: boolean;
  readonly ist_system: boolean;
  readonly eigene: boolean;
  readonly rechte: number;
  readonly abweichungen: number;
  readonly mitglieder: number;
}

export default async function Rollen(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const tor = await mandantTor(`/portal/${mandant}/einstellungen/rollen`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang, mandantId } = tor;

  const zeilen = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, (kontext) => kontext.abfrage<Zeile>(
      `select r.schluessel, r.bezeichnung, r.beschreibung, r.geltungsbereich::text as geltungsbereich,
              r.portal, r.erfordert_2fa, r.ist_system, (r.mandant_id is not null) as eigene,
              /*
               * WIRKSAM heisst: die Abweichung dieser Gesellschaft schlaegt die
               * Vorgabe — auch dann, wenn sie ein Recht ENTZIEHT. Ein Zaehler
               * ueber alle gewaehrten Zeilen zaehlte ein hier verweigertes Recht
               * mit, und die Zahl widersprach der Matrix darunter.
               */
              (select count(*)
                 from berechtigung b
                 left join rolle_berechtigung vorgabe
                        on vorgabe.rolle_id = r.id and vorgabe.berechtigung_id = b.id
                       and vorgabe.mandant_id is null
                 left join rolle_berechtigung hier
                        on hier.rolle_id = r.id and hier.berechtigung_id = b.id
                       and hier.mandant_id = $1
                where coalesce(hier.gewaehrt, vorgabe.gewaehrt) = true)::int as rechte,
              (select count(*) from rolle_berechtigung rb
                where rb.rolle_id = r.id and rb.mandant_id = $1)::int as abweichungen,
              (select count(*) from benutzer_mandant bm
                where bm.rolle_id = r.id and bm.mandant_id = $1 and bm.entzogen_am is null)::int as mitglieder
         from rolle r
        where r.archiviert_am is null and (r.mandant_id is null or r.mandant_id = $1)
        order by r.geltungsbereich, r.schluessel`, [mandantId]))) as Promise<readonly Zeile[]>);

  return (
    <PortalRahmen
      titel="Rollen und Rechte"
      wurzelTitel="Einstellungen"
      bereich={mandant as BereichSchluessel}
      nurLesen
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="einstellungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s3 text-h1 text-text">Rollen und Rechte</h1>
      <p className="mb-s5 max-w-[72ch] text-sm text-text-muted">
        Die Systemrollen gelten in jeder Gesellschaft; eine Abweichung gilt nur hier
        und schlägt die Vorgabe (0008). Die Zahl der Rechte ist, was in dieser
        Gesellschaft tatsächlich gilt.
      </p>
      <div data-cse="rollen-liste">
        <DataTable
          beschriftung="Rollen dieser Gesellschaft"
          zeilen={zeilen}
          /* Eine plattformweite und eine eigene Rolle duerfen denselben Schluessel tragen — die Zeile ist beides. */
          schluessel={(z) => `${z.eigene ? 'eigene' : 'system'}:${z.schluessel}`}
          spalten={[
            { schluessel: 'rolle', kopf: 'Rolle',
              zelle: (z) => (
                <Link href={`/portal/${mandant}/einstellungen/rollen/${z.schluessel}${z.eigene ? '?eigene=1' : ''}`}
                      className="text-text underline-offset-2 hover:text-brand hover:underline">
                  {z.bezeichnung}
                </Link>
              ) },
            { schluessel: 'schluessel', kopf: 'Schlüssel', zelle: (z) => <code className="text-xs">{z.schluessel}</code> },
            { schluessel: 'portal', kopf: 'Portal', zelle: (z) => PORTAL[z.portal] ?? z.portal },
            { schluessel: 'geltung', kopf: 'Geltung',
              zelle: (z) => (z.geltungsbereich === 'global' ? 'plattformweit' : z.eigene ? 'nur diese Gesellschaft' : 'je Gesellschaft') },
            { schluessel: 'faktor', kopf: '2FA', zelle: (z) => (z.erfordert_2fa ? 'Pflicht' : '—') },
            { schluessel: 'rechte', kopf: 'Rechte', numerisch: true, zelle: (z) => z.rechte },
            { schluessel: 'abweichungen', kopf: 'Abweichungen hier', numerisch: true,
              zelle: (z) => (z.abweichungen === 0 ? '—' : z.abweichungen) },
            { schluessel: 'mitglieder', kopf: 'Konten', numerisch: true, zelle: (z) => z.mitglieder },
          ]}
        />
      </div>
      <p className="mt-s5 max-w-[72ch] text-sm text-text-subtle">
        Der Editor der Matrix (`system.rolle_verwalten`) vergibt nie mehr, als die
        vergebende Person selbst hält (SEC-A3) — er kommt mit der Rollenverwaltung.
      </p>
    </PortalRahmen>
  );
}
