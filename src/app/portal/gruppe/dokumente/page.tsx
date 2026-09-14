import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import {
  bereichAus, BereichFilter, BereichMarke, GruppenAntwort, GruppenHinweis, GruppenRahmen,
  gruppenLesen, gruppenTor, ladeBereiche, LeereListe, mandantIdsFuer, type Suchparameter,
} from '../tor';

/**
 * `/portal/gruppe/dokumente` — Suche ueber die Dokumente aller Gesellschaften
 * (DOC-02, DOC-03, DOC-04), lesend.
 *
 * Nur Metadaten: Titel, Kategorie, Bezug, Groesse, Datum. Die Datei selbst
 * liegt in einem privaten Bucket und wird nur ueber eine signierte, auf den
 * Bereich zugeschnittene Adresse ausgegeben (DOC-03) — die es in der
 * Gruppenansicht nicht gibt. Der Weg zur Datei fuehrt ueber den Bereich.
 */
export const dynamic = 'force-dynamic';

const KATEGORIE: Readonly<Record<string, string>> = {
  kunde: 'Kunde', vertrag: 'Vertrag', angebot: 'Angebot', rechnung: 'Rechnung', beleg: 'Beleg',
  mitarbeiter: 'Mitarbeiter', projekt: 'Projekt', buchhaltung: 'Buchhaltung', unternehmen: 'Unternehmen',
};

interface Zeile {
  readonly id: string;
  readonly slug: string;
  readonly bereich_name: string;
  readonly titel: string;
  readonly kategorie: string;
  readonly kunde: string | null;
  readonly objekt: string | null;
  readonly groesse: string | null;
  readonly erstellt: string;
}

/** Bytes lesbar — Anzeige, keine Rechnung mit Bedeutung. */
function groesse(bytes: string | null): string {
  if (bytes === null) return '—';
  const b = Number(bytes);
  if (!Number.isFinite(b)) return '—';
  if (b < 1024) return `${String(b)} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

/** `%`, `_` und `\` sind in ILIKE Muster — als Zeichen gemeint, also maskiert. */
function ilikeMuster(q: string): string {
  return `%${q.replace(/[\\%_]/gu, (z) => `\\${z}`)}%`;
}

export default async function GruppenDokumente({ searchParams }: { searchParams: Suchparameter }) {
  const tor = await gruppenTor('/portal/gruppe/dokumente');
  if (tor.art !== 'ok') return <GruppenAntwort tor={tor} />;

  const rohQ = (await searchParams)['q'];
  const q = typeof rohQ === 'string' ? rohQ.trim().slice(0, 100) : '';

  const { bereiche, aktiv, zeilen } = await gruppenLesen(tor.zugang, async (kontext) => {
    const bereiche = await ladeBereiche(kontext);
    const aktiv = await bereichAus(searchParams, bereiche);
    const zeilen = await kontext.abfrage<Zeile>(
      `select d.id, m.slug, m.name as bereich_name, d.titel, d.kategorie::text as kategorie,
              k.name as kunde, o.bezeichnung as objekt, d.groesse_bytes::text as groesse,
              to_char(d.erstellt_am at time zone 'Europe/Berlin', 'DD.MM.YYYY') as erstellt
         from dokument d
         join mandant m on m.id = d.mandant_id
         left join kunde k on k.id = d.kunde_id
         left join objekt o on o.id = d.objekt_id
        where d.geloescht_am is null and d.mandant_id = any($1::uuid[])
          and ($2::text = '' or d.titel ilike $3
               or exists (select 1 from unnest(d.tags) as t(tag) where t.tag ilike $3))
        order by d.erstellt_am desc
        limit 300`,
      [mandantIdsFuer(kontext, aktiv), q, ilikeMuster(q)],
    );
    return { bereiche, aktiv, zeilen };
  });

  return (
    <GruppenRahmen zugang={tor.zugang} titel="Dokumente" aktiverTab="uebersicht">
      <h1 className="mb-s5 text-h1 text-text">Dokumente</h1>
      <BereichFilter bereiche={bereiche} aktiv={aktiv} basis="/portal/gruppe/dokumente" />
      {/* GET, kein Zustand: die Suche ist Teil der Adresse und aendert nichts. */}
      <form method="get" action="/portal/gruppe/dokumente" data-cse="dokumente-suche"
            className="mb-s5 flex flex-wrap items-center gap-s3">
        {aktiv === null ? null : <input type="hidden" name="bereich" value={aktiv.slug} />}
        <label htmlFor="q" className="text-sm text-text-muted">Suche in Titel und Schlagworten</label>
        <input id="q" name="q" type="search" defaultValue={q} maxLength={100}
               className="min-h-11 min-w-[16rem] rounded-md border border-line bg-surface px-s3 text-sm text-text" />
        <Button type="submit" variante="secondary">Suchen</Button>
      </form>
      {zeilen.length === 0 ? (
        <LeereListe text={q === '' ? 'Kein Dokument in dieser Auswahl.' : `Nichts gefunden zu „${q}“.`} />
      ) : (
        <DataTable
          beschriftung="Dokumente über alle Gesellschaften"
          zeilen={zeilen}
          schluessel={(z) => z.id}
          spalten={[
            { schluessel: 'bereich', kopf: 'Gesellschaft',
              zelle: (z) => <BereichMarke slug={z.slug} name={z.bereich_name} /> },
            { schluessel: 'titel', kopf: 'Titel', zelle: (z) => z.titel },
            { schluessel: 'kategorie', kopf: 'Kategorie', zelle: (z) => KATEGORIE[z.kategorie] ?? z.kategorie },
            { schluessel: 'bezug', kopf: 'Bezug', zelle: (z) => z.kunde ?? z.objekt ?? '—' },
            { schluessel: 'groesse', kopf: 'Größe', numerisch: true, zelle: (z) => groesse(z.groesse) },
            { schluessel: 'erstellt', kopf: 'Abgelegt', zelle: (z) => z.erstellt },
          ]}
        />
      )}
      <GruppenHinweis text="Die Datei selbst wird nur im Bereich ausgegeben — über eine signierte, kurzlebige Adresse, die auf diese Gesellschaft zugeschnitten ist (DOC-03)." />
    </GruppenRahmen>
  );
}
