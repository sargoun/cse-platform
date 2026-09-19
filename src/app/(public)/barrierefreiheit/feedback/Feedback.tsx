import type { Metadata } from 'next';
import type postgres from 'postgres';
import { db } from '@/server/db/pool';
import { withOeffentlich } from '@/server/kontext/oeffentlich';
import { basisAusAnfrage } from '@/server/inhalt/seiten-daten';
import { mitSprache, VORGABE_SPRACHE, type Sprache } from '@/lib/sprache';

/**
 * `/barrierefreiheit/feedback` — der verpflichtende Meldeweg (LEG-07, BFSG).
 *
 * **Diese Seite muss selbst barrierefrei sein**, und das ist keine Ironie,
 * sondern die Anforderung: ein Meldeweg für Barrieren, der eine Barriere hat,
 * erreicht genau die nicht, für die er da ist. Deshalb:
 *
 *  - **kein JavaScript.** Ein reines `<form method="post">`.
 *  - **jedes Feld hat ein echtes `<label>`**, kein Platzhaltertext als Ersatz —
 *    ein `placeholder` verschwindet beim Tippen und wird von manchen
 *    Screenreadern gar nicht gelesen.
 *  - **`autocomplete`-Token** (WCAG 1.3.5), damit Ausfüllhilfen greifen.
 *  - **die E-Mail-Adresse ist FREIWILLIG.** Wer nur melden will, soll melden
 *    können, ohne sich zu erkennen zu geben. Ein Pflichtfeld wäre eine Hürde
 *    vor dem Weg, der Hürden melden soll — und es steht ausdrücklich dabei.
 *  - **kein Honigtopf.** Er kostet nichts an Bedienbarkeit, aber auf DIESEM
 *    Formular wäre selbst ein unsichtbares Zusatzfeld ein Risiko: ein
 *    Screenreader-Nutzer, dessen Software es doch vorliest und ausfüllt,
 *    bekäme seine Meldung verworfen, ohne je zu erfahren warum.
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
    titel: 'Eine Barriere melden',
    einleitung:
      'Wenn Sie auf dieser Website auf etwas gestossen sind, das Sie nicht bedienen '
      + 'oder nicht lesen konnten, sagen Sie es uns. Wir sehen es uns an und melden '
      + 'uns, wenn Sie das möchten.',
    gesellschaft: 'Welcher Bereich?',
    gesellschaftHinweis: 'Wenn Sie unsicher sind: wählen Sie irgendeinen — wir leiten weiter.',
    seite: 'Auf welcher Seite? (freiwillig)',
    seiteHinweis: 'Die Adresse oder eine kurze Beschreibung, zum Beispiel „das Kontaktformular".',
    beschreibung: 'Was hat nicht funktioniert?',
    hilfsmittel: 'Womit arbeiten Sie? (freiwillig)',
    hilfsmittelHinweis:
      'Zum Beispiel: Screenreader NVDA, Bildschirmlupe, nur Tastatur, Sprachsteuerung. '
      + 'Das hilft uns beim Nachstellen.',
    email: 'Ihre E-Mail-Adresse (freiwillig)',
    emailHinweis:
      'Nur, wenn Sie eine Antwort möchten. Ohne Adresse nehmen wir die Meldung '
      + 'trotzdem auf — Sie müssen sich nicht zu erkennen geben, um eine Barriere '
      + 'zu melden.',
    absenden: 'Meldung absenden',
    andererWeg:
      'Sie können uns auch anrufen oder schreiben. Die Wege stehen in der '
      + 'Barrierefreiheitserklärung.',
    zurErklaerung: 'Zur Barrierefreiheitserklärung',
  },
  en: {
    titel: 'Report a barrier',
    einleitung:
      'If you came across something on this website you could not operate or could '
      + 'not read, tell us. We will look into it and get back to you if you want us to.',
    gesellschaft: 'Which division?',
    gesellschaftHinweis: 'If you are not sure, choose any — we will pass it on.',
    seite: 'On which page? (optional)',
    seiteHinweis: 'The address or a short description, for example "the contact form".',
    beschreibung: 'What did not work?',
    hilfsmittel: 'What do you use? (optional)',
    hilfsmittelHinweis:
      'For example: NVDA screen reader, screen magnifier, keyboard only, voice control. '
      + 'It helps us reproduce the problem.',
    email: 'Your e-mail address (optional)',
    emailHinweis:
      'Only if you would like a reply. Without an address we still record the report — '
      + 'you do not have to identify yourself to report a barrier.',
    absenden: 'Send report',
    andererWeg:
      'You can also call or write to us. The details are in the accessibility statement.',
    zurErklaerung: 'To the accessibility statement',
  },
} as const;

export async function feedbackMetadaten(
  sprache: Sprache = VORGABE_SPRACHE,
): Promise<Metadata> {
  const basis = await basisAusAnfrage();
  const t = TEXTE[sprache];
  return {
    title: t.titel,
    description: t.einleitung,
    alternates: { canonical: `${basis}${mitSprache('/barrierefreiheit/feedback', sprache)}` },
  };
}

const FELD = 'w-full rounded-md border border-line bg-surface px-s4 py-s3 text-base text-text';

export async function FeedbackSeiteFuer(
  sprache: Sprache = VORGABE_SPRACHE, meldung?: string | undefined, erledigt = false,
) {
  const liste = await bereiche();
  const t = TEXTE[sprache];

  return (
    <section data-cse="barriere-feedback"
             className="mx-auto flex max-w-content flex-col gap-s5 px-s5 py-s6">
      <h1 className="text-h1 text-text [hyphens:auto] break-words">{t.titel}</h1>
      <p className="max-w-[72ch] text-base text-text-muted">{t.einleitung}</p>

      {erledigt && (
        <p role="status" data-cse="barriere-danke"
           className="max-w-[72ch] rounded-md border border-success bg-success-soft p-s4 text-base text-text">
          {sprache === 'en'
            ? 'Thank you. Your report has arrived.'
            : 'Vielen Dank. Ihre Meldung ist angekommen.'}
        </p>
      )}

      {meldung !== undefined && (
        <p role="alert" data-cse="barriere-meldung"
           className="max-w-[72ch] rounded-md border border-danger bg-danger-soft p-s4 text-base text-text">
          {meldung}
        </p>
      )}

      <form
        method="post"
        action="/api/barrierefreiheit/meldung"
        data-cse="barriere-formular"
        className="flex max-w-[56ch] flex-col gap-s5"
      >
        <input type="hidden" name="sprache" value={sprache} />
        <input type="hidden" name="antwort" value="seite" />

        <fieldset className="m-0 flex flex-col gap-s3 border-0 p-0">
          <legend className="mb-s2 p-0 text-base font-semibold text-text">
            {t.gesellschaft}
          </legend>
          <p className="m-0 mb-s2 text-sm text-text-muted">{t.gesellschaftHinweis}</p>
          {liste.map((b, i) => (
            <label key={b.slug} className="flex items-center gap-s3 text-base text-text">
              <input type="radio" name="bereich" value={b.slug} required
                     defaultChecked={i === 0} data-cse="barriere-bereich" />
              {b.name}
            </label>
          ))}
        </fieldset>

        <label className="flex flex-col gap-s2 text-base text-text">
          {t.seite}
          <input name="seite" className={FELD} autoComplete="off" />
          <span className="text-sm text-text-muted">{t.seiteHinweis}</span>
        </label>

        <label className="flex flex-col gap-s2 text-base text-text">
          {t.beschreibung}
          <textarea name="beschreibung" rows={6} required className={FELD}
                    data-cse="barriere-beschreibung" />
        </label>

        <label className="flex flex-col gap-s2 text-base text-text">
          {t.hilfsmittel}
          <input name="hilfsmittel" className={FELD} autoComplete="off" />
          <span className="text-sm text-text-muted">{t.hilfsmittelHinweis}</span>
        </label>

        <label className="flex flex-col gap-s2 text-base text-text">
          {t.email}
          <input name="email" type="email" className={FELD} autoComplete="email" />
          <span className="text-sm text-text-muted">{t.emailHinweis}</span>
        </label>

        <button
          type="submit"
          data-cse="barriere-absenden"
          className="min-h-11 self-start rounded-md bg-brand px-s5 py-s3 text-base font-semibold text-white hover:bg-brand-hover"
        >
          {t.absenden}
        </button>
      </form>

      <p className="max-w-[72ch] text-sm text-text-muted">{t.andererWeg}</p>
      <a href={mitSprache('/barrierefreiheit', sprache)}
         className="min-h-11 self-start rounded-md border border-line-strong px-s5 py-s3 text-base text-text hover:bg-surface-2">
        {t.zurErklaerung}
      </a>
    </section>
  );
}
