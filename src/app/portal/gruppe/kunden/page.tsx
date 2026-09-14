import Link from 'next/link';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import {
  bereichAus, BereichFilter, BereichMarke, GruppenAntwort, GruppenHinweis, GruppenRahmen,
  gruppenLesen, gruppenTor, ladeBereiche, LeereListe, mandantIdsFuer, type Suchparameter,
} from '../tor';

/**
 * `/portal/gruppe/kunden` — Kunden ueber alle Bereiche (CRM-06, CRM-01).
 *
 * Derselbe Kunde kann in zwei Gesellschaften eine Zeile haben — je Bereich
 * eine eigene Kundennummer, ein eigener Debitor (TEN-02). `firma_id` haelt
 * sie zusammen; die Spalte „auch in" sagt, wo es ihn noch gibt.
 */
export const dynamic = 'force-dynamic';

const PILLE: Readonly<Record<string, PillZustand>> = {
  aktiv: 'Aktiv', inaktiv: 'Inaktiv', gesperrt: 'Fehler',
};

interface Zeile {
  readonly id: string;
  readonly slug: string;
  readonly bereich_name: string;
  readonly kundennummer: string;
  readonly name: string;
  readonly ort: string | null;
  readonly status: string;
  readonly auftraege_aktiv: number;
  readonly seit: string;
  readonly weitere_bereiche: readonly string[] | null;
}

export default async function GruppenKunden({ searchParams }: { searchParams: Suchparameter }) {
  const tor = await gruppenTor('/portal/gruppe/kunden');
  if (tor.art !== 'ok') return <GruppenAntwort tor={tor} />;

  const { bereiche, aktiv, zeilen } = await gruppenLesen(tor.zugang, async (kontext) => {
    const bereiche = await ladeBereiche(kontext);
    const aktiv = await bereichAus(searchParams, bereiche);
    const zeilen = await kontext.abfrage<Zeile>(
      `select k.id, m.slug, m.name as bereich_name, k.kundennummer, k.name, k.ort,
              k.status::text as status,
              (select count(*) from auftrag a
                where a.kunde_id = k.id and a.mandant_id = k.mandant_id
                  and a.status = 'aktiv' and a.archiviert_am is null)::int as auftraege_aktiv,
              to_char(k.erstellt_am at time zone 'Europe/Berlin', 'DD.MM.YYYY') as seit,
              (select array_agg(m2.slug order by m2.sortierung)
                 from kunde k2 join mandant m2 on m2.id = k2.mandant_id
                where k.firma_id is not null and k2.firma_id = k.firma_id
                  and k2.id <> k.id and k2.archiviert_am is null) as weitere_bereiche
         from kunde k
         join mandant m on m.id = k.mandant_id
        where k.archiviert_am is null and k.mandant_id = any($1::uuid[])
        order by k.name, m.sortierung
        limit 500`,
      [mandantIdsFuer(kontext, aktiv)],
    );
    return { bereiche, aktiv, zeilen };
  });

  return (
    <GruppenRahmen zugang={tor.zugang} titel="Kunden" aktiverTab="uebersicht">
      <h1 className="mb-s5 text-h1 text-text">Kunden</h1>
      <BereichFilter bereiche={bereiche} aktiv={aktiv} basis="/portal/gruppe/kunden" />
      {zeilen.length === 0 ? (
        <LeereListe text="Kein Kunde in dieser Auswahl." />
      ) : (
        <DataTable
          beschriftung="Kunden über alle Gesellschaften"
          zeilen={zeilen}
          schluessel={(z) => z.id}
          spalten={[
            { schluessel: 'bereich', kopf: 'Gesellschaft',
              zelle: (z) => <BereichMarke slug={z.slug} name={z.bereich_name} /> },
            { schluessel: 'name', kopf: 'Kunde',
              zelle: (z) => (
                <Link href={`/portal/${z.slug}/crm/kunden/${z.id}`}
                      className="text-text underline-offset-2 hover:text-brand hover:underline">
                  {z.name}
                </Link>
              ) },
            { schluessel: 'nummer', kopf: 'Kundennummer', zelle: (z) => z.kundennummer },
            { schluessel: 'ort', kopf: 'Ort', zelle: (z) => z.ort ?? '—' },
            { schluessel: 'auftraege', kopf: 'Aufträge aktiv', numerisch: true,
              zelle: (z) => z.auftraege_aktiv },
            { schluessel: 'weitere', kopf: 'Auch in',
              zelle: (z) => (z.weitere_bereiche === null || z.weitere_bereiche.length === 0
                ? <span className="text-text-subtle">—</span>
                : z.weitere_bereiche.join(', ')) },
            { schluessel: 'seit', kopf: 'Kunde seit', zelle: (z) => z.seit },
            { schluessel: 'status', kopf: 'Status',
              zelle: (z) => <StatusPill zustand={PILLE[z.status] ?? 'Aktiv'} /> },
          ]}
        />
      )}
      <GruppenHinweis text="Jede Gesellschaft führt ihre eigenen Kundennummern und Debitoren (TEN-02). Kundendaten werden im Bereich gepflegt." />
    </GruppenRahmen>
  );
}
