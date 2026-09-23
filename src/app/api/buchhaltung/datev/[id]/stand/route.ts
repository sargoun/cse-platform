import { type NextRequest, type NextResponse } from 'next/server';
import { fuehreUebergangAus, grundAus, UUID } from '../../../../uebergang';
import {
  istStapelVermerk, StapelFehler, vermerkeUebergabe, verwirfStapel,
} from '@/server/services/buchhaltung/datev/stapel';

/**
 * `POST /api/buchhaltung/datev/[id]/stand` — der Vermerk am Buchungsstapel
 * (V-027, ACC-02).
 *
 * **Es wird nichts gesendet.** Die Route schreibt, was ein MENSCH getan hat:
 * die Datei übergeben oder den Stapel verworfen. Es gibt keinen
 * DATEV-Endpunkt und keine Zugangsdaten (O-05); ein Knopf „an DATEV senden"
 * wäre eine erfundene Integration.
 *
 * `buchhaltung.exportieren` — dasselbe Recht, das den Stapel erzeugt und das
 * `t_mandant` auf `datev_export` im WITH CHECK verlangt. Wer eine Datei
 * erzeugen darf, vermerkt auch, was aus ihr geworden ist; ein eigenes Recht
 * dafür trennte zwei Hälften desselben Vorgangs.
 */
export const dynamic = 'force-dynamic';

/*
 * Die Stapelkennung kommt aus dem RUMPF und nicht aus dem Pfadsegment.
 *
 * Beide stünden zur Wahl, und genau das ist der Grund: zwei Quellen für
 * dieselbe Kennung sind eine, die irgendwann abweicht. Das Formular schickt
 * sie ohnehin mit, der Pfad ist die Adresse der SEITE.
 */
export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  return fuehreUebergangAus(anfrage, {
    recht: 'buchhaltung.exportieren',
    grundVon: (f) => grundAus(f, StapelFehler),
    handle: async (kontext, rumpf) => {
      const stapelId = rumpf.felder['stapel'] ?? '';
      const vermerk = rumpf.felder['vermerk'] ?? '';
      if (!UUID.test(stapelId)) {
        throw new StapelFehler('Kein Stapel benannt.', 'nicht_gefunden', 404);
      }
      if (!istStapelVermerk(vermerk)) {
        throw new StapelFehler('Diesen Vermerk gibt es nicht.', 'nicht_gefunden', 404);
      }
      const db = {
        abfrage: kontext.abfrage.bind(kontext),
        schreibe: kontext.schreibe.bind(kontext),
      };
      if (vermerk === 'uebergeben') {
        await vermerkeUebergabe(db, stapelId, rumpf.felder['notiz'] ?? null);
      } else {
        await verwirfStapel(db, stapelId, rumpf.felder['grund'] ?? '');
      }
      return { stapelId };
    },
    ziel: (slug, e) => `/portal/${slug}/buchhaltung/datev/${e.stapelId}`,
  });
}
