import { KpiStat } from '@/components/ui/KpiStat';
import { DataTable } from '@/components/ui/DataTable';
import { formatiereGeld, type Cent } from '@/server/services/finanz/geld';
import { gruppenUebersicht, type BereichKennzahlen } from '@/server/services/gruppe/uebersicht';
import {
  BereichMarke, GruppenAntwort, GruppenRahmen, gruppenLesen, gruppenTor, KeinRecht,
} from './tor';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { KENNZAHL_TEXTE } from '@/lib/i18n/verwaltung/kennzahlen';
import { AUFTRAG_AKTIV, PROJEKT_IN_ARBEIT } from '@/server/services/bericht/mengen';

/**
 * `/portal/gruppe` — die Gruppenuebersicht, LESEND (TEN-05, DSH-01, Invariante 10).
 *
 * Eine Zeile je Gesellschaft, eine Summe ueber die Gruppe. Jede Zahl fuehrt zu
 * der Liste, die sie zaehlt (DSH-04), und jede Liste ist eine Gruppenseite —
 * gehandelt wird erst im Bereich, nach einem bewussten Wechsel (§4.5).
 *
 * **Ein Strich ist kein Nullwert.** Wo diese Sitzung das Recht eines
 * Bereichs nicht haelt, steht `—` (D-475); eine 0 dort waere eine Aussage
 * ueber die Gesellschaft, die niemand gemacht hat.
 */
export const dynamic = 'force-dynamic';

const VERWEIS = 'text-text underline-offset-2 hover:text-brand hover:underline';

function Zahl({ wert, ziel }: { readonly wert: number | null; readonly ziel: string }) {
  if (wert === null) return <KeinRecht />;
  return <a href={ziel} className={VERWEIS}>{wert}</a>;
}

function Geld({ wert, ziel }: { readonly wert: Cent | null; readonly ziel: string }) {
  if (wert === null) return <KeinRecht />;
  return <a href={ziel} className={VERWEIS}>{formatiereGeld(wert)}</a>;
}

export default async function Gruppenuebersicht() {
  const tor = await gruppenTor('/portal/gruppe');
  if (tor.art !== 'ok') return <GruppenAntwort tor={tor} />;

  const { jahr, bereiche, summe } = await gruppenLesen(tor.zugang, (kontext) =>
    gruppenUebersicht(kontext));
  const n = bereiche.length;
  const anteil = (k: number): string => (k === n ? '' : ` · ${String(k)} von ${String(n)} Bereichen`);
  /*
   * `&`, wenn die Liste schon einen Filter trägt (V-149/V-150): die Zahl
   * „Aufträge aktiv" führt auf `auftraege?status=aktiv&bereich=…`, nicht auf
   * alle Aufträge des Bereichs.
   */
  const liste = (pfad: string, b: BereichKennzahlen): string =>
    `/portal/gruppe/${pfad}${pfad.includes('?') ? '&' : '?'}bereich=${b.slug}`;
  const tk = nachSprache(KENNZAHL_TEXTE, tor.zugang.sprache);

  return (
    <GruppenRahmen zugang={tor.zugang} titel="Gruppenübersicht" aktiverTab="uebersicht">
      <h1 className="mb-s5 text-h1 text-text">Gruppenübersicht</h1>

      <div data-cse="gruppe-summen"
           className="mb-s6 grid grid-cols-1 gap-s4 sm:grid-cols-2 xl:grid-cols-4">
        <a href="/portal/gruppe/auftraege" className="group block rounded-lg">
          <KpiStat label={`Aufträge aktiv${anteil(summe.bereiche.auftraege)}`}
                   wert={String(summe.auftraegeAktiv)} ton="info" icon="auftrag" interaktiv />
        </a>
        <a href="/portal/gruppe/finanzen" className="group block rounded-lg">
          <KpiStat label={`Fakturiert ${String(jahr)} netto${anteil(summe.bereiche.fakturiert)}`}
                   wert={formatiereGeld(summe.fakturiertJahrCent)} ton="success" icon="euro" interaktiv />
        </a>
        <a href="/portal/gruppe/offene-posten" className="group block rounded-lg">
          <KpiStat label={`Offene Forderungen${anteil(summe.bereiche.forderungen)}`}
                   wert={formatiereGeld(summe.forderungenOffenCent)}
                   ton={summe.forderungenOffenCent > 0n ? 'warning' : 'muted'} icon="rechnung" interaktiv />
        </a>
        <a href="/portal/gruppe/freigaben" className="group block rounded-lg">
          <KpiStat label={`Wartende Freigaben${anteil(summe.bereiche.freigaben)}`}
                   wert={String(summe.freigabenOffen)}
                   ton={summe.freigabenOffen > 0 ? 'warning' : 'muted'} icon="freigabe" interaktiv />
        </a>
      </div>

      <h2 className="mb-s3 text-h2 text-text">Je Gesellschaft</h2>
      <div data-cse="gruppe-matrix">
        <DataTable
          beschriftung="Kennzahlen je Gesellschaft"
          zeilen={bereiche}
          schluessel={(b) => b.slug}
          spalten={[
            {
              schluessel: 'bereich', kopf: 'Gesellschaft',
              zelle: (b) => <BereichMarke slug={b.slug} name={b.name} />,
            },
            {
              schluessel: 'auftraege', kopf: 'Aufträge aktiv', numerisch: true,
              zelle: (b) => (
                <Zahl wert={b.auftraegeAktiv} ziel={liste(`auftraege?status=${AUFTRAG_AKTIV}`, b)} />
              ),
            },
            {
              schluessel: 'angebote', kopf: 'Angebote offen', numerisch: true,
              /*
               * V-149 (DSH-04): hier stand eine nackte Zahl — die Liste
               * dahinter gab es nicht. Jetzt `/gruppe/angebote`, mit derselben
               * Menge (`ANGEBOT_OFFEN`).
               */
              zelle: (b) => <Zahl wert={b.angeboteOffen} ziel={liste('angebote?status=offen', b)} />,
            },
            {
              schluessel: 'projekte', kopf: tk.gruppeProjekte, numerisch: true,
              zelle: (b) => (
                <Zahl wert={b.projekteInArbeit}
                      ziel={liste(`projekte?status=${PROJEKT_IN_ARBEIT}`, b)} />
              ),
            },
            {
              schluessel: 'aufgaben', kopf: tk.gruppeAufgaben, numerisch: true,
              zelle: (b) => <Zahl wert={b.aufgabenOffen} ziel={liste('aufgaben', b)} />,
            },
            {
              schluessel: 'einsatz', kopf: tk.gruppeImEinsatz, numerisch: true,
              zelle: (b) => (
                <Zahl wert={b.imEinsatz}
                      ziel={`/portal/gruppe/auslastung?bereich=${b.slug}#im-einsatz`} />
              ),
            },
            {
              schluessel: 'leads', kopf: 'Neue Anfragen', numerisch: true,
              zelle: (b) => <Zahl wert={b.leadsNeu} ziel={liste('leads', b)} />,
            },
            {
              schluessel: 'objekte', kopf: 'Objekte', numerisch: true,
              zelle: (b) => <Zahl wert={b.objekte} ziel={liste('objekte', b)} />,
            },
            {
              schluessel: 'beschaeftigte', kopf: 'Beschäftigte', numerisch: true,
              zelle: (b) => <Zahl wert={b.beschaeftigte} ziel={liste('personen', b)} />,
            },
            {
              schluessel: 'fakturiert', kopf: `Fakturiert ${String(jahr)}`, numerisch: true,
              zelle: (b) => <Geld wert={b.fakturiertJahrCent} ziel={liste('rechnungen', b)} />,
            },
            {
              schluessel: 'forderungen', kopf: 'Forderungen offen', numerisch: true,
              zelle: (b) => <Geld wert={b.forderungenOffenCent} ziel={liste('offene-posten', b)} />,
            },
            {
              schluessel: 'freigaben', kopf: 'Freigaben', numerisch: true,
              zelle: (b) => <Zahl wert={b.freigabenOffen} ziel={liste('freigaben', b)} />,
            },
          ]}
        />
      </div>
      <p className="mt-s4 max-w-[72ch] text-sm text-text-subtle">
        Ein Strich heißt: kein Leserecht in diesem Bereich — keine Null. Fakturiert
        zählt festgeschriebene Rechnungen nach Rechnungsdatum, netto. Jede Zahl führt
        zur Liste dahinter; gehandelt wird im Bereich.
      </p>

      <h2 className="mb-s3 mt-s6 text-h2 text-text">Bereiche</h2>
      <ul data-cse="gruppe-bereiche" className="grid grid-cols-1 gap-s3 sm:grid-cols-2">
        {bereiche.map((b) => (
          <li key={b.slug}
              className="flex items-center justify-between gap-s3 rounded-lg border border-line bg-surface p-s4">
            <BereichMarke slug={b.slug} name={b.name} />
            <a href={`/portal/${b.slug}`} data-cse="bereich-oeffnen"
               className="min-h-11 rounded-md border border-line-strong px-s4 py-s3 text-sm text-text hover:bg-surface-2">
              Bereich öffnen
            </a>
          </li>
        ))}
      </ul>
    </GruppenRahmen>
  );
}
