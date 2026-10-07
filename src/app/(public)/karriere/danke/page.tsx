import type { Metadata } from 'next';
import { dankeBlatt } from '../Seiten';
import { KARRIERE_TEXTE } from '../texte';

/**
 * `/karriere/danke` — die Seite NACH dem Absenden (REC-03).
 *
 * **Sie sagt, was jetzt passiert und wann gelöscht wird** — mit der Zahl aus
 * `recruiting.aufbewahrung_tage`, nicht mit einem „danach". Eine
 * Dankesseite, die nur „Vielen Dank" sagt, lässt den Menschen im Unklaren
 * darüber, ob seine Daten angekommen sind und wie lange sie bleiben — beides
 * gehört nach Art. 13 DSGVO zur Erhebung und nicht in eine spätere E-Mail,
 * die vielleicht nie kommt. Englisch unter `/en/karriere/danke` (V-393).
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: KARRIERE_TEXTE.de.dankeMetaTitel };

export default function DankeSeite() {
  return dankeBlatt('de');
}
