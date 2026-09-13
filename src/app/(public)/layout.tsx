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
    zeilen: await bereicheLesen(kontext, sprache),
    name: await einstellungLesen(kontext, 'website.gruppenname'),
  }));
  /*
   * Welche Gesellschaft gerade offen ist — aus dem Pfad, gegen die ECHTEN
   * Slugs geprueft.
   *
   * `aktiv` gab es an der Huelle schon, und gesetzt hat es niemand: die
   * Markenreihe unter dem Hero bekam immer `null` und hat die offene
   * Gesellschaft nie hervorgehoben. Eine Eigenschaft, die alle durchreichen
   * und keiner fuellt, faellt nicht auf — sie sieht nur immer gleich aus.
   *
   * Geprueft wird gegen `bereiche` und nicht bloss auf das Pfadmuster: ein
   * `/unternehmen/erfunden` soll in der Wahl nichts hervorheben, sondern die
   * Beschriftung zeigen. `pfad` kommt ohne Sprachpraefix herein.
   */
  const bereiche = shellBereiche(zeilen);
  const ausPfad = /^\/unternehmen\/([^/]+)/u.exec(pfad)?.[1];
  const aktiv = bereiche.some((b) => b.slug === ausPfad) ? ausPfad ?? null : null;

  return (
    <OeffentlicheShell
      bereiche={bereiche}
      aktiv={aktiv}
      gruppeName={typeof name === 'string' ? name : ''}
      sprache={sprache}
      pfad={pfad}
      /*
       * Die echte Anmeldung (PR 20): Mobilnummer und Einmalcode unter
       * `/auth/mitarbeiter`. Bis D-421 zeigte der Punkt auf `/dev/anmelden`
       * und stand in einem Produktionsbau deshalb GAR NICHT da — obwohl die
       * Beschaeftigten laengst einen Eingang hatten. Die Website fuehrte damit
       * nicht ins Portal; wer sich anmelden wollte, musste die Adresse kennen.
       * Die Entwicklungsanmeldung bleibt erreichbar: von dieser Seite aus und
       * ueber den Streifen jeder `/dev`-Flaeche.
       */
      anmeldePfad="/auth/mitarbeiter"
    >
      {children}
    </OeffentlicheShell>
  );
}
