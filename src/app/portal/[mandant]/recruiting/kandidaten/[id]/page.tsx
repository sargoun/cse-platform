import { redirect } from 'next/navigation';
import { kennungOder404 } from '../../../../kennung';

/**
 * `/portal/[mandant]/recruiting/kandidaten/[id]` — dasselbe Blatt wie die
 * Bewerbung, und deshalb dorthin.
 *
 * **Ein Kandidat IST eine Bewerbung** (`kandidat.bewerbung_id` ist eindeutig,
 * 0166): was aus dem Lebenslauf gelesen wurde, hängt an ihr, und die Rangfolge
 * ordnet Bewerbungen. Zwei Blätter mit denselben Daten wären zwei Orte, an
 * denen jemand nachsieht — und einer davon wäre irgendwann der veraltete.
 *
 * Die Route bleibt trotzdem bestehen, weil die Seitenkarte sie führt und die
 * Rangfolge auf sie zeigt; sie leitet auf das eine Blatt weiter, statt es zu
 * verdoppeln.
 */
export const dynamic = 'force-dynamic';

export default async function Kandidatenblatt(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  redirect(`/portal/${mandant}/recruiting/bewerbungen/${id}`);
}
