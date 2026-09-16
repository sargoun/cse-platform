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
import { haeltRechte } from '@/app/portal/rechte';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import {
  ART_TEXT, WACHBUCH_ARTEN, istWachbuchArt, leseBuch, type EintragZeile,
} from '@/server/services/security/wachbuch';

/**
 * `/portal/[mandant]/security/wachbuch` — das Buch über alle Objekte
 * (SEC-05, LEG-01).
 *
 * **Filter als Links, nicht als Skript.** Die Seite ist eine Server-Komponente
 * und die Filter stehen in der Adresse: das Buch lässt sich verschicken,
 * lesezeichnen und ohne JavaScript bedienen — und in einem Objekt ohne
 * Empfang ist das kein Komfort, sondern der Unterschied zwischen benutzbar und
 * nicht.
 *
 * **Ein stornierter Eintrag verschwindet NICHT.** Er steht durchgestrichen da,
 * mit seinem Grund und einem Verweis auf die Richtigstellung. Ein Buch, aus
 * dem die falsche Seite verschwindet, beweist nichts — erst das Nebeneinander
 * von Irrtum und Korrektur tut es.
 */
export const dynamic = 'force-dynamic';

interface Objektzeile { readonly id: string; readonly bezeichnung: string }

export default async function Wachbuch(
  {
    params, searchParams,
  }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const suche = await searchParams;
  const pfad = `/portal/${mandant}/security/wachbuch`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  const darf = await haeltRechte(sitzung, 'wachbuch.schreiben');
  if (sitzung.aktiverMandantId === null) notFound();

  const einzeln = (feld: string): string | null => {
    const wert = suche[feld];
    return typeof wert === 'string' && wert !== '' ? wert : null;
  };
  const objektFilter = einzeln('objekt');
  const artRoh = einzeln('art');
  const artFilter = istWachbuchArt(artRoh) ? artRoh : null;

  const { eintraege, objekte } = await (db().begin(
    SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => ({
        eintraege: await leseBuch(kontext, {
          objektId: objektFilter, art: artFilter,
          von: einzeln('von'), bis: einzeln('bis'),
        }),
        objekte: await kontext.abfrage<Objektzeile>(
          `select id, bezeichnung from objekt
            where archiviert_am is null order by bezeichnung`,
        ),
      }))) as Promise<{
        eintraege: readonly EintragZeile[]; objekte: readonly Objektzeile[];
      }>);

  /**
   * Die Filterpille als LINK, nicht als Knopf.
   *
   * `components/ui/FilterPill` ist ein `<button onClick>` und damit eine
   * Client-Komponente; diese Seite rendert auf dem Server und stellt ihre
   * Filter in die Adresse (teilbar, lesezeichenfähig, ohne JavaScript
   * bedienbar). Die Klassen sind deshalb WÖRTLICH die der Komponente
   * (DESIGN §5: inaktiv `--surface-3` + `--text-muted`, aktiv Weiss auf
   * `--ink`) — dasselbe Aussehen, dasselbe Vokabular, nur ein anderes
   * Element. Ein eigener Farbwert stünde hier nicht.
   */
  const pille = (aktiv: boolean): string => [
    'inline-flex min-h-11 shrink-0 items-center rounded-full px-s4 text-sm no-underline',
    aktiv ? 'bg-white text-ink' : 'bg-surface-3 text-text-muted hover:text-text',
  ].join(' ');

  return (
    <PortalRahmen
      titel="Wachbuch"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Wachbuch</h1>
        {/*
          * Der neue Eintrag dahinter öffnet mit `wachbuch.schreiben` (Manifest);
          * diese Seite mit `wachbuch.lesen`. Wer das Buch lesen darf, darf nicht
          * zwangsläufig hineinschreiben — ohne das Schreibrecht führte der Knopf
          * auf 404 und verriete, was er nicht zeigen darf (AUT-06; Copilot-Runde
          * auf PR 16 / D-581).
          */}
        {darf['wachbuch.schreiben'] === true && (
          <Link href={`/portal/${mandant}/security/wachbuch/neu`} className="no-underline">
            <Button variante="primary">Eintrag schreiben</Button>
          </Link>
        )}
      </div>

      <nav aria-label="Filter" className="mb-s5 flex flex-wrap items-center gap-s2">
        <Link
          href={`/portal/${mandant}/security/wachbuch`}
          className={pille(artFilter === null && objektFilter === null)}
        >
          Alles
        </Link>
        {WACHBUCH_ARTEN.map((a) => (
          <Link
            key={a}
            href={`/portal/${mandant}/security/wachbuch?art=${a}${objektFilter === null ? '' : `&objekt=${objektFilter}`}`}
            className={pille(artFilter === a)}
          >
            {ART_TEXT[a]}
          </Link>
        ))}
        {objekte.map((o) => (
          <Link
            key={o.id}
            href={`/portal/${mandant}/security/wachbuch?objekt=${o.id}${artFilter === null ? '' : `&art=${artFilter}`}`}
            className={pille(objektFilter === o.id)}
          >
            {o.bezeichnung}
          </Link>
        ))}
      </nav>

      {eintraege.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Kein Eintrag in diesem Ausschnitt. Das heisst: es wurde nichts
          eingetragen — nicht, dass nichts passiert ist.
        </p>
      ) : (
        <ul className="m-0 list-none p-0">
          {eintraege.map((e) => (
            <li
              key={e.id}
              data-cse="wachbuch-eintrag"
              data-eintrag={e.id}
              data-storniert={e.storniert ? 'ja' : 'nein'}
              className="mb-s3 rounded-lg border border-line bg-surface p-s4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-s3">
                <Link
                  href={`/portal/${mandant}/security/wachbuch/${e.id}`}
                  className="text-base text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  <span className="tabular-nums text-text-muted">{e.nummer}</span>
                  {' · '}
                  <span className={e.storniert ? 'line-through' : undefined}>{e.betreff}</span>
                </Link>
                <span className="text-sm tabular-nums text-text-muted">{e.erfasstLokal}</span>
              </div>
              <p className="m-0 mt-s2 text-sm text-text-muted">
                {ART_TEXT[e.art]}
                {' · '}
                {e.objekt}
                {' · '}
                {e.urheber}
                {e.nachgetragen && ' · nachgetragen'}
                {e.storniert && (
                  <span className="ml-s2 text-danger">Storniert: {e.stornoGrund}</span>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </PortalRahmen>
  );
}
