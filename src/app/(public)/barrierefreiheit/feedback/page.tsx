import type { Metadata } from 'next';
import { FeedbackSeiteFuer, feedbackMetadaten } from './Feedback';

/** `/barrierefreiheit/feedback` — deutsch (LEG-07, BFSG). */
export const dynamic = 'force-dynamic';

export function generateMetadata(): Promise<Metadata> {
  return feedbackMetadaten();
}

export default async function Seite(
  { searchParams }: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const suche = await searchParams;
  const meldung = typeof suche['meldung'] === 'string' ? suche['meldung'] : undefined;
  /*
   * Die Bestaetigung steht auf DERSELBEN Seite und nicht auf einer eigenen:
   * ein Screenreader liest `role="status"` vor, ohne dass der Nutzer die
   * Orientierung verliert, und ein Seitenwechsel nach einem Formular ist fuer
   * jemanden mit Bildschirmlupe ein Suchen von vorn.
   */
  return FeedbackSeiteFuer(undefined, meldung, suche['ok'] === '1');
}
