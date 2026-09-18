import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { withTenant } from '@/server/kontext/index';
import { CrmFehler } from '@/server/services/crm/anlegen';
import { erledige, legeWiedervorlageAn, verschiebe }
  from '@/server/services/crm/wiedervorlage';

/**
 * `POST /api/crm/wiedervorlage` — erledigen, verschieben, anlegen (CRM-04).
 *
 * **Drei Vorgänge, ein Recht (`crm.schreiben`), ein Handler.** Sie stehen auf
 * derselben Liste und gehören demselben Menschen; drei Pfade wären dreimal
 * dieselbe Wache.
 *
 * **`anlegen` schreibt in drei Tabellen** — `lead_aktivitaet`, `aufgabe`,
 * `kalender_eintrag` — und nennt in der Rückmeldung, was davon NICHT entstand.
 * Eine Wiedervorlage, die in der Aufgabenliste fehlt, ohne dass jemand es
 * weiss, ist schlimmer als eine, die nur an einer Stelle steht (O-663).
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
  const zurueck = (daten.get('zurueck') as string | null) ?? '/portal';
  const was = String(daten.get('was') ?? '');
  if (!['erledigt', 'verschieben', 'anlegen'].includes(was)) {
    return NextResponse.json({ fehler: 'unbekannter_vorgang' }, { status: 400 });
  }
  const wert = (name: string): string | undefined => {
    const t = String(daten.get(name) ?? '').trim();
    return t === '' ? undefined : t;
  };

  let meldung = 'Gespeichert.';
  try {
    meldung = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung, { recht: 'crm.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        if (was === 'anlegen') {
          const spiegel = await legeWiedervorlageAn(kontext, {
            betreff: String(daten.get('betreff') ?? ''),
            notiz: wert('notiz'),
            faelligAm: String(daten.get('faelligAm') ?? ''),
            erinnerungAm: wert('erinnerungAm'),
            leadId: wert('leadId'),
            kundeId: wert('kundeId'),
            ansprechpartnerId: wert('ansprechpartnerId'),
            zustaendigBenutzerId: wert('zustaendigBenutzerId'),
          });
          const nicht = spiegel.nichtGespiegelt;
          return nicht.length === 0
            ? 'Die Wiedervorlage steht — in der Liste, in den Aufgaben und im Kalender.'
            : `Die Wiedervorlage steht. ${nicht.join(' ')}`;
        }

        const id = String(daten.get('id') ?? '');
        if (!UUID.test(id)) {
          throw new CrmFehler('Diese Wiedervorlage gibt es nicht.', 'nicht_gefunden', 404);
        }

        if (was === 'erledigt') {
          await erledige(kontext, id);
          return 'Erledigt — mit der Serverzeit gestempelt.';
        }

        await verschiebe(
          kontext, id, String(daten.get('faelligAm') ?? ''),
          String(daten.get('grund') ?? ''));
        return 'Verschoben. Der Grund steht als Notiz im Verlauf.';
      })) as Promise<string>);
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
    `${zurueck}${trenner}erfolg=${encodeURIComponent(meldung)}`, '/portal', anfrage), 303);
}
