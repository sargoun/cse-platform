import type { BereichZeile } from '@/server/inhalt/lesen';
import type { Sprache } from '@/lib/sprache';

/**
 * Die Wege zu den vier Gesellschaften — Anschrift, Telefon, E-Mail, Angebot.
 *
 * **Warum die Kontaktseite das braucht.** Sie trug einen Satz: „Für ein Angebot
 * nutzen Sie bitte das Formular des passenden Bereichs — Anschrift und
 * Telefonnummer aller vier Gesellschaften stehen im Impressum." Damit schickte
 * die Seite, auf der jemand Kontakt sucht, ihn auf zwei andere Seiten weiter.
 * Die Angaben stehen in `mandant`; sie hier NICHT zu zeigen war eine
 * Entscheidung gegen den Besucher und nicht gegen die Doppelpflege.
 *
 * Der Weg zum Angebot steht daneben, weil er der ist, den das Geschaeft
 * braucht: ein Anruf hinterlaesst keine Angaben, aus denen sich rechnen laesst
 * (`formular_definition` fragt genau die ab). Beides nebeneinander heisst:
 * ruf an, wenn du reden willst; nimm das Formular, wenn du einen Preis willst.
 */
const TEXT = {
  de: {
    ueberschrift: 'Direkt zur richtigen Gesellschaft',
    telefon: 'Telefon',
    epost: 'E-Mail',
    angebot: 'Angebot anfragen',
    fehlt: 'nicht hinterlegt',
    hinweis:
      'Ein Anruf klärt schnell — für ein belastbares Angebot braucht es die '
      + 'Angaben aus dem Formular, denn daraus wird gerechnet.',
  },
  en: {
    ueberschrift: 'Straight to the right company',
    telefon: 'Phone',
    epost: 'E-mail',
    angebot: 'Request a quote',
    fehlt: 'not recorded',
    hinweis:
      'A call settles things quickly — a binding quote needs the details from '
      + 'the form, because that is what the calculation uses.',
  },
} as const;

/**
 * `operations` fuehrt die Gruppe und verkauft nichts.
 *
 * Ein „Angebot anfragen" dort fuehrte auf ein Formular, das es nicht gibt —
 * derselbe Fehler wie ein Menuepunkt auf eine 404.
 */
const MIT_ANGEBOT: ReadonlySet<string> = new Set(['reinigung', 'security', 'bau']);

function leer(wert: string | null | undefined): string | null {
  return wert === null || wert === undefined || wert.trim() === '' ? null : wert;
}

export function Kontaktwege({ bereiche, sprache }: {
  readonly bereiche: readonly BereichZeile[];
  readonly sprache: Sprache;
}) {
  const t = TEXT[sprache === 'en' ? 'en' : 'de'];
  const praefix = sprache === 'en' ? '/en' : '';
  return (
    <section data-cse="kontaktwege" className="mx-auto max-w-content px-s5 py-s6">
      <h2 className="mb-s5 text-h2 text-text">{t.ueberschrift}</h2>
      <div className="grid grid-cols-1 gap-s5 md:grid-cols-2">
        {bereiche.map((b) => {
          const telefon = leer(b.telefon);
          const epost = leer(b.email);
          return (
            <div key={b.id} data-cse="kontaktweg" data-slug={b.slug}
                 className="rounded-lg border border-line bg-surface-2 p-s5">
              <h3 className="mb-s1 text-h3 text-text">{b.name}</h3>
              <p className="mb-s4 text-sm text-text-muted">{b.firma}</p>

              {leer(b.strasse) !== null && (
                <p className="mb-s3 text-base text-text">
                  {b.strasse}<br />
                  {b.plz} {b.ort}
                </p>
              )}

              <dl className="m-0 mb-s4">
                <div className="flex gap-s3 py-s1">
                  <dt className="w-20 text-sm text-text-muted">{t.telefon}</dt>
                  <dd className="m-0 text-base">
                    {telefon === null
                      ? <span className="text-text-subtle italic">{t.fehlt}</span>
                      : (
                        <a href={`tel:${telefon.replace(/[^+\d]/gu, '')}`}
                           className="text-text underline underline-offset-4">
                          {telefon}
                        </a>
                      )}
                  </dd>
                </div>
                <div className="flex gap-s3 py-s1">
                  <dt className="w-20 text-sm text-text-muted">{t.epost}</dt>
                  <dd className="m-0 break-all text-base">
                    {epost === null
                      ? <span className="text-text-subtle italic">{t.fehlt}</span>
                      : (
                        <a href={`mailto:${epost}`}
                           className="text-text underline underline-offset-4">
                          {epost}
                        </a>
                      )}
                  </dd>
                </div>
              </dl>

              {MIT_ANGEBOT.has(b.slug) && (
                <a href={`${praefix}/angebot/${b.slug}`} data-cse="kontakt-angebot"
                   className="inline-flex min-h-11 items-center text-sm text-text
                              underline underline-offset-4">
                  {t.angebot} ›
                </a>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-s5 max-w-[72ch] text-sm text-text-subtle">{t.hinweis}</p>
    </section>
  );
}
