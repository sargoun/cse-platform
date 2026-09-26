import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { autorisierungsAntwort } from '@/server/auth/antwort';
import { rechtepruefer } from '@/server/auth/zugang';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { withTenant } from '@/server/kontext/index';
import { CrmFehler } from '@/server/services/crm/anlegen';
import { setzeKondition } from '@/server/services/crm/kondition';

/**
 * `POST /api/crm/kunde/konditionen` — Debitorennummer, Zahlungsziel und
 * Mahnsperre setzen (CRM-01, FIN-15, K-05).
 *
 * **Hier stehen ZWEI Rechte, und das ist der Kern.** `crm.schreiben` als
 * erste Linie für den Kundenstamm (`WITH CHECK` von `t_mandant`), und
 * `crm_entgelt.lesen` im Dienst für genau diese vier Spalten. Sie sind
 * `cse_app` spaltenweise entzogen; ohne die zweite Prüfung konnte eine
 * Sitzung, der die Seite ein 404 zeigt, dieselben Werte über diesen Endpunkt
 * leeren und bekam „gespeichert" zurück. Der Dienst weist mit benanntem Grund
 * ab, und der Grund landet über den 303 auf dem Formular — ein 403 als JSON
 * wäre für ein Formular die falsche Antwort.
 *
 * **Ein leeres Feld heisst „löschen", ein FEHLENDES Feld heisst „nicht
 * anfassen".** Deshalb wird hier `daten.has(...)` gefragt und nicht nur der
 * Wert gelesen: ein Teilformular darf die übrigen Angaben nicht mitnehmen.
 *
 * Der Handler bleibt dünn: autorisieren, Dienst rufen, 303 zurück auf die
 * Seite — mit dem Grund, wenn es nicht ging (D-599).
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
  const zurueck = (daten.get('zurueck') as string | null) ?? '/portal';
  const kundeId = String(daten.get('kundeId') ?? '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(kundeId)) {
    return NextResponse.json({ fehler: 'unbekannte_kennung' }, { status: 404 });
  }
  /*
   * `undefined` nur, wenn das Feld GAR NICHT übergeben wurde. Ein leeres Feld
   * kommt als `''` durch und heisst im Dienst „löschen".
   */
  const wert = (name: string): string | undefined =>
    (daten.has(name) ? String(daten.get(name) ?? '').trim() : undefined);

  try {
    await db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung, { recht: 'crm.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        await setzeKondition(kontext, {
          kundeId,
          debitorennummer: wert('debitorennummer'),
          zahlungszielTage: wert('zahlungszielTage'),
          mahnsperreBis: wert('mahnsperreBis'),
          mahnsperreGrund: wert('mahnsperreGrund'),
        });
      }));
  } catch (fehler) {
    if (fehler instanceof CrmFehler) {
      const trenner = zurueck.includes('?') ? '&' : '?';
      return NextResponse.redirect(internesZiel(
        `${zurueck}${trenner}meldung=${encodeURIComponent(fehler.message)}`,
        '/portal', anfrage), 303);
    }
    const autorisierung = autorisierungsAntwort(fehler);
    if (autorisierung !== null) return autorisierung;
    throw fehler;
  }

  const trenner = zurueck.includes('?') ? '&' : '?';
  return NextResponse.redirect(internesZiel(
    `${zurueck}${trenner}erfolg=${encodeURIComponent(
      'Die Konditionen sind gespeichert. Was daraus folgt, steht oben neben jeder '
      + 'Angabe.')}`, '/portal', anfrage), 303);
}
