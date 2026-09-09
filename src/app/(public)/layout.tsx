import type { ReactNode } from 'react';
import { OeffentlicheShell } from '@/components/oeffentlich/OeffentlicheShell';
import { bereicheLesen, einstellungLesen, oeffentlichLesen } from '@/server/inhalt/lesen';
import { shellBereiche } from './lade-shell';

/**
 * Die Shell aller oeffentlichen Seiten.
 *
 * `force-dynamic`, weil der Inhalt aus `seite`/`abschnitt` kommt (PUB-07): ein
 * Textwechsel ist ein UPDATE und kein Deployment. Statisch vorgerendert waere
 * er genau das — und der Build braeuchte eine Datenbank, die er nicht hat.
 */
export const dynamic = 'force-dynamic';

export default async function OeffentlichesLayout({ children }: { children: ReactNode }) {
  const { zeilen, name } = await oeffentlichLesen(async (kontext) => ({
    zeilen: await bereicheLesen(kontext),
    name: await einstellungLesen(kontext, 'website.gruppenname'),
  }));
  return (
    <OeffentlicheShell
      bereiche={shellBereiche(zeilen)}
      gruppeName={typeof name === 'string' ? name : ''}
    >
      {children}
    </OeffentlicheShell>
  );
}
