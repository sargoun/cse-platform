import Link from 'next/link';
import type { Metadata } from 'next';
import { aufbewahrungsfristTage } from '../daten';

/**
 * `/karriere/danke` — die Seite NACH dem Absenden (REC-03).
 *
 * **Sie sagt, was jetzt passiert und wann gelöscht wird** — mit der Zahl aus
 * `recruiting.aufbewahrung_tage`, nicht mit einem „danach". Eine
 * Dankesseite, die nur „Vielen Dank" sagt, lässt den Menschen im Unklaren
 * darüber, ob seine Daten angekommen sind und wie lange sie bleiben — beides
 * gehört nach Art. 13 DSGVO zur Erhebung und nicht in eine spätere E-Mail,
 * die vielleicht nie kommt.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Danke — CSE Gruppe' };

export default async function DankeSeite() {
  const tage = await aufbewahrungsfristTage();

  return (
    <main className="mx-auto flex max-w-content flex-col gap-s5 px-s5 py-s7">
      <h1 className="m-0 text-display text-text">Ihre Bewerbung ist angekommen.</h1>
      <p className="m-0 max-w-prose text-base text-text-muted">
        Wir sehen sie uns an und melden uns. Über Einladung oder Absage
        entscheidet ein Mensch — eine automatische Auswahl findet nicht statt.
      </p>
      {/*
        * **Die Frist steht als Zahl da, nicht als „danach".**
        *
        * Art. 13 Abs. 2 lit. a DSGVO verlangt die Dauer der Speicherung, und
        * „wird danach gelöscht" ist keine Dauer. Die Zahl kommt aus der
        * Einstellung `recruiting.aufbewahrung_tage` — derselben, nach der die
        * Annahme `aufbewahrung_bis` setzt und der Nachtlauf löscht. Eine
        * Dankesseite mit einer eigenen Zahl wäre eine zweite Wahrheit, und die
        * falsche von beiden fiele erst bei der Aufsicht auf.
        */}
      <p className="m-0 max-w-prose text-base text-text-muted" data-cse="aufbewahrung">
        {tage === null ? (
          <>
            Ihre Angaben werden für dieses Verfahren verarbeitet und nach
            dessen Abschluss gelöscht, sofern kein Arbeitsverhältnis zustande
            kommt.
          </>
        ) : (
          <>
            Ihre Angaben werden für dieses Verfahren verarbeitet und{' '}
            <strong className="font-medium text-text">
              {String(tage)} Tage nach Eingang
            </strong>{' '}
            gelöscht, sofern kein Arbeitsverhältnis zustande kommt — auch
            dann, wenn wir uns nicht mehr melden.
          </>
        )}{' '}
        Wenn Sie möchten, dass wir sie früher löschen, schreiben Sie uns — die
        Adresse steht in der{' '}
        <Link href="/datenschutz" className="underline underline-offset-2">
          Datenschutzerklärung
        </Link>.
      </p>
      <Link
        href="/karriere"
        className="inline-flex min-h-11 w-fit items-center rounded-md border border-line-strong px-s5 text-base text-text hover:bg-surface-2"
      >
        Zurück zu den offenen Stellen
      </Link>
    </main>
  );
}
