import type { ReactNode } from 'react';
import Link from 'next/link';
import { AreaBadge } from '@/components/ui/AreaBadge';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { Icon } from '@/components/ui/Icon';
import { stundenMinutenText } from '@/lib/datum/stunden';
import type { BereichSchluessel } from '@/lib/design/theme';
import type { MeinTexte } from '@/lib/i18n/texte';
import type { EigeneSchicht } from '@/server/services/mitarbeiter/schichten';

/**
 * Die wiederkehrenden Bausteine der Arbeiterseiten.
 *
 * **Hier wird kein Bauteil ERFUNDEN.** DESIGN §12: „No component invented ad
 * hoc — extend this file first." Was hier steht, ist Zusammensetzung aus dem,
 * was `src/components/**` schon hat — `AreaBadge`, `StatusPill`, `Icon` — plus
 * Abstands- und Farbklassen aus dem Thema. Kein Hex, keine eigene Groesse,
 * kein neuer Zustand: `StatusPill` nimmt nur sein festes Vokabular, und was
 * sich darauf nicht abbilden laesst, steht als Text daneben statt als
 * erfundene Pille.
 *
 * Die Datei liegt bei den Seiten und nicht in `components/`, weil sie genau
 * diesen Seiten gehoert: ein `SchichtKarte` ausserhalb des Mitarbeiterportals
 * gibt es nicht.
 */

const BEREICHE = new Set<string>(['reinigung', 'security', 'bau', 'operations']);

/**
 * Die Gesellschaft einer Zeile — als NAME, nicht als Farbe (DESIGN §9).
 *
 * Ein unbekannter Slug faellt auf den Klartextnamen zurueck, statt gar nichts
 * zu zeigen: eine Zeile ohne Gesellschaft waere in einem Portal, das zwei
 * Arbeitsverhaeltnisse nebeneinander fuehrt, unbrauchbar (EMP-14).
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
 * Eine Schicht als Karte.
 *
 * Die Uhrzeiten kommen fertig aus der Datenbank, in Berliner Ortszeit
 * (Invariante 2). Das `+1` hinter dem Ende ist kein Schmuck: ohne es laese
 * sich `22:00 – 06:00` wie sechs Stunden rueckwaerts.
 */
export function SchichtKarte({
  schicht, texte, alsLink = true,
}: {
  readonly schicht: EigeneSchicht;
  readonly texte: MeinTexte;
  readonly alsLink?: boolean;
}) {
  const inhalt = (
    <>
      <div className="mb-s3 flex flex-wrap items-center gap-s3">
        <Gesellschaft slug={schicht.mandantSlug} name={schicht.mandantName} />
        <StatusPill zustand={schichtPille(schicht)} />
        {schicht.zeitanomalie !== 'keine' && (
          <span data-cse="zeitanomalie" className="text-sm text-warning">
            <Icon name="warnung" groesse="sm" className="inline-block align-[-2px]" />{' '}
            {schicht.zeitanomalie === 'dst_luecke' ? '23-Stunden-Tag' : '25-Stunden-Tag'}
          </span>
        )}
      </div>
      <Felder>
        <Feld label={texte.objekt}>{schicht.objekt ?? '—'}</Feld>
        <Feld label={texte.beginn}>
          <span className="cse-zahl">{schicht.beginnLokal}</span>
        </Feld>
        <Feld label={texte.ende}>
          <span className="cse-zahl">{schicht.endeLokal}</span>
          {schicht.endetAmFolgetag && (
            <span data-cse="folgetag" className="ms-s2 text-sm text-text-muted">+1</span>
          )}
        </Feld>
        <Feld label={texte.dauer}>
          <span className="cse-zahl">{stundenMinutenText(schicht.dauerMinuten)}</span>
        </Feld>
      </Felder>
    </>
  );

  const klassen = 'block rounded-lg border border-line bg-surface p-s4 no-underline';
  return alsLink ? (
    <Link
      href={`/portal/mein/schichten/${schicht.zuordnungId}`}
      data-cse="schicht"
      data-mandant={schicht.mandantSlug}
      className={`${klassen} transition-colors duration-fast hover:bg-surface-2`}
    >
      {inhalt}
    </Link>
  ) : (
    <div data-cse="schicht" data-mandant={schicht.mandantSlug} className={klassen}>
      {inhalt}
    </div>
  );
}

/**
 * Der Zustand einer Schicht auf das feste Pillenvokabular abgebildet
 * (DESIGN §5).
 *
 * Abgebildet und nicht erfunden: `StatusPill` laesst eine unbekannte
 * Beschriftung gar nicht erst zu, und das ist der Sinn — eine Seite soll
 * keinen Zustand zeigen, den der Rest der Plattform nicht kennt.
 */
function schichtPille(s: EigeneSchicht): PillZustand {
  if (s.status === 'abgesagt') return 'Abgelehnt';
  if (s.status === 'nicht_erschienen') return 'Fehler';
  if (s.einsatzStatus === 'storniert') return 'Archiviert';
  if (s.einsatzStatus === 'abgeschlossen') return 'Abgeschlossen';
  if (s.laeuftJetzt) return 'In Arbeit';
  if (s.status === 'zugesagt') return 'Bereit';
  return 'Geplant';
}

/** „Nichts da" als Satz, nicht als leere Flaeche. */
export function Leer({ text }: { readonly text: string }) {
  return (
    <p data-cse="leer" className="m-0 text-base text-text-muted">{text}</p>
  );
}
