import type { Metadata } from 'next';
import type postgres from 'postgres';
import { db } from '@/server/db/pool';
import { withOeffentlich } from '@/server/kontext/oeffentlich';
import { basisAusAnfrage } from '@/server/inhalt/seiten-daten';
import { mitSprache, VORGABE_SPRACHE, type Sprache } from '@/lib/sprache';

/**
 * `/werbewiderspruch` und `/en/werbewiderspruch` — der Widerspruch gegen
 * Werbung OHNE Token (CRM-08, LEG-08, § 7 Abs. 3 Nr. 4 UWG,
 * 04-SEITENKARTE §2.4).
 *
 * **Warum es diesen Weg neben dem Ein-Klick-Link gibt.** §2.4: „a forwarded
 * message is not a reason to make objection impossible". Wer die Werbemail
 * weitergeleitet bekommt, hat den Link nicht — und § 7 Abs. 3 Nr. 4 UWG
 * verlangt, dass der Empfänger „jederzeit" widersprechen kann, ohne andere
 * Kosten als die der Übermittlung.
 *
 * **Warum EINE Komponente für zwei Sprachen** (D-82, D-83). Die Seite ist ein
 * gesetzlicher Pflichtweg, und den muss auch ein englischsprachiger Empfänger
 * finden. Zwei Dateien mit demselben Formular wären zwei Wahrheiten über
 * dieselbe Pflicht: die Feldnamen, die Gesellschaftsliste und die Stände sind
 * hier EINMAL geschrieben und werden überlagert, nicht verdoppelt — genau wie
 * `Anfrage.tsx` es für `/datenschutz/anfrage` hält.
 *
 * **Die Gesellschaft steht im Formular.** Die vier sind verschiedene
 * juristische Personen, und jede ist für ihre Werbung selbst verantwortlich.
 * Ob ein Widerspruch für die ganze Gruppe wirken soll, ist eine Entscheidung
 * der Geschäftsführung und steht als offene Frage (O-641), nicht als still
 * gesetzte Regel.
 *
 * **Die Antwort ist immer dieselbe.** Ob eine Adresse im Bestand war, sagt
 * diese Seite nicht: „Zu dieser Adresse haben wir 3 Kontakte" wäre eine
 * Auskunft über einen fremden Datenbestand an jeden, der eine Adresse errät.
 *
 * **Ohne JavaScript.** Ein Pflichtweg, der ohne Skript nicht abschickt,
 * schliesst genau die Besucher aus, für die das BFSG gilt.
 */

interface Bereich { slug: string; name: string }

async function bereiche(): Promise<readonly Bereich[]> {
  return db().begin((tx: postgres.TransactionSql) =>
    withOeffentlich(tx, (kontext) => kontext.abfrage<Bereich>(
      `select slug, name from mandant
        where archiviert_am is null order by sortierung, name`,
    ))) as Promise<readonly Bereich[]>;
}

type Stand = 'entgegengenommen' | 'email_ungueltig' | 'ohne_gesellschaft' | 'zu_viele';

interface Texte {
  readonly titel: string;
  readonly einleitung: string;
  readonly gesellschaft: string;
  readonly hinweisGesellschaft: string;
  readonly email: string;
  readonly emailHinweis: string;
  readonly knopf: string;
  readonly weiterTitel: string;
  readonly weiter: string;
  readonly weiterLink: string;
  readonly ruecknahmeTitel: string;
  readonly ruecknahme: string;
  readonly meldung: Readonly<Record<Stand, { art: 'erfolg' | 'fehler'; text: string }>>;
}

const TEXTE: Readonly<Record<Sprache, Texte>> = {
  de: {
    titel: 'Keine Werbung mehr',
    einleitung:
      'Sie können der Verwendung Ihrer Adresse für Werbung jederzeit widersprechen '
      + '— ohne Angabe von Gründen und ohne andere Kosten als die der Übermittlung '
      + '(§ 7 Abs. 3 Nr. 4 UWG). Dieses Formular ist der Weg dorthin.',
    gesellschaft: 'Welche Gesellschaft?',
    hinweisGesellschaft:
      'Die vier Gesellschaften der Gruppe sind eigene Unternehmen, und jede ist für '
      + 'ihre Werbung selbst verantwortlich. Wählen Sie die, von der Sie die '
      + 'Nachricht bekommen haben — sie steht im Absender.',
    email: 'Ihre E-Mail-Adresse',
    emailHinweis: 'Genau die Adresse, an die die Werbung ging.',
    knopf: 'Keine Werbung mehr an diese Adresse',
    weiterTitel: 'Was weiterläuft.',
    weiter:
      'Ein Werbewiderspruch stoppt Werbung. Er stoppt nicht, was zur Durchführung '
      + 'eines Vertrags nötig ist — eine Rechnung etwa ruht auf Art. 6 Abs. 1 lit. b '
      + 'DSGVO und erreicht Sie weiter. Terminbestätigungen, Leistungsnachweise und '
      + 'Mahnungen halten wir bis zu einer ausdrücklichen Entscheidung ebenfalls '
      + 'zurück — im Zweifel zu Ihren Gunsten. Wenn Sie der Verarbeitung insgesamt '
      + 'widersprechen wollen (Art. 21 DSGVO), nutzen Sie bitte ',
    weiterLink: 'das Formular für Ihre Betroffenenrechte',
    ruecknahmeTitel: 'Zurücknehmen können wir das nicht.',
    ruecknahme:
      'Der Widerspruch wird als Nachweis geführt und lässt sich nicht löschen — er '
      + 'ist der Beleg dafür, dass Sie ihn erklärt haben. Wenn Sie später doch '
      + 'Werbung möchten, brauchen wir dafür eine neue, ausdrückliche Einwilligung.',
    meldung: {
      entgegengenommen: {
        art: 'erfolg',
        text: 'Ihr Widerspruch ist entgegengenommen. Sollte Ihre Adresse bei der '
          + 'gewählten Gesellschaft geführt werden, erhalten Sie von ihr keine Werbung '
          + 'mehr. Ob sie dort geführt wird, sagen wir an dieser Stelle nicht — das '
          + 'wäre eine Auskunft über unseren Datenbestand an jeden, der eine Adresse '
          + 'errät. Eine Bestätigung per E-Mail versenden wir derzeit nicht.',
      },
      email_ungueltig: { art: 'fehler', text: 'Bitte prüfen Sie die E-Mail-Adresse.' },
      ohne_gesellschaft: {
        art: 'fehler', text: 'Bitte wählen Sie eine der Gesellschaften.',
      },
      zu_viele: {
        art: 'fehler',
        text: 'Von dieser Verbindung sind in kurzer Zeit sehr viele Widersprüche '
          + 'eingegangen. Bitte versuchen Sie es in einer Viertelstunde erneut — oder '
          + 'schreiben Sie an die im Impressum genannte Adresse; der Widerspruch gilt '
          + 'dann genauso. Die Bremse schützt fremde Kontakte davor, dass jemand ihre '
          + 'Adressen errät und ihre Werbeansprache abstellt.',
      },
    },
  },
  en: {
    titel: 'No more advertising',
    einleitung:
      'You may object to the use of your address for advertising at any time — '
      + 'without giving reasons and at no cost beyond that of transmission '
      + '(§ 7 (3) no. 4 UWG). This form is the way to do it.',
    gesellschaft: 'Which company?',
    hinweisGesellschaft:
      'The four companies of the group are separate legal entities, and each is '
      + 'responsible for its own advertising. Please choose the one you received the '
      + 'message from — it is named in the sender line.',
    email: 'Your e-mail address',
    emailHinweis: 'Exactly the address the advertising was sent to.',
    knopf: 'Stop advertising to this address',
    weiterTitel: 'What keeps running.',
    weiter:
      'An advertising objection stops advertising. It does not stop what is '
      + 'necessary to perform a contract — an invoice, for instance, rests on '
      + 'Art. 6(1)(b) GDPR and will still reach you. Appointment confirmations, '
      + 'service records and payment reminders are withheld as well until this is '
      + 'expressly decided — in case of doubt, in your favour. If you wish to object '
      + 'to the processing as such (Art. 21 GDPR), please use ',
    weiterLink: 'the form for your data-subject rights',
    ruecknahmeTitel: 'We cannot undo this.',
    ruecknahme:
      'The objection is kept as evidence and cannot be deleted — it is the proof '
      + 'that you declared it. Should you want advertising again later, we need a '
      + 'new, express consent for that.',
    meldung: {
      entgegengenommen: {
        art: 'erfolg',
        text: 'Your objection has been received. If your address is held by the '
          + 'company you chose, you will receive no further advertising from it. '
          + 'Whether it is held there we do not say at this point — that would be '
          + 'disclosure about our records to anyone who guesses an address. We do not '
          + 'currently send an e-mail confirmation.',
      },
      email_ungueltig: { art: 'fehler', text: 'Please check the e-mail address.' },
      ohne_gesellschaft: { art: 'fehler', text: 'Please choose one of the companies.' },
      zu_viele: {
        art: 'fehler',
        text: 'A large number of objections has arrived from this connection in a '
          + 'short time. Please try again in a quarter of an hour — or write to the '
          + 'address given in the Impressum; the objection is equally valid that way. '
          + 'The brake protects other contacts from someone guessing their addresses '
          + 'and switching off their advertising.',
      },
    },
  },
} as const;

export async function werbewiderspruchMetadaten(
  sprache: Sprache = VORGABE_SPRACHE,
): Promise<Metadata> {
  const basis = await basisAusAnfrage();
  const t = TEXTE[sprache];
  return {
    title: t.titel,
    description: t.einleitung,
    alternates: { canonical: `${basis}${mitSprache('/werbewiderspruch', sprache)}` },
    robots: { index: false, follow: true },
  };
}

const FELD = 'w-full rounded-md border border-line bg-surface px-s4 py-s3 text-base text-text';

function istStand(wert: string): wert is Stand {
  return ['entgegengenommen', 'email_ungueltig', 'ohne_gesellschaft', 'zu_viele']
    .includes(wert);
}

export async function WerbewiderspruchSeiteFuer(
  sprache: Sprache = VORGABE_SPRACHE, stand = '',
) {
  const t = TEXTE[sprache];
  const meldung = istStand(stand) ? t.meldung[stand] : undefined;
  const liste = await bereiche();
  const anfragePfad = mitSprache('/datenschutz/anfrage', sprache);

  return (
    <section data-cse="werbewiderspruch"
             className="mx-auto flex max-w-content flex-col gap-s5 px-s5 py-s6">
      <h1 className="text-h1 text-text [hyphens:auto] break-words">{t.titel}</h1>
      <p className="max-w-[72ch] text-base text-text-muted">{t.einleitung}</p>

      {meldung === undefined ? null : (
        <p role="alert" data-cse="werbewiderspruch-meldung" data-stand={stand}
           className={meldung.art === 'erfolg'
             ? 'max-w-[72ch] rounded-md border border-success bg-success-soft p-s4 text-base text-text'
             : 'max-w-[72ch] rounded-md border border-danger bg-danger-soft p-s4 text-base text-text'}>
          {meldung.text}
        </p>
      )}

      <form method="post" action="/api/werbewiderspruch"
            data-cse="werbewiderspruch-formular"
            className="flex max-w-[56ch] flex-col gap-s5">
        <fieldset className="m-0 flex flex-col gap-s3 border-0 p-0">
          <legend className="mb-s2 p-0 text-base font-semibold text-text">
            {t.gesellschaft}
          </legend>
          <p className="m-0 mb-s2 text-sm text-text-muted">{t.hinweisGesellschaft}</p>
          {liste.map((b, i) => (
            <label key={b.slug} className="flex items-center gap-s3 text-base text-text">
              <input type="radio" name="bereich" value={b.slug} required
                     defaultChecked={i === 0} data-cse="werbewiderspruch-bereich" />
              {b.name}
            </label>
          ))}
        </fieldset>

        <label className="flex flex-col gap-s2 text-base text-text">
          {t.email}
          <input name="email" type="email" required autoComplete="email"
                 className={FELD} data-cse="werbewiderspruch-email" />
          <span className="text-sm text-text-muted">{t.emailHinweis}</span>
        </label>

        {/*
          * **Der Honigtopf** — derselbe wie im Karriereformular
          * (`services/lead/annahme.ts`, `istBot`). Ein Mensch sieht das Feld
          * nicht, ein Screenreader liest es nicht vor, ein
          * Formularausfueller-Bot fuellt es aus. Es ersetzt kein CAPTCHA; es
          * kostet nur niemanden etwas, und ein CAPTCHA kostet genau die
          * Menschen etwas, fuer die das BFSG gilt — auf einem Pflichtweg der
          * schlechteste Tausch, den man machen kann.
          */}
        <div className="hidden" aria-hidden="true">
          <label htmlFor="ww-webseite">Webseite</label>
          <input id="ww-webseite" name="webseite" type="text" tabIndex={-1}
                 autoComplete="off" />
        </div>

        <button type="submit"
                className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-s5 py-s3 text-base font-semibold text-white hover:bg-brand-hover">
          {t.knopf}
        </button>
      </form>

      <p className="max-w-[72ch] text-sm text-text-muted">
        <strong>{t.weiterTitel}</strong> {t.weiter}
        <a href={anfragePfad} className="underline underline-offset-2 hover:text-text">
          {t.weiterLink}
        </a>.
      </p>

      <p className="max-w-[72ch] text-sm text-text-muted">
        <strong>{t.ruecknahmeTitel}</strong> {t.ruecknahme}
      </p>
    </section>
  );
}
