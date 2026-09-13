import type postgres from 'postgres';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../unterseite';

/**
 * `/portal/[mandant]/einstellungen/protokoll` — das Pruefprotokoll dieser
 * Gesellschaft (SEC-A9, AUT-08, TEN-09, LEG-01), lesend.
 *
 * `audit_log` ist anfuegend und ohne Loeschpfad (Invariante 8). Gelesen
 * werden die Spalten, die `cse_app` halten darf — Vorher/Nachher gehoeren
 * nicht dazu (Spaltenrecht); sie stehen dem Export mit
 * `system.audit_exportieren` offen.
 */
export const dynamic = 'force-dynamic';

const AKTEUR: Readonly<Record<string, string>> = {
  mensch: 'Mensch', agent: 'Agent', system: 'System', job: 'Job',
};

interface Zeile {
  readonly id: string;
  readonly ebene: string;
  readonly akteur_typ: string;
  readonly akteur: string | null;
  readonly aktion: string;
  readonly objekt_typ: string | null;
  readonly objekt_id: string | null;
  readonly felder: readonly string[] | null;
  readonly zeit: string;
}

export default async function Protokoll(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const tor = await mandantTor(`/portal/${mandant}/einstellungen/protokoll`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang, mandantId } = tor;

  const zeilen = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, (kontext) => kontext.abfrage<Zeile>(
      `select a.id::text as id, a.ebene::text as ebene, a.akteur_typ::text as akteur_typ,
              coalesce(b.name, ag.name) as akteur, a.aktion, a.objekt_typ, a.objekt_id,
              a.geaendert_felder as felder,
              to_char(a.erstellt_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI:SS') as zeit
         from audit_log a
         left join benutzer b on b.id = a.akteur_id
         left join agent ag on ag.id = a.agent_id
        where a.mandant_id = $1
        order by a.id desc
        limit 200`, [mandantId]))) as Promise<readonly Zeile[]>);

  return (
    <PortalRahmen
      titel="Protokoll"
      wurzelTitel="Einstellungen"
      bereich={mandant as BereichSchluessel}
      nurLesen
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}/einstellungen`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s3 text-h1 text-text">Protokoll</h1>
      <p className="mb-s5 max-w-[72ch] text-sm text-text-muted">
        Die letzten 200 Einträge dieser Gesellschaft, neueste zuerst. Das Protokoll
        wird angefügt und nie gekürzt; ein Akteur ohne Namen ist ein Konto, das in
        dieser Sitzung nicht lesbar ist — der Eintrag bleibt.
      </p>
      {zeilen.length === 0 ? (
        <p data-cse="protokoll-leer" className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Noch kein Eintrag.
        </p>
      ) : (
        <div data-cse="protokoll">
          <DataTable
            beschriftung="Prüfprotokoll dieser Gesellschaft"
            zeilen={zeilen}
            schluessel={(z) => z.id}
            spalten={[
              { schluessel: 'zeit', kopf: 'Zeit', zelle: (z) => z.zeit },
              { schluessel: 'akteur', kopf: 'Akteur',
                zelle: (z) => z.akteur ?? (AKTEUR[z.akteur_typ] ?? z.akteur_typ) },
              { schluessel: 'aktion', kopf: 'Aktion', zelle: (z) => <code className="text-xs">{z.aktion}</code> },
              { schluessel: 'objekt', kopf: 'Objekt',
                zelle: (z) => (z.objekt_typ === null ? '—'
                  : `${z.objekt_typ}${z.objekt_id === null ? '' : ` · ${z.objekt_id.slice(0, 8)}`}`) },
              { schluessel: 'felder', kopf: 'Geänderte Felder',
                zelle: (z) => (z.felder === null || z.felder.length === 0 ? '—' : z.felder.join(', ')) },
              { schluessel: 'ebene', kopf: 'Ebene', zelle: (z) => (z.ebene === 'plattform' ? 'Plattform' : 'Gesellschaft') },
            ]}
          />
        </div>
      )}
    </PortalRahmen>
  );
}
