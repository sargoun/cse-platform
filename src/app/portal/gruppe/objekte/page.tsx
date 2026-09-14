import Link from 'next/link';
import { DataTable } from '@/components/ui/DataTable';
import {
  bereichAus, BereichFilter, BereichMarke, GruppenAntwort, GruppenHinweis, GruppenRahmen,
  gruppenLesen, gruppenTor, ladeBereiche, LeereListe, mandantIdsFuer, type Suchparameter,
} from '../tor';

/** `/portal/gruppe/objekte` — Objekte ueber alle Bereiche (OPS-01). */
export const dynamic = 'force-dynamic';

interface Zeile {
  readonly id: string;
  readonly slug: string;
  readonly bereich_name: string;
  readonly objektnummer: string;
  readonly bezeichnung: string;
  readonly gebaeudetyp: string | null;
  readonly strasse: string | null;
  readonly plz: string | null;
  readonly ort: string | null;
  readonly kunde: string | null;
}

export default async function GruppenObjekte({ searchParams }: { searchParams: Suchparameter }) {
  const tor = await gruppenTor('/portal/gruppe/objekte');
  if (tor.art !== 'ok') return <GruppenAntwort tor={tor} />;

  const { bereiche, aktiv, zeilen } = await gruppenLesen(tor.zugang, async (kontext) => {
    const bereiche = await ladeBereiche(kontext);
    const aktiv = await bereichAus(searchParams, bereiche);
    const zeilen = await kontext.abfrage<Zeile>(
      `select o.id, m.slug, m.name as bereich_name, o.objektnummer, o.bezeichnung, o.gebaeudetyp,
              nullif(concat_ws(' ', o.strasse, o.hausnummer), '') as strasse, o.plz, o.ort,
              k.name as kunde
         from objekt o
         join mandant m on m.id = o.mandant_id
         left join kunde k on k.id = o.kunde_id
        where o.archiviert_am is null and o.mandant_id = any($1::uuid[])
        order by o.ort, o.bezeichnung
        limit 500`,
      [mandantIdsFuer(kontext, aktiv)],
    );
    return { bereiche, aktiv, zeilen };
  });

  return (
    <GruppenRahmen zugang={tor.zugang} titel="Objekte" aktiverTab="uebersicht">
      <h1 className="mb-s5 text-h1 text-text">Objekte</h1>
      <BereichFilter bereiche={bereiche} aktiv={aktiv} basis="/portal/gruppe/objekte" />
      {zeilen.length === 0 ? (
        <LeereListe text="Kein Objekt in dieser Auswahl." />
      ) : (
        <DataTable
          beschriftung="Objekte über alle Gesellschaften"
          zeilen={zeilen}
          schluessel={(z) => z.id}
          spalten={[
            { schluessel: 'bereich', kopf: 'Gesellschaft',
              zelle: (z) => <BereichMarke slug={z.slug} name={z.bereich_name} /> },
            { schluessel: 'bezeichnung', kopf: 'Objekt',
              zelle: (z) => (
                <Link href={`/portal/${z.slug}/objekte/${z.id}`}
                      className="text-text underline-offset-2 hover:text-brand hover:underline">
                  {z.bezeichnung}
                </Link>
              ) },
            { schluessel: 'nummer', kopf: 'Nummer', zelle: (z) => z.objektnummer },
            { schluessel: 'adresse', kopf: 'Adresse',
              zelle: (z) => [z.strasse, [z.plz, z.ort].filter((t) => t !== null).join(' ')]
                .filter((t) => t !== null && t !== '').join(', ') || '—' },
            { schluessel: 'typ', kopf: 'Gebäudetyp', zelle: (z) => z.gebaeudetyp ?? '—' },
            { schluessel: 'kunde', kopf: 'Kunde', zelle: (z) => z.kunde ?? '—' },
          ]}
        />
      )}
      <GruppenHinweis text="Raumbuch, Reviere und Posten eines Objekts liegen im Bereich." />
    </GruppenRahmen>
  );
}
