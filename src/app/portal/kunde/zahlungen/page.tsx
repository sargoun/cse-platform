import Link from 'next/link';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { formatiereGeld, cent } from '@/server/services/finanz/geld';
import {
  KLASSE_LABEL, kundenZahlungsstand, kundenZahlungsSummen, type Kundenposten,
  type Postenzustand,
} from '@/server/services/kundenportal/zahlung';
import { AnmeldungNoetig } from '../../Anmeldung';
import { kundePortal, KundenRahmen } from '../rahmen';
import { Gesellschaft, KeinZugang, Kopfzeile, Leer, Offen } from '../bausteine';

/**
 * `/portal/kunde/zahlungen` — der Zahlungsstand der eigenen Rechnungen
 * (ACC-04, FIN-15, 04-SEITENKARTE §8).
 *
 * ===========================================================================
 * Die Zahl kommt aus `offener_posten`, nicht aus einer Summe über
 * `zahlung_zuordnung`
 * ===========================================================================
 *
 * Und das ist kein Stilfrage: `zahlung` traegt `p_intern_ceiling` und hat kein
 * `t_kunde` — im Kunden-Scope liefert die Tabelle null Zeilen.
 * `zahlung_zuordnung` dagegen ist sichtbar, und eine Zuordnung zu einer
 * STORNIERTEN Zahlung bleibt stehen (Invariante 8: im Finanzbereich wird nicht
 * hart geloescht). Eine Summe ueber die Zuordnungen kann den Storno deshalb
 * nicht ausfiltern und meldet eine unbezahlte Rechnung als bezahlt. Im
 * Demobestand gibt es diesen Fall wirklich — die ausfuehrliche Begruendung mit
 * der betroffenen Zeile steht in `services/kundenportal/zahlung.ts`.
 *
 * **Die Summen unten werden in der Datenbank gebildet**, nicht aus den Zeilen
 * dieser Seite addiert (CLAUDE.md: „No calculation in a component, ever").
 *
 * **Keine Spalte „bezahlt am".** `zahlung_zuordnung` fuehrt kein Valutadatum;
 * das liegt in `zahlung` und bleibt verschlossen. `erstellt_am` der Zuordnung
 * waere der Buchungszeitpunkt und nicht der Zahlungseingang — eine Zahl, die
 * aussieht wie eine Antwort und eine andere Frage beantwortet. Es steht
 * stattdessen „ausgeglichen am", und das ist die Wahrheit, die die Plattform
 * hat.
 *
 * **Keine Mahnstufe.** `mahnung` ist intern; eine Stufe ohne das Schreiben
 * dahinter waere eine Drohung ohne Text.
 */
export const dynamic = 'force-dynamic';

const PILLE: Readonly<Record<Postenzustand, PillZustand>> = {
  /*
   * `Überfällig` steht nicht hier, obwohl es im Vokabular von DESIGN §5
   * existiert: ob ein Posten ueberfaellig IST, haengt am Stichtag und nicht am
   * Posten, und die Alterklasse daneben sagt es genauer. Eine Pille, die
   * dasselbe zweimal sagt, sagt es einmal falsch.
   */
  offen: 'Offen',
  teilweise: 'In Arbeit',
  ausgeglichen: 'Abgeschlossen',
};

const ZUSTAND_TEXT: Readonly<Record<Postenzustand, string>> = {
  offen: 'offen',
  teilweise: 'teilweise ausgeglichen',
  ausgeglichen: 'ausgeglichen',
};

export default async function Kundenzahlungen(
  { searchParams }: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const suche = await searchParams;
  const rohStichtag = typeof suche['stichtag'] === 'string' ? suche['stichtag'] : null;
  const gewaehlt = rohStichtag !== null && /^\d{4}-\d{2}-\d{2}$/u.test(rohStichtag)
    ? rohStichtag : null;

  const ergebnis = await kundePortal('/portal/kunde/zahlungen', async (kontext) => {
    /*
     * Der Stichtag ist ein Berliner KALENDERTAG (K-11) — `app.berlin_heute()`
     * und nicht `new Date()`: der Node-Prozess laeuft in UTC, und am 1. eines
     * Monats um 00:30 Berliner Zeit waere „heute" der Vortag. Das Alter eines
     * Postens ist eine Differenz von Kalendertagen; eine Zeitumstellung
     * aendert es nicht.
     */
    const [heute] = await kontext.abfrage<{ tag: string }>(
      `select app.berlin_heute()::text as tag`);
    const stichtag = gewaehlt ?? heute?.tag ?? '2026-01-01';
    return {
      stichtag,
      posten: await kundenZahlungsstand(kontext, stichtag),
      summen: await kundenZahlungsSummen(kontext, stichtag),
    };
  }, ['finanzen.lesen', 'finanzen.herunterladen']);

  if (ergebnis.art === 'anmeldung') return <AnmeldungNoetig />;
  if (ergebnis.art === 'kein_zugang') {
    return (
      <KundenRahmen basis={ergebnis.basis} titel="Zahlungen" aktiverTab="zahlungen">
        <Kopfzeile titel="Zahlungen" />
        <KeinZugang />
      </KundenRahmen>
    );
  }

  const { basis, daten } = ergebnis;
  /*
   * BEIDE Rechte der Zielroute. `/portal/kunde/rechnungen/[id]` fuehrt im
   * Manifest `lesen: ["finanzen.lesen","finanzen.herunterladen"]`, und
   * `pruefeZugang` verknuepft die Leserechte einer Route mit UND — fehlt
   * eines, antwortet die Seite dahinter mit `notFound()`. Ein Verweis, dessen
   * Ziel diese Sitzung nicht oeffnen darf, verraet die Existenz dessen, was er
   * nicht zeigen darf (AUT-06, D-581).
   */
  const darfRechnung = basis.rechte['finanzen.lesen'] === true
    && basis.rechte['finanzen.herunterladen'] === true;
  const feld = 'min-h-11 rounded-md border border-line bg-surface-3 px-s3 text-sm text-text';
  const stichtagText = `${daten.stichtag.slice(8, 10)}.${daten.stichtag.slice(5, 7)}.${daten.stichtag.slice(0, 4)}`;

  return (
    <KundenRahmen basis={basis} titel="Zahlungen" aktiverTab="zahlungen">
      <Kopfzeile titel="Zahlungen" />

      <p className="mb-s5 max-w-[72ch] text-sm text-text-muted">
        Stichtag {stichtagText}. Das Alter eines Postens ist die Zahl der
        Kalendertage seit Fälligkeit — Kalendertage, keine Stunden: eine
        Zeitumstellung ändert es nicht.
      </p>

      <form
        method="get"
        action="/portal/kunde/zahlungen"
        data-cse="posten-stichtag"
        className="mb-s5 flex flex-wrap items-center gap-s3"
      >
        <label htmlFor="stichtag" className="text-sm text-text">Stichtag</label>
        <input
          id="stichtag"
          name="stichtag"
          type="date"
          defaultValue={daten.stichtag}
          className={feld}
        />
        <button
          type="submit"
          className="min-h-11 rounded-md border border-line-strong px-s5 text-sm text-text hover:bg-surface-2"
        >
          Anzeigen
        </button>
      </form>

      <dl
        data-cse="zahlungs-summen"
        className="mb-s5 grid grid-cols-1 gap-s4 sm:grid-cols-3"
      >
        <div className="rounded-lg border border-line bg-surface p-s5">
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Offen</dt>
          <dd className="m-0 mt-s2 cse-zahl text-h2 text-text">
            {formatiereGeld(cent(BigInt(daten.summen.offenCent)))}
          </dd>
        </div>
        <div className="rounded-lg border border-line bg-surface p-s5">
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
            Davon überfällig
          </dt>
          <dd className="m-0 mt-s2 cse-zahl text-h2 text-text">
            {formatiereGeld(cent(BigInt(daten.summen.ueberfaelligCent)))}
          </dd>
        </div>
        <div className="rounded-lg border border-line bg-surface p-s5">
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
            Bereits ausgeglichen
          </dt>
          <dd className="m-0 mt-s2 cse-zahl text-h2 text-text">
            {formatiereGeld(cent(BigInt(daten.summen.bezahltCent)))}
          </dd>
        </div>
      </dl>

      {daten.posten.length < daten.summen.anzahl && (
        /*
         * Die Kacheln summieren ueber ALLE Posten, die Liste bricht bei
         * `GRENZE` ab. Ohne diesen Satz naennte die Kachel Geld zu Zeilen,
         * die nicht auf dem Bildschirm stehen — und der Kunde rechnete nach
         * und kaeme auf etwas anderes. Die Grenze in die Summe zu ziehen waere
         * die falsche Richtung: eine Teilsumme, die „Offen" heisst, ist
         * ebenfalls falsch, nur unauffaelliger.
         */
        <p className="mb-s5 rounded-lg border border-line bg-surface-2 p-s4 text-sm text-text-muted">
          Die Liste zeigt die {daten.posten.length} ältesten von{' '}
          {daten.summen.anzahl} Posten. Die Beträge oben umfassen alle.
        </p>
      )}

      {daten.posten.length === 0 ? (
        <Leer text="Es steht keine Forderung offen, und es ist auch keine bezahlte
          verbucht. Ein Posten entsteht mit der Festschreibung einer Rechnung." />
      ) : (
        <DataTable
          beschriftung="Offene und ausgeglichene Posten mit Belegnummer, Fälligkeit, Alter, Beträgen und Gesellschaft"
          zeilen={daten.posten}
          schluessel={(p: Kundenposten) => p.id}
          spalten={[
            {
              schluessel: 'beleg',
              kopf: 'Rechnung',
              zelle: (p) => p.rechnungId !== null && darfRechnung ? (
                <Link
                  href={`/portal/kunde/rechnungen/${p.rechnungId}`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {p.belegnummer ?? 'Beleg öffnen'}
                </Link>
              ) : (p.belegnummer ?? <span className="text-text-subtle">—</span>),
            },
            {
              schluessel: 'faellig',
              kopf: 'Fällig',
              zelle: (p) => <span className="cse-zahl">{p.faelligAmLokal}</span>,
            },
            {
              schluessel: 'alter',
              kopf: 'Alter',
              zelle: (p) => (
                <span>
                  {KLASSE_LABEL[p.klasse]}
                  <span className="block cse-zahl text-sm text-text-muted">
                    {p.tage >= 0 ? `${p.tage} Tage` : `in ${-p.tage} Tagen`}
                  </span>
                </span>
              ),
            },
            {
              schluessel: 'betrag',
              kopf: 'Betrag',
              numerisch: true,
              zelle: (p) => formatiereGeld(cent(BigInt(p.betragCent))),
            },
            {
              schluessel: 'bezahlt',
              kopf: 'Ausgeglichen',
              numerisch: true,
              zelle: (p) => formatiereGeld(cent(BigInt(p.bezahltCent))),
            },
            {
              schluessel: 'offen',
              kopf: 'Offen',
              numerisch: true,
              zelle: (p) => formatiereGeld(cent(BigInt(p.offenCent))),
            },
            {
              schluessel: 'ausgeglichen_am',
              kopf: 'Ausgeglichen am',
              zelle: (p) => p.ausgeglichenAmLokal === null
                ? <span className="text-text-subtle">—</span>
                : <span className="cse-zahl">{p.ausgeglichenAmLokal}</span>,
            },
            {
              schluessel: 'gesellschaft',
              kopf: 'Gesellschaft',
              zelle: (p) => <Gesellschaft slug={p.mandantSlug} name={p.mandantName} />,
            },
            {
              schluessel: 'zustand',
              kopf: 'Zustand',
              zelle: (p) => (
                <span className="inline-flex flex-wrap items-center gap-s2">
                  <StatusPill zustand={PILLE[p.zustand]} />
                  <span className="text-xs text-text-muted">{ZUSTAND_TEXT[p.zustand]}</span>
                </span>
              ),
            },
          ]}
        />
      )}

      <div className="mt-s5 flex flex-col gap-s4">
        <Offen
          nummer="O-672"
          was="Kein Datum des Zahlungseingangs"
          weg={'Die Spalte „Ausgeglichen am" nennt den Tag, an dem der Posten '
            + 'geschlossen wurde. Ob Ihnen zusätzlich das Valutadatum Ihrer '
            + 'eigenen Zahlung gezeigt werden soll, ist noch nicht entschieden.'}
        />
        <Offen
          nummer="O-673"
          was="Kein Mahnstand im Portal"
          weg="Mahnungen erreichen Sie schriftlich; ob Stufe, Datum und Gebühr
            zusätzlich im Portal stehen sollen, ist noch nicht entschieden."
        />
      </div>
    </KundenRahmen>
  );
}
