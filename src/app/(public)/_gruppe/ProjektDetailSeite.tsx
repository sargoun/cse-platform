import { notFound } from 'next/navigation';
import { oeffentlichLesen } from '@/server/inhalt/lesen';
import { ReferenzAusTabelle } from '@/server/services/inhalt/referenz';
import { ProjektDetail } from '@/app/(public)/unternehmen/[bereich]/_profil/Inhalte';
import type { Sprache } from '@/lib/sprache';
import { GruppenDetailRahmen, gruppenGesellschaft } from './detail';

/**
 * `/projekte/[slug]` und `/en/projekte/[slug]` — ein Projekt der Gruppe.
 *
 * **Eine Referenz ohne Kundenfreigabe und eine, die es nicht gibt, sehen von
 * aussen gleich aus.** `t_referenz_oeffentlich` lässt nur
 * `freigegeben_vom_kunden AND status='veroeffentlicht' AND geloescht_am IS
 * NULL` durch; `nachSlug` gibt sonst `null`, und daraus wird 404. Ein
 * Unterschied verriete, dass es das Projekt gibt und der Kunde seiner
 * Veröffentlichung nur nicht zugestimmt hat (PRO-05).
 *
 * Gezeigt werden Titel, Kunde (soweit freigegeben), Jahr, Beschreibung und
 * freigegebene Bilder — **nie** ein Auftragswert, eine `kunde_id` oder eine
 * Anschrift. `referenz` trägt die drei bewusst nicht.
 */
export async function referenzDerGruppe(slug: string, sprache: Sprache) {
  const gesellschaft = await gruppenGesellschaft(sprache);
  const referenz = await oeffentlichLesen((kontext) =>
    new ReferenzAusTabelle({
      unsafe: (sql: string, werte?: readonly unknown[]) => kontext.abfrage(sql, werte),
    }).nachSlug(gesellschaft.id, slug));
  return { gesellschaft, referenz };
}

export async function ProjektDetailGruppe(
  { slug, sprache }: { readonly slug: string; readonly sprache: Sprache },
) {
  const { gesellschaft, referenz } = await referenzDerGruppe(slug, sprache);
  if (referenz === null) notFound();
  return (
    <GruppenDetailRahmen segment="projekte" slug={slug} sprache={sprache}
                         gesellschaft={gesellschaft}>
      <ProjektDetail referenz={referenz} bereich={gesellschaft.slug} sprache={sprache} />
    </GruppenDetailRahmen>
  );
}
