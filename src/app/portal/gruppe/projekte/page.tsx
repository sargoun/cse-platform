import Link from 'next/link';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { Listenfilter } from '@/components/portal/Listenfilter';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { KENNZAHL_TEXTE } from '@/lib/i18n/verwaltung/kennzahlen';
import { projektStatusAus } from '@/server/services/bericht/mengen';
import {
  bereichAus, BereichFilter, BereichMarke, GruppenAntwort, GruppenHinweis, GruppenRahmen,
  gruppenLesen, gruppenTor, ladeBereiche, LeereListe, mandantIdsFuer, type Suchparameter,
} from '../tor';

/**
 * `/portal/gruppe/projekte` — Bauprojekte ueber alle Bereiche (OPS-05, REP-05).
 *
 * Ohne Auftragssumme: `projekt` gibt `cse_app` nur Spaltenrechte, und die
 * Geldspalten gehoeren nicht dazu (0137-Muster) — die Summe eines Projekts
 * liest der Bereich ueber seinen eigenen Weg. Eine Gruppenliste, die sie
 * trotzdem selektierte, antwortete mit 500 statt mit einer Zahl.
 */
export const dynamic = 'force-dynamic';

const PILLE: Readonly<Record<string, PillZustand>> = {
  geplant: 'Geplant', in_arbeit: 'In Arbeit', abgenommen: 'Bereit',
  abgeschlossen: 'Abgeschlossen', archiviert: 'Archiviert',
};
const ART: Readonly<Record<string, string>> = { hochbau: 'Hochbau', ausbau: 'Ausbau', rueckbau: 'Rückbau' };

interface Zeile {
  readonly id: string;
  readonly slug: string;
  readonly bereich_name: string;
  readonly nummer: string;
  readonly bezeichnung: string;
  readonly kunde: string | null;
  readonly art: string;
  readonly status: string;
  readonly soll_ende: string | null;
}

export default async function GruppenProjekte({ searchParams }: { searchParams: Suchparameter }) {
  const tor = await gruppenTor('/portal/gruppe/projekte');
  if (tor.art !== 'ok') return <GruppenAntwort tor={tor} />;

  /*
   * **Der Stand aus der Gruppenübersicht** (V-150, DSH-04): die Spalte
   * „Bauprojekte in Arbeit" führt mit `?status=in_arbeit` hierher. Ohne den
   * Filter zeigte die Liste alle Stände, und die Zahl stand hier nirgends.
   */
  const status = projektStatusAus((await searchParams)['status']);
  const tk = nachSprache(KENNZAHL_TEXTE, tor.zugang.sprache);

  const { bereiche, aktiv, zeilen } = await gruppenLesen(tor.zugang, async (kontext) => {
    const bereiche = await ladeBereiche(kontext);
    const aktiv = await bereichAus(searchParams, bereiche);
    const zeilen = await kontext.abfrage<Zeile>(
      `select p.id, m.slug, m.name as bereich_name, p.nummer, p.bezeichnung, k.name as kunde,
              p.art::text as art, p.status::text as status,
              to_char(p.soll_ende, 'DD.MM.YYYY') as soll_ende
         from projekt p
         join mandant m on m.id = p.mandant_id
         left join kunde k on k.id = p.kunde_id
        where p.archiviert_am is null and p.mandant_id = any($1::uuid[])
          and ($2::text is null or p.status::text = $2)
        order by p.soll_ende nulls last, m.sortierung, p.nummer
        limit 500`,
      [mandantIdsFuer(kontext, aktiv), status],
    );
    return { bereiche, aktiv, zeilen };
  });

  return (
    <GruppenRahmen zugang={tor.zugang} titel="Projekte" aktiverTab="uebersicht">
      <h1 className="mb-s5 text-h1 text-text">Projekte</h1>
      <BereichFilter bereiche={bereiche} aktiv={aktiv}
                     basis={status === null
                       ? '/portal/gruppe/projekte' : `/portal/gruppe/projekte?status=${status}`} />
      {status === null ? null : (
        <Listenfilter sprache={tor.zugang.sprache}
                      beschreibung={tk.projektStatus[status] ?? tk.keinTreffer}
                      alleZiel={aktiv === null
                        ? '/portal/gruppe/projekte' : `/portal/gruppe/projekte?bereich=${aktiv.slug}`} />
      )}
      {zeilen.length === 0 ? (
        <LeereListe text="Kein Projekt in dieser Auswahl." />
      ) : (
        <DataTable
          beschriftung="Projekte über alle Gesellschaften"
          zeilen={zeilen}
          schluessel={(z) => z.id}
          spalten={[
            { schluessel: 'bereich', kopf: 'Gesellschaft',
              zelle: (z) => <BereichMarke slug={z.slug} name={z.bereich_name} /> },
            { schluessel: 'bezeichnung', kopf: 'Projekt',
              zelle: (z) => (
                <Link href={`/portal/${z.slug}/bau/projekte/${z.id}`}
                      className="text-text underline-offset-2 hover:text-brand hover:underline">
                  {z.bezeichnung}
                </Link>
              ) },
            { schluessel: 'nummer', kopf: 'Nummer', zelle: (z) => z.nummer },
            { schluessel: 'kunde', kopf: 'Kunde', zelle: (z) => z.kunde ?? '—' },
            { schluessel: 'art', kopf: 'Art', zelle: (z) => ART[z.art] ?? z.art },
            { schluessel: 'ende', kopf: 'Soll-Ende', zelle: (z) => z.soll_ende ?? '—' },
            { schluessel: 'status', kopf: 'Status',
              zelle: (z) => <StatusPill zustand={PILLE[z.status] ?? 'Geplant'} /> },
          ]}
        />
      )}
      <GruppenHinweis text="Aufmaß, Bautagebuch und Nachträge liegen im Bereich — hier steht, welches Projekt wo steht." />
    </GruppenRahmen>
  );
}
