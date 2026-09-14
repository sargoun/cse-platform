import { redirect } from 'next/navigation';

/**
 * `/auth/einladung/[token]` — die Einladung annehmen (AUT-04).
 *
 * **Sie ist derselbe Vorgang wie eine Zuruecksetzung**, und deshalb steht hier
 * kein zweites Formular: `kern.kennwort_token` fuehrt beide Zwecke, und
 * `/auth/passwort-neu` liest den Zweck aus dem Token und beschriftet sich
 * danach. Zwei Formulare hiessen zwei Abwege, von denen genau einer gepflegt
 * wird.
 *
 * Der Token wandert dabei aus dem Pfad in die Abfrage — nicht aus Bequemlichkeit,
 * sondern weil ein Wert im PFAD in jedem Zugriffsprotokoll steht, waehrend die
 * Abfrage zumindest aus dem `Referer` herausgehalten wird (die
 * Referrer-Policy der Plattform schneidet ihn ab, SEC-A7).
 */
export const dynamic = 'force-dynamic';

export default async function Einladung({ params }: {
  readonly params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  redirect(`/auth/passwort-neu?token=${encodeURIComponent(token)}`);
}
