import { Hero } from './Hero';
import { MarkenKarte } from './MarkenKarte';
import { motivFuerBereich, type PlatzhalterMotiv } from '@/lib/placeholder-assets';
import { bildFuerMotiv } from '@/server/inhalt/bilder';
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
/**
 * Das Motiv, das zu DIESER Seite gehoert — abgeleitet aus ihrem Pfad.
 *
 * `/unternehmen/security` bekommt die Nachtszene, `/unternehmen/bau` den
 * Rohbau, alles andere die Gebaeudezeile der Gruppe. Der Pfad ist die einzige
 * Angabe, die hier ohnehin vorliegt, und ein zusaetzliches Feld an `seite`
 * waere ein zweiter Ort, an dem dieselbe Zuordnung gepflegt werden muss.
 */
function motivFuerPfad(pfad: string): PlatzhalterMotiv {
  const teil = pfad.replace(/^\/(?:en\/)?/u, '').split('/');
  return motivFuerBereich(teil[0] === 'unternehmen' ? teil[1] : undefined);
}

/*
 * **Drei Stufen, in dieser Reihenfolge.**
 *
 * 1. Das Medium, das jemand DIESEM Abschnitt zugeordnet hat (`medien`) — die
 *    einzige Stufe, die etwas ueber diesen Abschnitt weiss.
 * 2. Eine Datei in `public/bilder/<motiv>.*` — der schnelle Weg, solange der
 *    Speicher nicht verbunden ist: Datei hinlegen, fertig.
 * 3. Der Platzhalter, sichtbar gekennzeichnet.
 *
 * Die Reihenfolge ist die Aussage: je spezifischer die Zuordnung, desto eher
 * gewinnt sie. Umgekehrt ueberschriebe eine allgemeine Bereichsdatei das
 * Bild, das jemand fuer genau diesen Abschnitt ausgesucht hat.
 */
function bildVon(a: Abschnitt, motiv: PlatzhalterMotiv = 'gruppe') {
  return a.medium === null
    ? bildFuerMotiv(motiv)
    : { pfad: a.medium.pfad, alt: a.medium.alt, platzhalter: a.medium.platzhalter };
}

function Text({ a }: { readonly a: Abschnitt }) {
  const faq = faqAus(a.daten);
  return (
    <section className="mx-auto flex max-w-content flex-col gap-s3 px-s5 py-s6 cse-auftritt">
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
    <section className="mx-auto flex max-w-content flex-col gap-s4 px-s5 py-s6 cse-auftritt">
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
  /*
   * `aktiv` stand hier und wurde von KEINEM Aufrufer gesetzt — die Markenreihe
   * darunter bekam also immer `null` und hat die offene Gesellschaft nie
   * hervorgehoben. Der Slug gehoert zur Huelle, die ihn ohnehin schon
   * bekommt (`OeffentlicheShellProps.aktiv`), und dort steht jetzt auch die
   * Klappwahl. D-381.
   */
}

export function Abschnitte(
  { seite, bereiche, ansprueche, sprache = VORGABE_SPRACHE }: AbschnitteProps,
) {
  return (
    <>
      {seite.abschnitte.map((a) => {
        switch (a.art) {
          case 'hero':
            /*
             * Der Hero steht allein. Die vier Gesellschaften sassen hier
             * darunter — DESIGN §6 verlangte das woertlich — und waren an
             * dieser Stelle falsch: sie landeten auf der ueberlebensgrossen
             * Geisterschrift des Heros und lasen sich als Kollision, und sie
             * verbrauchten ein Band Hoehe direkt unter der Falz. Sie stehen
             * jetzt als Klappwahl im Kopf (`GesellschaftsWahl`), wo sie von
             * JEDER Seite aus erreichbar sind und nicht nur von einer mit
             * Hero. DESIGN §6 ist mitgezogen, D-381.
             */
            return (
              <Hero
                key={a.id}
                ueberschrift={a.ueberschrift ?? seite.titel}
                akzentWort={a.akzentWort}
                text={a.text}
                bild={bildVon(a, motivFuerPfad(seite.pfad))}
                sprache={sprache}
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
                    bild={bildFuerMotiv(motivFuerBereich(b.bereich))}
                    sprache={sprache}
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
