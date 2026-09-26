import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Hinweis } from '@/components/ui/Hinweis';
import { RecruitingSeite } from '../../rahmen';
import { FELD, KNOPF } from '../../felder';
import { grundAus, RecruitingRueckmeldung } from '../../rueckmeldung';

/**
 * `/portal/[mandant]/recruiting/stellen/neu` — der Entwurf (REC-02,
 * Invariante 7).
 *
 * **Sie entsteht als ENTWURF, immer.** Auf diesem Bildschirm gibt es keinen
 * Knopf, der veröffentlicht, und kein Feld, das die Freigabe überspringt: das
 * Formular kennt nur `POST /api/recruiting/stellen`, und die Route legt nur
 * Entwürfe an. Der Weg nach draussen führt über die Freigabe — dieselbe Regel
 * wie beim Social-Beitrag (SOC-08), und aus demselben Grund: was den Namen
 * einer Gesellschaft trägt, geht nicht ohne einen Menschen hinaus.
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
  return (
    <RecruitingSeite
      mandant={mandant}
      unterpfad="stellen/neu"
      titel="Neue Stelle"
      kinder={async (zugang) => (
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

          <form method="post" action="/api/recruiting/stellen" data-cse="stelle-formular"
                className="flex max-w-prose flex-col gap-s4">
            <input type="hidden" name="mandant" value={mandant} />
            <input type="hidden" name="zurueck"
                   value={`/portal/${mandant}/recruiting/stellen/neu`} />

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
      )}
    />
  );
}
