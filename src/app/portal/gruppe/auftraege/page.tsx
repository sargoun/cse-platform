import Link from 'next/link';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { cent, formatiereGeld } from '@/server/services/finanz/geld';
import { Listenfilter } from '@/components/portal/Listenfilter';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { KENNZAHL_TEXTE } from '@/lib/i18n/verwaltung/kennzahlen';
import { auftragStatusAus } from '@/server/services/bericht/mengen';
import { gruppenAuftraege } from '@/server/services/bericht/listen';
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

export default async function GruppenAuftraege({ searchParams }: { searchParams: Suchparameter }) {
  const tor = await gruppenTor('/portal/gruppe/auftraege');
  if (tor.art !== 'ok') return <GruppenAntwort tor={tor} />;

  /*
   * **Der Stand aus der Gruppenübersicht** (V-150, DSH-04): „Aufträge aktiv"
   * zählt `status = 'aktiv'` und führt mit `?status=aktiv` hierher. Ohne den
   * Filter zeigte die Liste alle nicht archivierten — eine andere Menge als
   * die Zahl davor.
   */
  const status = auftragStatusAus((await searchParams)['status']);
  const tk = nachSprache(KENNZAHL_TEXTE, tor.zugang.sprache);

  const { bereiche, aktiv, zeilen } = await gruppenLesen(tor.zugang, async (kontext) => {
    const bereiche = await ladeBereiche(kontext);
    const aktiv = await bereichAus(searchParams, bereiche);
    // Die Abfrage steht im Dienst (V-152) und wird dort gegen die Summe geprüft.
    const zeilen = await gruppenAuftraege(kontext, mandantIdsFuer(kontext, aktiv), status);
    return { bereiche, aktiv, zeilen };
  });

  return (
    <GruppenRahmen zugang={tor.zugang} titel="Aufträge" aktiverTab="auftraege">
      <h1 className="mb-s5 text-h1 text-text">Aufträge</h1>
      <BereichFilter bereiche={bereiche} aktiv={aktiv}
                     basis={status === null
                       ? '/portal/gruppe/auftraege' : `/portal/gruppe/auftraege?status=${status}`} />
      {status === null ? null : (
        <Listenfilter sprache={tor.zugang.sprache}
                      beschreibung={tk.auftragStatus[status] ?? tk.keinTreffer}
                      alleZiel={aktiv === null
                        ? '/portal/gruppe/auftraege' : `/portal/gruppe/auftraege?bereich=${aktiv.slug}`} />
      )}
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
