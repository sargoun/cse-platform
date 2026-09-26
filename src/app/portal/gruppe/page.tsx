import { KpiStat } from '@/components/ui/KpiStat';
import { DataTable } from '@/components/ui/DataTable';
import { formatiereGeld, type Cent } from '@/server/services/finanz/geld';
import {
  gruppenUebersicht, SUMMEN_ZIELE, UEBERSICHT_ZIELE, uebersichtZiel,
} from '@/server/services/gruppe/uebersicht';
import {
  BereichMarke, GruppenAntwort, GruppenRahmen, gruppenLesen, gruppenTor, KeinRecht,
} from './tor';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { KENNZAHL_TEXTE } from '@/lib/i18n/verwaltung/kennzahlen';

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
  const tk = nachSprache(KENNZAHL_TEXTE, tor.zugang.sprache);
  const anteil = (k: number): string => (k === n ? '' : tk.anteil(k, n));
  /*
   * Die Ziele stehen im Dienst (`UEBERSICHT_ZIELE`, V-152): jede Zahl führt
   * auf die Liste MIT dem Filter, der ihre Menge zeigt — `auftraege?status=
   * aktiv&bereich=…`, `leads?status=neu&bereich=…` —, und dort misst sie ein
   * Test am Manifest.
   */
  const liste = (spalte: keyof typeof UEBERSICHT_ZIELE, slug: string): string =>
    uebersichtZiel(UEBERSICHT_ZIELE[spalte], slug);
  /*
   * **Eine Summe ist ein Verweis nur, wo es die Liste für diese Sitzung gibt**
   * (V-152, AUT-06). Sie zählt die Bereiche, deren Zelle eine Zahl ist — und
   * eine Zelle ist nur dort eine Zahl, wo die Sitzung das Recht der Zahl UND
   * der Liste hält. Ist es kein einziger, steht ein Strich ohne Verweis: die
   * Liste dahinter gäbe dieser Sitzung einen 404, und „0“ wäre eine Aussage
   * über das Recht, nicht über die Gruppe.
   */
  const summen = [
    { schluessel: 'auftraege', label: tk.gruppeAuftraege, bereiche: summe.bereiche.auftraege,
      wert: String(summe.auftraegeAktiv), ton: 'info', icon: 'auftrag' },
    { schluessel: 'fakturiert', label: tk.summeFakturiert(jahr), bereiche: summe.bereiche.fakturiert,
      wert: formatiereGeld(summe.fakturiertJahrCent), ton: 'success', icon: 'euro' },
    { schluessel: 'forderungen', label: tk.summeForderungen, bereiche: summe.bereiche.forderungen,
      wert: formatiereGeld(summe.forderungenOffenCent),
      ton: summe.forderungenOffenCent > 0n ? 'warning' : 'muted', icon: 'rechnung' },
    { schluessel: 'freigaben', label: tk.summeFreigaben, bereiche: summe.bereiche.freigaben,
      wert: String(summe.freigabenOffen),
      ton: summe.freigabenOffen > 0 ? 'warning' : 'muted', icon: 'freigabe' },
  ] as const;

  return (
    <GruppenRahmen zugang={tor.zugang} titel={tk.gruppeTitel} aktiverTab="uebersicht">
      <h1 className="mb-s5 text-h1 text-text">{tk.gruppeTitel}</h1>

      <div data-cse="gruppe-summen"
           className="mb-s6 grid grid-cols-1 gap-s4 sm:grid-cols-2 xl:grid-cols-4">
        {/*
          * „Aufträge aktiv" mit `?status=aktiv` (V-152, DSH-04): die Summe zählt
          * nur aktive Aufträge, die Liste ohne Filter zeigte alle nicht
          * archivierten.
          */}
        {summen.map((z) => (z.bereiche === 0 ? (
          <div key={z.schluessel} data-summe={z.schluessel}>
            <KpiStat label={z.label} wert="—" ton="muted" icon={z.icon} />
          </div>
        ) : (
          <a key={z.schluessel} data-summe={z.schluessel}
             href={uebersichtZiel(SUMMEN_ZIELE[z.schluessel], null)} className="group block rounded-lg">
            <KpiStat label={`${z.label}${anteil(z.bereiche)}`} wert={z.wert} ton={z.ton}
                     icon={z.icon} interaktiv />
          </a>
        )))}
      </div>

      <h2 className="mb-s3 text-h2 text-text">{tk.gruppeJeGesellschaft}</h2>
      <div data-cse="gruppe-matrix">
        <DataTable
          beschriftung={tk.gruppeBeschriftung}
          zeilen={bereiche}
          schluessel={(b) => b.slug}
          spalten={[
            {
              schluessel: 'bereich', kopf: tk.spalteGesellschaft,
              zelle: (b) => <BereichMarke slug={b.slug} name={b.name} />,
            },
            {
              schluessel: 'auftraege', kopf: tk.gruppeAuftraege, numerisch: true,
              zelle: (b) => (
                <Zahl wert={b.auftraegeAktiv} ziel={liste('auftraege', b.slug)} />
              ),
            },
            {
              schluessel: 'angebote', kopf: tk.gruppeAngebote, numerisch: true,
              /*
               * V-149 (DSH-04): hier stand eine nackte Zahl — die Liste
               * dahinter gab es nicht. Jetzt `/gruppe/angebote`, mit derselben
               * Menge (`ANGEBOT_OFFEN`).
               */
              zelle: (b) => <Zahl wert={b.angeboteOffen} ziel={liste('angebote', b.slug)} />,
            },
            {
              schluessel: 'projekte', kopf: tk.gruppeProjekte, numerisch: true,
              zelle: (b) => (
                <Zahl wert={b.projekteInArbeit} ziel={liste('projekte', b.slug)} />
              ),
            },
            {
              schluessel: 'aufgaben', kopf: tk.gruppeAufgaben, numerisch: true,
              zelle: (b) => <Zahl wert={b.aufgabenOffen} ziel={liste('aufgaben', b.slug)} />,
            },
            {
              schluessel: 'einsatz', kopf: tk.gruppeImEinsatz, numerisch: true,
              zelle: (b) => (
                <Zahl wert={b.imEinsatz} ziel={liste('einsatz', b.slug)} />
              ),
            },
            {
              schluessel: 'leads', kopf: tk.gruppeLeads, numerisch: true,
              /*
               * Mit `?status=neu` (V-152, DSH-04): die Zahl zählt neue Leads,
               * die Liste ohne Filter zeigte die ganze Pipeline.
               */
              zelle: (b) => <Zahl wert={b.leadsNeu} ziel={liste('leads', b.slug)} />,
            },
            {
              schluessel: 'objekte', kopf: tk.gruppeObjekte, numerisch: true,
              zelle: (b) => <Zahl wert={b.objekte} ziel={liste('objekte', b.slug)} />,
            },
            {
              schluessel: 'beschaeftigte', kopf: tk.gruppeBeschaeftigte, numerisch: true,
              zelle: (b) => <Zahl wert={b.beschaeftigte} ziel={liste('beschaeftigte', b.slug)} />,
            },
            {
              schluessel: 'fakturiert', kopf: tk.gruppeFakturiert(jahr), numerisch: true,
              zelle: (b) => <Geld wert={b.fakturiertJahrCent} ziel={liste('fakturiert', b.slug)} />,
            },
            {
              schluessel: 'forderungen', kopf: tk.gruppeForderungen, numerisch: true,
              zelle: (b) => <Geld wert={b.forderungenOffenCent} ziel={liste('forderungen', b.slug)} />,
            },
            {
              schluessel: 'freigaben', kopf: tk.gruppeFreigaben, numerisch: true,
              zelle: (b) => <Zahl wert={b.freigabenOffen} ziel={liste('freigaben', b.slug)} />,
            },
          ]}
        />
      </div>
      <p className="mt-s4 max-w-[72ch] text-sm text-text-subtle">{tk.gruppeHinweis}</p>

      <h2 className="mb-s3 mt-s6 text-h2 text-text">{tk.gruppeBereiche}</h2>
      <ul data-cse="gruppe-bereiche" className="grid grid-cols-1 gap-s3 sm:grid-cols-2">
        {bereiche.map((b) => (
          <li key={b.slug}
              className="flex items-center justify-between gap-s3 rounded-lg border border-line bg-surface p-s4">
            <BereichMarke slug={b.slug} name={b.name} />
            <a href={`/portal/${b.slug}`} data-cse="bereich-oeffnen"
               className="min-h-11 rounded-md border border-line-strong px-s4 py-s3 text-sm text-text hover:bg-surface-2">
              {tk.bereichOeffnen}
            </a>
          </li>
        ))}
      </ul>
    </GruppenRahmen>
  );
}
