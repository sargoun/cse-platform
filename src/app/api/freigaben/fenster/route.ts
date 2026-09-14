import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { withTenant } from '@/server/kontext/index';
import { FensterFehler, erhebeEinspruch, nimmZurueck }
  from '@/server/services/freigabe/stapel';
import { alsAntwort } from '../../sicherheit/antwort';

/**
 * `POST /api/freigaben/fenster` — Einspruch (APR-05) und Rücknahme (APR-06).
 *
 * **Zwei Handlungen an einer Adresse, weil sie dieselbe Form haben**: eine
 * Freigabe, ein Grund, ein Fenster, das laufen muss. Die Datenbank prüft
 * beides ein zweites Mal — zwischen dem Anzeigen eines Knopfes und seinem
 * Drücken vergeht Zeit, und ein Fenster kann in dieser Zeit zugehen.
 *
 * **Beide brauchen einen Grund.** Wer eine gefallene Entscheidung zurückholt,
 * schuldet den anderen Beteiligten eine Erklärung; in einem halben Jahr ist
 * „warum wurde das damals gestoppt" eine echte Frage.
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const daten = await anfrage.formData();
  const mandant = (String(daten.get('mandant') ?? '')).replace(/[^a-z0-9-]/gu, '');
  const freigabe = String(daten.get('freigabe') ?? '');
  const was = String(daten.get('was') ?? '');
  const grund = String(daten.get('grund') ?? '').trim();
  if (!UUID.test(freigabe)) {
    return NextResponse.json({ fehler: 'unbekannte_freigabe' }, { status: 400 });
  }
  const seite = `/portal/${mandant}/freigaben/${freigabe}`;
  if (was !== 'einspruch' && was !== 'ruecknahme') {
    return NextResponse.json({ fehler: 'unbekannte_handlung' }, { status: 400 });
  }
  if (grund.length < 5) {
    return NextResponse.redirect(
      internesZiel(`${seite}?fehler=grund`, seite, anfrage), 303);
  }

  try {
    await db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        /*
         * Einspruch und Rücknahme sind im Katalog zwei eigene, bindbare
         * Rechte — und nicht dasselbe wie „darf entscheiden".
         */
        await authorize(sitzung, {
          recht: was === 'einspruch' ? 'freigabe.einspruch_erheben' : 'freigabe.rueckgaengig',
          schreibend: true,
        }, rechtepruefer(kontext.abfrage.bind(kontext)));
        if (was === 'einspruch') await erhebeEinspruch(kontext, freigabe, grund);
        else await nimmZurueck(kontext, freigabe, grund);
      }));
  } catch (fehler) {
    if (fehler instanceof FensterFehler) {
      return NextResponse.redirect(
        internesZiel(`${seite}?fehler=fenster`, seite, anfrage), 303);
    }
    const antwort = alsAntwort(fehler);
    if (antwort !== null) return antwort;
    throw fehler;
  }

  return NextResponse.redirect(
    internesZiel(`${seite}?vermerkt=${was}`, seite, anfrage), 303);
}
