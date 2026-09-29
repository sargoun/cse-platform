import { type NextRequest, type NextResponse } from 'next/server';
import { fuehreUebergangAus, grundAus, UUID } from '../../../uebergang';
import { DokumentfreigabeFehler } from '@/server/services/dokument/kundenfreigabe';
import { setzeMitarbeiterfreigabe } from '@/server/services/dokument/mitarbeiterfreigabe';

/**
 * `POST /api/dokumente/[id]/mitarbeiterfreigabe` — den Schalter
 * `sichtbar_fuer_mitarbeiter` setzen oder zurücknehmen (DOC-04, EMP-11,
 * V-219, D-712).
 *
 * Recht: `dokument.schreiben` — dasselbe, mit dem das Kästchen beim Ablegen
 * gesetzt wird. Die Kennung steht im PFAD wie bei den Nachbarrouten
 * `datei` und `kundenfreigabe`.
 *
 * Ein Formular bekommt seine Seite zurück (D-599): die Abweisung als
 * `?vorgang=mitarbeiterfreigabe&fehler=<grund>` auf dem Dokumentblatt, der
 * Erfolg als `?mitarbeiterfreigabe=gesetzt|zurueckgenommen`.
 */
export const dynamic = 'force-dynamic';

export async function POST(
  anfrage: NextRequest, { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return fuehreUebergangAus(anfrage, {
    recht: 'dokument.schreiben',
    grundVon: (f) => grundAus(f, DokumentfreigabeFehler),
    handle: async (kontext, rumpf) => {
      if (!UUID.test(id)) {
        throw new DokumentfreigabeFehler('Kein Dokument benannt', 'nicht_gefunden');
      }
      /*
       * `sichtbar` wird auf `'ja'` VERGLICHEN — die Richtung, die ein Dokument
       * der ganzen Belegschaft zeigt, braucht das ausdrückliche Wort. Ein
       * fehlendes Feld ist eine Rücknahme, nie eine Freigabe.
       */
      const ergebnis = await setzeMitarbeiterfreigabe(
        { abfrage: kontext.abfrage.bind(kontext) }, id, {
          sichtbar: (rumpf.felder['sichtbar'] ?? '') === 'ja',
          grund: rumpf.felder['grund'] ?? '',
        });
      return { id, sichtbar: ergebnis.sichtbar };
    },
    ziel: (slug, ergebnis) => `/portal/${slug}/dokumente/${ergebnis.id}`
      + `?mitarbeiterfreigabe=${ergebnis.sichtbar ? 'gesetzt' : 'zurueckgenommen'}`,
  });
}
