import type { BeitragZeile } from '@/server/services/social/dienst';
import type { Sprache } from '@/lib/sprache';

/**
 * Die veröffentlichten Beiträge einer Gesellschaft auf ihrer Profilseite
 * (SOC-05, PRO-02).
 *
 * **Das ist der Kanal, der ohne Vertrag funktioniert.** Kein Anbieter, kein
 * Schlüssel, keine Wartezeit: ein freigegebener Beitrag steht hier, sobald er
 * veröffentlicht wurde, weil `beitrag.status` es sagt und die öffentliche
 * Policy in `0163` ihn durchlässt. Die fünf fremden Plattformen sind der
 * Zusatz, nicht die Voraussetzung.
 *
 * **Gezeigt wird genau diese Gesellschaft.** Wer auf der Seite von SSE
 * Security steht, will Neuigkeiten von SSE Security — dieselbe Regel wie bei
 * den Kontaktwegen darüber.
 *
 * **Ohne Beitrag steht hier nichts.** Kein „Bald mehr", kein leerer Rahmen:
 * ein Abschnitt, der ankündigt, dass er einmal Inhalt haben wird, ist eine
 * Baustelle auf einer Verkaufsseite.
 */

const TEXTE: Readonly<Record<Sprache, { readonly titel: string; readonly art: Readonly<Record<string, string>> }>> = {
  de: {
    titel: 'Aktuelles',
    art: {
      beitrag: 'Beitrag', projektschau: 'Projekt',
      neuigkeit: 'Neuigkeit', aktualisierung: 'Aktuelles',
    },
  },
  en: {
    titel: 'News',
    art: {
      beitrag: 'Post', projektschau: 'Project',
      neuigkeit: 'News', aktualisierung: 'Update',
    },
  },
};

export interface BeitraegeProps {
  readonly beitraege: readonly BeitragZeile[];
  readonly sprache: Sprache;
}

export function Beitraege({ beitraege, sprache }: BeitraegeProps) {
  if (beitraege.length === 0) return null;
  const t = TEXTE[sprache] ?? TEXTE.de;
  const datum = new Intl.DateTimeFormat(sprache === 'en' ? 'en-GB' : 'de-DE', {
    timeZone: 'Europe/Berlin', dateStyle: 'long',
  });

  return (
    <section data-cse="oeffentliche-beitraege" className="border-t border-line">
      <div className="mx-auto max-w-5xl px-s5 py-s7">
        <h2 className="mb-s5 text-h2 text-text">{t.titel}</h2>
        {/*
          * **Die `id` je Beitrag ist der Anker, auf den fremde Plattformen
          * zeigen.**
          *
          * `beitragsadresse()` im Social-Dienst baut
          * `/unternehmen/<slug>#beitrag-<id>`. Ohne sie landete der Link zwar
          * auf der richtigen Seite, aber irgendwo darauf — und bei sechs
          * Beiträgen nebeneinander ist „irgendwo" nicht der gemeinte.
          * `scroll-mt-s7` hält den Kopfbereich frei, damit der Anker nicht
          * unter der Leiste landet.
          */}
        <ul className="grid grid-cols-1 gap-s4 md:grid-cols-2">
          {beitraege.map((b) => (
            <li key={b.id} id={`beitrag-${b.id}`} data-cse="oeffentlicher-beitrag"
                className="flex scroll-mt-s7 flex-col gap-s2 rounded-lg border border-line bg-surface p-s5">
              <span className="text-micro uppercase text-text-subtle">
                {t.art[b.art] ?? t.art['beitrag']}
                {b.veroeffentlichtAm === null
                  ? '' : ` · ${datum.format(new Date(b.veroeffentlichtAm))}`}
              </span>
              <h3 className="text-h3 text-text hyphens-auto">{b.titel}</h3>
              {/*
                * `whitespace-pre-line`: der Text wurde in einem Textfeld
                * geschrieben, und die Absaetze darin sind Absicht. Ohne das
                * liest sich ein Beitrag als ein einziger Block -- und der
                * Verfasser sieht im Portal etwas anderes als der Besucher.
                */}
              <p className="whitespace-pre-line text-base text-text-muted">{b.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
