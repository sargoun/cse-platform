import { BereichsAvatar } from '@/components/ui/AreaBadge';
import type { BereichSchluessel } from '@/lib/design/theme';
import type { ReferenzMitBereich } from '@/server/services/inhalt/referenz';
import type { BeitragMitBereich } from '@/server/services/social/dienst';
import { mitSprache, type Sprache } from '@/lib/sprache';

/**
 * Die Gruppenlisten `/projekte` und `/news` — die ECHTEN Zeilen, nicht ein
 * Platzhaltertext (SEITENKARTE §2.1, PRO-05, SOC-05).
 *
 * **Was hier repariert wird.** Beide Seiten trugen einen redaktionellen
 * Abschnitt: „Hier stehen bald Referenzen" und „Noch keine Beiträge". Die
 * Referenzen und Beiträge gab es längst — sie standen auf den vier
 * Gesellschaftsprofilen. Ein Besucher, der über die Gruppenseite kam, las also,
 * es gebe nichts, während zwei Klicks weiter vier freigegebene Projekte
 * standen.
 *
 * **Jede Zeile nennt ihre Gesellschaft und führt DORTHIN.** Die kanonische
 * Adresse einer Referenz ist `/unternehmen/<bereich>/projekte/<slug>`; die
 * Gruppenliste ist eine Übersicht, kein zweiter Ort für denselben Inhalt.
 * Zwei Adressen für einen Text wären zwei Einträge im Suchindex und eine
 * Entscheidung, welcher der richtige ist — die niemand trifft.
 *
 * **Der redaktionelle Abschnitt bleibt stehen**, er wird nur umformuliert: er
 * ist die Einleitung („Projekte zeigen wir nur mit schriftlicher Zustimmung"),
 * und die ist auf einer Liste mit Inhalt genauso wahr wie auf einer leeren.
 */

const TEXTE = {
  de: {
    projekteLeer:
      'Zurzeit ist kein Projekt freigegeben. Wir zeigen ein Projekt erst, wenn der '
      + 'Kunde der Nennung schriftlich zugestimmt hat.',
    newsLeer: 'Zurzeit gibt es keine Beiträge.',
    vonGesellschaft: 'von',
    alleAnsehen: 'Alle Projekte dieser Gesellschaft',
  },
  en: {
    projekteLeer:
      'No project is currently released. We show a project only once the client has '
      + 'agreed in writing to being named.',
    newsLeer: 'There are currently no posts.',
    vonGesellschaft: 'by',
    alleAnsehen: 'All projects of this division',
  },
} as const;

export function GruppenProjekte(
  { referenzen, sprache }: {
    readonly referenzen: readonly ReferenzMitBereich[];
    readonly sprache: Sprache;
  },
) {
  const t = TEXTE[sprache] ?? TEXTE.de;

  return (
    <section data-cse="gruppen-projekte" className="border-t border-line">
      <div className="mx-auto max-w-content px-s5 py-s7">
        {referenzen.length === 0 ? (
          <p className="m-0 max-w-[72ch] text-base text-text-muted">{t.projekteLeer}</p>
        ) : (
          <ul className="m-0 grid list-none grid-cols-1 gap-s4 p-0 md:grid-cols-2">
            {referenzen.map((r) => (
              <li key={r.id}>
                {/*
                  * `<a>` und nicht `<Link>`: `typedRoutes` prueft `href` gegen
                  * die bekannten Routen und nimmt keine zur Laufzeit gebaute
                  * Zeichenkette an — `mitSprache()` gibt genau eine. Dieselbe
                  * Bauart wie in `Auswahl.tsx` und `ProfilTabs.tsx`; auf einer
                  * oeffentlichen Seite ist der vollstaendige Seitenwechsel
                  * ohnehin richtig.
                  */}
                <a
                  href={mitSprache(`/unternehmen/${r.bereichSlug}/projekte/${r.slug}`, sprache)}
                  data-cse="gruppen-projekt"
                  data-bereich={r.bereichSlug}
                  className="flex h-full flex-col gap-s3 rounded-lg border border-line bg-surface p-s5 transition-colors duration-fast hover:bg-surface-2"
                >
                  <span className="flex items-center gap-s3">
                    <BereichsAvatar bereich={r.bereichSlug as BereichSchluessel} />
                    <span className="text-micro uppercase tracking-[0.08em] text-text-muted">
                      {r.bereichName}
                    </span>
                  </span>
                  <span className="text-h3 text-text">{r.titel}</span>
                  {r.beschreibung === null ? null : (
                    <span className="text-sm text-text-muted">{r.beschreibung}</span>
                  )}
                  <span className="mt-auto text-xs text-text-subtle">
                    {[r.kundeName, r.jahr === null ? null : String(r.jahr)]
                      .filter((x) => x !== null).join(' · ')}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export function GruppenNeuigkeiten(
  { beitraege, sprache }: {
    readonly beitraege: readonly BeitragMitBereich[];
    readonly sprache: Sprache;
  },
) {
  const t = TEXTE[sprache] ?? TEXTE.de;
  const datum = new Intl.DateTimeFormat(sprache === 'en' ? 'en-GB' : 'de-DE', {
    timeZone: 'Europe/Berlin', dateStyle: 'long',
  });

  return (
    <section data-cse="gruppen-neuigkeiten" className="border-t border-line">
      <div className="mx-auto max-w-content px-s5 py-s7">
        {beitraege.length === 0 ? (
          <p className="m-0 max-w-[72ch] text-base text-text-muted">{t.newsLeer}</p>
        ) : (
          <ul className="m-0 grid list-none grid-cols-1 gap-s4 p-0 md:grid-cols-2">
            {beitraege.map((b) => (
              <li key={b.id}>
                <a
                  href={mitSprache(`/unternehmen/${b.bereichSlug}/news/${b.slug}`, sprache)}
                  data-cse="gruppen-neuigkeit"
                  data-bereich={b.bereichSlug}
                  className="flex h-full flex-col gap-s3 rounded-lg border border-line bg-surface p-s5 transition-colors duration-fast hover:bg-surface-2"
                >
                  <span className="flex items-center gap-s3">
                    <BereichsAvatar bereich={b.bereichSlug as BereichSchluessel} />
                    <span className="text-micro uppercase tracking-[0.08em] text-text-muted">
                      {b.bereichName}
                    </span>
                  </span>
                  <span className="text-h3 text-text">{b.titel}</span>
                  <span className="text-sm text-text-muted">{b.text}</span>
                  {b.veroeffentlichtAm === null ? null : (
                    <span className="mt-auto text-xs text-text-subtle">
                      {datum.format(new Date(b.veroeffentlichtAm))}
                    </span>
                  )}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
