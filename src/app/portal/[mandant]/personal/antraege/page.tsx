import Link from 'next/link';
import type postgres from 'postgres';
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
import { listeOffeneAntraege, type AntragZeile }
  from '@/server/services/abwesenheit/antrag';

/**
 * `/portal/[mandant]/personal/antraege` — der Genehmigungseingang (EMP-10,
 * NOT-01).
 *
 * **Das Älteste steht oben.** Ein Posteingang, der nach Datum des Urlaubs
 * sortiert, lässt den Antrag von vorgestern unter den Sommeranträgen
 * verschwinden — und der Mensch, der ihn gestellt hat, wartet.
 *
 * **Der Grund einer Krankmeldung steht hier nicht.** Was der Antrag zeigt, ist
 * Art, Zeitraum und Nachricht des Antragstellers; ob jemand krank ist und
 * woran, ist ein Gesundheitsdatum und hängt an einem eigenen Recht
 * (Art. 9 DSGVO, LEG-09).
 *
 * **Genehmigen ist kein Klick ins Leere:** es schreibt die Abwesenheit, rechnet
 * die Arbeitstage und bucht das Urlaubskonto. Fehlt der Anspruch des Jahres,
 * bricht der Dienst mit genau diesem Satz ab — lieber ein sichtbarer Halt als
 * ein Resturlaub im Minus, den niemand entschieden hat (O-18).
 */
export const dynamic = 'force-dynamic';

export default async function Antragseingang(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/personal/antraege`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={mandant} zielSlug={tor.ziel} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const zeilen = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => listeOffeneAntraege(kontext)),
  ) as Promise<readonly AntragZeile[]>);

  return (
    <PortalRahmen
      titel="Anträge"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Anträge</h1>
        <span className="text-sm text-text-muted">
          {zeilen.length === 0 ? 'nichts offen' : `${String(zeilen.length)} offen`}
        </span>
      </div>

      <nav className="mb-s5 flex flex-wrap gap-s2">
        <Link
          href={`/portal/${mandant}/personal/abwesenheiten`}
          className="inline-flex min-h-11 items-center rounded-md border border-line px-s3 text-sm text-text-muted transition-colors duration-fast hover:border-line-strong hover:text-text"
        >
          Abwesenheiten
        </Link>
      </nav>

      {zeilen.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Kein offener Antrag. Das heißt: entschieden ist entschieden — nicht,
          dass niemand etwas beantragen könnte.
        </p>
      ) : (
        <ul className="m-0 list-none p-0">
          {zeilen.map((a) => <Karte key={a.id} antrag={a} mandant={mandant} pfad={pfad} />)}
        </ul>
      )}

      <p className="mt-s5 max-w-prose text-sm text-text-muted">
        Eine Genehmigung schreibt die Abwesenheit, rechnet die Arbeitstage ohne
        Wochenenden und Berliner Feiertage und bucht sie auf das Urlaubskonto
        des Jahres. Welche Wochentage als Arbeitstage gelten, ist noch nicht
        entschieden — ausgeliefert ist Montag bis Freitag (O-18).
      </p>
    </PortalRahmen>
  );
}

function Karte({ antrag, mandant, pfad }: {
  readonly antrag: AntragZeile; readonly mandant: string; readonly pfad: string;
}) {
  return (
    <li
      data-cse="antrag"
      data-antrag={antrag.id}
      className="mb-s3 rounded-lg border border-line bg-surface p-s4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-s3">
        <span className="text-base text-text">
          <strong>{antrag.art}</strong>
          {' · '}
          {antrag.personName}
        </span>
        <span className="text-sm tabular-nums text-text-muted">
          {antrag.vonDatum !== null && antrag.bisDatum !== null
            ? `${antrag.vonDatum} bis ${antrag.bisDatum}`
            : 'ohne Zeitraum'}
        </span>
      </div>

      {antrag.nachricht !== null && (
        <p className="m-0 mt-s2 max-w-prose text-sm text-text">{antrag.nachricht}</p>
      )}

      <form
        action={`/api/antraege/${antrag.id}`}
        method="post"
        className="mt-s4 flex flex-wrap items-end gap-s3"
      >
        <input type="hidden" name="mandant" value={mandant} />
        <input type="hidden" name="zurueck" value={pfad} />
        <label className="flex-1">
          <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
            Kommentar (bei Ablehnung Pflicht)
          </span>
          <input
            name="kommentar"
            className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
            placeholder="Was spricht dafür oder dagegen?"
          />
        </label>
        <Button type="submit" name="entscheidung" value="genehmigt" variante="primary">
          Genehmigen
        </Button>
        <Button type="submit" name="entscheidung" value="abgelehnt" variante="secondary">
          Ablehnen
        </Button>
      </form>
    </li>
  );
}
