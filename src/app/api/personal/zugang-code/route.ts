import type postgres from 'postgres';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { withTenant } from '@/server/kontext/index';
import { ZUGANGSCODE_COOKIE, stelleZugangscodeAus, type Zugangscode } from '@/server/services/personal/zugangscode';
import { alsAntwort } from '../../sicherheit/antwort';

/**
 * `POST /api/personal/zugang-code` — die Einsatzleitung stellt einer
 * Mitarbeiterin einen Anmeldecode aus (EMP-01, O-82, D-487).
 *
 * Der Klartext geht NICHT in die Adresse (Verlauf, Proxy-Log), sondern in
 * einen kurzlebigen, nur fuer die Zugangsseite gueltigen Keks; die Seite
 * zeigt ihn, solange er lebt. Gespeichert ist nur der Hash.
 */
export const dynamic = 'force-dynamic';

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
  const mandant = String(daten.get('mandant') ?? '').replace(/[^a-z0-9-]/gu, '');
  const person = String(daten.get('person') ?? '');
  if (!UUID.test(person) || mandant === '') {
    return NextResponse.json({ fehler: 'unvollstaendig' }, { status: 400 });
  }
  const seite = `/portal/${mandant}/personal/personen/${person}/zugang`;

  let ergebnis: Zugangscode;
  try {
    ergebnis = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung, { recht: 'personal.zugang_verwalten', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        return stelleZugangscodeAus(kontext, person);
      })) as Promise<Zugangscode>);
  } catch (fehler) {
    const antwort = alsAntwort(fehler);
    if (antwort !== null) return antwort;
    throw fehler;
  }

  const keks = await cookies();
  if (ergebnis.ok) {
    keks.set(ZUGANGSCODE_COOKIE, ergebnis.code, {
      httpOnly: true, sameSite: 'lax', path: seite, maxAge: 300,
      secure: process.env.NODE_ENV === 'production',
    });
    return NextResponse.redirect(internesZiel(`${seite}?ausgestellt=1`, seite, anfrage), 303);
  }
  keks.delete(ZUGANGSCODE_COOKIE);
  return NextResponse.redirect(internesZiel(`${seite}?grund=${ergebnis.grund}`, seite, anfrage), 303);
}
