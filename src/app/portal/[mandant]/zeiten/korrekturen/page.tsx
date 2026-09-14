import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { berlinHeute } from '@/server/db/heute';
import { montag, tagePlus } from '@/lib/datum/kalendertag';
import { ladeKorrekturbuch } from '../daten';

/**
 * `/portal/[mandant]/zeiten/korrekturen` — das Korrekturbuch (TIM-11, LEG-01,
 * SEC-A9).
 *
 * **Es gibt diese Seite, weil eine Korrektur je Eintrag unsichtbar ist.** Wer
 * einen einzelnen Zeiteintrag öffnet, sieht seine Geschichte; wer wissen will,
 * ob in dieser Woche zwanzig Zeiten geändert wurden und von wem, findet das
 * dort nie. Genau diese Frage stellt eine Prüfung — und sie stellt sie über
 * einen Zeitraum, nicht über eine Zeile.
 *
 * Gefiltert wird nach dem Tag der KORREKTUR, nicht dem der Schicht: „was wurde
 * diese Woche geändert" meint die Änderung. Welche Schicht betroffen ist,
 * steht daneben.
 */
export const dynamic = 'force-dynamic';

const ART_TEXT: Readonly<Record<string, string>> = {
  zeit_korrektur: 'Zeit korrigiert',
  pause_korrektur: 'Pause korrigiert',
  zuordnung_korrektur: 'Zuordnung korrigiert',
  nacherfassung: 'Nacherfassung',
  storno: 'Storniert',
};

const GRUND_TEXT: Readonly<Record<string, string>> = {
  vergessen_auszustempeln: 'vergessen auszustempeln',
  geraet_defekt: 'Gerät defekt',
  falsches_objekt: 'falsches Objekt',
  einwand_mitarbeiter: 'Einwand der Person',
  nachtrag_offline: 'Nachtrag aus der Offline-Warteschlange',
  sonstiges: 'Sonstiges',
};

export default async function Korrekturbuch({
  params, searchParams,
}: {
  params: Promise<{ mandant: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/zeiten/korrekturen`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const frage = await searchParams;
  const heute = await berlinHeute();
  const roh = typeof frage['woche'] === 'string' ? frage['woche'] : null;
  const anker = roh !== null && /^\d{4}-\d{2}-\d{2}$/u.test(roh) ? roh : heute;
  const von = montag(anker);
  const bis = tagePlus(von, 6);

  const zeilen = await ladeKorrekturbuch(sitzung, von, bis);

  return (
    <PortalRahmen
      titel="Korrekturen"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="zeiten"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Korrekturen</h1>
        <p className="m-0 text-sm text-text-muted">
          {zeilen.length === 1 ? '1 Korrektur' : `${String(zeilen.length)} Korrekturen`}
          {' · '}
          <span className="tabular-nums">{von}</span> bis <span className="tabular-nums">{bis}</span>
        </p>
      </div>

      <nav aria-label="Woche wechseln" className="mb-s5 flex flex-wrap items-center gap-s2">
        <Sprung mandant={mandant} ziel={tagePlus(von, -7)} text="← Vorige Woche" />
        <Sprung mandant={mandant} ziel={montag(heute)} text="Diese Woche" />
        <Sprung mandant={mandant} ziel={tagePlus(von, 7)} text="Nächste Woche →" />
        <Link
          href={`/portal/${mandant}/zeiten?woche=${von}`}
          className="inline-flex min-h-11 items-center rounded-md border border-line px-s3 text-sm text-text-muted transition-colors duration-fast hover:border-line-strong hover:text-text"
        >
          Zeiten dieser Woche
        </Link>
      </nav>

      {zeilen.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          In dieser Woche wurde keine Zeit korrigiert. Das ist eine Aussage über
          die Woche, nicht über die Vollständigkeit der Spur — eine Korrektur
          ohne Zeile gibt es nicht.
        </p>
      ) : (
        <ol className="m-0 list-none p-0">
          {zeilen.map((k) => (
            <li
              key={k.id}
              data-cse="korrektur"
              data-korrektur={k.id}
              className="mb-s3 rounded-lg border border-line bg-surface p-s4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-s3">
                <span className="text-base text-text">
                  <strong>{ART_TEXT[k.art] ?? k.art}</strong>
                  {' · '}
                  {GRUND_TEXT[k.grund] ?? k.grund}
                </span>
                <span className="text-sm tabular-nums text-text-muted">{k.amLokal}</span>
              </div>
              <p className="m-0 mt-s2 max-w-prose text-sm text-text">{k.begruendung}</p>
              <p className="m-0 mt-s2 text-sm text-text-muted">
                {k.person}
                {' · Schicht ab '}
                <span className="tabular-nums">{k.betrifftLokal}</span>
                {' · '}
                {k.durchVon ?? 'Konto nicht einsehbar'}
                {' · '}
                <Link
                  href={`/portal/${mandant}/zeiten/${k.ersatzId ?? k.ursprungId}`}
                  className="underline hover:text-text"
                >
                  Zum Eintrag
                </Link>
              </p>
            </li>
          ))}
        </ol>
      )}

      <p className="mt-s5 max-w-prose text-sm text-text-muted">
        Wer korrigiert hat, steht nur da, wenn die eigene Rolle Benutzerkonten
        lesen darf (`system.benutzer_lesen`). Fehlt das Recht, fehlt der Name —
        nicht die Korrektur.
      </p>
    </PortalRahmen>
  );
}

function Sprung({ mandant, ziel, text }: {
  readonly mandant: string; readonly ziel: string; readonly text: string;
}) {
  return (
    <Link
      href={`/portal/${mandant}/zeiten/korrekturen?woche=${ziel}`}
      className="inline-flex min-h-11 items-center rounded-md border border-line px-s3 text-sm text-text-muted transition-colors duration-fast hover:border-line-strong hover:text-text"
    >
      {text}
    </Link>
  );
}
