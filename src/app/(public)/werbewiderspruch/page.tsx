import type { Metadata } from 'next';
import type postgres from 'postgres';
import { db } from '@/server/db/pool';
import { withOeffentlich } from '@/server/kontext/oeffentlich';
import { basisAusAnfrage } from '@/server/inhalt/seiten-daten';

/**
 * `/werbewiderspruch` — der Widerspruch gegen Werbung OHNE Token
 * (CRM-08, LEG-08, § 7 Abs. 3 Nr. 4 UWG, 04-SEITENKARTE §2.4).
 *
 * **Warum es diesen Weg neben dem Ein-Klick-Link gibt.** §2.4: „a forwarded
 * message is not a reason to make objection impossible". Wer die Werbemail
 * weitergeleitet bekommt, hat den Link nicht — und § 7 Abs. 3 Nr. 4 UWG
 * verlangt, dass der Empfänger „jederzeit" widersprechen kann, ohne andere
 * Kosten als die der Übermittlung.
 *
 * **Die Gesellschaft steht im Formular.** Die vier sind verschiedene
 * juristische Personen, und jede ist für ihre Werbung selbst verantwortlich —
 * dieselbe Begründung, aus der `/datenschutz/anfrage` die Gesellschaft fragt.
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
export const dynamic = 'force-dynamic';

interface Bereich { slug: string; name: string }

async function bereiche(): Promise<readonly Bereich[]> {
  return db().begin((tx: postgres.TransactionSql) =>
    withOeffentlich(tx, (kontext) => kontext.abfrage<Bereich>(
      `select slug, name from mandant
        where archiviert_am is null order by sortierung, name`,
    ))) as Promise<readonly Bereich[]>;
}

const TITEL = 'Keine Werbung mehr';
const EINLEITUNG =
  'Sie können der Verwendung Ihrer Adresse für Werbung jederzeit widersprechen '
  + '— ohne Angabe von Gründen und ohne andere Kosten als die der Übermittlung '
  + '(§ 7 Abs. 3 Nr. 4 UWG). Dieses Formular ist der Weg dorthin.';

export async function generateMetadata(): Promise<Metadata> {
  const basis = await basisAusAnfrage();
  return {
    title: TITEL,
    description: EINLEITUNG,
    alternates: { canonical: `${basis}/werbewiderspruch` },
    robots: { index: false, follow: true },
  };
}

const FELD = 'w-full rounded-md border border-line bg-surface px-s4 py-s3 text-base text-text';

const MELDUNG: Readonly<Record<string, { art: 'erfolg' | 'fehler'; text: string }>> = {
  entgegengenommen: {
    art: 'erfolg',
    text: 'Ihr Widerspruch ist entgegengenommen. Sollte Ihre Adresse bei der '
      + 'gewählten Gesellschaft geführt werden, erhalten Sie von ihr keine Werbung '
      + 'mehr. Ob sie dort geführt wird, sagen wir an dieser Stelle nicht — das '
      + 'wäre eine Auskunft über unseren Datenbestand an jeden, der eine Adresse '
      + 'errät.',
  },
  email_ungueltig: {
    art: 'fehler',
    text: 'Bitte prüfen Sie die E-Mail-Adresse.',
  },
  ohne_gesellschaft: {
    art: 'fehler',
    text: 'Bitte wählen Sie eine der Gesellschaften.',
  },
};

export default async function Werbewiderspruchseite(
  { searchParams }: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const suche = await searchParams;
  const stand = typeof suche['stand'] === 'string' ? suche['stand'] : '';
  const meldung = MELDUNG[stand];
  const liste = await bereiche();

  return (
    <section data-cse="werbewiderspruch"
             className="mx-auto flex max-w-content flex-col gap-s5 px-s5 py-s6">
      <h1 className="text-h1 text-text [hyphens:auto] break-words">{TITEL}</h1>
      <p className="max-w-[72ch] text-base text-text-muted">{EINLEITUNG}</p>

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
            Welche Gesellschaft?
          </legend>
          <p className="m-0 mb-s2 text-sm text-text-muted">
            Die vier Gesellschaften der Gruppe sind eigene Unternehmen, und jede
            ist für ihre Werbung selbst verantwortlich. Wählen Sie die, von der
            Sie die Nachricht bekommen haben — sie steht im Absender.
          </p>
          {liste.map((b, i) => (
            <label key={b.slug} className="flex items-center gap-s3 text-base text-text">
              <input type="radio" name="bereich" value={b.slug} required
                     defaultChecked={i === 0} data-cse="werbewiderspruch-bereich" />
              {b.name}
            </label>
          ))}
        </fieldset>

        <label className="flex flex-col gap-s2 text-base text-text">
          Ihre E-Mail-Adresse
          <input name="email" type="email" required autoComplete="email"
                 className={FELD} data-cse="werbewiderspruch-email" />
          <span className="text-sm text-text-muted">
            Genau die Adresse, an die die Werbung ging.
          </span>
        </label>

        <button type="submit"
                className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-s5 py-s3 text-base font-semibold text-white hover:bg-brand-hover">
          Keine Werbung mehr an diese Adresse
        </button>
      </form>

      <p className="max-w-[72ch] text-sm text-text-muted">
        <strong>Was weiterläuft.</strong> Ein Werbewiderspruch stoppt Werbung. Er
        stoppt nicht, was zur Durchführung eines Vertrags nötig ist — Rechnungen,
        Leistungsnachweise, Terminbestätigungen und Mahnungen ruhen auf Art. 6
        Abs. 1 lit. b DSGVO. Wenn Sie der Verarbeitung insgesamt widersprechen
        wollen (Art. 21 DSGVO), nutzen Sie bitte{' '}
        <a href="/datenschutz/anfrage"
           className="underline underline-offset-2 hover:text-text">
          das Formular für Ihre Betroffenenrechte
        </a>.
      </p>

      <p className="max-w-[72ch] text-sm text-text-muted">
        <strong>Zurücknehmen können wir das nicht.</strong> Der Widerspruch wird
        als Nachweis geführt und lässt sich nicht löschen — er ist der Beleg
        dafür, dass Sie ihn erklärt haben. Wenn Sie später doch Werbung möchten,
        brauchen wir dafür eine neue, ausdrückliche Einwilligung.
      </p>
    </section>
  );
}
