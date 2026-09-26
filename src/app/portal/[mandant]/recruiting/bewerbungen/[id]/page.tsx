import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { StatusPill } from '@/components/ui/StatusPill';
import { Hinweis } from '@/components/ui/Hinweis';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { ladeBewerbung, leseBewertung } from '@/server/services/recruiting/dienst';
import { punktzahlZehntel, punkteText } from '@/server/services/recruiting/rangfolge';
import { ladeKandidat } from '@/server/services/recruiting/kandidat';
import { modellStand } from '@/server/agent/modell/auswahl';
import { Recht } from '@/components/ui/Recht';
import { internSprache } from '@/lib/i18n/intern';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { RECRUITING_KANDIDAT_TEXTE } from '@/lib/i18n/verwaltung/recruiting-kandidat';
import { eigenerEintrag } from '@/lib/nachschlagen';
import { kennungOder404 } from '../../../../kennung';
import { haeltRechte } from '../../../../rechte';
import { RecruitingSeite, leseImMandanten } from '../../rahmen';
import { KNOPF } from '../../felder';
import { BEWERBUNG_MARKE, BEWERBUNG_TEXT, berlinZeit, berlinZeitIn } from '../../marken';

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
  /* Ein Schlüssel oder nichts — nachgeschlagen nur über `eigenerEintrag` (D-728). */
  const abgewiesen = typeof suche['fehler'] === 'string' && /^[a-z_]{1,64}$/u.test(suche['fehler'])
    ? suche['fehler'] : null;
  /*
   * V-223: zwei Formulare schicken ihre Abweisung auf diese Seite — das
   * Gespräch und der Kandidatendatensatz. `vorgang=kandidat` sagt, wohin der
   * Satz gehört; sonst stünde eine Abweisung der Angaben unter „Gespräch
   * planen".
   */
  const kandidatVorgang = suche['vorgang'] === 'kandidat';
  const kandidatErledigt = suche['kandidat'] === 'erfasst' || suche['kandidat'] === 'bestaetigt'
    || suche['kandidat'] === 'vorgeschlagen' ? suche['kandidat'] : null;
  return (
    <RecruitingSeite
      mandant={mandant}
      unterpfad={`bewerbungen/${id}`}
      titel="Bewerbung"
      kinder={async (zugang) => {
        const darf = await haeltRechte(
          zugang.sitzung, 'recruiting.bewerbung_bewerten', 'recruiting.entscheiden',
          'kalender.schreiben', 'recruiting.stelle_lesen', 'agent.aufgabe_starten');
        const d = await leseImMandanten(zugang, async (kontext) => ({
          b: await ladeBewerbung(kontext, id),
          kriterien: await leseBewertung(kontext, id),
          kandidat: await ladeKandidat(kontext, id),
          auslesen: (await modellStand(kontext))
            .find((m) => m.faehigkeit === 'extraktion_dokument') ?? null,
        }));
        if (d.b === null) notFound();
        const b = d.b;
        const sprache = internSprache(zugang.sprache);
        const kt = nachSprache(RECRUITING_KANDIDAT_TEXTE, sprache);
        const k = d.kandidat;
        const kZurueck = `/portal/${mandant}/recruiting/bewerbungen/${id}?vorgang=kandidat`;
        /* Einmal je gezeichnetem Formular: ein zweiter Klick trägt denselben Schlüssel. */
        const laufSchluessel = randomUUID();

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
              {/*
                * **Die Antwort an die Bewerberin** (V-037, REC-03, § 22 AGG).
                *
                * Die Seite ist seit je gebaut — Entwurf, Freigabe, Versand
                * über `server/agent/policy.ts` (Invariante 7) — und KEIN
                * Verweis führte hin. Eine Absage, die nie hinausgeht, ist
                * genau der Fall, aus dem § 22 AGG eine Beweislastumkehr
                * macht: die Bewerberin hört nichts, und das Unternehmen kann
                * nicht zeigen, WAS es geantwortet hat.
                *
                * Das Register verlangt für die Seite BEIDE Rechte
                * (`recruiting.bewerbung_bewerten` UND
                * `recruiting.entscheiden`) — der Verweis prüft deshalb
                * beide, sonst zeigte er auf eine 404 (AUT-06, D-581).
                */}
              {darf['recruiting.entscheiden'] === true
                && darf['recruiting.bewerbung_bewerten'] === true && (
                <Link
                  href={`/portal/${mandant}/recruiting/bewerbungen/${id}/antwort`}
                  data-cse="zur-antwort"
                  className={KNOPF}
                >
                  Antwort schreiben
                </Link>
              )}
            </nav>

            <dl className="mb-s6 grid max-w-prose grid-cols-1 gap-s2 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-s5">
              <dt className="text-text-muted">Stelle</dt>
              <dd className="m-0 min-w-0 break-words text-text">
                {b.stelleId === null || b.stelleTitel === null ? (
                  'Initiativbewerbung'
                ) : darf['recruiting.stelle_lesen'] === true ? (
                  <Link
                    href={`/portal/${mandant}/recruiting/stellen/${b.stelleId}`}
                    className="text-text underline decoration-line underline-offset-4 hover:decoration-current"
                  >
                    {b.stelleTitel}
                  </Link>
                ) : (
                  /*
                   * **Der Titel bleibt, der Weg nicht.** Diese Seite öffnet
                   * mit `recruiting.bewerbung_lesen`, die Stelle dahinter mit
                   * `recruiting.stelle_lesen` (Manifest) — zwei Rechte, die
                   * je Mandant getrennt entzogen werden können. Wer das
                   * zweite nicht hält, sah hier einen Verweis, der auf 404
                   * führte und damit die Existenz dessen verriet, was er
                   * nicht zeigen darf (AUT-06). Gemeldet von der
                   * Copilot-Runde auf PR 16.
                   */
                  b.stelleTitel
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

            {/* ------------------- Strukturierte Angaben (REC-04, V-223, D-717) */}
            <section id="kandidat" aria-labelledby="kandidat-titel" className="mb-s6 max-w-prose"
                     data-cse="kandidat">
              <h2 id="kandidat-titel" className="mb-s3 text-h3 text-text">{kt.kTitel}</h2>
              <p className="mb-s4 text-sm text-text-muted">{kt.kErklaerung}</p>

              {kandidatErledigt !== null && (
                <Hinweis art="erfolg" cse="kandidat-erledigt" className="mb-s4">
                  {kt.kErledigt[kandidatErledigt]}
                </Hinweis>
              )}
              {kandidatVorgang && abgewiesen !== null && (
                <Hinweis art="warnung" cse="kandidat-fehler" className="mb-s4">
                  <strong>{kt.kNichtGespeichert}</strong>{' '}
                  {eigenerEintrag(kt.kFehler, abgewiesen) ?? kt.kFehlerSonst}
                </Hinweis>
              )}

              {k === null ? (
                <p className="mb-s4 rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted"
                   data-cse="kandidat-keiner">
                  {kt.kKeiner}
                </p>
              ) : (
                <div className="mb-s4 rounded-lg border border-line bg-surface p-s5"
                     data-cse="kandidat-datensatz">
                  <p className="m-0 mb-s3 text-xs text-text-muted" data-cse="kandidat-quelle">
                    {k.quelleArt === 'agent' ? kt.kQuelleAgent : kt.kQuelleMensch}
                  </p>
                  {k.bestaetigtAm === null ? (
                    <p className="m-0 mb-s3 text-sm text-warning" data-cse="kandidat-unbestaetigt">
                      {kt.kUnbestaetigt}
                    </p>
                  ) : (
                    <p className="m-0 mb-s3 text-sm text-success" data-cse="kandidat-bestaetigt">
                      {kt.kBestaetigt.replace('{wann}', berlinZeitIn(k.bestaetigtAm, sprache))
                        .replace('{wer}', k.bestaetigtVon ?? '—')}
                    </p>
                  )}
                  <dl className="m-0 grid grid-cols-1 gap-s2 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-s5">
                    <dt className="text-text-muted">{kt.kQualifikationen}</dt>
                    <dd className="m-0 min-w-0 break-words text-text">
                      {k.qualifikationen.length === 0 ? kt.kKeineEintraege
                        : k.qualifikationen.join(' · ')}
                    </dd>
                    <dt className="text-text-muted">{kt.kSprachen}</dt>
                    <dd className="m-0 min-w-0 break-words text-text">
                      {k.sprachen.length === 0 ? kt.kKeineEintraege : k.sprachen.join(' · ')}
                    </dd>
                    <dt className="text-text-muted">{kt.kErfahrung}</dt>
                    <dd className="m-0 min-w-0 tabular-nums text-text">
                      {k.erfahrungJahre === null ? kt.kErfahrungUnbekannt
                        : `${String(k.erfahrungJahre)} ${kt.kJahre}`}
                    </dd>
                    <dt className="text-text-muted">{kt.kNotiz}</dt>
                    <dd className="m-0 min-w-0 whitespace-pre-line break-words text-text">
                      {k.notiz ?? kt.kKeineEintraege}
                    </dd>
                  </dl>
                </div>
              )}

              {darf['recruiting.bewerbung_bewerten'] !== true ? (
                <p className="m-0 text-sm text-text-muted" data-cse="kandidat-ohne-recht">
                  {kt.kErfassenOhneRecht}{' '}
                  <Recht schluessel="recruiting.bewerbung_bewerten" sprache={sprache} />
                </p>
              ) : (
              <>
              {k !== null && k.bestaetigtAm === null && (
                <form method="post" action={`/api/recruiting/bewerbungen/${id}/kandidat`}
                      data-cse="kandidat-bestaetigen"
                      className="mb-s4 flex flex-col gap-s3">
                  <input type="hidden" name="aktion" value="bestaetigen" />
                  <input type="hidden" name="zurueck" value={kZurueck} />
                  <p className="m-0 text-xs text-text-muted">{kt.kBestaetigenHinweis}</p>
                  <div>
                    <Button type="submit" variante="primary" data-cse="kandidat-bestaetigen-knopf">
                      {kt.kBestaetigen}
                    </Button>
                  </div>
                </form>
              )}

              <details className="mb-s4 rounded-lg border border-line bg-surface p-s5"
                       data-cse="kandidat-erfassen">
                <summary className="cursor-pointer text-sm font-semibold text-text">
                  {kt.kErfassenTitel}
                </summary>
                <form method="post" action={`/api/recruiting/bewerbungen/${id}/kandidat`}
                      className="mt-s4 flex flex-col gap-s4">
                  <input type="hidden" name="aktion" value="erfassen" />
                  <input type="hidden" name="zurueck" value={kZurueck} />
                  <div className="flex flex-col gap-s2">
                    <label htmlFor="k-qualifikationen" className="text-xs text-text-muted">
                      {kt.kQualifikationen} — {kt.kJeZeile}
                    </label>
                    <textarea id="k-qualifikationen" name="qualifikationen" rows={4}
                              defaultValue={k?.qualifikationen.join('\n') ?? ''} className={FELD}
                              data-cse="kandidat-qualifikationen" />
                  </div>
                  <div className="flex flex-col gap-s2">
                    <label htmlFor="k-sprachen" className="text-xs text-text-muted">
                      {kt.kSprachen} — {kt.kJeZeile}
                    </label>
                    <textarea id="k-sprachen" name="sprachen" rows={3}
                              defaultValue={k?.sprachen.join('\n') ?? ''} className={FELD}
                              data-cse="kandidat-sprachen" />
                  </div>
                  <div className="flex flex-col gap-s2">
                    <label htmlFor="k-jahre" className="text-xs text-text-muted">
                      {kt.kErfahrung} ({kt.kJahre})
                    </label>
                    <input id="k-jahre" name="erfahrung_jahre" type="number" min="0" max="60"
                           step="1"
                           defaultValue={k === null || k.erfahrungJahre === null ? ''
                             : String(k.erfahrungJahre)}
                           className={FELD} data-cse="kandidat-jahre" />
                    <p className="text-xs text-text-subtle">{kt.kErfahrungHinweis}</p>
                  </div>
                  <div className="flex flex-col gap-s2">
                    <label htmlFor="k-notiz" className="text-xs text-text-muted">{kt.kNotiz}</label>
                    <textarea id="k-notiz" name="notiz" rows={2} defaultValue={k?.notiz ?? ''}
                              className={FELD} />
                  </div>
                  <p className="m-0 text-xs text-text-muted">{kt.kSpeichernHinweis}</p>
                  <div>
                    <Button type="submit" variante="secondary" data-cse="kandidat-speichern">
                      {kt.kSpeichern}
                    </Button>
                  </div>
                </form>
              </details>

              {(k === null || k.bestaetigtAm === null) && (
                <div className="rounded-lg border border-line bg-surface p-s5"
                     data-cse="kandidat-vorschlag">
                  <h3 className="m-0 mb-s2 text-base font-semibold text-text">
                    {kt.kVorschlagTitel}
                  </h3>
                  <p className="m-0 mb-s3 text-sm text-text-muted">{kt.kVorschlagErklaerung}</p>
                  <p className="m-0 mb-s3 text-xs text-text-muted">{kt.kLebenslauf}</p>
                  {darf['agent.aufgabe_starten'] !== true ? (
                    <p className="m-0 text-sm text-text-muted" data-cse="kandidat-vorschlag-ohne-recht">
                      {kt.kOhneRecht}{' '}
                      <Recht schluessel="agent.aufgabe_starten" sprache={sprache} />
                    </p>
                  ) : d.auslesen === null || d.auslesen.modell === null ? (
                    <Hinweis art="warnung" cse="kandidat-ki-nicht-verfuegbar">
                      {kt.kVorschlagNichtVerfuegbar}
                    </Hinweis>
                  ) : (
                    <form method="post"
                          action={`/api/recruiting/bewerbungen/${id}/kandidat/vorschlag`}
                          className="flex flex-col gap-s3">
                      <input type="hidden" name="zurueck" value={kZurueck} />
                      <input type="hidden" name="schluessel" value={laufSchluessel} />
                      {d.auslesen.demo && (
                        <p className="m-0 text-xs text-text-muted" data-cse="kandidat-demo">
                          {kt.kVorschlagDemo}
                        </p>
                      )}
                      <div>
                        <Button type="submit" variante="secondary"
                                data-cse="kandidat-vorschlag-knopf">
                          {kt.kVorschlagKnopf}
                        </Button>
                      </div>
                    </form>
                  )}
                </div>
              )}
              </>
              )}
            </section>

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
                {abgewiesen !== null && !kandidatVorgang && (
                  <Hinweis art="warnung" cse="termin-fehler" className="mb-s5 max-w-prose">
                    {eigenerEintrag(FEHLER, abgewiesen) ?? 'Der Termin wurde abgewiesen.'}
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
