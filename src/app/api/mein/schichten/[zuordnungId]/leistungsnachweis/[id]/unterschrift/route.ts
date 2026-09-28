import type { NextRequest, NextResponse } from 'next/server';
import { signiere } from '@/server/services/reinigung/leistungsnachweis';
import { aufDerSchicht, dienstFehlerAntwort, zurueckZu } from '../../../../bruecke';
import { grundAufsFormularweg } from '@/app/api/formular-antwort';

/**
 * `POST /api/mein/schichten/[zuordnungId]/leistungsnachweis/[id]/unterschrift`
 * — der Kunde unterschreibt auf dem Telefon der Kraft (CLN-04, TIM-08, LEG-01).
 *
 * **Die Pruefsumme entscheidet.** Sie kommt aus der Anzeige zurueck; `signiere`
 * baut den Abzug NEU und weist ab, wenn die beiden nicht gleich sind (0066).
 * Das ist der einzige Fall, in dem eine Unterschrift scheitert, obwohl formal
 * alles stimmt — und der Grund, warum das Dokument etwas wert ist: der Kunde
 * hat unter GENAU das gesetzt, was auf dem Bildschirm stand.
 *
 * **Die Zeit kommt vom Server, der Name vom Menschen** (Invariante 5, TIM-08).
 * `unterzeichnet_am` stempelt ein Ausloeser mit `now()`; was ein Geraet
 * behauptet, landet getrennt in `geraete_zeit`, und die Abweichung leitet
 * dieselbe Funktion ab. Diese Route schickt keine Zeit mit — ohne JavaScript
 * gibt es keine zu behaupten, und eine erfundene waere schlechter als keine.
 *
 * **Die Rolle ist `auftraggeber`.** Die Gegenzeichnung der Kraft
 * (`auftragnehmer`) traegt eine `anstellung_id` und ist ein anderer Vorgang;
 * sie gehoert nicht in dasselbe Formular, weil sie etwas anderes bezeugt.
 *
 * **Kein Unterschriftsbild.** `signatur_medien_id` bleibt NULL: ein Canvas
 * braucht JavaScript, und die Geraete sind alte Diensttelefone. Name,
 * Serverzeit und Abzug tragen den Vorgang; das Bild ist Beigabe (0066) — und
 * ohne verbundenen Speicher gaebe es ohnehin keins, ohne dass die Unterschrift
 * daran scheitern duerfte.
 *
 * // TODO(client, O-741): Soll der Auftraggeber zusaetzlich handschriftlich auf dem Bildschirm zeichnen, und gilt eine getippte Namensangabe mit Serverzeit und Pruefsumme als ausreichend?
 */
export const dynamic = 'force-dynamic';

const HASH = /^[0-9a-f]{64}$/u;

function textOder(daten: FormData, feld: string): string | null {
  const wert = daten.get(feld);
  return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : null;
}

export async function POST(
  anfrage: NextRequest,
  kontext: { params: Promise<{ zuordnungId: string; id: string }> },
): Promise<NextResponse> {
  const { zuordnungId, id } = await kontext.params;
  const daten = await anfrage.formData();

  const name = textOder(daten, 'name');
  const pruefsumme = textOder(daten, 'pruefsumme');
  if (name === null) {
    return grundAufsFormularweg(anfrage, daten, 'kein_name', 400);
  }
  if (pruefsumme === null || !HASH.test(pruefsumme)) {
    // Ohne Pruefsumme wird nicht unterschrieben: sie ist die Verbindung
    // zwischen dem, was angezeigt wurde, und dem, was gespeichert wird.
    return grundAufsFormularweg(anfrage, daten, 'keine_pruefsumme', 400);
  }

  try {
    const ergebnis = await aufDerSchicht(anfrage, zuordnungId, async (k) => signiere(k, {
      nachweisId: id,
      rolle: 'auftraggeber',
      unterzeichnerName: name,
      unterzeichnerFunktion: textOder(daten, 'funktion'),
      bestaetigtePruefsumme: pruefsumme,
      ip: anfrage.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      userAgent: anfrage.headers.get('user-agent'),
    }));
    if (ergebnis.art === 'antwort') return ergebnis.antwort;
  } catch (fehler: unknown) {
    const antwort = dienstFehlerAntwort(fehler, { anfrage, daten });
    if (antwort !== null) return antwort;
    throw fehler;
  }

  return zurueckZu(daten, `/portal/mein/schichten/${zuordnungId}/leistungsnachweis`, anfrage);
}
