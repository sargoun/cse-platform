import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { formularSchluessel, angebotPfad } from '@/lib/formular/bereiche';
import { basisAusAnfrage } from '@/server/inhalt/seiten-daten';
import { DANK_TEXTE } from '@/lib/i18n/texte';
import { mitSprache, VORGABE_SPRACHE, type Sprache } from '@/lib/sprache';

/**
 * `/angebot/[bereich]/danke` — die Bestätigung nach einer Anfrage (REQ-01).
 *
 * **Warum es diese Seite geben MUSS.** Das Anfrageformular hat kein
 * JavaScript, und `/api/anfrage` antwortete mit JSON. Ein Besucher, der gerade
 * um ein Angebot gebeten hatte, landete also auf einer weissen Seite mit
 * `{"ok":true,"leadnummer":"L-..."}`. Das war der letzte Eindruck, den die
 * Firma bei ihm hinterliess — und der wahrscheinlichste nächste Schritt ist,
 * dass er es nochmal versucht und die SLA-Warteschlange mit Doppeln füllt
 * (SEITENKARTE §2.3 nennt genau diesen Fall).
 *
 * **Sie steht unter `[bereich]` und nicht daneben.** Ein statischer Ordner
 * `/angebot/danke` würde vom dynamischen `[bereich]` überdeckt: `/angebot/danke`
 * sähe aus wie ein Bereich namens „danke", und der hat kein Formular — 404,
 * nachdem der Lead schon geschrieben ist.
 *
 * **Kein `noindex`, aber auch kein Inhalt für Suchmaschinen.** Die Seite trägt
 * eine Vorgangsnummer in der Adresse; sie gehört nicht in einen Index. `robots`
 * sagt das ausdrücklich, statt sich darauf zu verlassen, dass niemand sie
 * verlinkt.
 */

export async function dankMetadaten(
  bereich: string, sprache: Sprache = VORGABE_SPRACHE,
): Promise<Metadata> {
  const basis = await basisAusAnfrage();
  const t = DANK_TEXTE[sprache];
  return {
    title: t.titel,
    description: t.satz,
    robots: { index: false, follow: true },
    alternates: {
      canonical: `${basis}${mitSprache(`${angebotPfad(bereich)}/danke`, sprache)}`,
    },
  };
}

export function DankeSeiteFuer(
  bereich: string, nummer: string | null, sprache: Sprache = VORGABE_SPRACHE,
) {
  /*
   * Ein Bereich ohne Formular hat keine Dankseite — sonst bestaetigte sie eine
   * Anfrage, die nie moeglich war. Dieselbe Pruefung wie am Formular selbst,
   * und aus derselben Quelle (`formularSchluessel`).
   */
  if (formularSchluessel(bereich) === undefined) notFound();
  const t = DANK_TEXTE[sprache];

  return (
    <section data-cse="angebot-danke"
             className="mx-auto flex max-w-content flex-col gap-s5 px-s5 py-s6">
      <h1 className="text-h1 text-text [hyphens:auto] break-words">{t.titel}</h1>
      <p className="max-w-[72ch] text-base text-text-muted">{t.satz}</p>

      {/*
        * Die Nummer steht in einem eigenen Kasten und nicht im Fliesstext: sie
        * ist das einzige, was jemand sich aufschreibt.
        */}
      {nummer !== null && nummer !== '' && (
        <div data-cse="angebot-vorgangsnummer"
             className="max-w-[48ch] rounded-lg border border-line bg-surface p-s5">
          <p className="m-0 text-micro uppercase tracking-[0.08em] text-text-muted">
            {t.nummerLabel}
          </p>
          <p className="m-0 mt-s2 font-mono text-h2 text-text">{nummer}</p>
          <p className="m-0 mt-s3 text-sm text-text-muted">{t.nummerHinweis}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-s4">
        <a
          href={mitSprache(angebotPfad(bereich), sprache)}
          data-cse="danke-weiter"
          className="min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-base text-text hover:bg-surface-2"
        >
          {t.weiter}
        </a>
        <a
          href={mitSprache('/', sprache)}
          data-cse="danke-startseite"
          className="min-h-11 rounded-md border border-line-strong px-s5 py-s3 text-base text-text hover:bg-surface-2"
        >
          {t.zurStartseite}
        </a>
      </div>
    </section>
  );
}
