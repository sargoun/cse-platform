import type { ReactNode } from 'react';
import Link from 'next/link';
import { AreaBadge } from '@/components/ui/AreaBadge';
import { Icon } from '@/components/ui/Icon';
import { Hinweis } from '@/components/ui/Hinweis';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * Die wiederkehrenden Bausteine der Kundenseiten.
 *
 * **Hier wird kein Bauteil ERFUNDEN.** DESIGN §12: „No component invented ad
 * hoc — extend this file first." Was hier steht, ist Zusammensetzung aus dem,
 * was `src/components/**` schon hat — `AreaBadge`, `Icon` — plus Abstands- und
 * Farbklassen aus dem Thema (`s1`…`s7`, `text-text`, `text-text-muted`,
 * `border-line`, `bg-surface`). Kein Hex, keine eigene Groesse.
 *
 * Die Datei liegt bei den Seiten und nicht in `components/`, aus demselben
 * Grund wie `portal/mein/bausteine.tsx`: sie gehoert genau diesen Seiten. Ein
 * `Offen`-Hinweis mit O-Nummer ausserhalb eines Portals, das auf Antworten
 * wartet, gibt es nicht.
 */

const BEREICHE = new Set<string>(['reinigung', 'security', 'bau', 'operations']);

/**
 * Die liefernde Gesellschaft einer Zeile — als NAME, nicht als Farbe
 * (DESIGN §9: Farbe ist nie das einzige Signal).
 *
 * **Sie steht an JEDER Zeile, und das ist eine Anforderung, keine Zierde.**
 * 04-SEITENKARTE §8 verlangt „each row labelled with the supplying entity —
 * which is what CRM-06 asks for", und der Fall dahinter ist O-52: ein Login,
 * zwei Gesellschaften der Gruppe. Ohne die Spalte saehen zwei Rechnungen
 * gleich aus, obwohl sie von zwei GmbHs kommen — und der Kunde ueberweist an
 * die falsche.
 *
 * Ein unbekannter Slug faellt auf den Klartextnamen zurueck, statt gar nichts
 * zu zeigen.
 */
export function Gesellschaft({
  slug, name,
}: { readonly slug: string; readonly name: string }) {
  if (BEREICHE.has(slug)) {
    return (
      <span data-cse="gesellschaft" data-mandant={slug}>
        <AreaBadge bereich={slug as BereichSchluessel} />
      </span>
    );
  }
  return (
    <span data-cse="gesellschaft" data-mandant={slug} className="text-sm text-text">
      {name}
    </span>
  );
}

/** Eine Beschriftung mit ihrem Wert — die Grundform jeder Detailzeile. */
export function Feld({
  label, children,
}: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="contents">
      <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">{label}</dt>
      <dd className="m-0 min-w-0 break-words text-base text-text">{children}</dd>
    </div>
  );
}

/** Ein Block aus `Feld`-Zeilen. 16px Fliesstext, auch auf dem Telefon (§8). */
export function Felder({ children }: { readonly children: ReactNode }) {
  return (
    <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-s4 gap-y-s2">{children}</dl>
  );
}

/**
 * „Nichts da" als Satz, nicht als leere Flaeche.
 *
 * Und der Satz sagt, WARUM nichts da ist. Eine leere Liste im Kundenportal
 * hat zwei Ursachen, die auf dem Bildschirm gleich aussehen: es gibt wirklich
 * nichts, oder eine Policy zeigt nichts (K-18). Deshalb nimmt dieser Baustein
 * einen Text und keinen Vorgabewert.
 */
export function Leer({ text }: { readonly text: string }) {
  return (
    <p
      data-cse="leer"
      className="m-0 rounded-lg border border-line bg-surface p-s5 text-base text-text-muted"
    >
      {text}
    </p>
  );
}

/**
 * Eine Kopfzeile mit Titel und optionaler Beistellung rechts — dieselbe Form
 * wie auf den internen Listen (`flex flex-wrap items-baseline
 * justify-between gap-s3`, `mb-s5`).
 */
export function Kopfzeile({
  titel, children,
}: { readonly titel: string; readonly children?: ReactNode }) {
  return (
    <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
      <h1 className="m-0 text-h1 text-text">{titel}</h1>
      {children}
    </div>
  );
}

/** Der Weg zurueck in die Liste — auf jeder Detailseite an derselben Stelle. */
export function Zurueck({
  ziel, text,
}: { readonly ziel: '/portal/kunde/nachrichten' | '/portal/kunde/reklamationen'
  | '/portal/kunde/rechnungen' | '/portal/kunde/projekte' | '/portal/kunde/nachweise';
  readonly text: string }) {
  return (
    <nav aria-label="Zurück" className="mb-s4">
      <Link href={ziel} className="text-sm text-text-muted underline hover:text-text">
        ← {text}
      </Link>
    </nav>
  );
}

/**
 * Eine offene Geschaeftsfrage, sichtbar an der Stelle, an der sonst ein Knopf
 * staende.
 *
 * **Warum ein Satz und kein deaktivierter Knopf.** Ein ausgegrauter Knopf
 * sagt „nicht jetzt" und laesst offen, ob es an der Anmeldung, am Recht oder
 * am Zustand liegt; der Mensch klickt und lernt nichts. Dieser Baustein sagt
 * stattdessen, was heute der richtige Weg IST, und nennt die Nummer der
 * offenen Frage — damit ein Anruf beim Ansprechpartner zur Entscheidung
 * fuehrt und nicht zu einem Fehlerbericht.
 *
 * Die O-Nummer steht im Text, weil dieselbe Nummer in `docs/DECISIONS.md`
 * unter „Offen" steht: der Bildschirm und das Register nennen denselben
 * Vorgang.
 */
export function Offen({
  nummer, was, weg,
}: {
  readonly nummer: string;
  readonly was: string;
  readonly weg: string;
}) {
  return (
    <Hinweis cse="offen">
      <span className="min-w-0" data-frage={nummer}>
        {/*
          * Das Icon laeuft IM Textfluss und wird von `align-middle`
          * ausgerichtet — nicht von einem Pixelwert. Hier stand `mt-[2px]` in
          * einer Flex-Reihe: ein erfundener Abstand (CLAUDE.md „no one-off
          * padding"), und obendrein ein falscher — `text-sm` hat nach
          * DESIGN §2 eine Zeilenhoehe von 22px, das Icon `sm` misst 16px, die
          * halbe Differenz waere 3px gewesen. Ein Wert, den die Typografie
          * selbst kennt, gehoert nicht in die Seite geschrieben.
          */}
        <Icon name="info" groesse="sm" className="mr-s2 inline align-middle" />
        <strong className="font-medium text-text">{was}</strong> — {weg}{' '}
        <span className="whitespace-nowrap text-text-subtle">offen ({nummer})</span>
      </span>
    </Hinweis>
  );
}

/**
 * Der Satz fuer ein angemeldetes Konto ohne Kundenbindung.
 *
 * **Er steht hier einmal und wird von jeder Kundenseite benutzt.** Vorher
 * stand er in `/portal/kunde/page.tsx`; neun weitere Seiten haetten ihn
 * kopiert, und die zehnte haette stattdessen einen Serverfehler gezeigt.
 *
 * Und er ist ausdruecklich NICHT „keine Daten": `app.sichtbare_mandanten()`
 * gibt im Kunden-Scope die leere Menge zurueck, wenn keine
 * `kunde_zugang`-Zeile existiert (fail closed, K-18). „Keine Rechnungen" und
 * „kein Zugang hinterlegt" sind zwei verschiedene Auskuenfte, und wer sie
 * verwechselt, ruft beim Kunden an.
 */
export function KeinZugang() {
  return (
    <p data-cse="kein-kundenzugang" className="max-w-[72ch] text-base text-text">
      Für diese Anmeldung ist noch kein Kundenzugang hinterlegt. Ohne die
      Zuordnung zu einem Kunden zeigt diese Seite nichts — und das ist nicht
      dasselbe wie „es liegt nichts vor". Ihre Ansprechpartnerin in der
      Verwaltung kann den Zugang freischalten.
    </p>
  );
}
