import type { Metadata } from 'next';
import { FeedbackSeiteFuer, feedbackMetadaten } from '../../../barrierefreiheit/feedback/Feedback';

/**
 * `/en/barrierefreiheit/feedback` — der BFSG-Meldeweg, englisch (LEG-07,
 * D-82, V-156).
 *
 * `Feedback.tsx` trug die englischen Texte, `POST /api/barrierefreiheit/meldung`
 * leitete mit `sprache=en` hierher zurück — und die Route fehlte. Wer eine
 * Barriere auf Englisch melden wollte, landete nach dem Absenden auf einem 404
 * und erfuhr nicht, ob die Meldung angekommen war: ein Meldeweg für Barrieren
 * mit einer Barriere darin.
 */
export const dynamic = 'force-dynamic';

export function generateMetadata(): Promise<Metadata> {
  return feedbackMetadaten('en');
}

export default async function EnglishBarrierReport(
  { searchParams }: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const suche = await searchParams;
  const meldung = typeof suche['meldung'] === 'string' ? suche['meldung'] : undefined;
  return FeedbackSeiteFuer('en', meldung, suche['ok'] === '1');
}
