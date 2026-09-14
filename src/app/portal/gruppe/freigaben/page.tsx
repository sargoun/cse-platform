import Link from 'next/link';
import { DataTable } from '@/components/ui/DataTable';
import { formatiereGeld } from '@/server/services/finanz/geld';
import { ladePosteingang } from '@/server/services/freigabe/laden';
import { RISIKO_LABEL, VORGANG_LABEL, zeitpunkt } from '../../[mandant]/freigaben/darstellung';
import {
  bereichAus, BereichFilter, BereichMarke, GruppenAntwort, GruppenHinweis, GruppenRahmen,
  gruppenLesen, gruppenTor, ladeBereiche, LeereListe, type Suchparameter,
} from '../tor';

/**
 * `/portal/gruppe/freigaben` — wartende Vorschlaege ueber alle Bereiche
 * (APR-01, Invariante 10). Jede Zeile fuehrt in ihren Bereich; entschieden
 * wird dort, nach dem Wechsel — hier gibt es keinen Knopf dafuer.
 */
export const dynamic = 'force-dynamic';

const DRINGLICH = 'text-danger';

export default async function GruppenFreigaben({ searchParams }: { searchParams: Suchparameter }) {
  const tor = await gruppenTor('/portal/gruppe/freigaben');
  if (tor.art !== 'ok') return <GruppenAntwort tor={tor} />;

  const { bereiche, aktiv, zeilen } = await gruppenLesen(tor.zugang, async (kontext) => {
    const bereiche = await ladeBereiche(kontext);
    const aktiv = await bereichAus(searchParams, bereiche);
    const alle = await ladePosteingang(kontext, new Date());
    return {
      bereiche, aktiv,
      zeilen: aktiv === null ? alle : alle.filter((z) => z.mandantId === aktiv.id),
    };
  });

  return (
    <GruppenRahmen zugang={tor.zugang} titel="Freigaben" aktiverTab="uebersicht">
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Wartende Freigaben</h1>
        <span data-cse="posteingang-zaehler" data-anzahl={zeilen.length}
              className="text-sm text-text-muted">
          {String(zeilen.length)} wartend
        </span>
      </div>
      <BereichFilter bereiche={bereiche} aktiv={aktiv} basis="/portal/gruppe/freigaben" />
      {zeilen.length === 0 ? (
        <LeereListe text="Nichts wartet auf eine Entscheidung." />
      ) : (
        <DataTable
          beschriftung="Wartende Freigaben über alle Gesellschaften"
          zeilen={zeilen}
          schluessel={(z) => z.id}
          spalten={[
            { schluessel: 'bereich', kopf: 'Gesellschaft',
              zelle: (z) => <BereichMarke slug={z.mandantSlug} name={z.mandantName} /> },
            { schluessel: 'frist', kopf: 'Frist',
              zelle: (z) => (
                <span className={z.dringlichkeit >= 4 ? DRINGLICH : ''}>
                  {z.dringlichkeitText}{z.frist === null ? '' : ` · ${zeitpunkt(z.frist)}`}
                </span>
              ) },
            { schluessel: 'vorgang', kopf: 'Vorgang',
              zelle: (z) => (
                <Link href={`/portal/${z.mandantSlug}/freigaben/${z.id}`}
                      className="text-text underline-offset-2 hover:text-brand hover:underline">
                  {z.titel}
                </Link>
              ) },
            { schluessel: 'art', kopf: 'Art', zelle: (z) => VORGANG_LABEL[z.vorgangTyp] },
            { schluessel: 'risiko', kopf: 'Risiko', zelle: (z) => RISIKO_LABEL[z.risiko] },
            { schluessel: 'betrag', kopf: 'Betrag', numerisch: true,
              zelle: (z) => (z.betragCent === null ? '—' : formatiereGeld(z.betragCent)) },
            { schluessel: 'pruefung', kopf: 'Prüfung',
              zelle: (z) => (z.unsichereFelder > 0
                ? <span className="text-warning">{String(z.unsichereFelder)} unsichere Felder</span>
                : 'alle Felder sicher') },
          ]}
        />
      )}
      <GruppenHinweis text="Entschieden wird im Bereich: der Verweis öffnet die Prüfung nach dem Wechsel dorthin. Die Gruppenansicht kennt keinen Freigabeknopf (Invariante 10)." />
    </GruppenRahmen>
  );
}
