import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { withTenant } from '@/server/kontext/index';
import { CrmFehler } from '@/server/services/crm/anlegen';
import { setzeKondition } from '@/server/services/crm/kondition';

/**
 * `POST /api/crm/kunde/konditionen` — Debitorennummer, Zahlungsziel und
 * Mahnsperre setzen (CRM-01, FIN-15, K-05).
 *
 * **Das Recht hier ist `crm.schreiben`, nicht `crm_entgelt.lesen`.** Die
 * Seite davor öffnet mit dem Leserecht der Kondition; geschrieben wird der
 * Kundenstamm, und dafür gilt die `WITH CHECK`-Klausel von `t_mandant`. Wer
 * eine Zahl sehen darf, darf sie nicht schon setzen.
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
  const wert = (name: string): string | undefined => {
    const t = String(daten.get(name) ?? '').trim();
    return t === '' ? undefined : t;
  };

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
    throw fehler;
  }

  const trenner = zurueck.includes('?') ? '&' : '?';
  return NextResponse.redirect(internesZiel(
    `${zurueck}${trenner}erfolg=${encodeURIComponent(
      'Die Konditionen sind gespeichert. Was daraus folgt, steht oben neben jeder '
      + 'Angabe.')}`, '/portal', anfrage), 303);
}
