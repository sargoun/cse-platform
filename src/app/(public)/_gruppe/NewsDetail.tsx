import { notFound } from 'next/navigation';
import { oeffentlichLesen } from '@/server/inhalt/lesen';
import { oeffentlicherBeitragNachSlug } from '@/server/services/social/dienst';
import { BeitragDetail } from '@/app/(public)/unternehmen/[bereich]/_profil/Inhalte';
import type { Sprache } from '@/lib/sprache';
import { GruppenDetailRahmen, gruppenGesellschaft } from './detail';

/**
 * `/news/[slug]` und `/en/news/[slug]` — eine Meldung der Gruppe.
 *
 * **Ein Entwurf und eine nicht vorhandene Meldung sehen von aussen gleich
 * aus**, und das ist richtig so: `oeffentlicherBeitragNachSlug` gibt `null`
 * für beides, und daraus wird 404. Ein Unterschied verriete, dass es die
 * Meldung gibt und sie nur noch nicht freigegeben ist.
 *
 * Gerendert wird `BeitragDetail` in der Gruppenhülle, nicht in `ProfilRahmen`:
 * auf Gruppenebene gibt es keinen Gesellschaftsdeckel und keine Reiterleiste.
 */
export async function beitragDerGruppe(slug: string, sprache: Sprache) {
  const gesellschaft = await gruppenGesellschaft(sprache);
  const beitrag = await oeffentlichLesen((kontext) =>
    oeffentlicherBeitragNachSlug(kontext, gesellschaft.id, slug));
  return { gesellschaft, beitrag };
}

export async function NewsDetailSeite(
  { slug, sprache }: { readonly slug: string; readonly sprache: Sprache },
) {
  const { gesellschaft, beitrag } = await beitragDerGruppe(slug, sprache);
  if (beitrag === null) notFound();
  return (
    <GruppenDetailRahmen segment="news" slug={slug} sprache={sprache}
                         gesellschaft={gesellschaft}>
      <BeitragDetail beitrag={beitrag} bereich={gesellschaft.slug}
                     sprache={sprache} segment="news" />
    </GruppenDetailRahmen>
  );
}
