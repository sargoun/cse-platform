import { Hero } from './Hero';
import { MarkenKarte } from './MarkenKarte';
import { PLATZHALTER_BILD } from '@/lib/placeholder-assets';
import { faqAus, leistungenAus } from '@/server/services/inhalt/jsonld';
import type { Abschnitt, Seite } from '@/server/services/inhalt/seite';
import type { ShellBereich } from './OeffentlicheShell';
import { mitSprache, VORGABE_SPRACHE, type Sprache } from '@/lib/sprache';

/**
 * Rendert die Abschnitte einer `seite`.
 *
 * **Kein fest verdrahteter Text.** Was hier steht, kommt aus der Datenbank;
 * fehlt ein Feld, bleibt die Stelle leer statt mit einem Beispielsatz gefuellt
 * zu werden. Ein Fuellsatz sieht fertig aus und wird deshalb nie ersetzt.
 *
 * Bilder ohne gepflegtes Medium bekommen das markierte Platzhalterbild (D-10)
 * — sichtbar als Platzhalter, nicht als Foto, das keiner mehr austauscht.
 */
function bildVon(a: Abschnitt) {
  return a.medium === null
    ? PLATZHALTER_BILD
    : { pfad: a.medium.pfad, alt: a.medium.alt, platzhalter: a.medium.platzhalter };
}

function Text({ a }: { readonly a: Abschnitt }) {
  const faq = faqAus(a.daten);
  return (
    <section className="mx-auto flex max-w-content flex-col gap-s3 px-s5 py-s6">
      {a.ueberschrift !== null && <h2 className="text-h2 text-text">{a.ueberschrift}</h2>}
      {a.text !== null && <p className="text-base text-text-muted">{a.text}</p>}
      {faq.length > 0 && (
        <dl className="flex flex-col gap-s4">
          {faq.map((f) => (
            <div key={f.frage} className="flex flex-col gap-s2">
              <dt className="text-h3 text-text">{f.frage}</dt>
              <dd className="text-base text-text-muted">{f.antwort}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

function Leistungen({ a }: { readonly a: Abschnitt }) {
  const leistungen = leistungenAus(a.daten);
  return (
    <section className="mx-auto flex max-w-content flex-col gap-s4 px-s5 py-s6">
      {a.ueberschrift !== null && <h2 className="text-h2 text-text">{a.ueberschrift}</h2>}
      <ul className="grid grid-cols-1 gap-s4 sm:grid-cols-2 xl:grid-cols-3">
        {leistungen.map((l) => (
          <li key={l.name} className="rounded-lg border border-line bg-surface p-s5">
            <h3 className="text-h3 text-text">{l.name}</h3>
            {l.beschreibung !== undefined && (
              <p className="mt-s2 text-sm text-text-muted">{l.beschreibung}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export interface AbschnitteProps {
  /**
   * Die Sprache der Seite — sie entscheidet, wohin die Markenkarten führen.
   *
   * Ohne sie zeigte eine Karte auf `/en` nach `/unternehmen/reinigung`, also
   * aus dem englischen Baum heraus in die deutsche Fassung. Der Besucher
   * verliert dabei nicht nur die Sprache, sondern auch seinen Platz.
   */
  readonly sprache?: Sprache;
  readonly seite: Seite;
  readonly bereiche: readonly ShellBereich[];
  /** Kurztexte je Bereich fuer die Markenkarten der Startseite. */
  readonly ansprueche: Readonly<Record<string, string>>;
}

export function Abschnitte(
  { seite, bereiche, ansprueche, sprache = VORGABE_SPRACHE }: AbschnitteProps,
) {
  return (
    <>
      {seite.abschnitte.map((a) => {
        switch (a.art) {
          case 'hero':
            return (
              <Hero
                key={a.id}
                ueberschrift={a.ueberschrift ?? seite.titel}
                akzentWort={a.akzentWort}
                text={a.text}
                bild={bildVon(a)}
              />
            );
          case 'markenkarten':
            return (
              <section
                key={a.id}
                className="mx-auto grid max-w-content grid-cols-1 gap-s4 p-s6 sm:grid-cols-2 xl:grid-cols-4"
              >
                {bereiche.map((b) => (
                  <MarkenKarte
                    key={b.slug}
                    bereich={b.bereich}
                    titel={b.name}
                    anspruch={ansprueche[b.slug] ?? ''}
                    href={mitSprache(`/unternehmen/${b.slug}`, sprache)}
                    bild={PLATZHALTER_BILD}
                  />
                ))}
              </section>
            );
          case 'leistungen':
            return <Leistungen key={a.id} a={a} />;
          default:
            return <Text key={a.id} a={a} />;
        }
      })}
    </>
  );
}
