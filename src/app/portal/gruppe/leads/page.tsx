import Link from 'next/link';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { cent, formatiereGeld } from '@/server/services/finanz/geld';
import {
  bereichAus, BereichFilter, BereichMarke, GruppenAntwort, GruppenHinweis, GruppenRahmen,
  gruppenLesen, gruppenTor, ladeBereiche, LeereListe, mandantIdsFuer, type Suchparameter,
} from '../tor';

/** `/portal/gruppe/leads` — die Pipeline ueber alle Bereiche (CRM-01, REP-02). */
export const dynamic = 'force-dynamic';

const PILLE: Readonly<Record<string, PillZustand>> = {
  neu: 'Offen', in_bearbeitung: 'In Arbeit', angebot: 'Angebot',
  gewonnen: 'Abgeschlossen', verloren: 'Abgelehnt', kein_bedarf: 'Archiviert',
};
const QUELLE: Readonly<Record<string, string>> = {
  webformular: 'Webformular', vergabe_radar: 'Vergaberadar', manuell: 'Manuell', empfehlung: 'Empfehlung',
  // V-139: die fünfte Quelle (0171) stand hier nicht — die Zeile zeigte den rohen Schlüssel.
  akquise: 'Akquise',
};
const PRIORITAET: Readonly<Record<string, string>> = { niedrig: 'niedrig', normal: 'normal', hoch: 'hoch' };

interface Zeile {
  readonly id: string;
  readonly slug: string;
  readonly bereich_name: string;
  readonly leadnummer: string;
  readonly betreff: string;
  readonly firma_name: string | null;
  readonly quelle: string;
  readonly status: string;
  readonly prioritaet: string;
  readonly sla: string | null;
  readonly sla_verletzt: boolean;
  readonly wert: string | null;
}

export default async function GruppenLeads({ searchParams }: { searchParams: Suchparameter }) {
  const tor = await gruppenTor('/portal/gruppe/leads');
  if (tor.art !== 'ok') return <GruppenAntwort tor={tor} />;

  const { bereiche, aktiv, zeilen } = await gruppenLesen(tor.zugang, async (kontext) => {
    const bereiche = await ladeBereiche(kontext);
    const aktiv = await bereichAus(searchParams, bereiche);
    const zeilen = await kontext.abfrage<Zeile>(
      `select l.id, m.slug, m.name as bereich_name, l.leadnummer, l.betreff, l.firma_name,
              l.quelle::text as quelle, l.status::text as status, l.prioritaet::text as prioritaet,
              to_char(l.sla_frist_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI') as sla,
              (l.sla_frist_am is not null and l.sla_frist_am < now()
                 and l.erste_reaktion_am is null) as sla_verletzt,
              l.geschaetzter_wert_cent::text as wert
         from lead l
         join mandant m on m.id = l.mandant_id
        where l.archiviert_am is null and l.mandant_id = any($1::uuid[])
        order by (l.status = 'neu') desc, l.sla_frist_am nulls last, l.erstellt_am desc
        limit 500`,
      [mandantIdsFuer(kontext, aktiv)],
    );
    return { bereiche, aktiv, zeilen };
  });

  return (
    <GruppenRahmen zugang={tor.zugang} titel="Anfragen" aktiverTab="uebersicht">
      <h1 className="mb-s5 text-h1 text-text">Anfragen und Pipeline</h1>
      <BereichFilter bereiche={bereiche} aktiv={aktiv} basis="/portal/gruppe/leads" />
      {zeilen.length === 0 ? (
        <LeereListe text="Keine Anfrage in dieser Auswahl." />
      ) : (
        <DataTable
          beschriftung="Anfragen über alle Gesellschaften"
          zeilen={zeilen}
          schluessel={(z) => z.id}
          spalten={[
            { schluessel: 'bereich', kopf: 'Gesellschaft',
              zelle: (z) => <BereichMarke slug={z.slug} name={z.bereich_name} /> },
            { schluessel: 'betreff', kopf: 'Anfrage',
              zelle: (z) => (
                <Link href={`/portal/${z.slug}/crm/leads/${z.id}`}
                      className="text-text underline-offset-2 hover:text-brand hover:underline">
                  {z.betreff}
                </Link>
              ) },
            { schluessel: 'nummer', kopf: 'Nummer', zelle: (z) => z.leadnummer },
            { schluessel: 'firma', kopf: 'Firma', zelle: (z) => z.firma_name ?? '—' },
            { schluessel: 'quelle', kopf: 'Quelle', zelle: (z) => QUELLE[z.quelle] ?? z.quelle },
            { schluessel: 'prioritaet', kopf: 'Priorität',
              zelle: (z) => PRIORITAET[z.prioritaet] ?? z.prioritaet },
            { schluessel: 'sla', kopf: 'Reaktionsfrist',
              zelle: (z) => (z.sla === null ? '—' : (
                <span className={z.sla_verletzt ? 'text-danger' : ''}>
                  {z.sla}{z.sla_verletzt ? ' · überschritten' : ''}
                </span>
              )) },
            { schluessel: 'wert', kopf: 'Geschätzt', numerisch: true,
              zelle: (z) => (z.wert === null ? '—' : formatiereGeld(cent(BigInt(z.wert)))) },
            { schluessel: 'status', kopf: 'Status',
              zelle: (z) => <StatusPill zustand={PILLE[z.status] ?? 'Offen'} /> },
          ]}
        />
      )}
      <GruppenHinweis text="Neue Anfragen stehen oben, danach nach Reaktionsfrist. Bearbeitet wird im Bereich." />
    </GruppenRahmen>
  );
}
