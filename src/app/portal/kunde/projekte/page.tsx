import Link from 'next/link';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import {
  listeKundenprojekte, type Kundenprojekt,
} from '@/server/services/kundenportal/projekt';
import { AnmeldungNoetig } from '../../Anmeldung';
import { kundePortal, KundenRahmen } from '../rahmen';
import { Gesellschaft, KeinZugang, Kopfzeile, Leer } from '../bausteine';

/**
 * `/portal/kunde/projekte` — die eigenen Bauprojekte (OPS-05, REP-05,
 * 04-SEITENKARTE §8).
 *
 * **Die Spalte „Leistungsverzeichnisse" wird NICHT gerendert, und das ist der
 * eigentliche Befund dieser Seite.** `listeProjekte` (`services/bau/lv.ts`)
 * zaehlt `leistungsverzeichnis` in einer Unterabfrage, und diese Tabelle
 * traegt kein `t_kunde`. Im Kunden-Scope zaehlt sie deshalb 0 — nicht „kein
 * Leistungsverzeichnis", sondern „nicht sichtbar", und die beiden sehen auf
 * dem Bildschirm identisch aus (nachgemessen in einer echten Kundensitzung:
 * `select count(*) from leistungsverzeichnis` liefert 0). Eine Null, die
 * aussieht wie eine Tatsache und eine Policy ist, ist teurer als eine
 * fehlende Spalte. `Aufmaße` bleibt, weil `aufmass` `t_kunde` traegt und die
 * Zahl dort echt ist.
 *
 * **Keine Auftragssumme, kein Sicherheitseinbehalt, kein verantwortlicher
 * Mitarbeiter.** Die Spalten stehen nicht in der Abfrage
 * (`services/kundenportal/projekt.ts`); RLS wirkt zeilenweise, die Projektion
 * entscheidet.
 */
export const dynamic = 'force-dynamic';

/** `projekt_status`: geplant, in_arbeit, abgenommen, abgeschlossen, archiviert. */
const PILLE: Readonly<Record<string, PillZustand>> = {
  geplant: 'Geplant',
  in_arbeit: 'In Arbeit',
  abgenommen: 'Bereit',
  abgeschlossen: 'Abgeschlossen',
  archiviert: 'Archiviert',
};

/** `projekt_art`: hochbau, ausbau, rueckbau. */
const ART: Readonly<Record<string, string>> = {
  hochbau: 'Hochbau',
  ausbau: 'Ausbau',
  rueckbau: 'Rückbau',
};

/** `bau_vertragsgrundlage`: vob_b, bgb. */
const GRUNDLAGE: Readonly<Record<string, string>> = {
  vob_b: 'VOB/B',
  bgb: 'BGB',
};

export default async function Kundenprojekte() {
  const ergebnis = await kundePortal('/portal/kunde/projekte',
    async (kontext) => listeKundenprojekte(kontext));

  if (ergebnis.art === 'anmeldung') return <AnmeldungNoetig />;
  if (ergebnis.art === 'kein_zugang') {
    return (
      <KundenRahmen basis={ergebnis.basis} titel="Bauprojekte" aktiverTab="projekte">
        <Kopfzeile titel="Bauprojekte" />
        <KeinZugang />
      </KundenRahmen>
    );
  }

  const { basis, daten } = ergebnis;

  return (
    <KundenRahmen basis={basis} titel="Bauprojekte" aktiverTab="projekte">
      <Kopfzeile titel="Bauprojekte" />

      {daten.length === 0 ? (
        <Leer text="Für diesen Zugang ist kein Bauprojekt hinterlegt. Bauprojekte
          erscheinen hier, wenn die REALTIME Service GmbH für Sie baut — für
          Reinigungs- und Sicherheitsaufträge ist diese Liste leer, und das ist
          richtig." />
      ) : (
        <DataTable
          beschriftung="Bauprojekte mit Nummer, Bezeichnung, Art, Terminen und Gesellschaft"
          zeilen={daten}
          schluessel={(p: Kundenprojekt) => p.id}
          spalten={[
            {
              schluessel: 'nummer',
              kopf: 'Nummer',
              zelle: (p) => (
                <Link
                  href={`/portal/kunde/projekte/${p.id}`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {p.nummer}
                </Link>
              ),
            },
            { schluessel: 'bezeichnung', kopf: 'Bezeichnung', zelle: (p) => p.bezeichnung },
            { schluessel: 'art', kopf: 'Art', zelle: (p) => ART[p.art] ?? p.art },
            {
              schluessel: 'grundlage',
              kopf: 'Vertrag',
              zelle: (p) => GRUNDLAGE[p.vertragsgrundlage] ?? p.vertragsgrundlage,
            },
            {
              schluessel: 'soll_ende',
              kopf: 'Soll-Ende',
              zelle: (p) => p.sollEndeLokal === null
                ? <span className="text-text-subtle">—</span>
                : <span className="cse-zahl">{p.sollEndeLokal}</span>,
            },
            {
              schluessel: 'ist_ende',
              kopf: 'Fertig am',
              zelle: (p) => p.istEndeLokal === null
                ? <span className="text-text-subtle">—</span>
                : <span className="cse-zahl">{p.istEndeLokal}</span>,
            },
            {
              schluessel: 'aufmasse',
              kopf: 'Aufmaße',
              numerisch: true,
              zelle: (p) => p.aufmassAnzahl === 0
                ? <span className="text-text-subtle">—</span>
                : String(p.aufmassAnzahl),
            },
            {
              schluessel: 'gesellschaft',
              kopf: 'Gesellschaft',
              zelle: (p) => <Gesellschaft slug={p.mandantSlug} name={p.mandantName} />,
            },
            {
              schluessel: 'status',
              kopf: 'Zustand',
              zelle: (p) => <StatusPill zustand={PILLE[p.status] ?? 'Geplant'} />,
            },
          ]}
        />
      )}
    </KundenRahmen>
  );
}
