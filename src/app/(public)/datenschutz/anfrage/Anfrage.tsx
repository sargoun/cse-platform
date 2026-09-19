import type { Metadata } from 'next';
import type postgres from 'postgres';
import { db } from '@/server/db/pool';
import { withOeffentlich } from '@/server/kontext/oeffentlich';
import { basisAusAnfrage } from '@/server/inhalt/seiten-daten';
import { ANFRAGE_ARTEN, ART_TEXT, ART_TEXT_EN } from '@/server/services/datenschutz/anfrage';
import { mitSprache, VORGABE_SPRACHE, type Sprache } from '@/lib/sprache';

/**
 * `/datenschutz/anfrage` — der Weg für Auskunft, Berichtigung und Löschung
 * (LEG-09, Art. 15–21 DSGVO).
 *
 * **Warum diese Seite eine Pflicht ist und keine Zugabe.** Art. 12 Abs. 2
 * verlangt, dass der Verantwortliche die Ausübung der Betroffenenrechte
 * *erleichtert*. Eine Datenschutzerklärung, die auf eine E-Mail-Adresse
 * verweist, erfüllt das gerade eben; ein Formular, das die Anfrage mit einer
 * laufenden Frist in einen internen Posteingang legt, erfüllt es wirklich —
 * und vor allem: es vergisst sie nicht.
 *
 * **Sie fragt so wenig wie möglich.** Kein Geburtsdatum, keine Anschrift, keine
 * Kundennummer. Ein Auskunftsersuchen ist der Moment, in dem jemand WENIGER
 * von sich preisgeben will; Art. 12 Abs. 6 erlaubt die Identitätsnachfrage nur
 * bei *begründeten Zweifeln* — also hinterher, im Einzelfall, von einem
 * Menschen.
 *
 * **Die Gesellschaft steht im Formular.** Die vier sind verschiedene
 * juristische Personen und jede für ihre Verarbeitung selbst verantwortlich;
 * eine Anfrage „an die Gruppe" gäbe es rechtlich nicht. Wer sich irrt, wird von
 * einem Menschen weitergeleitet — das steht auch so da.
 *
 * **Ohne JavaScript.** Ein Formular, das ohne Skript nicht abschickt, schliesst
 * genau die Besucher aus, für die das BFSG gilt — und dieses hier ist der
 * Pflichtweg für alle.
 */

interface Bereich { slug: string; name: string }

async function bereiche(): Promise<readonly Bereich[]> {
  return db().begin((tx: postgres.TransactionSql) =>
    withOeffentlich(tx, (kontext) => kontext.abfrage<Bereich>(
      `select slug, name from mandant
        where archiviert_am is null order by sortierung, name`,
    ))) as Promise<readonly Bereich[]>;
}

const TEXTE = {
  de: {
    titel: 'Ihre Rechte an Ihren Daten',
    einleitung:
      'Sie können jederzeit erfahren, welche Daten wir über Sie gespeichert haben, '
      + 'sie berichtigen oder löschen lassen und der Verarbeitung widersprechen. '
      + 'Dieses Formular ist der Weg dorthin — wir antworten innerhalb eines Monats.',
    hinweisGesellschaft:
      'Die vier Gesellschaften der Gruppe sind eigene Unternehmen, und jede ist für '
      + 'ihre Daten selbst verantwortlich. Wählen Sie die, mit der Sie zu tun hatten. '
      + 'Wenn Sie unsicher sind: wählen Sie irgendeine — wir leiten weiter.',
    gesellschaft: 'Gesellschaft',
    anliegen: 'Ihr Anliegen',
    name: 'Ihr Name',
    email: 'Ihre E-Mail-Adresse',
    emailHinweis: 'An diese Adresse geht unsere Antwort.',
    rolle: 'In welchem Zusammenhang? (freiwillig)',
    rolleHinweis:
      'Zum Beispiel: Beschäftigte, Bewerberin, Kundin, Besucherin der Website. '
      + 'Das hilft uns beim Suchen — nötig ist es nicht.',
    nachricht: 'Ihre Nachricht (freiwillig)',
    absenden: 'Anfrage absenden',
    sparsam:
      'Wir fragen absichtlich wenig. Für ein Auskunftsersuchen mehr Daten zu '
      + 'verlangen, als wir herausgeben, wäre das Gegenteil von Datenschutz. Sollten '
      + 'wir Sie nicht zuordnen können, fragen wir nach — bei Ihnen, nicht bei anderen.',
  },
  en: {
    titel: 'Your rights over your data',
    einleitung:
      'You can find out at any time what data we hold about you, have it corrected '
      + 'or erased, and object to its processing. This form is the way to do that — '
      + 'we reply within one month.',
    hinweisGesellschaft:
      'The four companies in the group are separate businesses, and each is '
      + 'responsible for its own data. Choose the one you dealt with. If you are not '
      + 'sure, choose any — we will pass it on.',
    gesellschaft: 'Company',
    anliegen: 'Your request',
    name: 'Your name',
    email: 'Your e-mail address',
    emailHinweis: 'Our reply goes to this address.',
    rolle: 'In what context? (optional)',
    rolleHinweis:
      'For example: employee, applicant, customer, website visitor. It helps us '
      + 'search — it is not required.',
    nachricht: 'Your message (optional)',
    absenden: 'Send request',
    sparsam:
      'We deliberately ask for little. Demanding more data for an access request '
      + 'than we hand out would be the opposite of data protection. If we cannot '
      + 'identify you, we will ask you — not somebody else.',
  },
} as const;

export async function anfrageMetadaten(
  sprache: Sprache = VORGABE_SPRACHE,
): Promise<Metadata> {
  const basis = await basisAusAnfrage();
  const t = TEXTE[sprache];
  return {
    title: t.titel,
    description: t.einleitung,
    alternates: { canonical: `${basis}${mitSprache('/datenschutz/anfrage', sprache)}` },
  };
}

const FELD = 'w-full rounded-md border border-line bg-surface px-s4 py-s3 text-base text-text';

export async function AnfrageSeiteFuer(
  sprache: Sprache = VORGABE_SPRACHE, meldung?: string | undefined,
) {
  const liste = await bereiche();
  const t = TEXTE[sprache];
  const arten = sprache === 'en' ? ART_TEXT_EN : ART_TEXT;

  return (
    <section data-cse="datenschutz-anfrage"
             className="mx-auto flex max-w-content flex-col gap-s5 px-s5 py-s6">
      <h1 className="text-h1 text-text [hyphens:auto] break-words">{t.titel}</h1>
      <p className="max-w-[72ch] text-base text-text-muted">{t.einleitung}</p>

      {meldung !== undefined && (
        <p role="alert" data-cse="anfrage-meldung"
           className="max-w-[72ch] rounded-md border border-danger bg-danger-soft p-s4 text-base text-text">
          {meldung}
        </p>
      )}

      <form
        method="post"
        action="/api/datenschutz/anfrage"
        data-cse="anfrage-formular"
        className="flex max-w-[56ch] flex-col gap-s5"
      >
        <input type="hidden" name="sprache" value={sprache} />
        <input type="hidden" name="antwort" value="seite" />

        <fieldset className="m-0 flex flex-col gap-s3 border-0 p-0">
          <legend className="mb-s2 p-0 text-base font-semibold text-text">
            {t.gesellschaft}
          </legend>
          <p className="m-0 mb-s2 text-sm text-text-muted">{t.hinweisGesellschaft}</p>
          {liste.map((b, i) => (
            <label key={b.slug} className="flex items-center gap-s3 text-base text-text">
              <input type="radio" name="bereich" value={b.slug} required
                     defaultChecked={i === 0} data-cse="anfrage-bereich" />
              {b.name}
            </label>
          ))}
        </fieldset>

        <fieldset className="m-0 flex flex-col gap-s3 border-0 p-0">
          <legend className="mb-s2 p-0 text-base font-semibold text-text">
            {t.anliegen}
          </legend>
          {ANFRAGE_ARTEN.map((art, i) => (
            <label key={art} className="flex items-start gap-s3 text-base text-text">
              <input type="radio" name="art" value={art} required className="mt-s1"
                     defaultChecked={i === 0} data-cse="anfrage-art" data-art={art} />
              <span>
                {arten[art].lang}
                <span className="block text-sm text-text-muted">{arten[art].kurz}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <label className="flex flex-col gap-s2 text-base text-text">
          {t.name}
          <input name="name" required autoComplete="name" className={FELD} />
        </label>

        <label className="flex flex-col gap-s2 text-base text-text">
          {t.email}
          <input name="email" type="email" required autoComplete="email" className={FELD} />
          <span className="text-sm text-text-muted">{t.emailHinweis}</span>
        </label>

        <label className="flex flex-col gap-s2 text-base text-text">
          {t.rolle}
          <input name="rolle" className={FELD} />
          <span className="text-sm text-text-muted">{t.rolleHinweis}</span>
        </label>

        <label className="flex flex-col gap-s2 text-base text-text">
          {t.nachricht}
          <textarea name="nachricht" rows={5} className={FELD} />
        </label>

        <button
          type="submit"
          data-cse="anfrage-absenden"
          className="min-h-11 self-start rounded-md bg-brand px-s5 py-s3 text-base font-semibold text-white hover:bg-brand-hover"
        >
          {t.absenden}
        </button>
      </form>

      <p className="max-w-[72ch] text-sm text-text-muted">{t.sparsam}</p>
    </section>
  );
}
