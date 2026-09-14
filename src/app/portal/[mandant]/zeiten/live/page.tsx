import { notFound } from 'next/navigation';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Icon } from '@/components/ui/Icon';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { stundenMinutenText } from '@/lib/datum/stunden';
import { ladeLaufende } from '../daten';

/**
 * `/portal/[mandant]/zeiten/live` — „Aktuell im Einsatz" (DSH-05, TIM-08).
 *
 * **Dieselbe Sicht wie die Kachel des Dashboards** (`zeiteintrag_offen`).
 * Nicht „dieselbe Bedingung, nochmal geschrieben": eine zweite Fassung
 * derselben Frage driftet, und eine Kachel, die etwas anderes sagt als ihre
 * Liste, macht beide unglaubwürdig (DSH-04).
 *
 * **Die Seite tickt nicht.** Sie zeigt einen Stand, und der steht dabei. Eine
 * Zahl, die im Browser weiterläuft, während der Server längst etwas anderes
 * weiss, ist die falsche Art von Lebendigkeit — die Minuten hier kommen aus
 * `now()` der Datenbank (Invariante 5).
 *
 * **Lange Läufer stehen oben markiert.** Ein Eintrag über zwölf Stunden ist
 * fast immer eine vergessene Abmeldung, und je später sie auffällt, desto
 * schwerer ist sie zu rekonstruieren — die Korrektur braucht dann eine
 * Begründung und einen Menschen, der sich erinnert (TIM-11).
 */
export const dynamic = 'force-dynamic';

/** Ab wann ein laufender Eintrag als auffällig gilt: die ArbZG-Höchstgrenze. */
const AUFFAELLIG_AB_MINUTEN = 600;

const ERFASSUNGSART_TEXT: Readonly<Record<string, string>> = {
  checkin_token: 'Check-in-Link',
  portal: 'Portal',
  planer_manuell: 'von der Planung gesetzt',
  nacherfassung: 'nacherfasst',
  import: 'importiert',
};

export default async function LiveBrettSeite(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/zeiten/live`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const { standLokal, zeilen } = await ladeLaufende(sitzung);
  const auffaellig = zeilen.filter((z) => z.minuten >= AUFFAELLIG_AB_MINUTEN);

  return (
    <PortalRahmen
      titel="Aktuell im Einsatz"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="zeiten"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Aktuell im Einsatz</h1>
        <p className="m-0 text-sm text-text-muted">
          Stand <span className="tabular-nums">{standLokal}</span>
          {' · '}
          {zeilen.length === 1 ? '1 Eintrag' : `${String(zeilen.length)} Einträge`}
        </p>
      </div>

      <nav aria-label="Weiter im Zeitbereich" className="mb-s4 flex flex-wrap gap-s2">
        <a
          href={`/portal/${mandant}/zeiten`}
          className="inline-flex min-h-11 items-center gap-s2 rounded-md border border-line px-s3 text-sm text-text-muted transition-colors duration-fast hover:border-line-strong hover:text-text"
        >
          <Icon name="zeit" groesse="sm" />
          Alle Zeiten der Woche
        </a>
      </nav>

      {zeilen.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Gerade ist niemand eingestempelt. Das heißt: kein offener Eintrag —
          nicht, dass niemand arbeitet. Wer ohne Check-in-Link arbeitet, taucht
          hier erst mit der Nacherfassung auf.
        </p>
      ) : (
        <>
          {auffaellig.length > 0 && (
            <p className="mb-s4 rounded-lg border border-warning bg-warning-soft p-s4 text-sm text-warning">
              <Icon name="warnung" groesse="sm" className="mr-s2 inline-block align-[-2px]" />
              {auffaellig.length === 1
                ? 'Ein Eintrag läuft länger als zehn Stunden.'
                : `${String(auffaellig.length)} Einträge laufen länger als zehn Stunden.`}
              {' '}
              Das ist fast immer eine vergessene Abmeldung — und § 3 ArbZG kennt
              die Grenze auch dann, wenn niemand gestempelt hat.
            </p>
          )}

          <ul className="m-0 grid list-none grid-cols-1 gap-s4 p-0 md:grid-cols-2 xl:grid-cols-3">
            {zeilen.map((z) => (
              <li
                key={z.id}
                data-cse="laufend"
                data-zeiteintrag={z.id}
                className={`rounded-lg border p-s4 ${
                  z.minuten >= AUFFAELLIG_AB_MINUTEN
                    ? 'border-warning bg-warning-soft'
                    : 'border-line bg-surface'
                }`}
              >
                <div className="flex items-baseline justify-between gap-s3">
                  <a
                    href={`/portal/${mandant}/zeiten/${z.id}`}
                    className="text-base text-text underline-offset-2 hover:underline"
                  >
                    {z.person}
                  </a>
                  <span className="text-base tabular-nums text-text">
                    {stundenMinutenText(z.minuten)}
                  </span>
                </div>
                <p className="m-0 mt-s2 text-sm text-text-muted">
                  {z.objekt ?? 'ohne Objekt'}
                  {' · seit '}
                  <span className="tabular-nums">{z.seitLokal}</span>
                </p>
                <p className="m-0 mt-s1 text-xs text-text-subtle">
                  {ERFASSUNGSART_TEXT[z.erfassungsart] ?? z.erfassungsart}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="mt-s5 max-w-prose text-sm text-text-muted">
        Die Dauer ist der Abstand zweier Zeitpunkte auf der Serveruhr, nicht die
        Differenz zweier Uhrzeiten: eine Schicht, die um 22:00 beginnt und in
        der Nacht der Zeitumstellung endet, ist eine Stunde kürzer oder länger
        als der Blick auf die Uhr sagt (Invariante 2).
      </p>
    </PortalRahmen>
  );
}
