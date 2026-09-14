import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { withTenant } from '@/server/kontext/index';
import {
  SETZBAR, VorgangFehler, setzeVorgangsstand,
  type SetzbarerStatus, type VorgangErgebnis,
} from '@/server/services/radar/vorgang';
import { alsAntwort } from '../../sicherheit/antwort';

/**
 * `POST /api/radar/vorgang` — den Stand einer Bekanntmachung setzen (RAD-07).
 *
 * Drei Stände, ein Formular: geprüft, in Bearbeitung, verworfen. Verworfen
 * ohne Grund weist der Dienst ab, und die Seite sagt warum. **Einreichen
 * steht hier nicht** — D-07: die Vergabeplattformen bieten dafür keine
 * Schnittstelle an, und eine Route, die so hiesse, wäre eine Behauptung.
 */
export const dynamic = 'force-dynamic';

function text(daten: FormData, feld: string): string | null {
  const wert = daten.get(feld);
  return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

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
  const status = text(daten, 'status') ?? '';
  if (!UUID.test(ausschreibung)) {
    return NextResponse.json({ fehler: 'unbekannte_bekanntmachung' }, { status: 400 });
  }
  if (!(SETZBAR as readonly string[]).includes(status)) {
    return NextResponse.json({ fehler: 'status_unbekannt' }, { status: 400 });
  }
  const seite = `/portal/${mandant}/radar/${ausschreibung}`;

  let ergebnis: VorgangErgebnis;
  try {
    ergebnis = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung, { recht: 'radar.status_setzen', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        const profil = text(daten, 'profil');
        const bewertung = text(daten, 'bewertung');
        return setzeVorgangsstand(kontext, {
          ausschreibungId: ausschreibung,
          status: status as SetzbarerStatus,
          grund: text(daten, 'grund'),
          radarProfilId: profil !== null && UUID.test(profil) ? profil : null,
          bewertungId: bewertung !== null && UUID.test(bewertung) ? bewertung : null,
        });
      })) as Promise<VorgangErgebnis>);
  } catch (fehler) {
    /*
     * Der fehlende Grund ist kein Serverfehler, sondern eine Auskunft: die
     * Seite zeigt sie als Satz und behaelt die Eingabe des Menschen im Blick.
     */
    if (fehler instanceof VorgangFehler && fehler.code === 'grund') {
      return NextResponse.redirect(internesZiel(`${seite}?fehler=grund`, seite, anfrage), 303);
    }
    const antwort = alsAntwort(fehler);
    if (antwort !== null) return antwort;
    throw fehler;
  }

  return NextResponse.redirect(
    internesZiel(`${seite}?vermerkt=${encodeURIComponent(ergebnis.status)}`, seite, anfrage), 303);
}
