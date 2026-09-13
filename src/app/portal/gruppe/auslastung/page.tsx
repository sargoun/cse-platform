import { DataTable } from '@/components/ui/DataTable';
import { berlinKalendertag } from '@/server/services/zeit/dauer';
import { formatiereStunden, gruppenAuslastung } from '@/server/services/gruppe/auslastung';
import {
  BereichMarke, GruppenAntwort, GruppenHinweis, GruppenRahmen, gruppenLesen, gruppenTor,
  ladeBereiche, LeereListe,
} from '../tor';

/**
 * `/portal/gruppe/auslastung` — Stunden je Person ueber alle Gesellschaften,
 * die letzten vier Wochen (REP-04, EMP-15, TIM-14).
 *
 * Kein Bereich kennt diese Summe: die Anstellung zaehlt je Gesellschaft, die
 * Person ist eine (D-09). Die Minuten sind die der Zeiteintraege, vom Server
 * gemessen (Invariante 5) — hier wird addiert, nicht gerechnet.
 */
export const dynamic = 'force-dynamic';

export default async function GruppenAuslastung() {
  const tor = await gruppenTor('/portal/gruppe/auslastung');
  if (tor.art !== 'ok') return <GruppenAntwort tor={tor} />;

  const heute = berlinKalendertag(new Date());
  const { bereiche, daten } = await gruppenLesen(tor.zugang, async (kontext) => ({
    bereiche: await ladeBereiche(kontext),
    daten: await gruppenAuslastung(kontext, heute),
  }));
  const namen = new Map(bereiche.map((b) => [b.slug, b.name]));
  const mehrfach = daten.personen.filter((p) => p.bereiche.length > 1).length;

  return (
    <GruppenRahmen zugang={tor.zugang} titel="Auslastung" aktiverTab="uebersicht">
      <h1 className="mb-s5 text-h1 text-text">Auslastung</h1>
      <p data-cse="auslastung-zaehler" data-mehrfach={mehrfach} className="mb-s4 text-sm text-text-muted">
        {String(daten.personen.length)} Personen mit Zeiteinträgen vom{' '}
        {daten.von.split('-').reverse().join('.')} bis {daten.bis.split('-').reverse().join('.')},
        davon {String(mehrfach)} in mehr als einer Gesellschaft.
      </p>
      {daten.personen.length === 0 ? (
        <LeereListe text="Keine Zeiteinträge in den letzten vier Wochen." />
      ) : (
        <div data-cse="auslastung-tabelle">
          <DataTable
            beschriftung="Stunden je Person und Woche über alle Gesellschaften"
            zeilen={daten.personen}
            schluessel={(p) => p.personId}
            spalten={[
              { schluessel: 'name', kopf: 'Person', zelle: (p) => p.name },
              { schluessel: 'bereiche', kopf: 'Gesellschaften',
                zelle: (p) => (
                  <span className="flex flex-wrap gap-s3">
                    {p.bereiche.map((slug) => (
                      <BereichMarke key={slug} slug={slug} name={namen.get(slug) ?? slug} />
                    ))}
                  </span>
                ) },
              ...daten.wochen.map((w, i) => ({
                schluessel: w.iso, kopf: w.iso.replace('-W', ' · KW '), numerisch: true,
                zelle: (p: (typeof daten.personen)[number]) => formatiereStunden(p.wochenMinuten[i] ?? 0),
              })),
              { schluessel: 'gesamt', kopf: 'Gesamt', numerisch: true,
                zelle: (p) => <strong>{formatiereStunden(p.gesamtMinuten)}</strong> },
            ]}
          />
        </div>
      )}
      <GruppenHinweis text="Gezählt werden abgeschlossene, nicht stornierte Zeiteinträge nach Beginn (Europe/Berlin). Stunden eines Bereichs, in dem diese Sitzung kein Zeit-Leserecht hält, fehlen in der Summe — die Spalte Gesellschaften zeigt, was gezählt wurde. Überstunden und Ausgleich werden im Stundenkonto des Bereichs geführt." />
    </GruppenRahmen>
  );
}
