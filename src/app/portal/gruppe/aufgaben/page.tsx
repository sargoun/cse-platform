import Link from 'next/link';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { gruppenAufgaben } from '@/server/services/gruppe/aufgaben';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { KENNZAHL_TEXTE } from '@/lib/i18n/verwaltung/kennzahlen';
import {
  bereichAus, BereichFilter, BereichMarke, GruppenAntwort, GruppenHinweis, GruppenRahmen,
  gruppenLesen, gruppenTor, ladeBereiche, LeereListe, mandantIdsFuer, type Suchparameter,
} from '../tor';

/**
 * `/portal/gruppe/aufgaben` — offene Aufgaben über alle Bereiche, LESEND
 * (OPS-11, DSH-01, DSH-04, Invariante 10, V-150, D-644).
 *
 * **Der Befund.** Die Gruppenübersicht zeigte keine anstehenden Aufgaben,
 * obwohl `aufgabe` einen Gruppenleseweg hat (`t_aufgabe_gruppe`, 0230) und
 * das Recht `gruppe.aufgabe.lesen` seit 0008 besteht. Eine Spalte allein wäre
 * eine tote Zahl gewesen — es gab keine Gruppenliste dahinter.
 *
 * Die Zelle „Offene Aufgaben" führt mit `?bereich=` hierher; die Seite zeigt
 * dieselbe Menge (`gruppenAufgaben`, `OFFENE_ZUSTAENDE`). Bearbeitet wird im
 * Bereich, nach dem Wechselblatt.
 */
export const dynamic = 'force-dynamic';

const PILLE: Readonly<Record<string, PillZustand>> = {
  offen: 'Offen', in_arbeit: 'In Arbeit', wartend: 'Wartet',
};

export default async function GruppenAufgabenSeite({ searchParams }: { searchParams: Suchparameter }) {
  const tor = await gruppenTor('/portal/gruppe/aufgaben');
  if (tor.art !== 'ok') return <GruppenAntwort tor={tor} />;
  const t = nachSprache(KENNZAHL_TEXTE, tor.zugang.sprache);

  const { bereiche, aktiv, zeilen } = await gruppenLesen(tor.zugang, async (kontext) => {
    const bereiche = await ladeBereiche(kontext);
    const aktiv = await bereichAus(searchParams, bereiche);
    return {
      bereiche,
      aktiv,
      zeilen: await gruppenAufgaben(kontext, mandantIdsFuer(kontext, aktiv)),
    };
  });

  return (
    <GruppenRahmen zugang={tor.zugang} titel={t.aufgabenTitel} aktiverTab="uebersicht">
      <h1 className="mb-s3 text-h1 text-text">{t.aufgabenTitel}</h1>
      <p className="mb-s5 max-w-prose text-sm text-text-muted">{t.aufgabenErklaerung}</p>
      <BereichFilter bereiche={bereiche} aktiv={aktiv} basis="/portal/gruppe/aufgaben" />
      {zeilen.length === 0 ? (
        <LeereListe text={t.aufgabenLeer} />
      ) : (
        <DataTable
          beschriftung={t.aufgabenBeschriftung}
          zeilen={zeilen}
          schluessel={(z) => z.id}
          spalten={[
            { schluessel: 'bereich', kopf: t.spalteGesellschaft,
              zelle: (z) => <BereichMarke slug={z.slug} name={z.bereichName} /> },
            { schluessel: 'titel', kopf: t.spalteAufgabe,
              zelle: (z) => (
                <Link href={`/portal/${z.slug}/aufgaben/${z.id}`}
                      className="text-text underline-offset-2 hover:text-brand hover:underline">
                  {z.titel}
                </Link>
              ) },
            { schluessel: 'faellig', kopf: t.spalteFaellig, zelle: (z) => z.faellig ?? '—' },
            { schluessel: 'status', kopf: t.spalteStatus,
              zelle: (z) => (
                <StatusPill zustand={PILLE[z.status] ?? 'Offen'} sprache={tor.zugang.sprache} />
              ) },
          ]}
        />
      )}
      <GruppenHinweis text={t.aufgabenHinweis} />
    </GruppenRahmen>
  );
}
