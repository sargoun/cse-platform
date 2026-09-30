import { NextResponse, type NextRequest } from 'next/server';
import { GeldFehler, parseGeld, type Cent } from '@/server/services/finanz/geld';
import { MengeFehler, mengeAusEingabe, type MilliMenge } from '@/server/services/finanz/menge';
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
 * **Wochenstunden und Arbeitstage werden hier ebenso gelesen** (D-771
 * Nachtrag), mit `mengeAusEingabe`, dem Leser der Plattform für getippte
 * Mengen: „38,5" und „38.5" meinen dasselbe, eine vierte Nachkommastelle oder
 * „abc" werden ein Grund. Vorher ging der rohe Text an `numeric` — ein
 * deutsches Komma war ein 22P02 und damit eine 500. Die Grenzen (0 bis 168
 * Stunden, 0 bis 7 Tage) prüft der Dienst, wie die Datenbank sie setzt.
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
      const text = (name: string): string | null => {
        const wert = (rumpf.felder[name] ?? '').trim();
        return wert === '' ? null : wert;
      };
      const roh = (rumpf.felder['stundensatz'] ?? '').trim();
      let satz: Cent | null = null;
      if (roh !== '') {
        try {
          satz = parseGeld(roh);
        } catch (fehler) {
          if (fehler instanceof GeldFehler) {
            throw new VertragEingabeFehler('betrag_ungueltig',
              `„${roh}" ist kein Eurobetrag in deutscher Schreibweise. Erwartet wird `
              + 'etwa „17,50" — Komma vor den Cent, Punkt für die Tausender.');
          }
          throw fehler;
        }
      }
      /** Eine getippte Menge — leer heisst „nicht hinterlegt", keine Zahl ist ein Grund. */
      const menge = (
        name: 'wochenstunden' | 'arbeitstageWoche',
        grund: 'wochenstunden_ungueltig' | 'arbeitstage_ungueltig',
      ): MilliMenge | null => {
        const wert = text(name);
        if (wert === null) return null;
        try {
          return mengeAusEingabe(wert);
        } catch (fehler) {
          if (fehler instanceof MengeFehler) {
            throw new VertragEingabeFehler(grund,
              `„${wert}" ist keine Zahl mit höchstens drei Nachkommastellen.`);
          }
          throw fehler;
        }
      };
      const wochenstunden = menge('wochenstunden', 'wochenstunden_ungueltig');
      const arbeitstageWoche = menge('arbeitstageWoche', 'arbeitstage_ungueltig');
      await setzeKondition(kontext, {
        anstellungId: id,
        giltAb: (rumpf.felder['giltAb'] ?? '').trim(),
        stundensatzCent: satz,
        ...(text('arbeitszeitmodell') === null
          ? {} : { arbeitszeitmodell: text('arbeitszeitmodell') as string }),
        wochenstunden,
        arbeitstageWoche,
        tarifgruppe: text('tarifgruppe'),
        kostenstelle: text('kostenstelle'),
        grund: text('grund'),
      });
    },
    /* `?gespeichert=1`: die Seite liest den Parameter und zeigt dafuer
       "Kondition eingetragen". Ohne ihn erschien der Erfolgshinweis nie - das
       Formular kam zurueck, und nichts sagte, dass es geklappt hat. Die
       Stammdatenroute macht es seit jeher so. */
    ziel: (slug) =>
      `/portal/${slug}/personal/anstellungen/${id}/entgelt?gespeichert=1`,
  });
}
