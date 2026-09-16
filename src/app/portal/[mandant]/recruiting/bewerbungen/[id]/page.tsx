import Link from 'next/link';
import { notFound } from 'next/navigation';
import { StatusPill } from '@/components/ui/StatusPill';
import { Hinweis } from '@/components/ui/Hinweis';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { ladeBewerbung, leseBewertung } from '@/server/services/recruiting/dienst';
import { punktzahlZehntel, punkteText } from '@/server/services/recruiting/rangfolge';
import { kennungOder404 } from '../../../../kennung';
import { haeltRechte } from '../../../../rechte';
import { RecruitingSeite, leseImMandanten } from '../../rahmen';
import { KNOPF } from '../../felder';
import { BEWERBUNG_MARKE, BEWERBUNG_TEXT, berlinZeit } from '../../marken';

/**
 * `/portal/[mandant]/recruiting/bewerbungen/[id]` — eine Bewerbung (REC-03,
 * REC-04).
 *
 * **Was hier NICHT steht: eine Empfehlung.** Die Seite zeigt, was der Mensch
 * geschrieben hat, wann es einging, wann es gelöscht wird — und, wenn jemand
 * bewertet hat, die Kriterien mit ihrem Gewicht. Sie zeigt keine Zahl, die
 * eine Entscheidung nahelegt, ohne die Kriterien danebenzustellen (LEG-12).
 *
 * **Die Knöpfe erscheinen nur mit ihrem Recht** (AUT-06): wer nicht bewerten
 * darf, sieht keinen Bewertungsknopf — ein Knopf auf einen 404 verrät die
 * Existenz dessen, was er nicht zeigen darf.
 */
export const dynamic = 'force-dynamic';

const QUELLE: Readonly<Record<string, string>> = {
  karriereseite: 'Karriereseite', initiativ: 'Initiativbewerbung',
  mail: 'E-Mail-Postfach', import: 'Import',
};

const FELD = 'min-h-11 w-full rounded-md border border-line bg-surface px-s3 py-s2 '
  + 'text-sm text-text focus:border-brand focus:outline-none';

/** Die Abweisungen der Terminroute — als Satz auf DIESER Seite. */
const FEHLER: Readonly<Record<string, string>> = {
  vergangenheit: 'Der Termin liegt nicht in der Zukunft. Ein Gespräch rückwirkend '
    + 'zu planen ist keine Einladung, sondern ein Versehen mit Verzögerung.',
  zeitpunkt_unlesbar: 'Der Termin ist keiner. Erwartet werden Datum und Uhrzeit '
    + 'in Berliner Zeit.',
  kein_kalendertag: 'Diesen Tag gibt es nicht.',
  keine_uhrzeit: 'Diese Uhrzeit gibt es nicht.',
  unbrauchbare_dauer: 'Die Dauer liegt zwischen 5 und 240 Minuten.',
  unbekannt: 'Diese Bewerbung gibt es nicht.',
  keine_serverzeit: 'Die Uhr des Servers war nicht zu lesen. Bitte noch einmal versuchen.',
};

export default async function Bewerbungsblatt(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const suche = await searchParams;
  const abgewiesen = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;
  return (
    <RecruitingSeite
      mandant={mandant}
      unterpfad={`bewerbungen/${id}`}
      titel="Bewerbung"
      kinder={async (zugang) => {
        const darf = await haeltRechte(
          zugang.sitzung, 'recruiting.bewerbung_bewerten', 'recruiting.entscheiden',
          'kalender.schreiben');
        const d = await leseImMandanten(zugang, async (kontext) => ({
          b: await ladeBewerbung(kontext, id),
          kriterien: await leseBewertung(kontext, id),
        }));
        if (d.b === null) notFound();
        const b = d.b;

        return (
          <>
            <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
              <h1 className="m-0 text-h1 text-text">{b.name}</h1>
              <StatusPill zustand={BEWERBUNG_MARKE[b.status]} />
            </div>

            <nav className="mb-s5 flex flex-wrap gap-s2">
              <Link href={`/portal/${mandant}/recruiting/bewerbungen`} className={KNOPF}>
                Alle Bewerbungen
              </Link>
              {darf['recruiting.bewerbung_bewerten'] === true && (
                <Link
                  href={`/portal/${mandant}/recruiting/kandidaten/${id}/bewertung`}
                  data-cse="zur-bewertung"
                  className={KNOPF}
                >
                  Bewerten
                </Link>
              )}
              {darf['recruiting.entscheiden'] === true && (
                <Link
                  href={`/portal/${mandant}/recruiting/kandidaten/${id}/entscheidung`}
                  data-cse="zur-entscheidung"
                  className={KNOPF}
                >
                  Entscheiden
                </Link>
              )}
            </nav>

            <dl className="mb-s6 grid max-w-prose grid-cols-1 gap-s2 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-s5">
              <dt className="text-text-muted">Stelle</dt>
              <dd className="m-0 min-w-0 break-words text-text">
                {b.stelleId === null || b.stelleTitel === null ? (
                  'Initiativbewerbung'
                ) : (
                  <Link
                    href={`/portal/${mandant}/recruiting/stellen/${b.stelleId}`}
                    className="text-text underline decoration-line underline-offset-4 hover:decoration-current"
                  >
                    {b.stelleTitel}
                  </Link>
                )}
              </dd>
              <dt className="text-text-muted">E-Mail</dt>
              <dd className="m-0 min-w-0 break-all text-text">{b.email}</dd>
              <dt className="text-text-muted">Telefon</dt>
              <dd className="m-0 min-w-0 break-words tabular-nums text-text">
                {b.telefon ?? '—'}
              </dd>
              <dt className="text-text-muted">Quelle</dt>
              <dd className="m-0 min-w-0 text-text">{QUELLE[b.quelle] ?? b.quelle}</dd>
              <dt className="text-text-muted">Eingegangen</dt>
              <dd className="m-0 min-w-0 tabular-nums text-text">
                {berlinZeit(b.eingegangenAm)}
              </dd>
              <dt className="text-text-muted">Aufbewahrung bis</dt>
              <dd className="m-0 min-w-0 tabular-nums text-text">{b.aufbewahrungBis}</dd>
              <dt className="text-text-muted">Stand</dt>
              <dd className="m-0 min-w-0 text-text">{BEWERBUNG_TEXT[b.status]}</dd>
            </dl>

            <h2 className="mb-s3 text-h3 text-text">Nachricht</h2>
            <p className="mb-s6 max-w-prose whitespace-pre-line rounded-lg border border-line bg-surface p-s5 text-sm text-text">
              {b.nachricht ?? 'Keine Nachricht mitgeschickt.'}
            </p>

            <h2 className="mb-s3 text-h3 text-text">Unterlagen</h2>
            <Hinweis art="warnung" cse="rec-keine-dateien" className="mb-s6 max-w-prose">
              <strong>Das Karriereformular nimmt heute keine Datei an.</strong>{' '}
              Der Belegspeicher ist nicht verbunden, und ein Feld, das eine
              Datei annimmt und sie nirgends ablegt, ist schlimmer als keines —
              der Mensch glaubt dann, sie sei angekommen. Die Frage steht als
              O-375 offen.
            </Hinweis>

            <h2 className="mb-s3 text-h3 text-text">Bewertung</h2>
            {d.kriterien.length === 0 ? (
              <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
                Noch nicht bewertet. Das ist kein Nachteil für die Bewerbung —
                sie steht in der Rangfolge mit 0,0 und damit sichtbar, statt
                zu verschwinden.
              </p>
            ) : (
              <>
                <p className="mb-s3 text-sm text-text">
                  Punktzahl:{' '}
                  <strong className="tabular-nums">
                    {punkteText(punktzahlZehntel(d.kriterien))}
                  </strong>{' '}
                  <span className="text-text-muted">
                    — gewichtetes Mittel der Kriterien, gerechnet von einer
                    geprüften Funktion und nicht von einem Modell (D-06).
                  </span>
                </p>
                <ul className="m-0 flex list-none flex-col gap-s2 p-0">
                  {d.kriterien.map((k) => (
                    <li key={k.id} data-cse="kriterium"
                        className="rounded-lg border border-line bg-surface p-s4">
                      <div className="flex flex-wrap items-baseline justify-between gap-s3">
                        <strong className="text-sm text-text">{k.kriterium}</strong>
                        <span className="tabular-nums text-sm text-text">
                          {String(k.punkte)} / 10 · Gewicht {String(k.gewicht)}
                        </span>
                      </div>
                      <p className="m-0 mt-s2 max-w-prose text-xs text-text-muted">
                        {k.begruendung}
                      </p>
                      {k.erstelltVonArt === 'agent' && (
                        <p className="m-0 mt-s2 text-xs text-warning">
                          Von einem Agenten vorgeschlagen — ungeprüft.
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}

            {/*
              * **Der Knopf, den die Gesprächsliste versprochen hat** (REC-06,
              * CAL-01).
              *
              * `/recruiting/gespraeche` sagte in seiner Leerseite, ein Termin
              * entstehe „über den Knopf auf dem Bewerbungsblatt" — und den gab
              * es nicht, so wenig wie eine Route, die `planeGespraech` ruft.
              * Ein Termin konnte damit nur aus dem Seed kommen. Gemeldet hat
              * das die Copilot-Runde auf PR 16.
              *
              * **`kalender.schreiben` und nicht nur `bewerbung_lesen`:** ein
              * Gespräch ist ein Kalendertermin, und die Gesprächsliste
              * verlangt dasselbe Recht (Routenmanifest). Wer es nicht hält,
              * sieht das Formular nicht — statt es auszufüllen und am 404 zu
              * scheitern (AUT-06).
              */}
            {darf['kalender.schreiben'] === true && (
              <>
                <h2 className="mb-s3 mt-s6 text-h3 text-text">Gespräch planen</h2>
                {suche['termin'] === '1' && (
                  <Hinweis art="hinweis" cse="termin-angelegt" className="mb-s5 max-w-prose">
                    <strong>Der Termin steht.</strong> Er erscheint in der
                    Gesprächsliste und im Kalender dieser Gesellschaft.
                  </Hinweis>
                )}
                {abgewiesen !== null && (
                  <Hinweis art="warnung" cse="termin-fehler" className="mb-s5 max-w-prose">
                    {FEHLER[abgewiesen] ?? 'Der Termin wurde abgewiesen.'}
                  </Hinweis>
                )}
                <form method="post" action="/api/recruiting/gespraeche"
                      data-cse="gespraech-formular"
                      className="flex max-w-prose flex-col gap-s4">
                  <input type="hidden" name="bewerbung" value={id} />
                  <input type="hidden" name="zurueck"
                         value={`/portal/${mandant}/recruiting/bewerbungen/${id}`} />
                  <div className="flex flex-col gap-s2">
                    <label htmlFor="termin" className="text-xs text-text-muted">
                      Termin (Berliner Zeit)
                    </label>
                    <input id="termin" name="termin" type="datetime-local" required
                           className={FELD} data-cse="gespraech-termin" />
                    <p className="text-xs text-text-subtle">
                      Angezeigt und gemeint ist Europe/Berlin; gespeichert wird der
                      Zeitpunkt in UTC. Geprüft wird gegen die Uhr des Servers, nicht
                      die dieses Geräts (Invariante 5).
                    </p>
                  </div>
                  <FormField label="Dauer in Minuten" name="dauer" type="number"
                             defaultValue="60" hinweis="5 bis 240 Minuten." />
                  <FormField label="Ort oder Verbindung" name="ort"
                             hinweis="Raum, Adresse oder Link — was die Einladung nennt." />
                  <div className="flex flex-col gap-s2">
                    <label htmlFor="fragen" className="text-xs text-text-muted">
                      Vorbereitete Fragen — je Zeile eine
                    </label>
                    <textarea id="fragen" name="fragen" rows={5} className={FELD}
                              data-cse="gespraech-fragen" />
                    <p className="text-xs text-text-subtle">
                      Was einzeln gefragt wird, steht einzeln da — ein Fliesstext
                      lässt sich im Gespräch nicht abhaken (REC-06).
                    </p>
                  </div>
                  <Button type="submit" variante="primary" data-cse="gespraech-anlegen">
                    Termin anlegen
                  </Button>
                </form>
              </>
            )}
          </>
        );
      }}
    />
  );
}
