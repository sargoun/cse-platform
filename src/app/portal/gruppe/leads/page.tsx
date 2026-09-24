import Link from 'next/link';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { cent, formatiereGeld } from '@/server/services/finanz/geld';
import { Listenfilter } from '@/components/portal/Listenfilter';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { KENNZAHL_TEXTE } from '@/lib/i18n/verwaltung/kennzahlen';
import { leadFristAus, leadStatusAus } from '@/server/services/bericht/mengen';
import { gruppenLeads } from '@/server/services/bericht/listen';
import {
  bereichAus, BereichFilter, BereichMarke, GruppenAntwort, GruppenHinweis, GruppenRahmen,
  gruppenLesen, gruppenTor, ladeBereiche, LeereListe, mandantIdsFuer, type Suchparameter,
} from '../tor';

/**
 * `/portal/gruppe/leads` — die Pipeline ueber alle Bereiche (CRM-01, REP-02).
 *
 * **Mit dem Filter der Zahl, die hierher führt** (V-152, DSH-04): „Neue
 * Anfragen" der Gruppenübersicht zählt `status = 'neu'` und führt mit
 * `?status=neu&bereich=…` hierher, die Kachel „Frist überschritten" mit
 * `?frist=ueberschritten`. Ohne Filter zeigte die Liste alle nicht
 * archivierten Leads — eine andere Menge als die Zahl davor.
 */
export const dynamic = 'force-dynamic';

const PILLE: Readonly<Record<string, PillZustand>> = {
  neu: 'Offen', in_bearbeitung: 'In Arbeit', angebot: 'Angebot',
  gewonnen: 'Abgeschlossen', verloren: 'Abgelehnt', kein_bedarf: 'Archiviert',
};
const QUELLE: Readonly<Record<string, string>> = {
  webformular: 'Webformular', vergabe_radar: 'Vergaberadar', manuell: 'Manuell', empfehlung: 'Empfehlung',
};
const PRIORITAET: Readonly<Record<string, string>> = { niedrig: 'niedrig', normal: 'normal', hoch: 'hoch' };

export default async function GruppenLeads({ searchParams }: { searchParams: Suchparameter }) {
  const tor = await gruppenTor('/portal/gruppe/leads');
  if (tor.art !== 'ok') return <GruppenAntwort tor={tor} />;

  const suche = await searchParams;
  const filter = { status: leadStatusAus(suche['status']), frist: leadFristAus(suche['frist']) };
  const tk = nachSprache(KENNZAHL_TEXTE, tor.zugang.sprache);

  const { bereiche, aktiv, zeilen } = await gruppenLesen(tor.zugang, async (kontext) => {
    const bereiche = await ladeBereiche(kontext);
    const aktiv = await bereichAus(Promise.resolve(suche), bereiche);
    // Die Abfrage steht im Dienst (V-152) und wird dort gegen die Zelle geprüft.
    const zeilen = await gruppenLeads(kontext, mandantIdsFuer(kontext, aktiv), filter);
    return { bereiche, aktiv, zeilen };
  });

  /* Der Bereichsfilter behält den Standfilter, „Alle anzeigen" den Bereich. */
  const abfrage = [
    filter.status === null ? null : `status=${filter.status}`,
    filter.frist === null ? null : `frist=${filter.frist}`,
  ].filter((t): t is string => t !== null);
  const basis = abfrage.length === 0
    ? '/portal/gruppe/leads' : `/portal/gruppe/leads?${abfrage.join('&')}`;
  const filterSatz = [
    filter.status === null ? null : (tk.leadStatus[filter.status] ?? tk.keinTreffer),
    filter.frist === null ? null : tk.fristUeberschritten,
  ].filter((t): t is string => t !== null).join(' · ');

  return (
    <GruppenRahmen zugang={tor.zugang} titel="Anfragen" aktiverTab="uebersicht">
      <h1 className="mb-s5 text-h1 text-text">Anfragen und Pipeline</h1>
      <BereichFilter bereiche={bereiche} aktiv={aktiv} basis={basis} />
      {abfrage.length === 0 ? null : (
        <Listenfilter sprache={tor.zugang.sprache} beschreibung={filterSatz}
                      alleZiel={aktiv === null
                        ? '/portal/gruppe/leads' : `/portal/gruppe/leads?bereich=${aktiv.slug}`} />
      )}
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
