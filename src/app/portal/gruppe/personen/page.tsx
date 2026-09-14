import Link from 'next/link';
import { DataTable } from '@/components/ui/DataTable';
import {
  bereichAus, BereichFilter, BereichMarke, GruppenAntwort, GruppenHinweis, GruppenRahmen,
  gruppenLesen, gruppenTor, ladeBereiche, LeereListe, mandantIdsFuer, type Suchparameter,
} from '../tor';

/**
 * `/portal/gruppe/personen` — Menschen und ihre Beschaeftigungen je
 * Gesellschaft (D-09, EMP-14, SEC-02/03, LEG-04) — **nur Identitaet**.
 *
 * Keine Stundensaetze, keine Konten, keine Abwesenheiten: das ist die Sicht,
 * die zeigt, WER in WELCHEN Gesellschaften arbeitet — die Frage, die ein
 * Bereich fuer sich allein nicht beantworten kann. Nachweise erscheinen nur,
 * wo diese Sitzung `personal.nachweis_lesen` haelt (Policy `n_lesen`).
 */
export const dynamic = 'force-dynamic';

interface Zeile {
  readonly id: string;
  readonly vorname: string;
  readonly nachname: string;
  readonly bereiche: readonly string[];
  readonly namen: readonly string[];
  readonly anstellungen: number;
  readonly naechster_ablauf: string | null;
  readonly bald_ablaufend: number;
}

export default async function GruppenPersonen({ searchParams }: { searchParams: Suchparameter }) {
  const tor = await gruppenTor('/portal/gruppe/personen');
  if (tor.art !== 'ok') return <GruppenAntwort tor={tor} />;

  const { bereiche, aktiv, zeilen } = await gruppenLesen(tor.zugang, async (kontext) => {
    const bereiche = await ladeBereiche(kontext);
    const aktiv = await bereichAus(searchParams, bereiche);
    const zeilen = await kontext.abfrage<Zeile>(
      `select p.id, p.vorname, p.nachname,
              array_agg(distinct m.slug) as bereiche,
              array_agg(distinct m.name) as namen,
              count(a.id)::int as anstellungen,
              (select to_char(min(n.gueltig_bis), 'DD.MM.YYYY') from nachweis n
                where n.person_id = p.id and n.status = 'gueltig'
                  and n.gueltig_bis is not null and n.gueltig_bis >= current_date) as naechster_ablauf,
              (select count(*) from nachweis n
                where n.person_id = p.id and n.status = 'gueltig'
                  and n.gueltig_bis is not null
                  and n.gueltig_bis < current_date + 60)::int as bald_ablaufend
         from person p
         join anstellung a on a.person_id = p.id and a.geloescht_am is null
                          and (a.austritt is null or a.austritt >= current_date)
         join mandant m on m.id = a.mandant_id
        where p.geloescht_am is null and a.mandant_id = any($1::uuid[])
        group by p.id, p.vorname, p.nachname
        order by p.nachname, p.vorname
        limit 1000`,
      [mandantIdsFuer(kontext, aktiv)],
    );
    return { bereiche, aktiv, zeilen };
  });

  const mehrfach = zeilen.filter((z) => z.bereiche.length > 1).length;

  return (
    <GruppenRahmen zugang={tor.zugang} titel="Personen" aktiverTab="uebersicht">
      <h1 className="mb-s5 text-h1 text-text">Personen</h1>
      <BereichFilter bereiche={bereiche} aktiv={aktiv} basis="/portal/gruppe/personen" />
      {zeilen.length === 0 ? (
        <LeereListe text="Keine Person in dieser Auswahl." />
      ) : (
        <>
          <p data-cse="personen-zaehler" data-mehrfach={mehrfach}
             className="mb-s4 text-sm text-text-muted">
            {String(zeilen.length)} Personen, davon {String(mehrfach)} in mehr als einer
            Gesellschaft beschäftigt.
          </p>
          <DataTable
            beschriftung="Personen und ihre Beschäftigungen je Gesellschaft"
            zeilen={zeilen}
            schluessel={(z) => z.id}
            spalten={[
              { schluessel: 'name', kopf: 'Name',
                zelle: (z) => {
                  const erster = z.bereiche[0];
                  const name = `${z.nachname}, ${z.vorname}`;
                  return erster === undefined ? name : (
                    <Link href={`/portal/${erster}/personal/personen/${z.id}`}
                          className="text-text underline-offset-2 hover:text-brand hover:underline">
                      {name}
                    </Link>
                  );
                } },
              { schluessel: 'bereiche', kopf: 'Gesellschaften',
                zelle: (z) => (
                  <span className="flex flex-wrap gap-s3">
                    {z.bereiche.map((slug, i) => (
                      <BereichMarke key={slug} slug={slug} name={z.namen[i] ?? slug} />
                    ))}
                  </span>
                ) },
              { schluessel: 'anstellungen', kopf: 'Beschäftigungen', numerisch: true,
                zelle: (z) => z.anstellungen },
              { schluessel: 'nachweis', kopf: 'Nächster Nachweis-Ablauf',
                zelle: (z) => (z.naechster_ablauf === null
                  ? <span className="text-text-subtle">—</span>
                  : <span className={z.bald_ablaufend > 0 ? 'text-warning' : ''}>{z.naechster_ablauf}</span>) },
            ]}
          />
        </>
      )}
      <GruppenHinweis text="Nur Identität: Wer in welcher Gesellschaft beschäftigt ist. Verträge, Konten und Abwesenheiten liegen im Bereich; Arbeitszeitgrenzen gelten je Person über alle Gesellschaften (siehe Auslastung)." />
    </GruppenRahmen>
  );
}
