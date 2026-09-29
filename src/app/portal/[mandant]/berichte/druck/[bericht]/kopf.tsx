import { MASSE_DRUCK } from '@/lib/design/theme';
import { tagInSprache } from '@/lib/datum/kalendertag';
import type { BerichtDruckTexte } from '@/lib/i18n/verwaltung/bericht-druck';

/**
 * Der Kopf des Berichtsblatts — Gesellschaft, Kopflinie, Titel, Zeitraum,
 * Körnung und Stand (REP-07, V-227, V-269, D-765).
 *
 * **Der Stand ist ein Kalendertag in der Sprache des Rahmens** (D-733 Nr. 1
 * und 2): die Datenbank liefert `app.berlin_heute()` als JJJJ-MM-TT, das
 * Blatt schreibt ihn — deutsch „28.09.2026", englisch „28 Sept 2026". Bis
 * V-269 formatierte die Abfrage ihn mit `to_char(…, 'DD.MM.YYYY')`, und im
 * englischen Rahmen stand „As of: 28.09.2026". Deutsch bleibt die Tabelle
 * darunter (D-721 Nr. 4), nicht der Kopf.
 *
 * Firmenzeile und Titel tragen die Klassen `firma` und `h1`, deren Masse die
 * Token aus DESIGN §11 in `./stil.ts` setzen — kein Literal hier.
 */
export function BlattKopf({ t, sprache, firma, titel, jahr, koernung, heute }: {
  readonly t: BerichtDruckTexte;
  /** Die Sprache der Sitzung — die des Rahmens (`null`: deutsch). */
  readonly sprache: string | null;
  readonly firma: string;
  readonly titel: string;
  readonly jahr: number;
  /** `null` für einen Bericht ohne Körnung. */
  readonly koernung: keyof BerichtDruckTexte['koernungen'] | null;
  /** Der Berliner Kalendertag der Datenbank, JJJJ-MM-TT. */
  readonly heute: string;
}) {
  return (
    <>
      <header>
        <p className="firma">{firma}</p>
        <hr className="kopflinie" />
      </header>

      <h1>{titel}</h1>
      <dl data-cse="bericht-druck-kopf" style={{ margin: `${MASSE_DRUCK['druck-block']} 0` }}>
        <div>
          <dt style={{ display: 'inline' }}>{`${t.zeitraum}: `}</dt>
          <dd style={{ display: 'inline', margin: 0 }}>{String(jahr)}</dd>
        </div>
        {koernung === null ? null : (
          <div>
            <dt style={{ display: 'inline' }}>{`${t.koernung}: `}</dt>
            <dd style={{ display: 'inline', margin: 0 }}>{t.koernungen[koernung]}</dd>
          </div>
        )}
        <div>
          <dt style={{ display: 'inline' }}>{`${t.stand}: `}</dt>
          <dd data-cse="bericht-druck-stand" style={{ display: 'inline', margin: 0 }}>
            {tagInSprache(heute, sprache)}
          </dd>
        </div>
      </dl>
    </>
  );
}
