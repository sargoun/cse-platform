import type { ReactNode } from 'react';
import Link from 'next/link';
import { Hinweis } from '@/components/ui/Hinweis';
import { alsRoute } from '@/server/auth/kennwort-anmeldung';
import type { LeseKontext } from '@/server/kontext/index';
import { ganzesJahr, jahrAus, type Zeitraum } from '@/server/services/bericht/zeitraum';
import { GruppenAntwort, GruppenRahmen, gruppenLesen, gruppenTor } from '../tor';

/**
 * Der Rahmen der Gruppenberichte (SPEC §6, TEN-05, Invariante 10).
 *
 * **Dieselben sechs Fragen, eine andere Antwortform.** Im Bereich lautet die
 * Antwort „wie viel"; in der Gruppe lautet sie „wer trägt wie viel bei".
 * Eine Summe ohne Aufteilung ist die eine Zahl, die niemanden handeln lässt —
 * deshalb steht hier je Gesellschaft eine Zeile und darunter die Summe.
 *
 * **Lesend per Konstruktion**: `gruppenLesen` gibt einen `LeseKontext`, und
 * keine Tabelle kennt für `app.scope() = 'gruppe'` eine Schreib-Policy.
 * Es gibt hier auch keinen CSV-Ausgang: `bericht.exportieren` ist ein Recht
 * am BEREICH, und ein Bereichsrecht in der Gruppenansicht zu prüfen hiesse,
 * sich einen Bereich auszusuchen.
 */

export const GRUPPEN_BERICHTE = [
  { schluessel: 'umsatz', titel: 'Umsatz & Ergebnis', spec: 'REP-01',
    beschreibung: 'Erlöse, Aufwand und Ergebnis je Gesellschaft' },
  { schluessel: 'auftraege', titel: 'Aufträge & Leads', spec: 'REP-02',
    beschreibung: 'Anfragen und Abschlussquote je Gesellschaft' },
  { schluessel: 'attribution', titel: 'Herkunft', spec: 'REP-03',
    beschreibung: 'Welcher Kanal wirkt in welcher Gesellschaft' },
  { schluessel: 'mitarbeiter', titel: 'Stunden', spec: 'REP-04',
    beschreibung: 'Freigegebene Stunden und Köpfe je Gesellschaft' },
  { schluessel: 'projekte', titel: 'Projekte', spec: 'REP-05',
    beschreibung: 'Laufend, abgeschlossen, verspätet' },
  { schluessel: 'pipeline', titel: 'Vergabepipeline', spec: 'REP-06',
    beschreibung: 'Gefunden, eingereicht, Zuschlag' },
] as const;

export type GruppenBericht = (typeof GRUPPEN_BERICHTE)[number]['schluessel'];

export interface GruppenBerichtProps {
  readonly bericht: GruppenBericht;
  readonly suche: Promise<Record<string, string | string[] | undefined>>;
  readonly kinder: (kontext: LeseKontext, jahr: Zeitraum) => Promise<ReactNode>;
  readonly fussnote?: ReactNode;
}

export async function GruppenBerichtsSeite({
  bericht, suche, kinder, fussnote,
}: GruppenBerichtProps) {
  const pfad = `/portal/gruppe/berichte/${bericht}`;
  const tor = await gruppenTor(pfad);
  if (tor.art !== 'ok') return <GruppenAntwort tor={tor} />;

  const eintrag = GRUPPEN_BERICHTE.find((b) => b.schluessel === bericht)!;
  const parameter = await suche;

  const { inhalt, jahr, laufend } = await gruppenLesen(tor.zugang, async (kontext) => {
    const [uhr] = await kontext.abfrage<{ heute: string }>(
      `select app.berlin_heute()::text as heute`);
    const gewaehlt = jahrAus(parameter['jahr'], uhr!.heute);
    const zeitraum = ganzesJahr(gewaehlt);
    return {
      inhalt: await kinder(kontext, zeitraum),
      jahr: gewaehlt,
      laufend: Number(uhr!.heute.slice(0, 4)),
    };
  });

  return (
    <GruppenRahmen zugang={tor.zugang} titel={eintrag.titel} aktiverTab="berichte">
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <div className="min-w-0">
          <h1 className="text-h1 text-text">{eintrag.titel}</h1>
          <p className="mt-s1 max-w-prose text-sm text-text-muted">{eintrag.beschreibung}</p>
        </div>
        <Link href={alsRoute('/portal/gruppe/berichte')} data-cse="zu-berichten"
              className="text-sm text-text underline underline-offset-2">
          Alle Berichte
        </Link>
      </div>

      <nav aria-label="Jahr" data-cse="jahr-wahl" className="mb-s5 flex flex-wrap gap-s2">
        {[laufend - 2, laufend - 1, laufend].map((j) => (
          <Link key={j} href={alsRoute(`${pfad}?jahr=${String(j)}`)}
                data-cse={`jahr-${String(j)}`}
                aria-current={j === jahr ? 'page' : undefined}
                className={`inline-flex min-h-11 items-center rounded-md border px-s4 text-sm
                            ${j === jahr
                              ? 'border-line-strong bg-surface-3 text-text'
                              : 'border-line text-text-muted hover:border-line-strong'}`}>
            {j}
          </Link>
        ))}
      </nav>

      {inhalt}

      <Hinweis art="hinweis" cse="gruppe-lesend" className="mt-s6 max-w-prose">
        <strong>Die Gruppenansicht liest nur.</strong> Zahlen entstehen in den Gesellschaften;
        hier stehen sie nebeneinander. Den CSV-Ausgang gibt es im Bereich — das Recht dazu
        gehört einer Gesellschaft, nicht der Gruppe.
        {fussnote === undefined ? null : <> {fussnote}</>}
      </Hinweis>
    </GruppenRahmen>
  );
}
