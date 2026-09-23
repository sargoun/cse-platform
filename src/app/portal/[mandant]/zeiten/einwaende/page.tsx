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
import { listeOffeneEinwaende, type EinwandZeile } from '@/server/services/zeit/einwand';
import { berlinAnzeige } from '@/server/services/zeit/dauer';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * `/portal/[mandant]/zeiten/einwaende` — der Eingang der Planung (EMP-07).
 *
 * **Diese Seite ist die zweite Haelfte von EMP-07.** Die erste ist, dass ein
 * Mitarbeitender seinen Zeiteintrag nicht bearbeiten kann; ohne die zweite
 * waere das keine Verbesserung, sondern eine Verschlechterung: die Person
 * haette ihre Abweichung gemeldet und nie eine Antwort bekommen, und die
 * Aufzeichnung bliebe falsch. „Erreicht die Planung" heisst deshalb: es gibt
 * eine Liste, sie steht in der Tab-Leiste, und die aelteste Meldung steht
 * oben.
 *
 * **Anerkennen aendert hier noch keine Zeit.** Die Entscheidung sagt, DASS
 * die Meldung zutrifft; die neue Fassung des Zeiteintrags praegt die
 * Korrektur mit ihrem eigenen Recht und ihrer eigenen Spur (TIM-11). Der
 * Hinweis darauf steht auf der Karte, weil die haeufigste Verwechslung genau
 * hier passiert: „ich habe es doch anerkannt".
 *
 * Was der Planer NICHT sieht: eine vorbelegte Uebernahme der behaupteten
 * Zeit. Die Behauptung steht als Text daneben (`behauptet_*`), damit sie
 * gelesen und nicht durchgeklickt wird — sie ist die Aussage eines Menschen,
 * keine Messung (Invariante 5).
 */
export const dynamic = 'force-dynamic';

const ART_TEXT: Readonly<Record<string, string>> = {
  eintrag_fehlt: 'Eintrag fehlt',
  zeit_falsch: 'Zeit falsch',
  pause_falsch: 'Pause falsch',
  zuordnung_falsch: 'Zuordnung falsch',
  sonstiges: 'Sonstiges',
};

const STATUS_TEXT: Readonly<Record<string, string>> = {
  offen: 'Offen',
  in_pruefung: 'In Prüfung',
};


/**
 * Die Sätze zu den Gründen, mit denen `api/zeit/einwand/entscheidung`
 * zurückkommt (V-052, D-562).
 *
 * Vorher antwortete die Route auf jede Abweisung mit JSON — eine weisse Seite
 * mit einem Datenfeld für einen Menschen, der gerade „Entscheiden" gedrückt
 * hat, und mit dem getippten Text verloren.
 */
const FEHLERTEXT: Readonly<Record<string, string>> = {
  kein_einwand: 'Es war kein Einwand benannt.',
  unbekannter_status: 'Diesen Zustand gibt es nicht.',
  begruendung_zu_kurz:
    'Eine Entscheidung braucht eine Begründung von mindestens zehn Zeichen. Im '
    + 'Streit steht sonst da, dass jemand etwas weggeklickt hat.',
  nicht_gefunden: 'Diesen Einwand gibt es in dieser Gesellschaft nicht.',
  bereits_entschieden:
    'Über diesen Einwand ist bereits entschieden. Ein neuer Sachverhalt ist ein '
    + 'neuer Einwand.',
  eigener_einwand:
    'Über den eigenen Einwand entscheidet man nicht (EMP-07) — die Aufzeichnung '
    + 'behält ihren Beweiswert nur, wenn die betroffene Person sie nicht selbst bewegt.',
};

export default async function Einwandeingang(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const suche = await searchParams;
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;
  const pfad = `/portal/${mandant}/zeiten/einwaende`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const zeilen = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => listeOffeneEinwaende(kontext)),
  ) as Promise<readonly EinwandZeile[]>);

  return (
    <PortalRahmen
      titel="Zeit-Einwände"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="zeiten"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Zeit-Einwände</h1>
        <span className="text-sm text-text-muted">
          {zeilen.length === 0 ? 'nichts offen' : `${String(zeilen.length)} offen`}
        </span>
      </div>

      {fehler === null ? null : (
        <p
          data-cse="einwand-fehler"
          className="mb-s5 max-w-prose rounded-lg border border-warning bg-warning-soft p-s5 text-sm text-warning"
        >
          <strong>Nichts wurde entschieden.</strong>{' '}
          {FEHLERTEXT[fehler] ?? 'Der Vorgang wurde abgewiesen.'}
        </p>
      )}

      {zeilen.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Kein offener Einwand. Das heißt: gemeldete Abweichungen sind
          entschieden — nicht, dass niemand melden könnte.
        </p>
      ) : (
        <ul className="m-0 list-none p-0">
          {zeilen.map((z) => <Karte key={z.id} zeile={z} mandant={mandant} pfad={pfad} />)}
        </ul>
      )}
    </PortalRahmen>
  );
}

function Karte({ zeile, mandant, pfad }: {
  readonly zeile: EinwandZeile; readonly mandant: string; readonly pfad: string;
}) {
  return (
    <li
      data-cse="einwand"
      data-einwand={zeile.id}
      className="mb-s3 rounded-lg border border-line bg-surface p-s4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-s3">
        <span className="text-base text-text">
          {/* DESIGN §9: das Wort traegt die Bedeutung, nicht die Farbe. */}
          <strong>{STATUS_TEXT[zeile.status] ?? zeile.status}</strong>
          {' · '}
          {ART_TEXT[zeile.art] ?? zeile.art}
        </span>
        <span className="text-sm tabular-nums text-text-muted">{zeile.betrifftDatum}</span>
      </div>

      <p className="m-0 mt-s2 text-sm text-text-muted">
        {zeile.personName}
        {zeile.zeiteintragId === null && ' · zu einem Tag ohne Eintrag'}
        {' · '}
        {/*
          Der Weg auf das Blatt — ohne ihn war die Detailseite gebaut, im
          Routenregister eingetragen, mit Rechten bewacht und fuer niemanden
          erreichbar. Sie traegt das, was auf der Karte nicht Platz hat: die
          Aufzeichnung neben der Behauptung, Geraetezeit und Abweichung
          paarweise, und die Antwort darauf, ob eine Korrektur gefolgt ist.
        */}
        <Link
          href={`/portal/${mandant}/zeiten/einwaende/${zeile.id}`}
          data-cse="zum-einwand"
          className="text-text underline-offset-2 hover:text-brand hover:underline"
        >
          Blatt öffnen
        </Link>
      </p>

      <p className="m-0 mt-s2 max-w-prose text-sm text-text">{zeile.begruendung}</p>

      {(zeile.behauptetBeginn !== null || zeile.behauptetEnde !== null
        || zeile.behauptetPauseMinuten !== null) && (
        <p className="m-0 mt-s2 text-sm text-text-muted">
          Angegeben:
          {zeile.behauptetBeginn !== null && ` ab ${berlinAnzeige(zeile.behauptetBeginn)}`}
          {zeile.behauptetEnde !== null && ` bis ${berlinAnzeige(zeile.behauptetEnde)}`}
          {zeile.behauptetPauseMinuten !== null
            && ` · Pause ${String(zeile.behauptetPauseMinuten)} min`}
          {' — Angabe der Person, keine Messung.'}
        </p>
      )}

      <form
        action="/api/zeit/einwand/entscheidung"
        method="post"
        className="mt-s4 flex flex-wrap items-end gap-s3"
      >
        <input type="hidden" name="einwand" value={zeile.id} />
        <input type="hidden" name="mandant" value={mandant} />
        <input type="hidden" name="zurueck" value={pfad} />
        <label className="flex-1">
          <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
            Begründung (mindestens 10 Zeichen — außer bei „In Prüfung" und
            „Zurückgezogen")
          </span>
          {/*
            * Kein `required`: die Route verlangt die Begründung nur für die
            * drei ENTSCHEIDUNGEN. Ein Pflichtfeld für alle fünf zwänge dazu,
            * einen Satz zu erfinden, wo es nichts zu begründen gibt — und das
            * Einzelblatt daneben hält es schon so.
            */}
          <input
            name="begruendung"
            minLength={10}
            className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
            placeholder="Was wurde geprüft, und was folgt daraus?"
          />
        </label>
        <label>
          <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
            Entscheidung
          </span>
          <select
            name="status"
            defaultValue="anerkannt"
            className="min-h-11 rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
          >
            <option value="in_pruefung">In Prüfung (noch keine Entscheidung)</option>
            <option value="anerkannt">Anerkannt</option>
            <option value="teilweise_anerkannt">Teilweise anerkannt</option>
            <option value="abgelehnt">Abgelehnt</option>
            {/* Siehe die Begründung auf dem Einzelblatt (V-052, O-901). */}
            <option value="zurueckgezogen">
              Zurückgezogen (die Person hat den Einwand zurückgenommen)
            </option>
          </select>
        </label>
        <Button type="submit" variante="secondary">Entscheiden</Button>
      </form>

      <p className="m-0 mt-s3 text-sm text-text-muted">
        Anerkennen ändert die Zeit noch nicht — die neue Fassung entsteht mit
        der Korrektur, und die trägt ihre eigene Spur.
      </p>
    </li>
  );
}
