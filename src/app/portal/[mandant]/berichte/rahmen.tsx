import type { ReactNode } from 'react';
import Link from 'next/link';
import type postgres from 'postgres';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant, type LeseKontext } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Hinweis } from '@/components/ui/Hinweis';
import { alsRoute } from '@/server/auth/kennwort-anmeldung';
import type { BereichSchluessel } from '@/lib/design/theme';
import {
  abschnitte, ganzesJahr, jahrAus, type Granularitaet, type Zeitraum,
} from '@/server/services/bericht/zeitraum';
import { AnmeldungNoetig } from '../../Anmeldung';
import { MandantAntwort, mandantTor } from '../../unterseite';

/**
 * Der gemeinsame Rahmen der sechs Berichte (SPEC §5.23, REP-01…REP-07).
 *
 * **Warum sie sich einen teilen.** Alle sechs beantworten dieselbe
 * Vorfrage — welcher Bereich, welches Jahr, welche Körnung — und alle sechs
 * bieten dieselben zwei Ausgänge (CSV-Datei und Druckblatt, REP-07). Sechsmal ausgeschrieben wäre das sechsmal
 * dieselbe Gelegenheit, den Zeitraum anders zu lesen: eine Umsatzzahl für
 * „dieses Jahr" neben einer Auftragszahl für „letzte 365 Tage" widerspricht
 * sich auf einem Bildschirm, ohne dass es jemand bemerkt.
 *
 * **Das laufende Jahr kommt aus der DATENBANK** (`app.berlin_heute()`,
 * Invariante 5). Die Uhr des Anwendungsservers entschiede sonst, welches Jahr
 * ein Bericht zeigt — und im Januar um 00:30 wäre das das falsche.
 */

export const BERICHTE = [
  { schluessel: 'umsatz', titel: 'Umsatz & Ergebnis', spec: 'REP-01',
    beschreibung: 'Erlöse, Aufwand und Ergebnis je Abschnitt' },
  { schluessel: 'auftraege', titel: 'Aufträge & Leads', spec: 'REP-02',
    beschreibung: 'Anfragen, gewonnene Anfragen, Abschlussquote' },
  { schluessel: 'attribution', titel: 'Herkunft', spec: 'REP-03',
    beschreibung: 'Welcher Kanal führt zu unterschriebenen Aufträgen' },
  { schluessel: 'mitarbeiter', titel: 'Stunden & Auslastung', spec: 'REP-04',
    beschreibung: 'Ist-Stunden, Soll, Mehrarbeit je Mensch' },
  { schluessel: 'projekte', titel: 'Projekte', spec: 'REP-05',
    beschreibung: 'Status, Marge, Termintreue' },
  { schluessel: 'pipeline', titel: 'Vergabepipeline', spec: 'REP-06',
    beschreibung: 'Gefunden · gesichtet · geboten · gewonnen' },
] as const;

export type BerichtSchluessel = (typeof BERICHTE)[number]['schluessel'];

export interface BerichtsLage {
  readonly jahr: number;
  readonly koernung: Granularitaet;
  readonly jahresZeitraum: Zeitraum;
  readonly abschnitte: readonly Zeitraum[];
  readonly heute: string;
}

/** Die Körnung aus der Abfrage — geprüft, damit kein Wort in eine Abfrage läuft. */
export function koernungAus(roh: unknown): Granularitaet {
  return roh === 'quartal' || roh === 'jahr' ? roh : 'monat';
}

export interface BerichtsSeiteProps {
  readonly mandant: string;
  readonly bericht: BerichtSchluessel;
  readonly suche: Record<string, string | string[] | undefined>;
  readonly kinder: (kontext: LeseKontext, lage: BerichtsLage) => Promise<ReactNode>;
  /** Blendet die Körnungswahl aus, wo der Bericht nur einen Zeitraum kennt. */
  readonly nurJahr?: boolean;
  readonly fussnote?: ReactNode;
}

/**
 * Lädt die Zahlen und zeichnet den Rahmen. Der Bericht selbst ist `kinder` —
 * er bekommt den gebundenen Lesekontext und den Zeitraum und gibt Markup
 * zurück; gerechnet wird in `server/services/bericht`, nie hier.
 */
export async function BerichtsSeite({
  mandant, bericht, suche, kinder, nurJahr = false, fussnote,
}: BerichtsSeiteProps) {
  const pfad = `/portal/${mandant}/berichte/${bericht}`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art === 'anmeldung') return <AnmeldungNoetig />;
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  const eintrag = BERICHTE.find((b) => b.schluessel === bericht)!;

  const { inhalt, lage, darfExportieren } = await (db().begin(SCHNAPPSCHUSS,
    async (tx: postgres.TransactionSql) => withTenant(tx, zugang.sitzung, async (kontext) => {
      const [uhr] = await kontext.abfrage<{ heute: string }>(
        `select app.berlin_heute()::text as heute`);
      const heute = uhr!.heute;
      const jahr = jahrAus(suche['jahr'], heute);
      const koernung = nurJahr ? 'jahr' : koernungAus(suche['koernung']);
      const gegenwart: BerichtsLage = {
        jahr,
        koernung,
        jahresZeitraum: ganzesJahr(jahr),
        abschnitte: abschnitte(jahr, koernung),
        heute,
      };
      const [recht] = await kontext.abfrage<{ hat: boolean }>(
        `select app.hat_recht('bericht.exportieren', app.aktiver_mandant()) as hat`);
      return {
        inhalt: await kinder(kontext, gegenwart),
        lage: gegenwart,
        darfExportieren: recht?.hat === true,
      };
    }))) as { inhalt: ReactNode; lage: BerichtsLage; darfExportieren: boolean };

  const link = (aenderung: { jahr?: number; koernung?: Granularitaet }) => {
    const q = new URLSearchParams();
    q.set('jahr', String(aenderung.jahr ?? lage.jahr));
    if (!nurJahr) q.set('koernung', aenderung.koernung ?? lage.koernung);
    return alsRoute(`${pfad}?${q.toString()}`);
  };

  const laufendesJahr = Number(lage.heute.slice(0, 4));
  const jahre = [laufendesJahr - 2, laufendesJahr - 1, laufendesJahr];

  return (
    <PortalRahmen
      titel={eintrag.titel}
      wurzelTitel="Berichte"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="berichte"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <div className="min-w-0">
          <h1 className="text-h1 text-text">{eintrag.titel}</h1>
          <p className="mt-s1 max-w-prose text-sm text-text-muted">{eintrag.beschreibung}</p>
        </div>
        <Link href={alsRoute(`/portal/${mandant}/berichte`)} data-cse="zu-berichten"
              className="text-sm text-text underline underline-offset-2">
          Alle Berichte
        </Link>
      </div>

      <div className="mb-s5 flex flex-wrap items-center gap-s4" data-cse="bericht-steuerung">
        <nav aria-label="Jahr" className="flex flex-wrap items-center gap-s2">
          {jahre.map((j) => (
            <Link key={j} href={link({ jahr: j })} data-cse={`jahr-${String(j)}`}
                  aria-current={j === lage.jahr ? 'page' : undefined}
                  className={`inline-flex min-h-11 items-center rounded-md border px-s4 text-sm
                              ${j === lage.jahr
                                ? 'border-line-strong bg-surface-3 text-text'
                                : 'border-line text-text-muted hover:border-line-strong'}`}>
              {j}
            </Link>
          ))}
        </nav>

        {!nurJahr && (
          <nav aria-label="Körnung" className="flex flex-wrap items-center gap-s2">
            {([['monat', 'Monate'], ['quartal', 'Quartale'], ['jahr', 'Jahr']] as const).map(
              ([wert, label]) => (
                <Link key={wert} href={link({ koernung: wert })} data-cse={`koernung-${wert}`}
                      aria-current={wert === lage.koernung ? 'page' : undefined}
                      className={`inline-flex min-h-11 items-center rounded-md border px-s4 text-sm
                                  ${wert === lage.koernung
                                    ? 'border-line-strong bg-surface-3 text-text'
                                    : 'border-line text-text-muted hover:border-line-strong'}`}>
                  {label}
                </Link>
              ),
            )}
          </nav>
        )}

        {/*
          * **Der Ausgang ist ein eigenes Recht** (`bericht.exportieren`, an
          * `admin` gebunden und an `leitung` bindbar). Wer eine Zahl ansehen
          * darf, darf sie nicht schon aus dem Haus tragen — eine CSV-Datei
          * verlässt das Portal und jede Zugriffskontrolle darin. Ohne das
          * Recht erscheint kein Knopf statt eines Knopfes, der 403 antwortet.
          */}
        {darfExportieren && (
          <a
            href={`/api/berichte/${bericht}/csv?jahr=${String(lage.jahr)}`
              + `&koernung=${lage.koernung}&mandant=${mandant}`}
            data-cse="csv-export"
            download
            className="ms-auto inline-flex min-h-11 items-center rounded-md border border-line
                       px-s4 text-sm text-text transition-colors duration-fast ease-brand
                       hover:border-line-strong"
          >
            Als CSV
          </a>
        )}
        {/*
          * **Der zweite Ausgang aus REP-07: das Blatt** (V-227, D-721). Es
          * zeigt dieselben Zeilen und Spalten wie die Datei und wird im
          * Browser zu Papier oder PDF. Dasselbe Recht wie die CSV-Datei — ein
          * Ausdruck verlässt das Haus genauso.
          */}
        {darfExportieren && (
          <Link
            href={alsRoute(`/portal/${mandant}/berichte/druck/${bericht}?jahr=${String(lage.jahr)}`
              + `&koernung=${lage.koernung}`)}
            data-cse="druck-export"
            className="inline-flex min-h-11 items-center rounded-md border border-line
                       px-s4 text-sm text-text transition-colors duration-fast ease-brand
                       hover:border-line-strong"
          >
            Als PDF drucken
          </Link>
        )}
      </div>

      {inhalt}

      {fussnote !== undefined && (
        <Hinweis art="hinweis" cse="bericht-fussnote" className="mt-s6 max-w-prose">
          {fussnote}
        </Hinweis>
      )}
    </PortalRahmen>
  );
}
