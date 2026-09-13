import Link from 'next/link';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { cent, formatiereGeld } from '@/server/services/finanz/geld';
import {
  bereichAus, BereichFilter, BereichMarke, GruppenAntwort, GruppenHinweis, GruppenRahmen,
  gruppenLesen, gruppenTor, ladeBereiche, LeereListe, mandantIdsFuer, type Suchparameter,
} from '../tor';

/**
 * `/portal/gruppe/rechnungen` — Rechnungen ueber alle Gesellschaften, jede in
 * ihrem eigenen Nummernkreis (TEN-02, FIN-16). Lesend: festschreiben,
 * stornieren und anlegen geschieht im Bereich (Invariante 4).
 */
export const dynamic = 'force-dynamic';

const PILLE: Readonly<Record<string, PillZustand>> = {
  entwurf: 'Entwurf',
  // „Abgeschlossen" und nicht „Festgeschrieben": das Wort fehlt DESIGN §5.
  festgeschrieben: 'Abgeschlossen',
  verworfen: 'Archiviert',
};

interface Zeile {
  readonly id: string;
  readonly slug: string;
  readonly bereich_name: string;
  readonly nummer: string | null;
  readonly status: string;
  readonly kunde: string | null;
  readonly datum: string | null;
  readonly netto: string;
  readonly brutto: string;
  readonly faellig: string | null;
}

export default async function GruppenRechnungen({ searchParams }: { searchParams: Suchparameter }) {
  const tor = await gruppenTor('/portal/gruppe/rechnungen');
  if (tor.art !== 'ok') return <GruppenAntwort tor={tor} />;

  const { bereiche, aktiv, zeilen } = await gruppenLesen(tor.zugang, async (kontext) => {
    const bereiche = await ladeBereiche(kontext);
    const aktiv = await bereichAus(searchParams, bereiche);
    const zeilen = await kontext.abfrage<Zeile>(
      `select r.id, m.slug, m.name as bereich_name, r.nummer, r.status::text as status,
              k.name as kunde, to_char(r.rechnungsdatum, 'DD.MM.YYYY') as datum,
              r.netto_gesamt_cent::text as netto, r.brutto_cent::text as brutto,
              to_char(r.faellig_am, 'DD.MM.YYYY') as faellig
         from rechnung r
         join mandant m on m.id = r.mandant_id
         left join kunde k on k.id = r.kunde_id
        where r.mandant_id = any($1::uuid[])
        order by r.rechnungsdatum desc, m.sortierung, r.nummer_laufend desc nulls last
        limit 500`,
      [mandantIdsFuer(kontext, aktiv)],
    );
    return { bereiche, aktiv, zeilen };
  });

  return (
    <GruppenRahmen zugang={tor.zugang} titel="Rechnungen" aktiverTab="finanzen">
      <h1 className="mb-s5 text-h1 text-text">Rechnungen</h1>
      <BereichFilter bereiche={bereiche} aktiv={aktiv} basis="/portal/gruppe/rechnungen" />
      {zeilen.length === 0 ? (
        <LeereListe text="Keine Rechnung in dieser Auswahl." />
      ) : (
        <DataTable
          beschriftung="Rechnungen über alle Gesellschaften"
          zeilen={zeilen}
          schluessel={(z) => z.id}
          spalten={[
            { schluessel: 'bereich', kopf: 'Gesellschaft',
              zelle: (z) => <BereichMarke slug={z.slug} name={z.bereich_name} /> },
            { schluessel: 'nummer', kopf: 'Nummer',
              zelle: (z) => (
                <Link href={`/portal/${z.slug}/finanzen/rechnungen/${z.id}`}
                      className="text-text underline-offset-2 hover:text-brand hover:underline">
                  {z.nummer ?? 'Entwurf'}
                </Link>
              ) },
            { schluessel: 'kunde', kopf: 'Kunde', zelle: (z) => z.kunde ?? '—' },
            { schluessel: 'datum', kopf: 'Datum', zelle: (z) => z.datum ?? '—' },
            { schluessel: 'netto', kopf: 'Netto', numerisch: true,
              zelle: (z) => formatiereGeld(cent(BigInt(z.netto))) },
            { schluessel: 'brutto', kopf: 'Brutto', numerisch: true,
              zelle: (z) => formatiereGeld(cent(BigInt(z.brutto))) },
            { schluessel: 'faellig', kopf: 'Fällig', zelle: (z) => z.faellig ?? '—' },
            { schluessel: 'status', kopf: 'Status',
              zelle: (z) => <StatusPill zustand={PILLE[z.status] ?? 'Entwurf'} /> },
          ]}
        />
      )}
      <GruppenHinweis text="Ein Entwurf trägt keine Nummer; sie entsteht erst beim Festschreiben, je Gesellschaft lückenlos in ihrem eigenen Kreis (Invariante 4)." />
    </GruppenRahmen>
  );
}
