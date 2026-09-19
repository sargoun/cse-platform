import { type NextRequest, type NextResponse } from 'next/server';
import {
  RedaktionFehler, aendereProfil, setzeProfilStatus,
} from '@/server/services/inhalt/redaktion';
import { UUID, fuehreWebsiteAus, leerZuNull, zahlOderNull } from '../gemeinsam';

/**
 * `POST /api/website/profil` — die Texte und der Zustand EINER Sprachfassung
 * des Unternehmensprofils (PRO-01, PRO-02, TEN-07).
 *
 * **Je Sprache eine Zeile, je Zeile ein eigener Knopf** (D-82).
 * `unternehmensprofil_uk` ist `unique (mandant_id, sprache)`; die deutsche und
 * die englische Fassung sind zwei Zeilen und werden getrennt gespeichert und
 * getrennt veröffentlicht. Ein gemeinsames Formular hätte die englische
 * Fassung mit der deutschen hinausgeschickt, ohne dass jemand sie gelesen hat.
 *
 * **`referenz.schreiben` und nicht `system.identitaet_verwalten`.**
 * `t_profil_pflege` verlangt in seiner `with check` genau `referenz.schreiben`;
 * das zweite Recht bewacht die SEITE im Manifest (sie zeigt neben den Texten
 * die Identität der Gesellschaft). Ein Recht zu prüfen, das die Datenbank
 * nicht prüft, verschiebt die Abweisung in die RLS — richtig, und an der
 * falschen Stelle erklärt.
 */
export const dynamic = 'force-dynamic';

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  return fuehreWebsiteAus(anfrage, {
    recht: 'referenz.schreiben',
    handle: async (kontext, rumpf) => {
      const handlung = rumpf.felder['handlung'] ?? '';
      const id = rumpf.felder['id'] ?? '';
      if (!UUID.test(id)) {
        throw new RedaktionFehler('Dieses Profil gibt es hier nicht.', 'nicht_gefunden');
      }

      if (handlung === 'status') {
        await setzeProfilStatus(kontext, id, (rumpf.felder['veroeffentlicht'] ?? '') === '1');
        return 'gespeichert=status';
      }
      if (handlung !== 'texte') {
        throw new RedaktionFehler(
          'Diese Handlung kennt die Route nicht.', 'unbekannte_handlung');
      }

      await aendereProfil(kontext, id, {
        kurzbeschreibung: rumpf.felder['kurzbeschreibung'] ?? '',
        beschreibung: leerZuNull(rumpf.felder['beschreibung']),
        gruendung: zahlOderNull(rumpf.felder['gruendung']),
        mitarbeiterZahl: zahlOderNull(rumpf.felder['mitarbeiterZahl']),
      });
      return 'gespeichert=texte';
    },
  });
}
