import { MandantUnterseite } from '../../../../unterseite';

/**
 * `/portal/[mandant]/crm/leads/neu` — noch nicht gebaut, und das steht hier
 * ausdrücklich als eigene Datei.
 *
 * **Warum eine Datei fuer eine Seite, die es nicht gibt.** Ohne sie greift
 * Next.js die Nachbarroute `[id]`, reicht `neu` als Kennung in ein
 * `$1::uuid` und die Anwendung antwortet **500** — „Da ist etwas
 * schiefgegangen." Die Seitenkarte fuehrt diese Adresse; wer sie oeffnet, soll
 * lesen, dass das Modul noch gebaut wird, und nicht, dass der Server kaputt
 * ist. Der Unterschied ist nicht Kosmetik: ein 500 sagt „mein Fehler", wo
 * „noch nicht da" die Wahrheit ist.
 *
 * `kennungOder404` faengt denselben Fall inzwischen auch in der `[id]`-Seite
 * ab — dann aber als 404, und ein 404 auf eine Adresse, die im Manifest steht,
 * ist die zweitbeste Antwort. Diese Datei gibt die beste.
 */
export const dynamic = 'force-dynamic';

export default async function Platzhalter(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  return <MandantUnterseite segmente={['crm', 'leads', 'neu']} mandant={mandant} />;
}
