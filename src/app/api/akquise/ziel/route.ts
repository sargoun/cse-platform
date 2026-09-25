import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { autorisierungsAntwort } from '@/server/auth/antwort';
import { rechtepruefer } from '@/server/auth/zugang';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { withTenant } from '@/server/kontext/index';
import { AkquiseFehler, markiereGeprueft, verwirf } from '@/server/services/akquise/ziel';
import { uebernehmen } from '@/server/services/akquise/uebernahme';

/**
 * `POST /api/akquise/ziel` — was ein Mensch mit einer recherchierten Firma tun
 * kann (§12).
 *
 * Drei Handlungen, und alle drei sind eine Entscheidung eines Menschen:
 * ansehen, verwerfen (mit Grund) oder in den Vertrieb übernehmen.
 *
 * **Was hier NICHT geht: senden.** Es gibt keinen Zweig, der eine Nachricht
 * hinausschickt — nicht weil er vergessen wurde, sondern weil er nicht
 * hingehört. Der Weg nach draußen führt über `lead_aktivitaet` und dort über
 * `kern.uwg_sendetor`, das gegen den LEBENDEN Kontakt prüft. Eine zweite Tür
 * neben dem Tor wäre der ganze Sinn des Tores.
 *
 * **Die Übernahme läuft in EINER Transaktion**, weil Lead, Rückverknüpfung und
 * Aktivitätenspur zusammengehören — `uebernehmen()` beschreibt, warum.
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
  const mandantId = sitzung.aktiverMandantId;

  const daten = await anfrage.formData();
  const id = String(daten.get('id') ?? '');
  const handlung = String(daten.get('handlung') ?? '');
  const grund = String(daten.get('grund') ?? '');
  const betreff = String(daten.get('betreff') ?? '');

  if (!['ansehen', 'verwerfen', 'uebernehmen'].includes(handlung)) {
    return NextResponse.json({ fehler: 'unbekannte_handlung' }, { status: 400 });
  }

  try {
    await db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          {
            benutzerId: sitzung.benutzerId,
            personId: sitzung.personId,
            aktiverMandantId: mandantId,
            ansicht: sitzung.ansicht,
            aal: sitzung.aal,
            portal: sitzung.portal,
            sitzungId: sitzung.sitzungId,
          },
          { recht: 'crm.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        const abfrage = { unsafe: (s: string, w?: readonly unknown[]) => kontext.abfrage(s, w) };

        if (handlung === 'ansehen') {
          await markiereGeprueft(abfrage, mandantId, id, sitzung.benutzerId);
          return;
        }
        if (handlung === 'verwerfen') {
          await verwirf(abfrage, mandantId, id, grund);
          return;
        }
        /*
         * Der Besitzer ist der, der übernimmt — nicht ein Vorgabekonto. Wer
         * eine Firma in den Vertrieb holt, hat sie sich angesehen; ihm den
         * Vorgang zu geben ist die einzige Zuordnung, die ohne eine erfundene
         * Regel auskommt (O-14 nennt die offene Frist, nicht den Besitzer).
         */
        await uebernehmen(abfrage, mandantId, {
          zielId: id,
          besitzerBenutzerId: sitzung.benutzerId,
          betreff: betreff === '' ? undefined : betreff,
        });
      }));
  } catch (fehler) {
    if (fehler instanceof AkquiseFehler) {
      return NextResponse.json({ fehler: fehler.grund, meldung: fehler.message },
                               { status: 400 });
    }
    const autorisierung = autorisierungsAntwort(fehler);
    if (autorisierung !== null) return autorisierung;
    throw fehler;
  }

  return NextResponse.redirect(
    internesZiel(daten.get('zurueck') as string | null, '/portal', anfrage), 303);
}
