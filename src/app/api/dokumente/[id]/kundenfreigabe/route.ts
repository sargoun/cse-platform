import { type NextRequest, type NextResponse } from 'next/server';
import { fuehreUebergangAus, grundAus, UUID } from '../../../uebergang';
import {
  DokumentfreigabeFehler, setzeKundenfreigabe,
} from '@/server/services/dokument/kundenfreigabe';

/**
 * `POST /api/dokumente/[id]/kundenfreigabe` — den Schalter
 * `sichtbar_fuer_kunde` setzen (DOC-04).
 *
 * Recht: `dokument.kunde_freigeben`. Ausdruecklich NICHT `dokument.schreiben`
 * — das haelt laut Katalog auch die Rolle `mitarbeiter`, und wer Nachweise
 * ablegen darf, entscheidet damit nicht, was ein Kunde zu sehen bekommt.
 * Genau diese Luecke stand bis 0297 in der zweiten Linie offen: `t_mandant`
 * prueft `dokument.schreiben`, und beim INSERT war der Weg damit frei.
 *
 * Die Kennung steht im PFAD und nicht im Rumpf, weil die Nachbarroute
 * `api/dokumente/[id]/datei` es so haelt — zwei Formen fuer dieselbe Sache
 * an derselben Ressource waeren eine Einladung, die falsche zu nehmen.
 */
export const dynamic = 'force-dynamic';

export async function POST(
  anfrage: NextRequest, { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return fuehreUebergangAus(anfrage, {
    recht: 'dokument.kunde_freigeben',
    grundVon: (f) => grundAus(f, DokumentfreigabeFehler),
    handle: async (kontext, rumpf) => {
      if (!UUID.test(id)) {
        throw new DokumentfreigabeFehler('Kein Dokument benannt', 'nicht_gefunden');
      }
      /**
       * `frei` wird auf `'ja'` VERGLICHEN, nicht auf Abwesenheit geprueft.
       *
       * Ein `!== 'nein'` machte aus einem fehlenden Feld eine Freigabe — und
       * ein fehlendes Feld ist genau, was ein halb abgeschickter Rumpf
       * liefert. Die riskante Richtung braucht das ausdrueckliche Wort.
       */
      const ergebnis = await setzeKundenfreigabe(
        { abfrage: kontext.abfrage.bind(kontext) }, id, {
          frei: (rumpf.felder['frei'] ?? '') === 'ja',
          grund: rumpf.felder['grund'] ?? '',
        });
      return { id, frei: ergebnis.frei };
    },
    ziel: (slug, ergebnis) =>
      `/portal/${slug}/dokumente/${ergebnis.id}/kundenfreigabe`,
  });
}
