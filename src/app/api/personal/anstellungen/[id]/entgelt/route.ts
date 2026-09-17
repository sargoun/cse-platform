import { NextResponse, type NextRequest } from 'next/server';
import { GeldFehler, parseGeld, type Cent } from '@/server/services/finanz/geld';
import { setzeKondition, VertragEingabeFehler } from '@/server/services/personal/anstellung';
import { fuehrePersonalAus } from '../../../gemeinsam';
import { UUID } from '../../../../rumpf';

/**
 * `POST /api/personal/anstellungen/[id]/entgelt` — eine datierte Kondition
 * (K-05, D-09 §6, 01-KERN §6.15, Invariante 1).
 *
 * **Der Betrag wird SERVERSEITIG in Cent geparst.** `parseGeld` nimmt
 * ausschliesslich deutsche Schreibweise — `.` gruppiert, `,` trennt die
 * Nachkommastellen. `1.234` sind eintausendzweihundertvierunddreissig Euro,
 * und es als eins zwo drei vier zu lesen ist die Sorte Fehler, die erst in
 * einer Projektmarge auffaellt. Eine Zahl, die nicht dieser Form entspricht,
 * wird abgewiesen und nicht geraten.
 *
 * **Geschrieben wird eine KONDITION und nicht der Spiegel.** Der Satz auf
 * `anstellung` ist ein Spiegel mit genau einem Schreiber
 * (`kern.anstellung_kondition_spiegeln`); wer ihn direkt setzte, bewertete
 * jede vergangene Kalkulation still neu (§6.14).
 */
export const dynamic = 'force-dynamic';

export async function POST(
  anfrage: NextRequest, kontextParam: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await kontextParam.params;
  if (!UUID.test(id)) {
    return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
  }
  return fuehrePersonalAus(anfrage, {
    recht: 'personal.entgelt_schreiben',
    handle: async (kontext, rumpf) => {
      const roh = (rumpf.felder['stundensatz'] ?? '').trim();
      let satz: Cent | null = null;
      if (roh !== '') {
        try {
          satz = parseGeld(roh);
        } catch (fehler) {
          if (fehler instanceof GeldFehler) {
            throw new VertragEingabeFehler(
              `„${roh}" ist kein Eurobetrag in deutscher Schreibweise. Erwartet wird `
              + 'etwa „17,50" — Komma vor den Cent, Punkt für die Tausender.');
          }
          throw fehler;
        }
      }
      const text = (name: string): string | null => {
        const wert = (rumpf.felder[name] ?? '').trim();
        return wert === '' ? null : wert;
      };
      await setzeKondition(kontext, {
        anstellungId: id,
        giltAb: (rumpf.felder['giltAb'] ?? '').trim(),
        stundensatzCent: satz,
        ...(text('arbeitszeitmodell') === null
          ? {} : { arbeitszeitmodell: text('arbeitszeitmodell') as string }),
        wochenstunden: text('wochenstunden'),
        arbeitstageWoche: text('arbeitstageWoche'),
        tarifgruppe: text('tarifgruppe'),
        kostenstelle: text('kostenstelle'),
        grund: text('grund'),
      });
    },
    ziel: (slug) => `/portal/${slug}/personal/anstellungen/${id}/entgelt`,
  });
}
