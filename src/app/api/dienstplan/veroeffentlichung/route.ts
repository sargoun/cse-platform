import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { withTenant } from '@/server/kontext/index';
import { veroeffentliche } from '@/server/services/dienstplan/veroeffentlichung';
import { alsAntwort } from '../../sicherheit/antwort';

/**
 * `POST /api/dienstplan/veroeffentlichung` — einen Zeitraum bekanntgeben
 * (TIM-01, NOT-01).
 *
 * `dienstplan.veroeffentlichen` und **nicht** `dienstplan.schreiben`: wer den
 * Plan aendert, hat ihn damit nicht bekanntgegeben, und wer ihn bekanntgibt,
 * darf ihn darum nicht aendern. Zwei Handlungen, zwei Rechte — dieselbe
 * Trennung, die `dienstplan.konflikt_quittieren` von `dienstplan.schreiben`
 * trennt.
 *
 * **Der Zeitraum kommt aus dem Formular, der MANDANT aus der Sitzung.** Ein
 * `?mandant=` steht hier nur fuer den Rueckweg in der Adresse (Invariante 3);
 * geschrieben wird in `app.aktiver_mandant()`.
 *
 * **Blockierende Konflikte halten die Bekanntgabe nicht auf**, und das ist
 * keine Nachlaessigkeit: ob sie es sollten, ist Teil der offenen Frage O-712.
 * Ihre Zahl steht in der Vorschau obenan und wird im Beleg mitgeschrieben —
 * wer trotz drei Sperren veroeffentlicht hat, ist damit nachweisbar.
 */
export const dynamic = 'force-dynamic';

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
  const von = String(daten.get('von') ?? '');
  const bis = String(daten.get('bis') ?? '');
  const umfang = String(daten.get('umfang') ?? 'woche');
  const notiz = daten.get('notiz');

  let id = '';
  let empfaenger = 0;
  let ohneZugang = 0;
  try {
    await db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung,
          { recht: 'dienstplan.veroeffentlichen', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        const ergebnis = await veroeffentliche(kontext, {
          von,
          bis,
          umfang,
          notiz: typeof notiz === 'string' ? notiz : null,
        });
        id = ergebnis.id;
        empfaenger = ergebnis.empfaenger;
        ohneZugang = ergebnis.ohneZugang;
      }));
  } catch (fehler) {
    const antwort = alsAntwort(fehler);
    if (antwort !== null) return antwort;
    throw fehler;
  }

  const seite = `/portal/${mandant}/dienstplan/veroeffentlichung`;
  const ziel = `${seite}?von=${von}&bis=${bis}&veroeffentlicht=${id}`
    + `&empfaenger=${String(empfaenger)}&ohne=${String(ohneZugang)}`;
  return NextResponse.redirect(internesZiel(ziel, seite, anfrage), 303);
}
