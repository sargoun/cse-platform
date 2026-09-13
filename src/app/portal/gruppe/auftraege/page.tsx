import Link from 'next/link';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { cent, formatiereGeld } from '@/server/services/finanz/geld';
import {
  bereichAus, BereichFilter, BereichMarke, GruppenAntwort, GruppenHinweis, GruppenRahmen,
  gruppenLesen, gruppenTor, ladeBereiche, LeereListe, mandantIdsFuer, type Suchparameter,
} from '../tor';

/** `/portal/gruppe/auftraege` — Auftraege ueber alle Bereiche, lesend (OPS-05, DSH-01). */
export const dynamic = 'force-dynamic';

const PILLE: Readonly<Record<string, PillZustand>> = {
  angelegt: 'Geplant', aktiv: 'In Arbeit', pausiert: 'Wartet',
  abgeschlossen: 'Abgeschlossen', storniert: 'Abgelehnt',
};
const ART: Readonly<Record<string, string>> = {
  einzelauftrag: 'Einzelauftrag', rahmenvertrag: 'Rahmenvertrag',
  dauerauftrag: 'Dauerauftrag', projekt: 'Projekt',
};

interface Zeile {
  readonly id: string;
  readonly slug: string;
  readonly bereich_name: string;
  readonly auftragsnummer: string;
  readonly bezeichnung: string;
  readonly kunde: string | null;
  readonly objekt: string | null;
  readonly art: string;
  readonly status: string;
  readonly wert: string | null;
  readonly start: string | null;
}

export default async function GruppenAuftraege({ searchParams }: { searchParams: Suchparameter }) {
  const tor = await gruppenTor('/portal/gruppe/auftraege');
  if (tor.art !== 'ok') return <GruppenAntwort tor={tor} />;

  const { bereiche, aktiv, zeilen } = await gruppenLesen(tor.zugang, async (kontext) => {
    const bereiche = await ladeBereiche(kontext);
    const aktiv = await bereichAus(searchParams, bereiche);
    const zeilen = await kontext.abfrage<Zeile>(
      `select a.id, m.slug, m.name as bereich_name, a.auftragsnummer, a.bezeichnung,
              k.name as kunde, o.bezeichnung as objekt, a.art::text as art, a.status::text as status,
              a.auftragswert_netto_cent::text as wert,
              to_char(a.start_datum, 'DD.MM.YYYY') as start
         from auftrag a
         join mandant m on m.id = a.mandant_id
         left join kunde k on k.id = a.kunde_id
         left join objekt o on o.id = a.objekt_id
        where a.archiviert_am is null and a.mandant_id = any($1::uuid[])
        order by a.start_datum desc nulls last, m.sortierung, a.auftragsnummer
        limit 500`,
      [mandantIdsFuer(kontext, aktiv)],
    );
    return { bereiche, aktiv, zeilen };
  });

  return (
    <GruppenRahmen zugang={tor.zugang} titel="Aufträge" aktiverTab="auftraege">
      <h1 className="mb-s5 text-h1 text-text">Aufträge</h1>
      <BereichFilter bereiche={bereiche} aktiv={aktiv} basis="/portal/gruppe/auftraege" />
      {zeilen.length === 0 ? (
        <LeereListe text="Kein Auftrag in dieser Auswahl." />
      ) : (
        <DataTable
          beschriftung="Aufträge über alle Gesellschaften"
          zeilen={zeilen}
          schluessel={(z) => z.id}
          spalten={[
            { schluessel: 'bereich', kopf: 'Gesellschaft',
              zelle: (z) => <BereichMarke slug={z.slug} name={z.bereich_name} /> },
            { schluessel: 'bezeichnung', kopf: 'Auftrag',
              zelle: (z) => (
                <Link href={`/portal/${z.slug}/auftraege/${z.id}`}
                      className="text-text underline-offset-2 hover:text-brand hover:underline">
                  {z.bezeichnung}
                </Link>
              ) },
            { schluessel: 'nummer', kopf: 'Nummer', zelle: (z) => z.auftragsnummer },
            { schluessel: 'kunde', kopf: 'Kunde', zelle: (z) => z.kunde ?? '—' },
            { schluessel: 'objekt', kopf: 'Objekt', zelle: (z) => z.objekt ?? '—' },
            { schluessel: 'art', kopf: 'Art', zelle: (z) => ART[z.art] ?? z.art },
            { schluessel: 'wert', kopf: 'Wert netto', numerisch: true,
              zelle: (z) => (z.wert === null
                ? <span className="text-text-subtle">offen</span>
                : formatiereGeld(cent(BigInt(z.wert)))) },
            { schluessel: 'start', kopf: 'Start', zelle: (z) => z.start ?? '—' },
            { schluessel: 'status', kopf: 'Status',
              zelle: (z) => <StatusPill zustand={PILLE[z.status] ?? 'Geplant'} /> },
          ]}
        />
      )}
      <GruppenHinweis text="Ein Kunde ohne Namen heißt: kein Leserecht auf die Kundendaten dieses Bereichs. Öffnen, ändern und anlegen geschieht im Bereich — der Verweis führt über das Wechselblatt dorthin." />
    </GruppenRahmen>
  );
}
