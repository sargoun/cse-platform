import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { istGleicherUrsprung, erwarteterUrsprung } from '@/server/auth/ursprung';
import { bindePersoenlich } from '@/server/kontext/index';
import { db } from '@/server/db/pool';
import { oeffne } from '@/server/benachrichtigung/posteingang';

/**
 * `POST /api/benachrichtigungen/[id]/oeffnen` — stempeln und weiterleiten
 * (NOT-01, NOT-03).
 *
 * **Ein Klick ist beides.** Wer eine Benachrichtigung oeffnet, hat sie
 * gelesen; ein zweiter Knopf „als gelesen markieren" daneben waere eine
 * Handlung, die niemand ausfuehrt, und der Posteingang bliebe fuer immer voll.
 *
 * **Das Ziel kommt aus der ZEILE, nicht aus der Anfrage.** Ein `ziel` im Rumpf
 * waere ein Feld, in das sich eine fremde Adresse schreiben liesse — eine
 * offene Weiterleitung mit einer echten Anmeldung davor (D-504).
 *
 * **POST und kein GET**, weil es Zustand aendert: ein Vorauslader, ein
 * Suchroboter oder ein weitergeleiteter Link markierte sonst fremde Meldungen
 * als gelesen.
 *
 * Kein Rechteschluessel davor, und das ist kein Versehen: der Posteingang ist
 * persoenlich. `t_benachrichtigung_lesen_setzen` bindet ihn an
 * `empfaenger_id = app.aktueller_benutzer()` — eine fremde Zeile trifft null
 * Zeilen, und die Antwort ist 404 wie bei jeder fremden Zeile (AUT-06).
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export async function POST(
  anfrage: NextRequest, { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });

  const sitzung = await aktuelleSitzung();
  if (sitzung === null) return NextResponse.json({ fehler: 'nicht_angemeldet' }, { status: 401 });

  const ziel = await (db().begin(async (tx: postgres.TransactionSql) => {
    await bindePersoenlich(tx, sitzung);
    const abfrage = async <T>(a: string, w?: readonly unknown[]): Promise<readonly T[]> =>
      (await tx.unsafe(a, (w ?? []) as never[])) as unknown as readonly T[];
    return oeffne({ abfrage, schreibe: abfrage }, id);
  }) as Promise<string | null>);

  if (ziel === null) return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });

  // Relativ und aus der Zeile: `new URL(ziel, origin)` kann damit nie auf
  // einen fremden Wirt zeigen, weil `ziel` per CHECK mit `/` beginnt.
  return NextResponse.redirect(new URL(ziel, erwarteterUrsprung(anfrage)), 303);
}
