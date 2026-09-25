import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Hinweis } from '@/components/ui/Hinweis';
import { Recht } from '@/components/ui/Recht';
import { internSprache } from '@/lib/i18n/intern';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { RECRUITING_STELLENENTWURF_TEXTE } from '@/lib/i18n/verwaltung/recruiting-stellenentwurf';
import { bedarf } from '@/server/services/recruiting/dienst';
import { haeltRechte } from '../../../../rechte';
import { RecruitingSeite, leseImMandanten } from '../../rahmen';
import { FELD, KNOPF } from '../../felder';
import { grundAus, RecruitingRueckmeldung } from '../../rueckmeldung';

/**
 * `/portal/[mandant]/recruiting/stellen/neu` — der Entwurf (REC-02,
 * Invariante 7).
 *
 * **Sie entsteht als ENTWURF, immer.** Auf diesem Bildschirm gibt es keinen
 * Knopf, der veröffentlicht, und kein Feld, das die Freigabe überspringt: die
 * Formulare kennen nur `POST /api/recruiting/stellen` und
 * `POST /api/recruiting/stellen/entwurf`, und beide legen nur Entwürfe an.
 * Der Weg nach draussen führt über die Freigabe — dieselbe Regel wie beim
 * Social-Beitrag (SOC-08), und aus demselben Grund: was den Namen einer
 * Gesellschaft trägt, geht nicht ohne einen Menschen hinaus.
 *
 * **Zwei Wege zum Entwurf** (V-222, D-716). Der Back-office-Agent formuliert
 * die Beschreibung aus den Angaben eines Menschen (REC-02 „AI drafts, a human
 * edits and approves", SPEC §17); oder ein Mensch schreibt sie selbst. Die
 * Anforderungen schreibt in beiden Fällen der Mensch.
 *
 * **Anforderungen je Zeile und nicht als Fliesstext.** Die Bewertung läuft
 * später GEGEN diese Zeilen (REC-05); ein Absatz liesse sich nicht als
 * Kriterium ausweisen, und genau das müsste im AGG-Streit erklärt werden.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Neue Stelle — Recruiting' };

export default async function NeueStelle(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  /* V-148: die Abweisung kommt als `?fehler=` auf DIESE Seite zurück. */
  const grund = grundAus(await searchParams);
  const zurueck = `/portal/${mandant}/recruiting/stellen/neu`;
  return (
    <RecruitingSeite
      mandant={mandant}
      unterpfad="stellen/neu"
      titel="Neue Stelle"
      kinder={async (zugang) => {
        const sprache = internSprache(zugang.sprache);
        const t = nachSprache(RECRUITING_STELLENENTWURF_TEXTE, sprache);
        /*
         * Der Agentenweg verlangt ZWEI Rechte — die Route prüft beide
         * (`recruiting.stelle_schreiben`, `agent.aufgabe_starten`). Wer nur
         * das erste hält, sieht den Abschnitt mit dem fehlenden Recht statt
         * eines Knopfs mit einer Abweisung dahinter (AUT-06).
         */
        const darf = await haeltRechte(zugang.sitzung, 'agent.aufgabe_starten');
        const objekte = (await leseImMandanten(zugang, (k) => bedarf(k, 4)))
          .filter((b): b is typeof b & { objektId: string } => b.objektId !== null);
        /* Einmal je gezeichnetem Formular: ein zweiter Klick trägt denselben Schlüssel. */
        const schluessel = randomUUID();

        return (
          <>
            <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
              <h1 className="m-0 text-h1 text-text">Neue Stelle</h1>
              <Link href={`/portal/${mandant}/recruiting/stellen`} className={KNOPF}>
                Zurück zur Liste
              </Link>
            </div>

            <RecruitingRueckmeldung sprache={zugang.sprache} seite="stelleNeu" grund={grund}
                                    eingabenErneut />

            <Hinweis art="hinweis" cse="stelle-neu-hinweis" className="mb-s5 max-w-prose">
              <strong>Diese Stelle entsteht als Entwurf.</strong> Sie erscheint
              weder auf der Karriereseite noch bei einer Jobbörse, bevor ein
              Mensch sie freigegeben hat (Invariante 7). Was hier steht, lässt
              sich danach nicht mehr stillschweigend ändern.
            </Hinweis>

            {/* ------------------------------ Der Agent entwirft (V-222, D-716) */}
            <section aria-labelledby="stelle-agent" className="mb-s7 max-w-prose"
                     data-cse="stelle-agent">
              <h2 id="stelle-agent" className="mb-s3 text-h3 text-text">{t.agentTitel}</h2>
              <p className="mb-s4 text-sm text-text-muted">{t.agentErklaerung}</p>
              {darf['agent.aufgabe_starten'] !== true ? (
                <p className="text-sm text-text-muted" data-cse="stelle-agent-ohne-recht">
                  {t.agentOhneRecht}{' '}
                  <Recht schluessel="agent.aufgabe_starten" sprache={sprache} />
                </p>
              ) : (
                <form method="post" action="/api/recruiting/stellen/entwurf"
                      data-cse="stelle-agent-formular"
                      className="flex flex-col gap-s4 rounded-lg border border-line bg-surface p-s5">
                  <input type="hidden" name="zurueck" value={zurueck} />
                  <input type="hidden" name="schluessel" value={schluessel} />

                  <div className="flex flex-col gap-s2">
                    <label htmlFor="agent-titel" className="text-xs text-text-muted">
                      {t.titel}
                    </label>
                    <input id="agent-titel" name="titel" required maxLength={160}
                           className={FELD} data-cse="stelle-agent-titel" />
                  </div>
                  <div className="flex flex-col gap-s2">
                    <label htmlFor="agent-ort" className="text-xs text-text-muted">
                      {t.einsatzort}
                    </label>
                    <input id="agent-ort" name="einsatzort" required maxLength={120}
                           className={FELD} data-cse="stelle-agent-ort" />
                  </div>
                  <div className="flex flex-col gap-s2">
                    <label htmlFor="agent-beginn" className="text-xs text-text-muted">
                      {t.beginn}
                    </label>
                    <input id="agent-beginn" name="beginn" required maxLength={80}
                           className={FELD} data-cse="stelle-agent-beginn" />
                    <p className="text-xs text-text-subtle">{t.beginnHinweis}</p>
                  </div>
                  <div className="flex flex-col gap-s2">
                    <label htmlFor="agent-aufgaben" className="text-xs text-text-muted">
                      {t.aufgaben}
                    </label>
                    <textarea id="agent-aufgaben" name="aufgaben" rows={4} className={FELD}
                              data-cse="stelle-agent-aufgaben" />
                    <p className="text-xs text-text-subtle">{t.aufgabenHinweis}</p>
                  </div>
                  <div className="flex flex-col gap-s2">
                    <label htmlFor="agent-anforderungen" className="text-xs text-text-muted">
                      {t.anforderungen}
                    </label>
                    <textarea id="agent-anforderungen" name="anforderungen" rows={4}
                              className={FELD} data-cse="stelle-agent-anforderungen" />
                    <p className="text-xs text-text-subtle">{t.anforderungenHinweis}</p>
                  </div>
                  <div className="flex flex-col gap-s2">
                    <label htmlFor="agent-objekt" className="text-xs text-text-muted">
                      {t.objekt}
                    </label>
                    <select id="agent-objekt" name="objekt" defaultValue="" className={FELD}
                            data-cse="stelle-agent-objekt">
                      <option value="">{t.objektKeins}</option>
                      {objekte.map((o) => (
                        <option key={o.objektId} value={o.objektId}>
                          {t.objektZeile.replace('{objekt}', o.objektName ?? '—')
                            .replace('{zusagen}', String(o.fehlendeZusagen))
                            .replace('{schichten}', String(o.schichten))}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-text-subtle">{t.objektHinweis}</p>
                  </div>
                  <div className="flex flex-col gap-s2">
                    <label htmlFor="agent-stunden" className="text-xs text-text-muted">
                      {t.wochenstunden}
                    </label>
                    <input id="agent-stunden" name="wochenstunden" type="number" min="1"
                           max="60" step="0.5" className={FELD} />
                  </div>
                  <div className="flex flex-col gap-s2">
                    <label htmlFor="agent-frist" className="text-xs text-text-muted">
                      {t.frist}
                    </label>
                    <input id="agent-frist" name="bewerbungsfrist" type="date" className={FELD} />
                    <p className="text-xs text-text-subtle">{t.fristHinweis}</p>
                  </div>
                  <div>
                    <Button type="submit" variante="primary" data-cse="stelle-agent-anlegen">
                      {t.agentKnopf}
                    </Button>
                  </div>
                </form>
              )}
            </section>

            <h2 className="mb-s3 text-h3 text-text">{t.handTitel}</h2>
            <form method="post" action="/api/recruiting/stellen" data-cse="stelle-formular"
                  className="flex max-w-prose flex-col gap-s4">
              <input type="hidden" name="mandant" value={mandant} />
              <input type="hidden" name="zurueck" value={zurueck} />

              <div className="flex flex-col gap-s2">
                <label htmlFor="titel" className="text-xs text-text-muted">Titel</label>
                <input id="titel" name="titel" required maxLength={160} className={FELD}
                       data-cse="stelle-titel" />
              </div>

              <div className="flex flex-col gap-s2">
                <label htmlFor="beschreibung" className="text-xs text-text-muted">
                  Beschreibung
                </label>
                <textarea id="beschreibung" name="beschreibung" required rows={8}
                          className={FELD} data-cse="stelle-beschreibung" />
                <p className="text-xs text-text-subtle">
                  Was die Stelle ist. Auf der Karriereseite steht genau dieser
                  Text — er wird nicht umgeschrieben.
                </p>
              </div>

              <div className="flex flex-col gap-s2">
                <label htmlFor="anforderungen" className="text-xs text-text-muted">
                  Anforderungen — eine je Zeile
                </label>
                <textarea id="anforderungen" name="anforderungen" rows={6} className={FELD}
                          data-cse="stelle-anforderungen" />
                <p className="text-xs text-text-subtle">
                  Je Zeile eine Anforderung. Die Bewertung einer Bewerbung läuft
                  später gegen diese Zeilen (REC-05) — ein Absatz liesse sich
                  nicht als Kriterium ausweisen.
                </p>
              </div>

              <div className="flex flex-col gap-s2">
                <label htmlFor="einsatzort" className="text-xs text-text-muted">
                  Einsatzort
                </label>
                <input id="einsatzort" name="einsatzort" maxLength={120} className={FELD}
                       data-cse="stelle-ort" />
              </div>

              <div className="flex flex-col gap-s2">
                <label htmlFor="wochenstunden" className="text-xs text-text-muted">
                  Wochenstunden
                </label>
                <input id="wochenstunden" name="wochenstunden" type="number" min="1" max="60"
                       step="0.5" className={FELD} data-cse="stelle-stunden" />
              </div>

              <div className="flex flex-col gap-s2">
                <label htmlFor="frist" className="text-xs text-text-muted">
                  Bewerbungsfrist
                </label>
                <input id="frist" name="bewerbungsfrist" type="date" className={FELD}
                       data-cse="stelle-frist" />
                <p className="text-xs text-text-subtle">
                  Leer heisst: offen, bis die Stelle geschlossen wird.
                </p>
              </div>

              <Button type="submit" variante="primary" data-cse="stelle-anlegen">
                Entwurf anlegen
              </Button>
            </form>
          </>
        );
      }}
    />
  );
}
