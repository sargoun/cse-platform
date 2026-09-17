import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { withTenant } from '@/server/kontext/index';
import { CrmFehler, legeLeadAn, setzeLeadStatus } from '@/server/services/crm/anlegen';

/**
 * `POST /api/crm/lead` — einen Lead anlegen oder seinen Stand ändern (CRM-02,
 * CRM-07).
 *
 * **Der Besitzer ist, wer anlegt.** Kein Auswahlfeld und kein Vorgabekonto: wer
 * einen Lead einträgt, hat das Gespräch geführt. Ein Vorgabebesitzer wäre eine
 * Zuweisung, die niemand getroffen hat — und ein Lead, für den sich niemand
 * zuständig fühlt, ist ein verlorener.
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
  const wert = (name: string): string | undefined => {
    const t = String(daten.get(name) ?? '').trim();
    return t === '' ? undefined : t;
  };

  let ziel = zurueck;
  try {
    ziel = await db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          {
            benutzerId: sitzung.benutzerId,
            personId: sitzung.personId,
            aktiverMandantId: sitzung.aktiverMandantId,
            ansicht: sitzung.ansicht,
            aal: sitzung.aal,
            portal: sitzung.portal,
            sitzungId: sitzung.sitzungId,
          },
          { recht: 'crm.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        const status = wert('status');
        if (status !== undefined) {
          await setzeLeadStatus(kontext, String(daten.get('id') ?? ''), status,
                                wert('grund'));
          return zurueck;
        }

        const neu = await legeLeadAn(kontext, {
          betreff: String(daten.get('betreff') ?? ''),
          firmaName: wert('firmaName'),
          kundeId: wert('kundeId'),
          bedarf: wert('bedarf'),
          besitzerBenutzerId: sitzung.benutzerId,
        });
        const bereich = zurueck.split('/')[2] ?? '';
        return `/portal/${bereich}/crm/leads/${neu.id}`;
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

  return NextResponse.redirect(internesZiel(ziel, '/portal', anfrage), 303);
}
