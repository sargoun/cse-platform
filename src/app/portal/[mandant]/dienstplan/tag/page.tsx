import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { stundenText } from '@/server/services/dienstplan/wochenraster';
import { beschriftung, ladePlanfenster, tagePlus } from '../daten';
import { berlinHeute } from '@/server/db/heute';

/**
 * `/portal/[mandant]/dienstplan/tag` — die Disposition (TIM-01, TIM-04, DSH-05).
 *
 * Der Tag ist die Ansicht fuer die Frage „wer steht wo, JETZT" — und die
 * beantwortet ein Raster schlecht. Ein Disponent sucht nicht nach einer
 * Uhrzeit, sondern nach einem Objekt: welche Schichten laufen dort, welche
 * sind unbesetzt, welche tragen einen Befund. Deshalb **nach Objekt
 * gruppiert**, nach Beginn sortiert, mit der Unterbesetzung ganz oben.
 *
 * Auch hier gilt TIM-04: zehn Schichten zur selben Sekunde sind zehn Zeilen.
 * Eine Gruppierung nach Uhrzeit haette daraus eine mit einer Zahl gemacht,
 * und wer die Zahl liest, weiss nicht, welche neun fehlen.
 */
export const dynamic = 'force-dynamic';

export default async function Tagesansicht({
  params, searchParams,
}: {
  params: Promise<{ mandant: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/dienstplan/tag`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={mandant} zielSlug={tor.ziel} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const frage = await searchParams;
  const roh = typeof frage['tag'] === 'string' ? frage['tag'] : null;
  // Der Berliner Tag kommt aus der Datenbank — siehe `@/server/db/heute`.
  const heuteTag = await berlinHeute();
  const tag = roh !== null && /^\d{4}-\d{2}-\d{2}$/u.test(roh) ? roh : heuteTag;

  const { tage, schichten, abwesenheitGeprueft } = await ladePlanfenster(sitzung, tag, tag);
  const heute = tage[0];

  // Nach Objekt gruppieren — die Reihenfolge innerhalb bleibt die Zeit.
  const nachObjekt = new Map<string, typeof schichten>();
  for (const s of schichten) {
    const liste = nachObjekt.get(s.objekt);
    if (liste === undefined) nachObjekt.set(s.objekt, [s]);
    else (liste as typeof schichten[number][]).push(s);
  }
  const objekte = [...nachObjekt.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const unbesetzt = schichten.filter((s) => s.besetzt < s.soll);

  return (
    <PortalRahmen
      titel="Dienstplan — Tag"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="dienstplan"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">
          {heute === undefined ? 'Dienstplan — Tag' : beschriftung(heute.datum)}
        </h1>
        <p className="m-0 text-sm text-text-muted">
          {schichten.length === 1 ? '1 Schicht' : `${String(schichten.length)} Schichten`}
          {unbesetzt.length > 0 && (
            <span className="text-warning">
              {' · '}{String(unbesetzt.length)} unbesetzt
            </span>
          )}
        </p>
      </div>

      {!abwesenheitGeprueft && (
        <p className="mb-s4 rounded-lg border border-line bg-surface p-s4 text-sm text-text-muted">
          Abwesenheiten werden hier nicht geprüft — dafür fehlt das Recht
          `zeit.abwesenheit_lesen`. Das heißt <strong>nicht</strong>, dass
          niemand abgemeldet ist.
        </p>
      )}
      <nav aria-label="Tag wechseln" className="mb-s4 flex flex-wrap gap-s2">
        <Sprung mandant={mandant} ziel={tagePlus(tag, -1)} text="← Vortag" />
        <Sprung mandant={mandant} ziel={heuteTag} text="Heute" />
        <Sprung mandant={mandant} ziel={tagePlus(tag, 1)} text="Folgetag →" />
        <Link
          href={`/portal/${mandant}/dienstplan/woche?woche=${tag}`}
          className="rounded-md border border-line px-s3 py-s1 text-sm text-text-muted hover:border-line-strong hover:text-text"
        >
          Wochenansicht
        </Link>
      </nav>

      {heute?.feiertag != null && (
        <p className="mb-s4 rounded-md bg-info-soft px-s3 py-s2 text-sm text-info">
          Feiertag: {heute.feiertag}
        </p>
      )}

      {schichten.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          An diesem Tag ist nichts geplant.
        </p>
      ) : (
        objekte.map(([objekt, liste]) => (
          <section key={objekt} data-cse="objektgruppe" data-objekt={objekt} className="mb-s6">
            <h2 className="mb-s3 text-h3 text-text">{objekt}</h2>
            <ul className="m-0 list-none p-0">
              {liste.map((s) => (
                <li
                  key={s.id}
                  data-cse="schicht"
                  data-schicht={s.id}
                  className="border-b border-line py-s3"
                >
                  <Link
                    href={`/portal/${mandant}/dienstplan/einsatz/${s.id}`}
                    className="flex flex-wrap items-baseline justify-between gap-s3 text-text hover:text-brand"
                  >
                    <span className="tabular-nums">
                      {s.beginnLokal}–{s.endeLokal} · {stundenText(s)}
                    </span>
                    <span className="text-sm text-text-muted">
                      {s.revier ?? '—'}
                      {' · '}
                      <span className={s.besetzt < s.soll ? 'text-warning' : ''}>
                        {String(s.besetzt)}/{String(s.soll)}
                        {s.besetzt < s.soll ? ' unbesetzt' : ''}
                      </span>
                    </span>
                  </Link>
                  {s.befunde.length > 0 && (
                    <p className="m-0 mt-s1 text-micro">
                      {s.befunde.map((b) => (
                        <span
                          key={b.text}
                          data-cse="befund"
                          data-art={b.art}
                          className={`mr-s2 rounded px-s1 ${
                            b.art === 'sperre' ? 'bg-danger-soft text-danger'
                              : b.art === 'warnung' ? 'bg-warning-soft text-warning'
                                : 'bg-info-soft text-info'}`}
                        >
                          {b.art === 'sperre' ? 'Gesperrt' : b.art === 'warnung' ? 'Warnung' : 'Hinweis'}
                          {': '}{b.text}
                        </span>
                      ))}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </PortalRahmen>
  );
}

function Sprung(
  { mandant, ziel, text }: { readonly mandant: string; readonly ziel: string; readonly text: string },
) {
  return (
    <Link
      href={`/portal/${mandant}/dienstplan/tag?tag=${ziel}`}
      className="rounded-md border border-line px-s3 py-s1 text-sm text-text-muted hover:border-line-strong hover:text-text"
    >
      {text}
    </Link>
  );
}
