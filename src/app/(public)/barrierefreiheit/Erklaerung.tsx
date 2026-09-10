import type { Metadata } from 'next';
import { basisAusAnfrage } from '@/server/inhalt/seiten-daten';
import { bereicheLesen, oeffentlichLesen } from '@/server/inhalt/lesen';
import { BARRIERE_TEXTE } from '@/lib/i18n/texte';
import { alternativen, mitSprache, VORGABE_SPRACHE, type Sprache } from '@/lib/sprache';

/**
 * Die Barrierefreiheitserklaerung (LEG-07, PUB-09).
 *
 * **Warum diese Seite Code ist und kein `seite`-Datensatz.** Sie ist keine
 * Werbeseite, sondern eine rechtlich verlangte Erklaerung. Als
 * CMS-Inhalt liesse sie sich ohne Pruefung aendern oder loeschen — und eine
 * geloeschte Barrierefreiheitserklaerung faellt niemandem auf, bis sie
 * gebraucht wird.
 *
 * **Was hier NICHT steht: eine Konformitaetsaussage.** "Vollstaendig
 * konform", "teilweise konform" — das ist eine rechtliche Erklaerung des
 * Betreibers, die eine tatsaechliche Pruefung voraussetzt. Sie zu erfinden
 * waere schlimmer als sie wegzulassen: eine falsche Konformitaetsaussage ist
 * eine falsche Zusage an genau die Menschen, die sich darauf verlassen. Der
 * Abschnitt ist deshalb sichtbar als offen gekennzeichnet.
 *
 * // TODO(client): O-205 — Konformitätsstatus (vollständig / teilweise /
 * // nicht konform), benannte Stelle für Feedback und Durchsetzungsverfahren,
 * // sowie das Datum der Erstprüfung. Ohne diese drei Angaben ist die
 * // Erklärung nach BFSG unvollständig.
 */
export async function barriereMetadaten(
  sprache: Sprache = VORGABE_SPRACHE,
): Promise<Metadata> {
  const basis = await basisAusAnfrage();
  const t = BARRIERE_TEXTE[sprache];
  return {
    title: t.titel,
    description: t.metaBeschreibung,
    alternates: {
      canonical: `${basis}${mitSprache('/barrierefreiheit', sprache)}`,
      languages: alternativen('/barrierefreiheit', basis),
    },
  };
}

/**
 * Eine Komponente, zwei Sprachen — die Texte kommen aus `BARRIERE_TEXTE`.
 *
 * Eine zweite Komponente daneben waere die naheliegende Loesung und die
 * schlechtere: der naechste Absatz landet in einer von beiden, und die
 * englische Erklaerung sagt dann etwas anderes als die deutsche. Bei einer
 * rechtlich verlangten Erklaerung ist das kein Schoenheitsfehler.
 */
export async function Barrierefreiheit(
  { sprache = VORGABE_SPRACHE }: { readonly sprache?: Sprache } = {},
) {
  const bereiche = await oeffentlichLesen(bereicheLesen);
  const kontakt = bereiche.find((b) => b.email !== null && b.email !== '');
  const t = BARRIERE_TEXTE[sprache];

  return (
    <article className="mx-auto flex max-w-content flex-col gap-s5 px-s5 py-s6">
      <h1 className="text-h1 text-text">{t.titel}</h1>

      <section className="flex flex-col gap-s2">
        <h2 className="text-h2 text-text">{t.standardTitel}</h2>
        <p className="text-base text-text-muted">{t.standardText}</p>
      </section>

      <section className="flex flex-col gap-s2">
        <h2 className="text-h2 text-text">{t.pruefungTitel}</h2>
        <p className="text-base text-text-muted">{t.pruefungText}</p>
        <p className="text-base text-text-muted">{t.pruefungGrenze}</p>
      </section>

      {/* Sichtbar offen, nicht stillschweigend erfunden. */}
      <section
        data-cse="offener-punkt"
        className="flex flex-col gap-s2 rounded-lg border border-warning bg-warning-soft p-s5"
      >
        <h2 className="text-h2 text-text">{t.offenTitel}</h2>
        <p className="text-base text-text">{t.offenText}</p>
      </section>

      <section className="flex flex-col gap-s2">
        <h2 className="text-h2 text-text">{t.meldenTitel}</h2>
        <p className="text-base text-text-muted">{t.meldenText}</p>
        {kontakt === undefined ? (
          <p className="text-base text-text">{t.keinMeldeweg}</p>
        ) : (
          <p className="text-base text-text">
            <a className="underline" href={`mailto:${kontakt.email ?? ''}`}>
              {kontakt.email}
            </a>
            {kontakt.telefon !== null && <> · {t.telefon} {kontakt.telefon}</>}
          </p>
        )}
      </section>
    </article>
  );
}
