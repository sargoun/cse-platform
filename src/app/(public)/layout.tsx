import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { OeffentlicheShell } from '@/components/oeffentlich/OeffentlicheShell';
import { KOPF_PFAD, KOPF_SPRACHE } from '@/lib/kopf';
import { istSprache, VORGABE_SPRACHE } from '@/lib/sprache';
import { bereicheLesen, einstellungLesen, oeffentlichLesen } from '@/server/inhalt/lesen';
import { shellBereiche } from './lade-shell';

/**
 * Die Shell aller oeffentlichen Seiten.
 *
 * `force-dynamic`, weil der Inhalt aus `seite`/`abschnitt` kommt (PUB-07): ein
 * Textwechsel ist ein UPDATE und kein Deployment. Statisch vorgerendert waere
 * er genau das — und der Build braeuchte eine Datenbank, die er nicht hat.
 *
 * Sprache und Pfad kommen aus den Koepfen der Middleware: ein Layout bekommt
 * in Next.js nur `children` und wuesste sonst weder, in welcher Sprache es
 * rendert, noch wohin die Sprachwahl zeigen soll.
 */
export const dynamic = 'force-dynamic';

export default async function OeffentlichesLayout({ children }: { children: ReactNode }) {
  const kopf = await headers();
  const roh = kopf.get(KOPF_SPRACHE) ?? '';
  const sprache = istSprache(roh) ? roh : VORGABE_SPRACHE;
  const pfad = kopf.get(KOPF_PFAD) ?? '/';

  const { zeilen, name } = await oeffentlichLesen(async (kontext) => ({
    zeilen: await bereicheLesen(kontext),
    name: await einstellungLesen(kontext, 'website.gruppenname'),
  }));
  return (
    <OeffentlicheShell
      bereiche={shellBereiche(zeilen)}
      gruppeName={typeof name === 'string' ? name : ''}
      sprache={sprache}
      pfad={pfad}
    >
      {children}
    </OeffentlicheShell>
  );
}
