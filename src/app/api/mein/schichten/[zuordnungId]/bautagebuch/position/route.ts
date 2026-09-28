import type { NextRequest, NextResponse } from 'next/server';
import {
  findeOderLegeBautagAn, heftePositionAn, istPositionArt, type PositionArt,
} from '@/server/services/bau/bautagebuch';
import { aufDerSchicht, dienstFehlerAntwort, zurueckZu } from '../../../bruecke';
import { grundAufsFormularweg } from '@/app/api/formular-antwort';

/**
 * `POST /api/mein/schichten/[zuordnungId]/bautagebuch/position` — Geraet,
 * Lieferung oder Vorkommnis (BAU-07, LEG-01).
 *
 * **Eine Zeile je Sache, kein Fliesstextfeld** (§7.14): „3 t Bewehrung,
 * Lieferschein 4711" bleibt auswertbar; derselbe Satz in `bemerkungen` ist nur
 * noch lesbar.
 *
 * **Das Projekt kommt aus der SCHICHT** (K-02, Invariante 3) — `einsatz.projekt_id`,
 * im Personen-Scope aufgeloest. Ein Feld dafuer gibt es nicht: es waere die
 * Stelle, an der jemand auf einer fremden Baustelle eintraegt.
 *
 * **Der Tag wird hier geoeffnet, nicht beim Ansehen.** `findeOderLegeBautagAn`
 * legt ihn an, wenn es ihn noch nicht gibt — eine SEITE, die beim Lesen
 * schreibt, legte bei jedem Vorauslader einen Bautag an. Ist der Tag schon
 * geschlossen oder storniert, wirft der Dienst mit einer Meldung, die sagt, was
 * stattdessen zu tun ist (Storno des Tages und Ersatztag).
 *
 * **Kein Recht aus dem Katalog** (K-19, 04-SEITENKARTE §7): `bau.schreiben`
 * waere zu breit — es traegt auch das Leistungsverzeichnis, die
 * Nachtragsanmeldung und die Aufmassfreigabe. Bewacht wird der Weg durch die
 * Sitzung, den aus der Schicht aufgeloesten Mandanten und
 * `bautagebuch_position.t_selbst_m1_erfassen` (0303), die nur Zeilen auf
 * Projekten zulaesst, auf denen dieser Mensch eingesetzt ist.
 */
export const dynamic = 'force-dynamic';

const MENGE = /^\d{1,9}([.,]\d{1,3})?$/u;

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

  const art = textOder(daten, 'art');
  const bezeichnung = textOder(daten, 'bezeichnung');
  const menge = textOder(daten, 'menge');
  if (art === null || !istPositionArt(art)) {
    return grundAufsFormularweg(anfrage, daten, 'unbekannte_art', 400);
  }
  if (bezeichnung === null) {
    return grundAufsFormularweg(anfrage, daten, 'keine_bezeichnung', 400);
  }
  if (menge !== null && !MENGE.test(menge)) {
    return grundAufsFormularweg(anfrage, daten, 'menge_ungueltig', 400);
  }

  try {
    const ergebnis = await aufDerSchicht(anfrage, zuordnungId, async (k, bezug) => {
      if (bezug.projektId === null) return null;
      const tagId = await findeOderLegeBautagAn(k, bezug.projektId, bezug.vonDatum);
      return heftePositionAn(k, {
        bautagebuchId: tagId,
        art: art as PositionArt,
        bezeichnung,
        // Die Menge reist als TEXT in ein `numeric` — nie durch einen Double.
        menge: menge === null ? null : menge.replace(',', '.'),
        einheit: textOder(daten, 'einheit'),
        beschreibung: textOder(daten, 'beschreibung'),
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
