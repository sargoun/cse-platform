import Link from 'next/link';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { Listenfilter } from '@/components/portal/Listenfilter';
import { cent, formatiereGeld } from '@/server/services/finanz/geld';
import { angebotFilterAus, angebotStaende } from '@/server/services/bericht/mengen';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { KENNZAHL_TEXTE } from '@/lib/i18n/verwaltung/kennzahlen';
import {
  bereichAus, BereichFilter, BereichMarke, GruppenAntwort, GruppenHinweis, GruppenRahmen,
  gruppenLesen, gruppenTor, ladeBereiche, LeereListe, mandantIdsFuer, type Suchparameter,
} from '../tor';

/**
 * `/portal/gruppe/angebote` — Angebote über alle Bereiche, LESEND
 * (OPS-08, DSH-01, DSH-04, Invariante 10, V-149, D-643).
 *
 * **Der Befund.** Die Gruppenübersicht zeigte „Angebote offen" als nackte
 * Zahl — jede andere Zelle der Zeile führte auf ihre Gruppenliste, diese auf
 * nichts, weil es die Liste nicht gab. DSH-04: keine toten Zahlen.
 *
 * Die Zelle führt mit `?status=offen` hierher, und die Seite zeigt dieselbe
 * Menge (`ANGEBOT_OFFEN`, `mengen.ts`); ohne Filter alle nicht archivierten.
 * Gelesen wird über `t_gruppe` auf `angebot` (0024) — `gruppe.angebot.lesen`
 * je Bereich. Gehandelt wird im Bereich, nach dem Wechselblatt.
 */
export const dynamic = 'force-dynamic';

const PILLE: Readonly<Record<string, PillZustand>> = {
  entwurf: 'Entwurf', in_pruefung: 'In Prüfung', versendet: 'Angebot', angenommen: 'Aktiv',
  abgelehnt: 'Abgelehnt', zurueckgezogen: 'Archiviert', abgelaufen: 'Überfällig',
};

interface Zeile {
  readonly id: string;
  readonly slug: string;
  readonly bereich_name: string;
  readonly angebotsnummer: string | null;
  readonly titel: string;
  readonly kunde: string | null;
  readonly status: string;
  readonly netto_cent: string;
  readonly gueltig_bis: string | null;
}

export default async function GruppenAngebote({ searchParams }: { searchParams: Suchparameter }) {
  const tor = await gruppenTor('/portal/gruppe/angebote');
  if (tor.art !== 'ok') return <GruppenAntwort tor={tor} />;
  const t = nachSprache(KENNZAHL_TEXTE, tor.zugang.sprache);
  const suche = await searchParams;
  const filter = angebotFilterAus(suche['status']);

  const { bereiche, aktiv, zeilen } = await gruppenLesen(tor.zugang, async (kontext) => {
    const bereiche = await ladeBereiche(kontext);
    const aktiv = await bereichAus(Promise.resolve(suche), bereiche);
    const zeilen = await kontext.abfrage<Zeile>(
      `select a.id, m.slug, m.name as bereich_name, a.angebotsnummer, a.titel,
              k.name as kunde, a.status::text as status, a.netto_cent::text as netto_cent,
              to_char(a.gueltig_bis, 'DD.MM.YYYY') as gueltig_bis
         from angebot a
         join mandant m on m.id = a.mandant_id
         left join kunde k on k.id = a.kunde_id
        where a.archiviert_am is null and a.mandant_id = any($1::uuid[])
          and ($2::text[] is null or a.status::text = any($2::text[]))
        order by a.erstellt_am desc, m.sortierung
        limit 500`,
      [mandantIdsFuer(kontext, aktiv), angebotStaende(filter)],
    );
    return { bereiche, aktiv, zeilen };
  });

  const basis = filter === null ? '/portal/gruppe/angebote' : `/portal/gruppe/angebote?status=${filter}`;
  return (
    <GruppenRahmen zugang={tor.zugang} titel={t.angeboteTitel} aktiverTab="uebersicht">
      <h1 className="mb-s5 text-h1 text-text">{t.angeboteTitel}</h1>
      <BereichFilter bereiche={bereiche} aktiv={aktiv} basis={basis} />
      {filter === null ? null : (
        <Listenfilter sprache={tor.zugang.sprache}
                      beschreibung={filter === 'offen'
                        ? t.angebotOffen : t.angebotStatus[filter] ?? t.keinTreffer}
                      alleZiel={aktiv === null
                        ? '/portal/gruppe/angebote'
                        : `/portal/gruppe/angebote?bereich=${aktiv.slug}`} />
      )}
      {zeilen.length === 0 ? (
        <LeereListe text={t.angeboteLeer} />
      ) : (
        <DataTable
          beschriftung={t.angeboteBeschriftung}
          zeilen={zeilen}
          schluessel={(z) => z.id}
          spalten={[
            { schluessel: 'bereich', kopf: t.spalteGesellschaft,
              zelle: (z) => <BereichMarke slug={z.slug} name={z.bereich_name} /> },
            { schluessel: 'titel', kopf: t.spalteAngebot,
              zelle: (z) => (
                <Link href={`/portal/${z.slug}/angebote/${z.id}`}
                      className="text-text underline-offset-2 hover:text-brand hover:underline">
                  {z.titel}
                </Link>
              ) },
            { schluessel: 'nummer', kopf: t.spalteNummer, zelle: (z) => z.angebotsnummer ?? '—' },
            { schluessel: 'kunde', kopf: t.spalteKunde, zelle: (z) => z.kunde ?? '—' },
            { schluessel: 'wert', kopf: t.spalteWert, numerisch: true,
              zelle: (z) => formatiereGeld(cent(BigInt(z.netto_cent))) },
            { schluessel: 'gueltig', kopf: t.spalteGueltigBis, zelle: (z) => z.gueltig_bis ?? '—' },
            { schluessel: 'status', kopf: t.spalteStatus,
              zelle: (z) => (
                <StatusPill zustand={PILLE[z.status] ?? 'Entwurf'} sprache={tor.zugang.sprache} />
              ) },
          ]}
        />
      )}
      <GruppenHinweis text={t.angeboteHinweis} />
    </GruppenRahmen>
  );
}
