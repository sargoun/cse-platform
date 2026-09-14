import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { withTenant } from '@/server/kontext/index';
import { EinreichungFehler, erfasseEinreichung } from '@/server/services/vergabe/einreichung';
import { alsAntwort } from '../../sicherheit/antwort';

/**
 * `POST /api/vergabe/einreichung` — festhalten, dass ein Mensch eingereicht
 * hat (RAD-07, D-07, REP-06).
 *
 * **Die Route überträgt nichts.** Sie schreibt einen Satz in die Datenbank:
 * diese Person hat zu diesem Zeitpunkt über diese Plattform abgegeben. Der
 * Upload ist vorher passiert, auf der Plattform, von Hand — eine
 * Schnittstelle dafür gibt es nicht, und eine zu behaupten wäre schlimmer als
 * keine zu haben.
 *
 * **Eine eigene Adresse und ein eigenes Recht.** `vergabe.schreiben` führt die
 * Prüfliste; `vergabe.einreichung_erfassen` bezeugt die Abgabe. Wer Formulare
 * abhakt, bezeugt damit nicht die Abgabe.
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
  const mappe = text(daten, 'mappe') ?? '';
  if (!UUID.test(ausschreibung) || !UUID.test(mappe)) {
    return NextResponse.json({ fehler: 'unbekannte_mappe' }, { status: 400 });
  }
  const formular = `/portal/${mandant}/radar/${ausschreibung}/mappe/einreichung`;
  const mappenseite = `/portal/${mandant}/radar/${ausschreibung}/mappe`;

  try {
    await db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung, { recht: 'vergabe.einreichung_erfassen', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        const plattform = text(daten, 'plattform');
        await erfasseEinreichung(kontext, {
          mappeId: mappe,
          plattformId: plattform !== null && UUID.test(plattform) ? plattform : null,
          plattformText: text(daten, 'plattform_text'),
          kennzeichen: text(daten, 'kennzeichen'),
        });
      }));
  } catch (fehler) {
    if (fehler instanceof EinreichungFehler) {
      const schluessel = fehler.code === 'stand' ? 'stand'
        : fehler.code === 'recht' ? 'recht' : 'plattform';
      return NextResponse.redirect(
        internesZiel(`${formular}?fehler=${schluessel}`, formular, anfrage), 303);
    }
    const antwort = alsAntwort(fehler);
    if (antwort !== null) return antwort;
    throw fehler;
  }

  return NextResponse.redirect(
    internesZiel(`${mappenseite}?vermerkt=eingereicht`, mappenseite, anfrage), 303);
}
