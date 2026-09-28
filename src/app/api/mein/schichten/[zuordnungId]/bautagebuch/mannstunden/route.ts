import type { NextRequest, NextResponse } from 'next/server';
import { findeOderLegeBautagAn, hefteMannstundenAn }
  from '@/server/services/bau/bautagebuch';
import { aufDerSchicht, dienstFehlerAntwort, zurueckZu } from '../../../bruecke';
import { grundAufsFormularweg } from '@/app/api/formular-antwort';

/**
 * `POST /api/mein/schichten/[zuordnungId]/bautagebuch/mannstunden` — die
 * Stunden der Kolonne (BAU-07).
 *
 * **`herkunft` ist immer `eigen`.** Eine Kolonne traegt ihre eigenen Stunden
 * ein; Nachunternehmerstunden bezeugt die Bauleitung, weil dahinter eine
 * Rechnung eines Dritten steht. Ein Auswahlfeld dafuer waere die Einladung,
 * fremde Leistung als eigene zu buchen — und nur `eigen` erzeugt spaeter einen
 * Abgleich mit der Zeiterfassung.
 *
 * **Die Dauer ist eine GEMESSENE Zahl in ganzen Minuten** (K-16), nie eine
 * Bruchzahl Stunden. Der Dienst prueft 0…1440 als Eingabeplausibilitaet — das
 * ist AUSDRUECKLICH keine ArbZG-Grenze: die gilt je PERSON ueber alle
 * Gesellschaften (D-09) und wird an anderer Stelle geprueft.
 *
 * **Ohne Gewerkekatalog geht es nicht, und das ist ehrlich so.** `gewerk_id`
 * ist Pflicht, und der Katalog wird leer ausgeliefert (O-159). Die Seite bietet
 * das Formular deshalb gar nicht erst an; diese Route weist den Direktaufruf
 * mit der Meldung des Dienstes ab, die den Grund nennt.
 *
 * // TODO(client, O-281): Zaehlen die Mannstunden im Bautagebuch die Anwesenheit auf der Baustelle (brutto) oder die Arbeitszeit ohne Pausen (netto)?
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function textOder(daten: FormData, feld: string): string | null {
  const wert = daten.get(feld);
  return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : null;
}

export async function POST(
  anfrage: NextRequest,
  kontext: { params: Promise<{ zuordnungId: string }> },
): Promise<NextResponse> {
  const { zuordnungId } = await kontext.params;
  const daten = await anfrage.formData();

  const gewerkId = textOder(daten, 'gewerk');
  const personen = Number(textOder(daten, 'personen') ?? '');
  const minuten = Number(textOder(daten, 'minuten') ?? '');

  if (gewerkId === null || !UUID.test(gewerkId)) {
    return grundAufsFormularweg(anfrage, daten, 'kein_gewerk', 400);
  }
  if (!Number.isInteger(personen) || personen <= 0) {
    return grundAufsFormularweg(anfrage, daten, 'personen_ungueltig', 400);
  }
  if (!Number.isInteger(minuten) || minuten < 0 || minuten > 1440) {
    return grundAufsFormularweg(anfrage, daten, 'dauer_ungueltig', 400);
  }

  try {
    const ergebnis = await aufDerSchicht(anfrage, zuordnungId, async (k, bezug) => {
      if (bezug.projektId === null) return null;
      const tagId = await findeOderLegeBautagAn(k, bezug.projektId, bezug.vonDatum);
      return hefteMannstundenAn(k, {
        bautagebuchId: tagId,
        gewerkId,
        herkunft: 'eigen',
        anzahlPersonen: personen,
        dauerMinuten: minuten,
        taetigkeit: textOder(daten, 'taetigkeit'),
      });
    });
    if (ergebnis.art === 'antwort') return ergebnis.antwort;
    if (ergebnis.wert === null) {
      return grundAufsFormularweg(anfrage, daten, 'kein_projekt', 422);
    }
  } catch (fehler: unknown) {
    const antwort = dienstFehlerAntwort(fehler, { anfrage, daten });
    if (antwort !== null) return antwort;
    throw fehler;
  }

  return zurueckZu(daten, `/portal/mein/schichten/${zuordnungId}/bautagebuch`, anfrage);
}
