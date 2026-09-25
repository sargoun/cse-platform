import type { NextRequest, NextResponse } from 'next/server';
import { korrigiereMannstunden } from '@/server/services/bau/bautagebuch';
import { aufDerSchicht, dienstFehlerAntwort, zurueckZu } from '../../../bruecke';
import { grundAufsFormularweg } from '@/app/api/formular-antwort';

/**
 * `POST /api/mein/schichten/[zuordnungId]/bautagebuch/korrektur` — die EIGENE
 * Mannstundenzeile richtigstellen (V-063, BAU-07, LEG-01).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund: alles war gebaut ausser dem Weg dorthin.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `bautagebuch_mannstunden` trägt seit `0082` `storniert_am`, `storno_grund`
 * und `ersetzt_durch_id`; `korrigiereMannstunden` steht seit je im Dienst;
 * und `0303` legte eigens eine Policy an — `t_selbst_m1_storno` —, die der
 * Kolonne genau diesen einen Übergang auf ihrer eigenen Zeile erlaubt. Ihr
 * Kommentar sagt es wörtlich: „die Korrekturspur der EIGENEN Zeile".
 *
 * **Und es gab keine Route dorthin.** Wer sich vertippt hatte, sah seine
 * falsche Zeile bis zum Abschluss des Tages im Bautagebuch stehen — in dem
 * Dokument, das im Streit über den Bauablauf zählt.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Eine Handlung, nicht zwei.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Storno und Ersatz schreibt `korrigiereZeile` in EINER Transaktion und setzt
 * dabei `ersetzt_durch_id`. Zwei getrennte Knöpfe liessen einen Zustand zu, in
 * dem storniert ist und nichts an die Stelle getreten — die Tagessumme wäre
 * dann still zu klein, und der Abgleich gegen die Zeiterfassung meldete einen
 * Befund, der keiner ist.
 *
 * Die Policy erzwingt dasselbe von unten: ihre `with check`-Klausel verlangt
 * `storniert_am is not null AND ersetzt_durch_id is not null`. Ein Storno ohne
 * Ersatz kommt hier gar nicht durch.
 *
 * **`herkunft` bleibt `eigen`**, wie beim Anlegen: eine Kolonne trägt ihre
 * eigenen Stunden ein. Nachunternehmerstunden bezeugt die Bauleitung, weil
 * dahinter die Rechnung eines Dritten steht — und nur `eigen` erzeugt später
 * den Abgleich mit der Zeiterfassung.
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

  const zeileId = textOder(daten, 'zeile');
  const grund = textOder(daten, 'grund');
  const gewerkId = textOder(daten, 'gewerk');
  const personen = Number(textOder(daten, 'personen') ?? '');
  const minuten = Number(textOder(daten, 'minuten') ?? '');

  if (zeileId === null || !UUID.test(zeileId)) {
    return grundAufsFormularweg(anfrage, daten, 'keine_zeile', 400);
  }
  /*
   * **Der Grund ist Pflicht, und zwar hier und nicht erst in der Datenbank.**
   * Eine Korrektur ohne Grund ist im Bautagebuch die halbe Auskunft: man
   * sieht, dass etwas geändert wurde, und nicht warum. LEG-01 verlangt die
   * Spur, nicht nur das Ergebnis.
   */
  if (grund === null) {
    return grundAufsFormularweg(anfrage, daten, 'kein_grund', 400);
  }
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
      /*
       * Der Tag kommt aus der ZEILE, nicht aus dem Formular: `korrigiereMannstunden`
       * liest `bautagebuch_id` der alten Zeile und hängt den Ersatz an
       * denselben Tag. Ein Tag aus dem Formular wäre die Gelegenheit, eine
       * Korrektur auf einen anderen Bautag zu schieben.
       */
      return korrigiereMannstunden(k, {
        zeileId,
        grund,
        ersatz: {
          gewerkId,
          herkunft: 'eigen',
          anzahlPersonen: personen,
          dauerMinuten: minuten,
          taetigkeit: textOder(daten, 'taetigkeit'),
        },
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
