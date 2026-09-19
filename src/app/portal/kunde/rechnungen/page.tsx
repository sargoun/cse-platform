import Link from 'next/link';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import { formatiereGeld, cent } from '@/server/services/finanz/geld';
import {
  listeKundenrechnungen, rechnungsGesellschaften, type Kundenrechnung,
} from '@/server/services/kundenportal/rechnung';
import { AnmeldungNoetig } from '../../Anmeldung';
import { kundePortal, KundenRahmen } from '../rahmen';
import {
  Gesellschaft, GesellschaftsFilter, KeinZugang, Kopfzeile, Leer, slugAus,
} from '../bausteine';

/**
 * `/portal/kunde/rechnungen` — die eigenen festgeschriebenen Belege
 * (FIN-11, FIN-12, DOC-03, O-91, 04-SEITENKARTE §8).
 *
 * **Ein Entwurf ist hier strukturell unerreichbar.** `rechnung.t_kunde` UND
 * `rechnung.p_rechnung_decke` verlangen beide `status = 'festgeschrieben'`
 * (0075) — O-91 ist damit auf Datenbankebene konservativ beantwortet, nicht
 * in einer `where`-Bedingung, die jemand vergisst. Und ein Entwurf traegt
 * keine Nummer (Invariante 4): eine Liste mit „ohne — Entwurf" waere im
 * Kundenportal nicht nur falsch, sondern unverstaendlich.
 *
 * **Keine Nummernkreis-, Hash- oder Ausgangsbuchspalte.** Alle drei liegen
 * hinter `p_intern_ceiling`; eine Spalte darueber waere im Kundenportal still
 * leer (K-18), und fachlich ist der Nummernkreis die interne
 * Lueckenlosigkeitspruefung.
 *
 * **Der Zustand wird auf DESIGN §5 abgebildet, nicht erfunden.**
 * „Festgeschrieben" steht nicht im festen Pillenvokabular; dieselbe Abbildung
 * wie in der internen Rechnungsliste — `festgeschrieben` → `Abgeschlossen`,
 * und der Storno steht als eigene Spalte daneben, weil „ist dieser Beleg
 * aufgehoben" keine Zustandsfrage ist.
 *
 * **Der Gesellschaftsfilter ist kein Mandantenwechsler.** Im Kunden-Scope
 * gibt es keinen aktiven Mandanten (K-20), und ein Umschalter, der die
 * Sitzung aendert, waere genau der Weg, den Invariante 3 ausschliesst. Der
 * Filter verengt die ANZEIGE; was sichtbar ist, entscheidet RLS (O-52: ein
 * Login, zwei liefernde Gesellschaften).
 */
export const dynamic = 'force-dynamic';

const ART: Readonly<Record<string, string>> = {
  standard: 'Rechnung',
  abschlag: 'Abschlag',
  anzahlung: 'Anzahlung',
  schluss: 'Schlussrechnung',
  storno: 'Storno',
};

export default async function Kundenrechnungen(
  { searchParams }: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const suche = await searchParams;
  /*
   * Der Slug wird auf die Form geprueft und danach als Parameter in die
   * Abfrage gegeben ($1), nie in den SQL-Text. Ein Slug, den es nicht gibt,
   * ergibt eine leere Liste — kein Fehler, und die Zeile unten sagt, dass
   * gefiltert wird. `slugAus` ist dieselbe Pruefung wie auf den drei anderen
   * gefilterten Kundenlisten; sie stand hier zuerst und ist nach
   * `bausteine.tsx` gewandert, damit vier Listen nicht vier Muster haben.
   */
  const slug = slugAus(suche);

  const ergebnis = await kundePortal('/portal/kunde/rechnungen', async (kontext) => ({
    rechnungen: await listeKundenrechnungen(kontext, { mandantSlug: slug }),
    gesellschaften: await rechnungsGesellschaften(kontext),
  }));

  if (ergebnis.art === 'anmeldung') return <AnmeldungNoetig />;
  if (ergebnis.art === 'kein_zugang') {
    return (
      <KundenRahmen basis={ergebnis.basis} titel="Rechnungen" aktiverTab="rechnungen">
        <Kopfzeile titel="Rechnungen" />
        <KeinZugang />
      </KundenRahmen>
    );
  }

  const { basis, daten } = ergebnis;
  /*
   * **Keine Download-Spalte in der Liste, und das ist eine Entscheidung
   * gegen eine naheliegende Bequemlichkeit.**
   *
   * Ob aus einem Beleg ueberhaupt eine Datei entsteht, haengt an den
   * Pflichtangaben der EN 16931 (BT-49, BT-10 …) und laesst sich nur
   * beantworten, indem die Snapshot-Nutzlast gelesen und geprueft wird —
   * 200-mal fuer eine Liste. Ohne die Pruefung stuenden hier Knoepfe, die
   * eine JSON-Fehlermeldung mit BT-Nummern herunterladen; im Demobestand
   * fehlen genau diese zwei Felder bei ALLEN 19 Rechnungen des
   * Portalkunden. Ein Knopf, der einen Fehler laedt, ist schlechter als
   * keiner — der Beleg selbst weiss es und sagt es (`[id]/page.tsx`).
   */
  return (
    <KundenRahmen basis={basis} titel="Rechnungen" aktiverTab="rechnungen">
      <Kopfzeile titel="Rechnungen" />

      <GesellschaftsFilter
        wurzel="/portal/kunde/rechnungen"
        gesellschaften={daten.gesellschaften}
        aktiv={slug}
      />

      {daten.rechnungen.length === 0 ? (
        <Leer text={slug === null
          ? 'Es liegt keine Rechnung vor. Ein Entwurf erscheint hier nicht — eine Rechnung wird sichtbar, sobald sie festgeschrieben ist, und trägt dann ihre Nummer.'
          : 'Von dieser Gesellschaft liegt keine Rechnung vor. Über „Alle" sehen Sie die übrigen.'} />
      ) : (
        <DataTable
          beschriftung="Rechnungen mit Nummer, Art, Leistungszeitraum, Betrag, Fälligkeit und Gesellschaft"
          zeilen={daten.rechnungen}
          schluessel={(r: Kundenrechnung) => r.id}
          spalten={[
            {
              schluessel: 'nummer',
              kopf: 'Nummer',
              zelle: (r) => (
                <Link
                  href={`/portal/kunde/rechnungen/${r.id}`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {r.nummer}
                </Link>
              ),
            },
            { schluessel: 'art', kopf: 'Art', zelle: (r) => ART[r.rechnungsart] ?? r.rechnungsart },
            {
              schluessel: 'datum',
              kopf: 'Datum',
              zelle: (r) => r.rechnungsdatumLokal === null
                ? <span className="text-text-subtle">—</span>
                : <span className="cse-zahl">{r.rechnungsdatumLokal}</span>,
            },
            {
              schluessel: 'zeitraum',
              kopf: 'Leistungszeitraum',
              /*
               * `leistung_von` und `leistung_bis` — es gibt keine Spalte
               * `leistungszeitraum`. Zwei Daten, eine Zelle, und wenn nur
               * eines gesetzt ist, steht auch nur eines da.
               */
              zelle: (r) => r.leistungVonLokal === null && r.leistungBisLokal === null
                ? <span className="text-text-subtle">—</span>
                : (
                  <span className="cse-zahl">
                    {r.leistungVonLokal ?? '?'} – {r.leistungBisLokal ?? '?'}
                  </span>
                ),
            },
            {
              schluessel: 'brutto',
              kopf: 'Brutto',
              numerisch: true,
              zelle: (r) => formatiereGeld(cent(BigInt(r.bruttoCent))),
            },
            {
              schluessel: 'zahlbetrag',
              kopf: 'Zahlbetrag',
              numerisch: true,
              /*
               * Brutto UND Zahlbetrag: bei einer Schlussrechnung mit
               * Abschlägen sind das zwei verschiedene Zahlen, und die zu
               * überweisende ist die zweite. Nur eine zu zeigen hiesse, dem
               * Kunden die falsche zu zeigen — welche, haengt vom Beleg ab.
               */
              zelle: (r) => formatiereGeld(cent(BigInt(r.zahlbetragCent))),
            },
            {
              schluessel: 'faellig',
              kopf: 'Fällig',
              zelle: (r) => r.faelligAmLokal === null
                ? <span className="text-text-subtle">—</span>
                : <span className="cse-zahl">{r.faelligAmLokal}</span>,
            },
            {
              schluessel: 'gesellschaft',
              kopf: 'Gesellschaft',
              zelle: (r) => <Gesellschaft slug={r.mandantSlug} name={r.mandantName} />,
            },
            {
              schluessel: 'status',
              kopf: 'Zustand',
              zelle: (r) => (
                <span className="inline-flex flex-wrap items-center gap-s2">
                  <StatusPill zustand="Abgeschlossen" />
                  {r.storniertDurch === null ? null : (
                    <span data-cse="storniert" className="text-xs text-text-muted">
                      aufgehoben durch {r.storniertDurch}
                    </span>
                  )}
                </span>
              ),
            },
          ]}
        />
      )}
    </KundenRahmen>
  );
}
