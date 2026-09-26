import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Hinweis } from '@/components/ui/Hinweis';
import { internSprache } from '@/lib/i18n/intern';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { RECRUITING_KANDIDAT_TEXTE } from '@/lib/i18n/verwaltung/recruiting-kandidat';
import { eigenerEintrag } from '@/lib/nachschlagen';
import { listeStellen } from '@/server/services/recruiting/dienst';
import { RecruitingSeite, leseImMandanten } from '../../rahmen';
import { FELD, KNOPF } from '../../felder';
import { grundAus } from '../../rueckmeldung';

/**
 * `/portal/[mandant]/recruiting/bewerbungen/neu` — eine Bewerbung aus dem
 * Postfach erfassen (REC-03, REC-07, V-224, D-718).
 *
 * **Warum es diese Seite gibt.** REC-03 verlangt Bewerbungen über das
 * Karriereformular UND über ein Postfach. Das Postfach ist nicht
 * angeschlossen (O-938) — und die Seite sagt das zuerst. Bis dahin überträgt
 * ein Mensch, was per E-Mail kam: mit Quelle „E-Mail-Postfach" und derselben
 * Löschfrist wie jede andere Bewerbung.
 *
 * **Keine Kaltakquise, kein Scraping** (CLAUDE.md): erfasst wird, was jemand
 * von sich aus geschickt hat.
 *
 * Zweisprachig von Anfang an (D-592): jedes sichtbare Wort kommt aus
 * `verwaltung/recruiting-kandidat.ts`.
 */
export const dynamic = 'force-dynamic';

const T = RECRUITING_KANDIDAT_TEXTE;

export default async function BewerbungAusPostfach(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const grund = grundAus(await searchParams);
  return (
    <RecruitingSeite
      mandant={mandant}
      unterpfad="bewerbungen/neu"
      titel={{ de: T.de.pTitel, en: T.en.pTitel }}
      kinder={async (zugang) => {
        const t = nachSprache(T, internSprache(zugang.sprache));
        /* Nur offene Stellen — eine geschlossene nimmt keine Bewerbung mehr an. */
        const stellen = (await leseImMandanten(zugang, (k) => listeStellen(k)))
          .filter((s) => s.geschlossenAm === null);
        return (
          <>
            <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
              <h1 className="m-0 text-h1 text-text">{t.pTitel}</h1>
              <Link href={`/portal/${mandant}/recruiting/bewerbungen`} className={KNOPF}>
                {t.pZurListe}
              </Link>
            </div>

            <Hinweis art="warnung" cse="postfach-nicht-verbunden" className="mb-s5 max-w-prose">
              <strong>{t.pNichtVerbunden}</strong>{' '}
              {t.pEinleitung}
            </Hinweis>

            {grund !== null && (
              <Hinweis art="warnung" cse="postfach-fehler" className="mb-s5 max-w-prose">
                <strong>{t.pNichtGespeichert}</strong>{' '}
                {eigenerEintrag(t.pFehler, grund) ?? t.pFehlerSonst}
              </Hinweis>
            )}

            <form method="post" action="/api/recruiting/bewerbungen" data-cse="postfach-formular"
                  className="flex max-w-prose flex-col gap-s4">
              <input type="hidden" name="zurueck"
                     value={`/portal/${mandant}/recruiting/bewerbungen/neu`} />

              <div className="flex flex-col gap-s2">
                <label htmlFor="stelle" className="text-xs text-text-muted">{t.pStelle}</label>
                <select id="stelle" name="stelle" defaultValue="" className={FELD}
                        data-cse="postfach-stelle">
                  <option value="">{t.pInitiativ}</option>
                  {stellen.map((s) => <option key={s.id} value={s.id}>{s.titel}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-s2">
                <label htmlFor="name" className="text-xs text-text-muted">{t.pName}</label>
                <input id="name" name="name" required maxLength={200} className={FELD}
                       data-cse="postfach-name" />
              </div>
              <div className="flex flex-col gap-s2">
                <label htmlFor="email" className="text-xs text-text-muted">{t.pEmail}</label>
                <input id="email" name="email" type="email" required maxLength={254}
                       className={FELD} data-cse="postfach-email" />
              </div>
              <div className="flex flex-col gap-s2">
                <label htmlFor="telefon" className="text-xs text-text-muted">{t.pTelefon}</label>
                <input id="telefon" name="telefon" type="tel" maxLength={60} className={FELD} />
              </div>
              <div className="flex flex-col gap-s2">
                <label htmlFor="nachricht" className="text-xs text-text-muted">
                  {t.pNachricht}
                </label>
                <textarea id="nachricht" name="nachricht" rows={8} maxLength={20000}
                          className={FELD} data-cse="postfach-nachricht" />
                <p className="text-xs text-text-subtle">{t.pNachrichtHinweis}</p>
              </div>
              <p className="m-0 text-xs text-text-muted">{t.pFrist}</p>
              <div>
                <Button type="submit" variante="primary" data-cse="postfach-anlegen">
                  {t.pAnlegen}
                </Button>
              </div>
            </form>
          </>
        );
      }}
    />
  );
}
