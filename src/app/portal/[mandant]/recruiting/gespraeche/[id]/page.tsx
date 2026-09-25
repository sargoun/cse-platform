import Link from 'next/link';
import { notFound } from 'next/navigation';
import { StatusPill } from '@/components/ui/StatusPill';
import { Hinweis } from '@/components/ui/Hinweis';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { Recht } from '@/components/ui/Recht';
import { ladeGespraech } from '@/server/services/recruiting/dienst';
import { internSprache } from '@/lib/i18n/intern';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import {
  RECRUITING_GESPRAECH_TEXTE, type GespraechErledigt,
} from '@/lib/i18n/verwaltung/recruiting-gespraech';
import { eigenerEintrag } from '@/lib/nachschlagen';
import { kennungOder404 } from '../../../../kennung';
import { haeltRechte } from '../../../../rechte';
import { RecruitingSeite, leseImMandanten } from '../../rahmen';
import { FELD, KNOPF } from '../../felder';
import { GESPRAECH_MARKE, berlinZeit, berlinZeitIn } from '../../marken';
import { berlinFormularWert } from '@/lib/datum/formularzeit';

/**
 * `/portal/[mandant]/recruiting/gespraeche/[id]` — ein Termin (REC-06, CAL-01).
 *
 * **Die vorbereiteten Fragen stehen hier, weil sie für ALLE dieselben sein
 * sollen.** Ein strukturiertes Gespräch ist nicht Bürokratie: wer jedem
 * dieselben Fragen stellt, kann hinterher erklären, warum er sich anders
 * entschieden hat — und genau das verlangt § 22 AGG im Streitfall.
 */
export const dynamic = 'force-dynamic';

const ERLEDIGT: readonly GespraechErledigt[] = ['abgesagt', 'verschoben', 'vermerkt'];

export default async function Gespraechsblatt(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const suche = await searchParams;
  /* V-220: die Rückmeldung der Route auf DIESE Seite — ein Schlüssel oder nichts. */
  const fehler = typeof suche['fehler'] === 'string' && /^[a-z_]{1,64}$/u.test(suche['fehler'])
    ? suche['fehler'] : null;
  const erledigt = ERLEDIGT.find((e) => e === suche['erledigt']) ?? null;
  return (
    <RecruitingSeite
      mandant={mandant}
      unterpfad={`gespraeche/${id}`}
      titel="Gespräch"
      kinder={async (zugang) => {
        const g = await leseImMandanten(zugang, (k) => ladeGespraech(k, id));
        if (g === null) notFound();
        const sprache = internSprache(zugang.sprache);
        const t = nachSprache(RECRUITING_GESPRAECH_TEXTE, sprache);
        /*
         * Ändern darf, wer den Termin auch anlegen darf (V-220): dieselben
         * zwei Rechte wie `POST /api/recruiting/gespraeche`. Der Verweis auf
         * die Antwortseite prüft deren zwei (Register, AUT-06).
         */
        const darf = await haeltRechte(
          zugang.sitzung, 'kalender.schreiben', 'recruiting.bewerbung_bewerten',
          'recruiting.entscheiden');
        const zurueck = `/portal/${mandant}/recruiting/gespraeche/${g.id}`;

        return (
          <>
            <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
              <h1 className="m-0 text-h1 text-text">{g.bewerberName}</h1>
              <StatusPill zustand={GESPRAECH_MARKE[g.status] ?? 'Geplant'} sprache={sprache} />
            </div>

            <nav className="mb-s5 flex flex-wrap gap-s2">
              <Link href={`/portal/${mandant}/recruiting/gespraeche`} className={KNOPF}>
                Alle Gespräche
              </Link>
              <Link
                href={`/portal/${mandant}/recruiting/bewerbungen/${g.bewerbungId}`}
                className={KNOPF}
              >
                Zur Bewerbung
              </Link>
            </nav>

            <dl className="mb-s6 grid max-w-prose grid-cols-1 gap-s2 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-s5">
              <dt className="text-text-muted">Termin</dt>
              <dd className="m-0 min-w-0 tabular-nums text-text">
                {/*
                  * Der Zusatz „(Europe/Berlin)" stand hier, solange
                  * `berlinZeit` nur die Wanduhr gab. Seit D-584 nennt die
                  * Ausgabe die Zone selbst (MEZ/MESZ) — und die ist genauer:
                  * sie unterscheidet die beiden 02:30 der
                  * Umstellungsnacht, was der Zonenname allein nicht kann.
                  * Beides nebeneinander sagte dasselbe zweimal und das
                  * Genauere leiser.
                  */}
                {berlinZeit(g.termin)}
              </dd>
              <dt className="text-text-muted">Dauer</dt>
              <dd className="m-0 min-w-0 tabular-nums text-text">
                {String(g.dauerMinuten)} Minuten
              </dd>
              <dt className="text-text-muted">Ort</dt>
              <dd className="m-0 min-w-0 break-words text-text">{g.ort ?? '—'}</dd>
              <dt className="text-text-muted">Stelle</dt>
              <dd className="m-0 min-w-0 break-words text-text">
                {g.stelleTitel ?? 'Initiativbewerbung'}
              </dd>
            </dl>

            {erledigt !== null && (
              <Hinweis art="erfolg" cse="gespraech-erledigt" className="mb-s5 max-w-prose">
                {t.erledigt[erledigt]}
              </Hinweis>
            )}
            {fehler !== null && (
              <Hinweis art="warnung" cse="gespraech-fehler" className="mb-s5 max-w-prose">
                <strong>{t.nichtGeaendert}</strong>{' '}
                {eigenerEintrag(t.fehler, fehler) ?? t.fehlerSonst}
              </Hinweis>
            )}

            {/*
              * **Der Stand, den bisher kein Weg setzte** (V-220). Abgesagt und
              * geführt stehen mit Zeitpunkt (Uhr der Datenbank) und Person da;
              * der Grund einer Absage bleibt intern.
              */}
            {g.status === 'abgesagt' && g.abgesagtAm !== null && (
              <Hinweis art="warnung" cse="gespraech-abgesagt" className="mb-s6 max-w-prose">
                <strong>{t.statusText.abgesagt}.</strong>{' '}
                {t.abgesagtAm.replace('{wann}', berlinZeitIn(g.abgesagtAm, sprache))
                  .replace('{wer}', g.abgesagtVon ?? t.unbekanntePerson)}
                {g.abgesagtGrund !== null && (
                  <span className="mt-s2 block">
                    {t.abgesagtGrund}: {g.abgesagtGrund}
                  </span>
                )}
              </Hinweis>
            )}
            {g.status === 'stattgefunden' && g.vermerktAm !== null && (
              <Hinweis art="erfolg" cse="gespraech-gefuehrt" className="mb-s6 max-w-prose">
                {t.vermerktAm.replace('{wann}', berlinZeitIn(g.vermerktAm, sprache))
                  .replace('{wer}', g.vermerktVon ?? t.unbekanntePerson)}
              </Hinweis>
            )}

            <h2 className="mb-s3 text-h3 text-text">Vorbereitete Fragen</h2>
            {g.fragen.length === 0 ? (
              <Hinweis art="warnung" cse="gespraech-ohne-fragen" className="mb-s6 max-w-prose">
                <strong>Keine Fragen hinterlegt.</strong> Ein Gespräch ohne
                festgelegte Fragen lässt sich hinterher nicht mit einem anderen
                vergleichen — und im AGG-Streit ist genau dieser Vergleich das,
                was die Gesellschaft vorlegen muss.
              </Hinweis>
            ) : (
              <ol className="mb-s6 m-0 max-w-prose list-decimal pl-s5 text-sm text-text">
                {g.fragen.map((f) => <li key={f} className="mb-s2">{f}</li>)}
              </ol>
            )}

            <h2 className="mb-s3 text-h3 text-text">Notiz</h2>
            <p className="max-w-prose whitespace-pre-line rounded-lg border border-line bg-surface p-s5 text-sm text-text">
              {g.notiz ?? 'Keine Notiz erfasst.'}
            </p>

            {/* --------------------------------- Termin ändern (V-220, D-714) */}
            {g.status === 'geplant' && (
              <section aria-labelledby="gespraech-aendern" className="mt-s7 max-w-prose"
                       data-cse="gespraech-aendern">
                <h2 id="gespraech-aendern" className="mb-s3 text-h3 text-text">
                  {t.aendernTitel}
                </h2>
                {darf['kalender.schreiben'] !== true ? (
                  <p className="text-sm text-text-muted" data-cse="gespraech-ohne-recht">
                    {t.ohneRecht}{' '}
                    <Recht schluessel="kalender.schreiben" sprache={sprache} />
                  </p>
                ) : (
                  <div className="flex flex-col gap-s5">
                    <form method="post" action={`/api/recruiting/gespraeche/${g.id}`}
                          data-cse="gespraech-verschieben"
                          className="flex flex-col gap-s4 rounded-lg border border-line bg-surface p-s5">
                      <h3 className="m-0 text-base font-semibold text-text">
                        {t.verschiebenTitel}
                      </h3>
                      <input type="hidden" name="aktion" value="verschieben" />
                      <input type="hidden" name="zurueck" value={zurueck} />
                      <div className="flex flex-col gap-s2">
                        <label htmlFor="termin" className="text-xs text-text-muted">
                          {t.neuerTermin}
                        </label>
                        <input id="termin" name="termin" type="datetime-local" required
                               defaultValue={berlinFormularWert(g.termin)}
                               className={FELD} data-cse="gespraech-neuer-termin" />
                        <p className="text-xs text-text-subtle">{t.neuerTerminHinweis}</p>
                      </div>
                      <FormField label={t.dauer} name="dauer" type="number"
                                 defaultValue={String(g.dauerMinuten)} hinweis={t.dauerHinweis} />
                      <div>
                        <Button type="submit" variante="secondary"
                                data-cse="gespraech-verschieben-abschicken">
                          {t.verschiebenKnopf}
                        </Button>
                      </div>
                    </form>

                    <form method="post" action={`/api/recruiting/gespraeche/${g.id}`}
                          data-cse="gespraech-vermerken"
                          className="flex flex-col gap-s3 rounded-lg border border-line bg-surface p-s5">
                      <h3 className="m-0 text-base font-semibold text-text">
                        {t.vermerkenTitel}
                      </h3>
                      <input type="hidden" name="aktion" value="vermerken" />
                      <input type="hidden" name="zurueck" value={zurueck} />
                      <p className="m-0 text-sm text-text-muted">
                        {g.begonnen ? t.vermerkenErklaerung : t.nochNicht}
                      </p>
                      {g.begonnen && (
                        <div>
                          <Button type="submit" variante="secondary"
                                  data-cse="gespraech-vermerken-abschicken">
                            {t.vermerkenKnopf}
                          </Button>
                        </div>
                      )}
                    </form>

                    <form method="post" action={`/api/recruiting/gespraeche/${g.id}`}
                          data-cse="gespraech-absagen"
                          className="flex flex-col gap-s3 rounded-lg border border-line bg-surface p-s5">
                      <h3 className="m-0 text-base font-semibold text-text">
                        {t.absagenTitel}
                      </h3>
                      <input type="hidden" name="aktion" value="absagen" />
                      <input type="hidden" name="zurueck" value={zurueck} />
                      <label className="flex flex-col gap-s2 text-sm text-text">
                        {t.grund}
                        <textarea name="grund" rows={2} required
                                  data-cse="gespraech-absage-grund"
                                  placeholder={t.grundBeispiel} className={FELD} />
                      </label>
                      <p className="m-0 text-xs text-text-muted">{t.grundHinweis}</p>
                      <div>
                        <Button type="submit" variante="danger"
                                data-cse="gespraech-absagen-abschicken">
                          {t.absagenKnopf}
                        </Button>
                      </div>
                    </form>
                  </div>
                )}
              </section>
            )}

            {/*
              * **Nichts geht von selbst an die Bewerberin** (Invariante 7): der
              * Weg zu einer Nachricht ist die Antwortseite — Entwurf, Freigabe,
              * erst dann hinaus. Der Verweis steht nur mit deren zwei Rechten.
              */}
            {(g.status === 'abgesagt' || erledigt === 'verschoben') && (
              <p className="mt-s5 max-w-prose text-sm text-text-muted" data-cse="gespraech-nachricht">
                {t.nachricht}
                {darf['recruiting.bewerbung_bewerten'] === true
                  && darf['recruiting.entscheiden'] === true && (
                  <>
                    {' '}
                    <Link
                      href={`/portal/${mandant}/recruiting/bewerbungen/${g.bewerbungId}/antwort`}
                      data-cse="gespraech-zur-antwort"
                      className="text-text underline underline-offset-2 hover:text-brand"
                    >
                      {t.nachrichtVerweis}
                    </Link>
                  </>
                )}
              </p>
            )}
          </>
        );
      }}
    />
  );
}
