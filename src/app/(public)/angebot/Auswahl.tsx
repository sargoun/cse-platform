import { notFound } from 'next/navigation';
import { FORMULAR_SCHLUESSEL, angebotPfad } from '@/lib/formular/bereiche';
import { bereicheLesen, oeffentlichLesen } from '@/server/inhalt/lesen';
import { AUSWAHL_TEXTE } from '@/lib/i18n/texte';
import { mitSprache, VORGABE_SPRACHE, type Sprache } from '@/lib/sprache';
import { BereichsAvatar } from '@/components/ui/AreaBadge';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * `/angebot` — die Bereichsauswahl (§2.3, REQ-01).
 *
 * **Kein Formular mit einer Auswahlliste.** Die drei Feldsätze sind
 * verschieden, weil die Gewerke verschieden sind: Reinigung rechnet über m²
 * und Frequenz, Sicherheit über Zeitraum und Kräfte, Bau über Gewerk und
 * Leistungsverzeichnis. Ein gemeinsames Formular mit Dropdown fragte entweder
 * zu wenig, um zu rechnen, oder zu viel, um es auszufüllen.
 *
 * Die Bereiche kommen aus `mandant`, nicht aus einer Liste hier — ein fünfter
 * Bereich braucht eine Zeile und keine Komponente.
 */
export async function Angebotsauswahl(
  { sprache = VORGABE_SPRACHE }: { readonly sprache?: Sprache } = {},
) {
  const bereiche = await oeffentlichLesen(bereicheLesen);
  const mitFormular = bereiche.filter(
    (b) => FORMULAR_SCHLUESSEL[b.slug] !== undefined,
  );
  // Kein Bereich mit Formular hiesse: diese Seite hat nichts zu zeigen. Eine
  // leere Auswahlseite sähe aus wie ein Ladefehler.
  if (mitFormular.length === 0) notFound();

  const t = AUSWAHL_TEXTE[sprache];

  return (
    <section className="mx-auto flex max-w-content flex-col gap-s5 px-s5 py-s6">
      <h1 className="text-h1 text-text [hyphens:auto] break-words">{t.titel}</h1>
      <p className="max-w-[72ch] text-base text-text-muted">{t.einleitung}</p>

      <ul data-cse="angebot-auswahl" className="grid gap-s4 sm:grid-cols-2">
        {mitFormular.map((b) => (
          <li key={b.slug}>
            <a
              href={mitSprache(angebotPfad(b.slug), sprache)}
              data-cse="angebot-bereich"
              data-bereich={b.slug}
              className="flex items-center gap-s4 rounded-lg border border-line bg-surface p-s5"
            >
              <BereichsAvatar bereich={b.slug as BereichSchluessel} />
              <span className="flex flex-col">
                <span className="text-h3 text-text">{b.name}</span>
                {b.kurzbeschreibung !== null && (
                  <span className="text-sm text-text-muted">{b.kurzbeschreibung}</span>
                )}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
