import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { stundenAusMinuten } from '@/lib/datum/stunden';

/**
 * `/portal/[mandant]/dienstplan/konflikte` — der Konflikteingang (TIM-05,
 * TIM-06, TIM-14, SEC-04).
 *
 * Zwei Sorten stehen hier, und der Unterschied ist der ganze Punkt:
 *
 * - **Blockierend.** Ein Wachmann ohne gueltigen Nachweis, § 34a GewO. Es
 *   gibt keinen Uebergehen-Knopf, und das Formular fehlt hier nicht aus
 *   Versehen — es gibt nichts zu entscheiden.
 * - **Warnend.** Eine ArbZG-Ueberschreitung etwa. Sie laesst sich quittieren,
 *   aber nur **mit Begruendung**: eine leere Quittung ist kein Vorgang,
 *   sondern ein Klick, und im Streit steht dann da, dass jemand etwas
 *   weggeklickt hat.
 *
 * Ein Konflikt, der eine andere Gesellschaft betrifft, sagt DASS — nie wo
 * und fuer wen (K-06). Der Planer erfaehrt, dass die Person anderweitig
 * gebunden ist; alles Weitere geht ihn nichts an.
 */
export const dynamic = 'force-dynamic';

interface KonfliktZeile {
  readonly id: string;
  readonly art: string;
  readonly schwere: string;
  readonly blockiert: boolean;
  readonly fremd: boolean;
  readonly person: string;
  readonly beginn_lokal: string;
  readonly ende_lokal: string;
  readonly einsatz_id: string | null;
  readonly objekt: string | null;
  readonly ist_minuten: number | null;
  readonly grenzwert_minuten: number | null;
  readonly regel: string | null;
  /** Die Gegenschichten einer Überschneidung — fertig beschriftet, Europe/Berlin. */
  readonly gegenschichten: readonly string[];
}

/**
 * Die Schluessel sind die WIRKLICHEN Werte von `konflikt_art`.
 *
 * Sie lauteten `arbeitszeit`, `qualifikation` und `unterbesetzung` — keiner
 * davon existiert. Das Enum ist ('ueberschneidung','qualifikation_entfallen',
 * 'arbzg','aufzeichnungsfrist'), und ein Zugriff mit unbekanntem Schluessel
 * gab `undefined`: im Eingang stand der rohe Enum-Wert statt einer
 * Bezeichnung. Derselbe Fehler steckte im Plan (`daten.ts`), dort mit der
 * teureren Wirkung — jeder Ruhezeitverstoss las sich als „Unterbesetzt".
 */
const ART_TEXT: Readonly<Record<string, string>> = {
  arbzg: 'Arbeitszeit',
  qualifikation_entfallen: 'Nachweis',
  ueberschneidung: 'Überschneidung',
  aufzeichnungsfrist: 'Aufzeichnungsfrist',
};

/**
 * Bei welchen Regeln der Grenzwert eine UNTERgrenze ist.
 *
 * Die Karte schrieb „4,07 h statt höchstens 11,00 h" — und das ist bei einer
 * Ruhezeit schlicht falsch herum: § 5 ArbZG verlangt elf Stunden MINDESTENS.
 * Eine Warnung, die ihren eigenen Paragrafen verdreht, macht aus einem Befund
 * eine Formulierung, der niemand traut — und im Streit steht sie so im Ausdruck.
 */
const MINDESTWERT = new Set(['ruhezeit_unter_11h']);

const REGEL_TEXT: Readonly<Record<string, string>> = {
  tagesarbeitszeit_ueber_8h: 'Tagesarbeitszeit über 8 Stunden (§ 3 ArbZG)',
  tagesarbeitszeit_ueber_10h: 'Tagesarbeitszeit über 10 Stunden (§ 3 ArbZG)',
  ruhezeit_unter_11h: 'Ruhezeit unter 11 Stunden (§ 5 ArbZG)',
  pause_fehlt_ueber_6h: 'Pause fehlt bei über 6 Stunden (§ 4 ArbZG)',
  pause_fehlt_ueber_9h: 'Pause zu kurz bei über 9 Stunden (§ 4 ArbZG)',
  ausgleichszeitraum_ueberschritten: 'Ausgleichszeitraum überschritten (§ 3 Satz 2 ArbZG)',
};

export default async function Konflikteingang(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/dienstplan/konflikte`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const zeilen = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => kontext.abfrage<KonfliktZeile>(
      `select k.id, k.art::text as art, k.schwere::text as schwere, k.blockiert,
              k.betrifft_fremden_mandant as fremd,
              (p.vorname || ' ' || p.nachname) as person,
              to_char((k.zeitraum_beginn at time zone 'Europe/Berlin'), 'DD.MM.YYYY HH24:MI')
                                             as beginn_lokal,
              to_char((k.zeitraum_ende   at time zone 'Europe/Berlin'), 'DD.MM. HH24:MI')
                                             as ende_lokal,
              k.einsatz_id, o.bezeichnung as objekt,
              v.ist_minuten, v.grenzwert_minuten, v.regel::text as regel,
              -- Die Gegenschichten stehen seit dem ersten Tag in details, und
              -- niemand las sie: im Eingang stand „Überschneidung", ohne zu
              -- sagen WOGEGEN. Eine Warnung, die die Gegenschicht nicht nennt,
              -- laesst sich nicht aufloesen -- nur quittieren.
              -- jsonb_typeof davor, weil ein einmal doppelt kodiertes details
              -- eine JSON-ZEICHENKETTE ist: der Pfadzugriff liefert dort nichts
              -- Brauchbares, und jsonb_array_elements_text braeche die Seite.
              -- (Kommentar ohne Backticks: einer im Template-Literal beendet
              --  die Zeichenkette und bricht den Build.)
              coalesce((
                select array_agg(t.x)
                  from jsonb_array_elements_text(
                         case when jsonb_typeof(k.details->'gegenschichten') = 'array'
                              then k.details->'gegenschichten'
                              else '[]'::jsonb end) as t(x)
              ), '{}'::text[]) as gegenschichten
         from planungs_konflikt k
         join person p on p.id = k.person_id
         left join einsatz e on e.mandant_id = k.mandant_id and e.id = k.einsatz_id
         left join objekt  o on o.mandant_id = k.mandant_id and o.id = e.objekt_id
         left join arbeitszeit_verstoss v on v.id = k.arbeitszeit_verstoss_id
        where k.status = 'offen' and k.hinfaellig_am is null
        order by k.blockiert desc, k.zeitraum_beginn`,
    ))) as Promise<readonly KonfliktZeile[]>);

  const sperren = zeilen.filter((z) => z.blockiert);
  const warnungen = zeilen.filter((z) => !z.blockiert);

  return (
    <PortalRahmen
      titel="Konflikte"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="dienstplan"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Konflikte</h1>
        <Link
          href={`/portal/${mandant}/dienstplan/woche`}
          className="rounded-md border border-line px-s3 py-s1 text-sm text-text-muted hover:border-line-strong hover:text-text"
        >
          Zum Dienstplan
        </Link>
      </div>

      {zeilen.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Kein offener Konflikt. Das heißt: der Detektor hat gelaufen und nichts
          gefunden — nicht, dass niemand nachgesehen hätte.
        </p>
      ) : (
        <>
          {sperren.length > 0 && (
            <section className="mb-s6">
              <h2 className="mb-s2 text-h3 text-text">Gesperrt</h2>
              <p className="mb-s4 max-w-prose text-sm text-text-muted">
                Diese Einteilungen sind nicht zulässig und lassen sich nicht
                übergehen — § 34a GewO kennt keine Begründung, die einen fehlenden
                Sachkundenachweis ersetzt. Die Einteilung muss geändert werden.
              </p>
              <ul className="m-0 list-none p-0">
                {sperren.map((z) => (
                  <Karte key={z.id} zeile={z} mandant={mandant} quittierbar={false} pfad={pfad} />
                ))}
              </ul>
            </section>
          )}

          {warnungen.length > 0 && (
            <section>
              <h2 className="mb-s2 text-h3 text-text">Zu entscheiden</h2>
              <p className="mb-s4 max-w-prose text-sm text-text-muted">
                Diese Konflikte lassen sich quittieren. Die Begründung bleibt bei
                dem Konflikt stehen — sie ist die Spur, dass jemand die Warnung
                gesehen und trotzdem so geplant hat.
              </p>
              <ul className="m-0 list-none p-0">
                {warnungen.map((z) => (
                  <Karte key={z.id} zeile={z} mandant={mandant} quittierbar pfad={pfad} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </PortalRahmen>
  );
}

function Karte({
  zeile, mandant, quittierbar, pfad,
}: {
  readonly zeile: KonfliktZeile; readonly mandant: string;
  readonly quittierbar: boolean; readonly pfad: string;
}) {
  return (
    <li
      data-cse="konflikt"
      data-konflikt={zeile.id}
      data-blockiert={zeile.blockiert ? 'ja' : 'nein'}
      className="mb-s3 rounded-lg border border-line bg-surface p-s4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-s3">
        <span className="text-base text-text">
          {/* §9: das Wort traegt die Bedeutung, nicht die Farbe. */}
          <strong className={zeile.blockiert ? 'text-danger' : 'text-warning'}>
            {zeile.blockiert ? 'Gesperrt' : 'Warnung'}
          </strong>
          {' · '}
          {ART_TEXT[zeile.art] ?? zeile.art}
          {zeile.fremd && ' · über Gesellschaften hinweg'}
        </span>
        <span className="text-sm tabular-nums text-text-muted">
          {zeile.beginn_lokal} – {zeile.ende_lokal}
        </span>
      </div>

      <p className="m-0 mt-s2 text-sm text-text-muted">
        {zeile.person}
        {zeile.objekt !== null && ` · ${zeile.objekt}`}
        {zeile.regel !== null && ` · ${REGEL_TEXT[zeile.regel] ?? zeile.regel}`}
        {zeile.ist_minuten !== null && zeile.grenzwert_minuten !== null
          && ` · ${stundenAusMinuten(zeile.ist_minuten)} statt `
            + `${MINDESTWERT.has(zeile.regel ?? '') ? 'mindestens' : 'höchstens'} `
            + `${stundenAusMinuten(zeile.grenzwert_minuten)}`}
      </p>

      {zeile.gegenschichten.length > 0 && (
        <p data-cse="gegenschicht" className="m-0 mt-s2 max-w-prose text-sm text-warning">
          Gegenschicht: {zeile.gegenschichten.join(' · ')}
        </p>
      )}

      {zeile.einsatz_id !== null && (
        <p className="m-0 mt-s2 text-sm">
          <Link
            href={`/portal/${mandant}/dienstplan/einsatz/${zeile.einsatz_id}`}
            className="text-text underline-offset-2 hover:text-brand hover:underline"
          >
            Zur Schicht
          </Link>
        </p>
      )}

      {quittierbar ? (
        <form action="/api/konflikt" method="post" className="mt-s4 flex flex-wrap items-end gap-s3">
          <input type="hidden" name="konflikt" value={zeile.id} />
          <input type="hidden" name="mandant" value={mandant} />
          <input type="hidden" name="zurueck" value={pfad} />
          <label className="flex-1">
            <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
              Begründung (mindestens 10 Zeichen)
            </span>
            <input
              name="begruendung"
              required
              minLength={10}
              className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
              placeholder="Warum wird trotzdem so geplant?"
            />
          </label>
          <Button type="submit" variante="secondary">Quittieren</Button>
        </form>
      ) : (
        <p className="m-0 mt-s3 text-sm text-danger">
          Nicht quittierbar — die Einteilung muss geändert werden.
        </p>
      )}
    </li>
  );
}

