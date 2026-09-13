import { redirect } from 'next/navigation';

/**
 * `/portal/[mandant]/agenten/[agent]/aufgaben` — die Liste der Läufe.
 *
 * Sie steht bereits auf der Agentenseite, vollständig und mit denselben
 * Spalten. Diese Route deshalb als Weiterleitung statt als zweite Liste: zwei
 * Bildschirme mit derselben Tabelle gehen beim nächsten Feld auseinander, und
 * dann zeigt einer von beiden etwas anderes als der andere — ohne dass jemand
 * sagen könnte, welcher recht hat. Die Seitenkarte führt den Pfad, also
 * antwortet er; er antwortet nur nicht doppelt.
 */
export default async function Aufgabenliste(
  { params }: { params: Promise<{ mandant: string; agent: string }> },
) {
  const { mandant, agent } = await params;
  redirect(`/portal/${mandant}/agenten/${agent}`);
}
