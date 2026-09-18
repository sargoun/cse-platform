import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { withTenant, type SchreibKontext } from '@/server/kontext/index';
import { FreigabeFehler, gibFrei } from '@/server/services/zeit/abrechnungsfreigabe';
import { alsAntwort } from '../../sicherheit/antwort';

/**
 * `POST /api/zeiten/freigabe` — erfasste Zeit zur Abrechnung freigeben
 * (TIM-12, FIN-07, FIN-18, §3.3/§7.3).
 *
 * **Auf O-39 blockiert, und trotzdem vollständig.** `zeit.abrechnung_freigeben`
 * ist nicht geseedet und an keine Rolle gebunden (03-AUTH §12.4), solange der
 * Mandant nicht gesagt hat, ob es diesen Schritt überhaupt gibt. `authorize`
 * antwortet damit heute für JEDE Sitzung mit „kein Recht" — und das ist der
 * gewollte Zustand: der Weg ist gebaut und geprüft, das Tor ist zu, und die
 * Antwort öffnet es mit einer Bindung statt mit einem Umbau.
 *
 * Die Rechteprüfung steht dreifach: hier, in `app.zeit_zur_abrechnung_freigeben`
 * (0366) und im Manifest der Seite. Das ist kein Überfluss — eine Route, die
 * ihr Recht nur im eigenen Rumpf kennt, ist von aussen nicht prüfbar (AUT-04).
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
  const ids = daten.getAll('zeiteintrag')
    .filter((w): w is string => typeof w === 'string')
    .filter((w) => UUID.test(w));
  /* Die Filterlage des Bildschirms kommt zurück, damit der Bericht in
     derselben Woche und derselben Auswahl landet, aus der er stammt. */
  const frage = String(daten.get('frage') ?? '').replace(/[^a-zA-Z0-9=&_-]/gu, '');

  let seite = '/portal';
  try {
    const bericht = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext: SchreibKontext) => {
        await authorize(sitzung, { recht: 'zeit.abrechnung_freigeben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)));
        const [m] = await kontext.abfrage<{ slug: string }>(
          `select m.slug from mandant m where m.id = app.aktiver_mandant()`);
        seite = `/portal/${m?.slug ?? ''}/zeiten/freigabe`;
        return gibFrei(kontext, ids);
      }))) as { freigegeben: number; uebersprungen: readonly unknown[] };

    const ziel = `${seite}?${frage === '' ? '' : `${frage}&`}`
      + `freigegeben=${String(bericht.freigegeben)}`
      + `&uebersprungen=${String(bericht.uebersprungen.length)}`;
    return NextResponse.redirect(internesZiel(ziel, '/portal', anfrage), 303);
  } catch (fehler) {
    if (fehler instanceof FreigabeFehler) {
      return NextResponse.redirect(
        internesZiel(
          `${seite}?${frage === '' ? '' : `${frage}&`}fehler=${fehler.code}`,
          '/portal', anfrage),
        303);
    }
    const antwort = alsAntwort(fehler);
    if (antwort !== null) return antwort;
    throw fehler;
  }
}
