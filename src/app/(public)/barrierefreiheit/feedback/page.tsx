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
  /*
   * Bestätigung (`?ok=1`) und Abweisung (`?fehler=<grund>`) kommen als
   * Schlüssel zurück (D-769) — `Feedback.tsx` schlägt sie nach.
   */
  return FeedbackSeiteFuer(undefined, await searchParams);
}
