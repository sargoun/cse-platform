import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { withTenant } from '@/server/kontext/index';
import {
  ausnahmeSchreibrecht, legeAusnahmeAn, leseSerie, type AusnahmeArt,
} from '@/server/services/dienstplan/serie';
import { alsAntwort } from '../../../../sicherheit/antwort';

/**
 * `POST /api/dienstplan/serien/[id]/ausnahmen` — eine Einzeltermin-Ausnahme
 * (TIM-02, §5.4).
 *
 * **Zwei Rechte, und das zweite ist das, das wirklich sperrt.** Die Route
 * gehoert dem Dienstplan und verlangt `dienstplan.schreiben`. Die
 * Schreibpolicy der TABELLE fragt aber etwas anderes: `turnus_ausnahme`
 * verlangt `reinigung.schreiben` (0029), `posten_ausnahme` verlangt
 * `security.schreiben` (0069). Wer nur das erste prueft, schickt das Formular
 * gegen eine Policy, die null Zeilen trifft — und die Oberflaeche sagt „nicht
 * vorhanden", wo „dafuer fehlt das Gewerkerecht" die Wahrheit ist. Deshalb
 * wird das Gewerkerecht hier ausdruecklich mitgeprueft, nachdem der Traeger
 * bekannt ist.
 *
 * **Drei Arten, nicht zwei.** `turnus_ausnahme_art` ist
 * ('ausfall','zusatz','verschiebung'), und `zusatz` ist im Generator
 * implementiert. Ein Formular mit nur zwei Arten liesse den einzigen Weg,
 * eine Zusatzschicht in eine Serie zu haengen, unerreichbar.
 *
 * **Der Generator laeuft sofort mit.** Eine Ausnahme, die erst der Nachtlauf
 * anwendet, ist bis zum naechsten Morgen eine Zeile ohne Wirkung: die Schicht
 * steht noch im Plan, und wer sie ausgetragen hat, glaubt das Gegenteil.
 */
export const dynamic = 'force-dynamic';

const KENNUNG = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function text(daten: FormData, feld: string): string | null {
  const wert = daten.get(feld);
  return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : null;
}

function zahl(daten: FormData, feld: string): number | null {
  const roh = text(daten, feld);
  if (roh === null) return null;
  const n = Number(roh);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export async function POST(
  anfrage: NextRequest, { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }
  const { id } = await params;
  if (!KENNUNG.test(id)) {
    return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
  }

  const daten = await anfrage.formData();
  const mandant = String(daten.get('mandant') ?? '').replace(/[^a-z0-9-]/gu, '');
  const art = text(daten, 'art');
  const datum = text(daten, 'datum');
  const grund = text(daten, 'grund');
  if (art === null || datum === null || grund === null) {
    return NextResponse.json({ fehler: 'pflichtfeld_fehlt' }, { status: 400 });
  }

  let angelegt = '';
  let erzeugt = 0;
  let storniert = 0;
  try {
    const antwort = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        const pruefer = rechtepruefer(kontext.abfrage.bind(kontext));
        await authorize(
          sitzung, { recht: 'dienstplan.schreiben', schreibend: true }, pruefer,
        );

        /*
         * Der Traeger ENTSCHEIDET, welches Gewerkerecht gilt — er wird deshalb
         * gelesen, bevor das zweite `authorize` laeuft. Die Serie selbst ist
         * mit `dienstplan.lesen` lesbar, und das haelt jeder, der
         * `dienstplan.schreiben` haelt.
         */
        const blatt = await leseSerie(kontext, id);
        if (blatt === null) {
          return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
        }
        const gewerk = ausnahmeSchreibrecht(blatt);
        if (gewerk === null) {
          return NextResponse.json(
            { fehler: 'veranstaltung_ohne_ausnahme' }, { status: 409 },
          );
        }
        await authorize(sitzung, { recht: gewerk, schreibend: true }, pruefer);

        const ergebnis = await legeAusnahmeAn(kontext, {
          planungsserieId: id,
          datum,
          art: art as AusnahmeArt,
          ersatzDatum: text(daten, 'ersatz_datum'),
          ersatzZeit: text(daten, 'ersatz_zeit'),
          dauerMinuten: zahl(daten, 'dauer'),
          ersatzBesetzung: zahl(daten, 'ersatz_besetzung'),
          grund,
        });
        angelegt = ergebnis.id;
        erzeugt = ergebnis.bericht?.erzeugt ?? 0;
        storniert = ergebnis.bericht?.storniert ?? 0;
        return null;
      })) as Promise<NextResponse | null>);
    if (antwort !== null) return antwort;
  } catch (fehler) {
    const antwort = alsAntwort(fehler);
    if (antwort !== null) return antwort;
    throw fehler;
  }

  const blattPfad = `/portal/${mandant}/dienstplan/serien/${id}`;
  const ziel = `${blattPfad}?ausnahme=${angelegt}`
    + `&erzeugt=${String(erzeugt)}&storniert=${String(storniert)}`;
  return NextResponse.redirect(internesZiel(ziel, blattPfad, anfrage), 303);
}
