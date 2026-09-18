import { NextResponse, type NextRequest } from 'next/server';
import {
  erstelleEntwurf, legeVor, type PositionEingabe,
} from '@/server/services/reinigung/leistungsnachweis';
import { aufDerSchicht, dienstFehlerAntwort, zurueckZu } from '../../bruecke';

/**
 * `POST /api/mein/schichten/[zuordnungId]/leistungsnachweis` — die Kraft legt
 * den Nachweis an und VOR (CLN-04, FIN-05).
 *
 * **Anlegen und Vorlegen in EINEM Schritt**, weil es auf der Schicht EIN
 * Vorgang ist: die Kraft tippt, was sie geleistet hat, und haelt dem Kunden das
 * Blatt hin. Ein Entwurf, der auf dem Telefon liegen bleibt, ist ein Nachweis,
 * den niemand unterschreibt. Getrennt bleibt dagegen die UNTERSCHRIFT — sie hat
 * ihre eigene Adresse, weil zwischen Anzeige und Fingerdruck die Pruefsumme
 * steht (0066).
 *
 * **Der Kunde kommt aus dem OBJEKT** (K-02, §1.8). `erstelleEntwurf` prueft ihn
 * gegen `objekt.kunde_id` und weist ab, was nicht passt; diese Route liest ihn
 * deshalb serverseitig und nimmt kein Feld dafuer entgegen. Ein
 * `kunde`-Formularfeld machte die Kundendecke zu einer Eingabe.
 *
 * **Der Preis bleibt LEER.** `einzelpreis_cent` wird nicht gesetzt:
 * // TODO(client, O-348): Traegt eine Position bei Monatspauschale einen Einzelpreis je Durchgang, oder bleibt er leer und die Rechnung stellt die Pauschale?
 *
 * **Die Nummer faellt vielleicht nicht — und dann steht es auf dem Blatt.**
 * `legeVor` zieht sie aus dem Nummernkreis `leistungsnachweis`; gibt es keinen
 * oder ist er ein Platzhalter, bleibt `nummer` NULL und der Vorgang gelingt
 * trotzdem. O-147 laesst offen, ob ueberhaupt lueckenlos nummeriert wird, und
 * eine erfundene Nummer waere schlimmer als keine (K-17).
 *
 * Bis 0304 fiel dieser Fall IMMER, und still: `nummernkreis.p_nk_intern_ceiling`
 * war USING `app.portal() = 'intern'`, die Tabelle im Mitarbeiterportal also
 * unsichtbar, `vergebeNummer` meldete `kein_kreis` — derselbe Nachweis bekam
 * aus dem Buero eine Nummer und von der Schicht keine. 0304 oeffnet genau den
 * Kreistyp `leistungsnachweis` fuer dieses Portal.
 *
 * **Gesagt wird es auf der SEITE, nicht hier.** Diese Route antwortet mit
 * einem 303 auf ein echtes `<form method="post">` (die Geraete sind alte
 * Diensttelefone ohne JavaScript); ein Rumpf kaeme nie an. Die Seite liest den
 * Kopf danach ohnehin neu und schreibt `t.nummerOffen`, wenn `nummer` fehlt.
 * `nummerOffen` wird hier deshalb ENTGEGENGENOMMEN und nicht weggeworfen — der
 * Wert steht im Rueckgabetyp und faellt auf, wenn jemand ihn spaeter braucht.
 */
export const dynamic = 'force-dynamic';

/** So viele Positionszeilen bietet das Formular an. */
const ZEILEN = 3;
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

  const positionen: PositionEingabe[] = [];
  for (let i = 0; i < ZEILEN; i += 1) {
    const bezeichnung = textOder(daten, `bezeichnung_${String(i)}`);
    if (bezeichnung === null) continue;
    const mengeRoh = textOder(daten, `menge_${String(i)}`) ?? '1';
    if (!MENGE.test(mengeRoh)) {
      return NextResponse.json({ fehler: 'menge_ungueltig' }, { status: 400 });
    }
    positionen.push({
      bezeichnung,
      /*
       * Die Menge reist als TEXT in ein `numeric` (Invariante 1 sinngemaess:
       * keine Zahl durch einen Double). Das deutsche Komma wird zum Punkt —
       * die Datenbank liest nur den.
       */
      menge: mengeRoh.replace(',', '.'),
      einheit: textOder(daten, `einheit_${String(i)}`) ?? 'Stk',
      quelle: 'manuell',
      einzelpreisCent: null,
    });
  }
  if (positionen.length === 0) {
    // Ein Nachweis ohne Position ist ein leeres Blatt — und genau das soll
    // niemand unterschreiben.
    return NextResponse.json({ fehler: 'keine_position' }, { status: 400 });
  }

  try {
    const ergebnis = await aufDerSchicht(anfrage, zuordnungId, async (k, bezug) => {
      if (bezug.objektId === null) return null;

      const [objekt] = await k.abfrage<{ kunde_id: string | null }>(
        `select kunde_id from objekt where id = $1::uuid`, [bezug.objektId],
      );
      if (objekt === undefined || objekt.kunde_id === null) return null;

      const id = await erstelleEntwurf(k, {
        objektId: bezug.objektId,
        kundeId: objekt.kunde_id,
        von: bezug.vonDatum,
        bis: bezug.bisDatum,
        positionen,
      });
      const { nummer, nummerOffen } = await legeVor(k, id);
      return { id, nummer, nummerOffen };
    });
    if (ergebnis.art === 'antwort') return ergebnis.antwort;
    if (ergebnis.wert === null) {
      return NextResponse.json({ fehler: 'kein_objekt' }, { status: 422 });
    }
  } catch (fehler: unknown) {
    const antwort = dienstFehlerAntwort(fehler);
    if (antwort !== null) return antwort;
    throw fehler;
  }

  return zurueckZu(daten, `/portal/mein/schichten/${zuordnungId}/leistungsnachweis`, anfrage);
}
