import { DataTable } from '@/components/ui/DataTable';
import {
  bereichAus, BereichFilter, BereichMarke, GruppenAntwort, GruppenHinweis, GruppenRahmen,
  gruppenLesen, gruppenTor, ladeBereiche, LeereListe, type Suchparameter,
} from '../tor';

/**
 * `/portal/gruppe/protokoll` — das Pruefprotokoll ueber alle Gesellschaften
 * (SEC-A9, AUT-08, TEN-09). Gelesen unter `gruppe.system.audit_lesen`; die
 * Policy `t_audit_lesen` gibt die Zeilen der sichtbaren Bereiche und die
 * Plattformzeilen ohne Bereich (`mandant_id is null`).
 */
export const dynamic = 'force-dynamic';

const AKTEUR: Readonly<Record<string, string>> = {
  mensch: 'Mensch', agent: 'Agent', system: 'System', job: 'Job',
};

interface Zeile {
  readonly id: string;
  readonly slug: string | null;
  readonly bereich_name: string | null;
  readonly ebene: string;
  readonly akteur_typ: string;
  readonly akteur: string | null;
  readonly aktion: string;
  readonly objekt_typ: string | null;
  readonly objekt_id: string | null;
  readonly zeit: string;
}

export default async function GruppenProtokoll({ searchParams }: { searchParams: Suchparameter }) {
  const tor = await gruppenTor('/portal/gruppe/protokoll');
  if (tor.art !== 'ok') return <GruppenAntwort tor={tor} />;

  const { bereiche, aktiv, zeilen } = await gruppenLesen(tor.zugang, async (kontext) => {
    const bereiche = await ladeBereiche(kontext);
    const aktiv = await bereichAus(searchParams, bereiche);
    const zeilen = await kontext.abfrage<Zeile>(
      `select a.id::text as id, m.slug, m.name as bereich_name, a.ebene::text as ebene,
              a.akteur_typ::text as akteur_typ, coalesce(b.name, ag.name) as akteur,
              a.aktion, a.objekt_typ, a.objekt_id,
              to_char(a.erstellt_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI:SS') as zeit
         from audit_log a
         left join mandant m on m.id = a.mandant_id
         left join benutzer b on b.id = a.akteur_id
         left join agent ag on ag.id = a.agent_id
        where ($1::uuid is null and (a.mandant_id is null or a.mandant_id = any($2::uuid[])))
           or a.mandant_id = $1::uuid
        order by a.id desc
        limit 200`,
      [aktiv?.id ?? null, kontext.mandantIds],
    );
    return { bereiche, aktiv, zeilen };
  });

  return (
    <GruppenRahmen zugang={tor.zugang} titel="Protokoll" aktiverTab="uebersicht">
      <h1 className="mb-s5 text-h1 text-text">Protokoll</h1>
      <BereichFilter bereiche={bereiche} aktiv={aktiv} basis="/portal/gruppe/protokoll" />
      {zeilen.length === 0 ? (
        <LeereListe text="Kein Eintrag in dieser Auswahl." />
      ) : (
        <DataTable
          beschriftung="Prüfprotokoll über alle Gesellschaften, neueste zuerst"
          zeilen={zeilen}
          schluessel={(z) => z.id}
          spalten={[
            { schluessel: 'zeit', kopf: 'Zeit', zelle: (z) => z.zeit },
            { schluessel: 'bereich', kopf: 'Gesellschaft',
              zelle: (z) => (z.slug === null
                ? <span className="text-text-muted">Plattform</span>
                : <BereichMarke slug={z.slug} name={z.bereich_name ?? z.slug} />) },
            { schluessel: 'akteur', kopf: 'Akteur',
              zelle: (z) => z.akteur ?? (AKTEUR[z.akteur_typ] ?? z.akteur_typ) },
            { schluessel: 'aktion', kopf: 'Aktion', zelle: (z) => <code className="text-xs">{z.aktion}</code> },
            { schluessel: 'objekt', kopf: 'Objekt',
              zelle: (z) => (z.objekt_typ === null ? '—'
                : `${z.objekt_typ}${z.objekt_id === null ? '' : ` · ${z.objekt_id.slice(0, 8)}`}`) },
          ]}
        />
      )}
      <GruppenHinweis text="Die letzten 200 Einträge. Ein Akteur ohne Namen heißt: das Konto ist in dieser Sitzung nicht lesbar; der Eintrag ist es trotzdem — das Protokoll kennt keine Lücken." />
    </GruppenRahmen>
  );
}
