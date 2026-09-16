import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { withTenant } from '@/server/kontext/index';
import {
  MappeFehler, SETZBARER_MAPPENSTAND, POSITIONSSTAENDE,
  entfernePosition, ergaenzePosition, setzeMappenstand, setzePositionsstand,
  type MappenStand, type Positionsstand,
} from '@/server/services/vergabe/mappe';
import { alsAntwort } from '../../sicherheit/antwort';

/**
 * `POST /api/vergabe/mappe` — die Prüfliste führen (RAD-07).
 *
 * Vier Handlungen an einer Adresse, unterschieden durch `was`: eine Position
 * anlegen, eine Position ENTFERNEN, den Stand einer Position setzen, den Stand
 * der Mappe setzen.
 * **Einreichen ist keine davon** — das ist eine eigene Route mit einem
 * eigenen Recht, weil es eine andere Aussage ist (D-07).
 */
export const dynamic = 'force-dynamic';

function text(daten: FormData, feld: string): string | null {
  const wert = daten.get(feld);
  return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** Die Fehlercodes des Dienstes als die Schlüssel, die die Seite in Sätze übersetzt. */
function fehlerSchluessel(fehler: MappeFehler): string {
  if (fehler.message.includes('Bezeichnung')) return 'bezeichnung';
  if (fehler.message.includes('Begründung')) return 'begruendung';
  if (fehler.message.includes('Datei')) return 'datei';
  if (fehler.message.includes('leer')) return 'leer';
  if (fehler.message.includes('eingereicht')) return 'eingereicht';
  if (fehler.code === 'stand') return 'unvollstaendig';
  return 'abgewiesen';
}

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const daten = await anfrage.formData();
  const mandant = (text(daten, 'mandant') ?? '').replace(/[^a-z0-9-]/gu, '');
  const ausschreibung = text(daten, 'ausschreibung') ?? '';
  const was = text(daten, 'was') ?? '';
  if (!UUID.test(ausschreibung)) {
    return NextResponse.json({ fehler: 'unbekannte_bekanntmachung' }, { status: 400 });
  }
  const seite = `/portal/${mandant}/radar/${ausschreibung}/mappe`;

  try {
    await db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung, { recht: 'vergabe.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        if (was === 'position_neu') {
          const mappe = text(daten, 'mappe') ?? '';
          if (!UUID.test(mappe)) throw new MappeFehler('nicht_gefunden', 'Mappe unbekannt.');
          await ergaenzePosition(kontext, {
            mappeId: mappe,
            bezeichnung: text(daten, 'bezeichnung') ?? '',
            kategorie: text(daten, 'kategorie'),
            pflicht: daten.get('pflicht') !== null,
          });
          return;
        }

        /*
         * **Eine Prüflistenzeile zurücknehmen** — der Dienst konnte es, die
         * Adresse kannte den Schritt nicht.
         *
         * `entfernePosition` stand vollständig da, mit eigenem Fehlerfall,
         * und keine Zeile im Baum rief sie. Ohne diesen Schritt bleibt eine
         * vertippte Zeile für immer in der Mappe: „gilt nicht" nimmt sie zwar
         * aus dem Zähler, verlangt dafür aber eine BEGRÜNDUNG — und für einen
         * Tippfehler gibt es keine. Genau das sagt der Dienst in seinem
         * eigenen Kommentar: kein Geschäftsvorfall, sondern ein Tippfehler.
         *
         * Dasselbe Recht wie die übrigen drei (`vergabe.schreiben`): wer die
         * Liste führt, führt sie in beide Richtungen. Und dieselbe Sperre —
         * nach dem Einreichen ändert sich an der Mappe nichts mehr, das prüft
         * der Dienst.
         */
        if (was === 'position_entfernen') {
          const position = text(daten, 'position') ?? '';
          if (!UUID.test(position)) throw new MappeFehler('nicht_gefunden', 'Position unbekannt.');
          await entfernePosition(kontext, position);
          return;
        }

        if (was === 'positionsstand') {
          const position = text(daten, 'position') ?? '';
          const stand = text(daten, 'stand') ?? '';
          if (!UUID.test(position)) throw new MappeFehler('nicht_gefunden', 'Position unbekannt.');
          if (!(POSITIONSSTAENDE as readonly string[]).includes(stand)) {
            throw new MappeFehler('eingabe', 'Unbekannter Stand.');
          }
          await setzePositionsstand(kontext, {
            positionId: position,
            stand: stand as Positionsstand,
            hinweis: text(daten, 'hinweis'),
          });
          return;
        }

        if (was === 'mappenstand') {
          const mappe = text(daten, 'mappe') ?? '';
          const stand = text(daten, 'stand') ?? '';
          if (!UUID.test(mappe)) throw new MappeFehler('nicht_gefunden', 'Mappe unbekannt.');
          if (!(SETZBARER_MAPPENSTAND as readonly string[]).includes(stand)) {
            throw new MappeFehler('stand', 'Unbekannter Stand.');
          }
          await setzeMappenstand(kontext, {
            mappeId: mappe, stand: stand as MappenStand, luecken: text(daten, 'luecken'),
          });
          return;
        }

        throw new MappeFehler('eingabe', 'Unbekannte Handlung.');
      }));
  } catch (fehler) {
    if (fehler instanceof MappeFehler) {
      return NextResponse.redirect(
        internesZiel(`${seite}?fehler=${fehlerSchluessel(fehler)}`, seite, anfrage), 303);
    }
    const antwort = alsAntwort(fehler);
    if (antwort !== null) return antwort;
    throw fehler;
  }

  return NextResponse.redirect(internesZiel(`${seite}?vermerkt=mappe`, seite, anfrage), 303);
}
