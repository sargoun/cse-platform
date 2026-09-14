import Link from 'next/link';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { berlinKalendertag } from '@/server/services/zeit/dauer';
import { montag, tagePlus } from '@/lib/datum/kalendertag';
import { gruppenArbzgBefunde, type GruppenArbzgBefund } from '@/server/services/gruppe/auslastung';
import {
  bereichAus, BereichFilter, BereichMarke, GruppenAntwort, GruppenHinweis, GruppenRahmen,
  gruppenLesen, gruppenTor, ladeBereiche, LeereListe, mandantIdsFuer, type Suchparameter,
} from '../tor';

/**
 * `/portal/gruppe/dienstplan` — der zusammengefuehrte Dienstplan einer Woche,
 * lesend, und die ArbZG-Befunde ueber Gesellschaften hinweg an EINER Stelle
 * (TIM-01, TIM-04, TIM-14, LEG-03).
 *
 * Der zweite Teil ist der Grund fuer die Seite: ein Bereich sieht nur seine
 * Schichten. Dass dieselbe Person nachts fuer die Security und morgens fuer
 * die Reinigung eingeteilt ist, sieht erst die Gruppe — und das Gesetz zaehlt
 * je Person (D-09). Geprueft wird mit `pruefeArbzg`, derselben Funktion wie im
 * Bereich, ueber die Zeiteintraege aller Bereiche einer Person.
 */
export const dynamic = 'force-dynamic';

const PILLE: Readonly<Record<string, PillZustand>> = {
  geplant: 'Geplant', laufend: 'In Arbeit', abgeschlossen: 'Abgeschlossen', storniert: 'Archiviert',
};
const REGEL: Readonly<Record<string, string>> = {
  tagesarbeitszeit_ueber_8h: 'Tagesarbeitszeit über 8 h',
  tagesarbeitszeit_ueber_10h: 'Tagesarbeitszeit über 10 h',
  ruhezeit_unter_11h: 'Ruhezeit unter 11 h',
  pause_fehlt_ueber_6h: 'Pause fehlt (über 6 h)',
  pause_fehlt_ueber_9h: 'Pause fehlt (über 9 h)',
  ausgleichszeitraum_ueberschritten: 'Ausgleichszeitraum überschritten',
};
const SCHWERE: Readonly<Record<GruppenArbzgBefund['schwere'], PillZustand>> = {
  verstoss: 'Fehler', warnung: 'Überfällig', hinweis: 'Offen',
};

interface Einsatz {
  readonly id: string;
  readonly slug: string;
  readonly bereich_name: string;
  readonly datum: string;
  readonly von: string;
  readonly bis: string;
  readonly folgetag: boolean;
  readonly objekt: string | null;
  readonly soll: number | null;
  readonly besetzt: number | null;
  readonly status: string;
}

async function wocheAus(suchparameter: Suchparameter, heute: string): Promise<string> {
  const roh = (await suchparameter)['woche'];
  return typeof roh === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(roh) ? montag(roh) : montag(heute);
}

export default async function GruppenDienstplan({ searchParams }: { searchParams: Suchparameter }) {
  const tor = await gruppenTor('/portal/gruppe/dienstplan');
  if (tor.art !== 'ok') return <GruppenAntwort tor={tor} />;

  const heute = berlinKalendertag(new Date());
  const woche = await wocheAus(searchParams, heute);
  const sonntag = tagePlus(woche, 6);

  const { bereiche, aktiv, einsaetze, befunde } = await gruppenLesen(tor.zugang, async (kontext) => {
    const bereiche = await ladeBereiche(kontext);
    const aktiv = await bereichAus(searchParams, bereiche);
    const einsaetze = await kontext.abfrage<Einsatz>(
      `select e.id, m.slug, m.name as bereich_name,
              to_char(e.plan_datum, 'DD.MM.YYYY') as datum,
              to_char(e.beginn_zeitpunkt at time zone 'Europe/Berlin', 'HH24:MI') as von,
              to_char(e.ende_zeitpunkt at time zone 'Europe/Berlin', 'HH24:MI') as bis,
              e.endet_am_folgetag as folgetag, o.bezeichnung as objekt,
              e.soll_besetzung as soll, e.besetzt_anzahl as besetzt, e.status::text as status
         from einsatz e
         join mandant m on m.id = e.mandant_id
         left join objekt o on o.id = e.objekt_id
        where e.mandant_id = any($1::uuid[])
          and e.plan_datum between $2::date and $3::date
        order by e.plan_datum, e.beginn_zeitpunkt, m.sortierung
        limit 800`,
      [mandantIdsFuer(kontext, aktiv), woche, sonntag],
    );
    const befunde = await gruppenArbzgBefunde(kontext, heute);
    return { bereiche, aktiv, einsaetze, befunde };
  });
  const relevant = befunde.filter((b) => aktiv === null || b.bereiche.includes(aktiv.slug));
  const anhang = aktiv === null ? '' : `&bereich=${aktiv.slug}`;

  return (
    <GruppenRahmen zugang={tor.zugang} titel="Dienstplan" aktiverTab="uebersicht">
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Dienstplan · Woche ab {woche.split('-').reverse().join('.')}</h1>
        <nav aria-label="Woche" className="flex gap-s2 text-sm">
          <a href={`/portal/gruppe/dienstplan?woche=${tagePlus(woche, -7)}${anhang}`}
             className="min-h-11 rounded-md border border-line px-s4 py-s3 text-text hover:bg-surface-2">
            ‹ Vorwoche
          </a>
          <a href={`/portal/gruppe/dienstplan?woche=${tagePlus(woche, 7)}${anhang}`}
             className="min-h-11 rounded-md border border-line px-s4 py-s3 text-text hover:bg-surface-2">
            Folgewoche ›
          </a>
        </nav>
      </div>
      <BereichFilter bereiche={bereiche} aktiv={aktiv} basis="/portal/gruppe/dienstplan" />

      <h2 className="mb-s3 text-h2 text-text">Arbeitszeitgesetz — Befunde der letzten 14 Tage</h2>
      {relevant.length === 0 ? (
        <LeereListe text="Kein Befund über Gesellschaften hinweg in den letzten 14 Tagen." />
      ) : (
        <div data-cse="arbzg-befunde" data-anzahl={relevant.length}>
          <DataTable
            beschriftung="ArbZG-Befunde je Person, über alle Gesellschaften"
            zeilen={relevant}
            schluessel={(b) => `${b.personId}:${b.regel}:${b.kalendertag}`}
            spalten={[
              { schluessel: 'schwere', kopf: 'Schwere',
                zelle: (b) => <StatusPill zustand={SCHWERE[b.schwere]} /> },
              { schluessel: 'tag', kopf: 'Tag', zelle: (b) => b.kalendertag.split('-').reverse().join('.') },
              { schluessel: 'name', kopf: 'Person', zelle: (b) => b.name },
              { schluessel: 'regel', kopf: 'Regel', zelle: (b) => REGEL[b.regel] ?? b.regel },
              { schluessel: 'minuten', kopf: 'Minuten', numerisch: true, zelle: (b) => b.minuten },
              { schluessel: 'bereiche', kopf: 'Gesellschaften',
                zelle: (b) => (
                  <span className={b.ueberMandanten ? 'text-warning' : ''}>
                    {b.bereiche.join(' + ')}{b.ueberMandanten ? ' · erst zusammen sichtbar' : ''}
                  </span>
                ) },
            ]}
          />
        </div>
      )}

      <h2 className="mb-s3 mt-s6 text-h2 text-text">Einsätze der Woche</h2>
      {einsaetze.length === 0 ? (
        <LeereListe text="Kein Einsatz in dieser Woche und Auswahl." />
      ) : (
        <div data-cse="gruppe-einsaetze">
          <DataTable
            beschriftung="Einsätze der Woche über alle Gesellschaften"
            zeilen={einsaetze}
            schluessel={(e) => e.id}
            spalten={[
              { schluessel: 'datum', kopf: 'Tag', zelle: (e) => e.datum },
              { schluessel: 'zeit', kopf: 'Zeit',
                zelle: (e) => `${e.von}–${e.bis}${e.folgetag ? ' (+1)' : ''}` },
              { schluessel: 'bereich', kopf: 'Gesellschaft',
                zelle: (e) => <BereichMarke slug={e.slug} name={e.bereich_name} /> },
              { schluessel: 'objekt', kopf: 'Objekt',
                zelle: (e) => (
                  <Link href={`/portal/${e.slug}/dienstplan/einsatz/${e.id}`}
                        className="text-text underline-offset-2 hover:text-brand hover:underline">
                    {e.objekt ?? 'Einsatz'}
                  </Link>
                ) },
              { schluessel: 'besetzung', kopf: 'Besetzung', numerisch: true,
                zelle: (e) => (e.soll === null ? '—' : (
                  <span className={(e.besetzt ?? 0) < e.soll ? 'text-warning' : ''}>
                    {String(e.besetzt ?? 0)} / {String(e.soll)}
                  </span>
                )) },
              { schluessel: 'status', kopf: 'Status',
                zelle: (e) => <StatusPill zustand={PILLE[e.status] ?? 'Geplant'} /> },
            ]}
          />
        </div>
      )}
      <GruppenHinweis text="Eingeteilt, getauscht und besetzt wird im Bereich. Die Befunde zählen die Zeiteinträge aller Gesellschaften einer Person zusammen — so, wie das Arbeitszeitgesetz es tut." />
    </GruppenRahmen>
  );
}
