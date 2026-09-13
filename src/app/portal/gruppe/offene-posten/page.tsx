import { DataTable } from '@/components/ui/DataTable';
import { formatiereGeld, type Cent } from '@/server/services/finanz/geld';
import { gruppenOffenePosten } from '@/server/services/gruppe/offene-posten';
import {
  bereichAus, BereichFilter, BereichMarke, GruppenAntwort, GruppenHinweis, GruppenRahmen,
  gruppenLesen, gruppenTor, KeinRecht, ladeBereiche, LeereListe, mandantIdsFuer, type Suchparameter,
} from '../tor';

/** `/portal/gruppe/offene-posten` — Debitoren und Kreditoren ueber alle Gesellschaften (ACC-07). */
export const dynamic = 'force-dynamic';

const ART: Readonly<Record<string, string>> = {
  debitor: 'Forderung', kreditor: 'Verbindlichkeit',
  debitor_guthaben: 'Kundenguthaben', kreditor_guthaben: 'Lieferantenguthaben',
};

function Betrag({ wert, warnend = false }: { readonly wert: Cent | null; readonly warnend?: boolean }) {
  if (wert === null) return <KeinRecht />;
  return <span className={warnend && wert > 0n ? 'text-danger' : ''}>{formatiereGeld(wert)}</span>;
}

export default async function GruppenOffenePosten({ searchParams }: { searchParams: Suchparameter }) {
  const tor = await gruppenTor('/portal/gruppe/offene-posten');
  if (tor.art !== 'ok') return <GruppenAntwort tor={tor} />;

  const { bereiche, aktiv, daten } = await gruppenLesen(tor.zugang, async (kontext) => {
    const bereiche = await ladeBereiche(kontext);
    const aktiv = await bereichAus(searchParams, bereiche);
    const daten = await gruppenOffenePosten(kontext, mandantIdsFuer(kontext, aktiv));
    return { bereiche, aktiv, daten };
  });
  const namen = new Map(bereiche.map((b) => [b.slug, b.name]));

  return (
    <GruppenRahmen zugang={tor.zugang} titel="Offene Posten" aktiverTab="finanzen">
      <h1 className="mb-s5 text-h1 text-text">Offene Posten</h1>
      <BereichFilter bereiche={bereiche} aktiv={aktiv} basis="/portal/gruppe/offene-posten" />

      <h2 className="mb-s3 text-h2 text-text">Je Gesellschaft</h2>
      <div data-cse="posten-bereiche">
        <DataTable
          beschriftung="Offene Posten je Gesellschaft"
          zeilen={daten.bereiche}
          schluessel={(b) => b.slug}
          spalten={[
            { schluessel: 'bereich', kopf: 'Gesellschaft',
              zelle: (b) => <BereichMarke slug={b.slug} name={b.name} /> },
            { schluessel: 'deb', kopf: 'Forderungen offen', numerisch: true,
              zelle: (b) => <Betrag wert={b.debitorenOffenCent} /> },
            { schluessel: 'deb_ue', kopf: 'davon überfällig', numerisch: true,
              zelle: (b) => <Betrag wert={b.debitorenUeberfaelligCent} warnend /> },
            { schluessel: 'kred', kopf: 'Verbindlichkeiten offen', numerisch: true,
              zelle: (b) => <Betrag wert={b.kreditorenOffenCent} /> },
            { schluessel: 'kred_ue', kopf: 'davon überfällig', numerisch: true,
              zelle: (b) => <Betrag wert={b.kreditorenUeberfaelligCent} warnend /> },
            { schluessel: 'anzahl', kopf: 'Posten', numerisch: true,
              zelle: (b) => (b.anzahl === null ? <KeinRecht /> : b.anzahl) },
          ]}
        />
      </div>

      <h2 className="mb-s3 mt-s6 text-h2 text-text">Posten</h2>
      {daten.posten.length === 0 ? (
        <LeereListe text="Kein offener Posten in dieser Auswahl." />
      ) : (
        <div data-cse="posten-liste">
          <DataTable
            beschriftung="Offene Posten über alle Gesellschaften"
            zeilen={daten.posten}
            schluessel={(p) => p.id}
            spalten={[
              { schluessel: 'bereich', kopf: 'Gesellschaft',
                zelle: (p) => <BereichMarke slug={p.slug} name={namen.get(p.slug) ?? p.slug} /> },
              { schluessel: 'art', kopf: 'Art', zelle: (p) => ART[p.art] ?? p.art },
              { schluessel: 'gegenpartei', kopf: 'Kunde / Lieferant', zelle: (p) => p.gegenpartei ?? '—' },
              { schluessel: 'beleg', kopf: 'Beleg',
                zelle: (p) => (p.zielPfad === null ? (p.beleg ?? '—') : (
                  <a href={p.zielPfad}
                     className="text-text underline-offset-2 hover:text-brand hover:underline">
                    {p.beleg ?? 'Beleg'}
                  </a>
                )) },
              { schluessel: 'betrag', kopf: 'Betrag', numerisch: true,
                zelle: (p) => formatiereGeld(p.betragCent) },
              { schluessel: 'offen', kopf: 'Offen', numerisch: true,
                zelle: (p) => formatiereGeld(p.offenCent) },
              { schluessel: 'faellig', kopf: 'Fällig',
                zelle: (p) => (p.faelligAm === null ? '—' : (
                  <span className={p.ueberfaelligTage > 0 ? 'text-danger' : ''}>
                    {p.faelligAm}{p.ueberfaelligTage > 0 ? ` · ${String(p.ueberfaelligTage)} Tage` : ''}
                  </span>
                )) },
              { schluessel: 'mahnstufe', kopf: 'Mahnstufe', numerisch: true,
                zelle: (p) => (p.mahnstufe === null || p.mahnstufe === 0 ? '—' : p.mahnstufe) },
            ]}
          />
        </div>
      )}
      <GruppenHinweis text="Ein Posten ohne Kunden- oder Lieferantennamen heißt: kein Leserecht auf diese Stammdaten im Bereich. Mahnen und ausgleichen geschieht im Bereich." />
    </GruppenRahmen>
  );
}
