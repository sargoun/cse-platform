import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler }
  from '@/server/auth/fehler';
import { withTenant } from '@/server/kontext/index';
import { sageZuordnungAb } from '@/server/services/dienstplan/einteilung';

/**
 * `POST /api/einsaetze/[id]/absagen` — eine Einteilung absagen (R-08).
 *
 * **Absagen ist nicht löschen.** Die Zeile bleibt mit Grund und Zeitpunkt
 * stehen (Invariante 8): wer eingeteilt war und warum er es nicht mehr ist,
 * ist genau die Frage, die im Streit gestellt wird. Der Auslöser
 * `checkin_token_widerrufen` zieht dabei die ausgegebenen Check-in-Marken
 * zurück — eine Marke, die auf eine abgesagte Einteilung zeigt, wäre ein
 * offenes Stechuhr-Fenster ohne Grundlage.
 *
 * Der Pfadparameter ist die SCHICHT; welche Einteilung gemeint ist, steht im
 * Formular. Damit bleibt die Route dort, wo die API-Karte sie führt, und der
 * Rückweg zeigt auf dieselbe Schicht.
 */
export const dynamic = 'force-dynamic';

export async function POST(
  anfrage: NextRequest, kontextParam: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const { id: einsatzId } = await kontextParam.params;
  const daten = await anfrage.formData();
  const zuordnung = daten.get('zuordnung');
  const grund = daten.get('grund');
  if (typeof zuordnung !== 'string' || zuordnung === '') {
    return NextResponse.json({ fehler: 'keine_zuordnung' }, { status: 400 });
  }
  if (typeof grund !== 'string' || grund.trim() === '') {
    return NextResponse.json({ fehler: 'kein_grund' }, { status: 400 });
  }

  try {
    await db().begin(async (tx: postgres.TransactionSql) =>
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
          { recht: 'dienstplan.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        await sageZuordnungAb(kontext, zuordnung, grund);
      }));
  } catch (fehler) {
    if (fehler instanceof NichtGefundenFehler) {
      return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
    }
    if (fehler instanceof NichtAngemeldetFehler) {
      return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
    }
    if (fehler instanceof ZweiterFaktorFehler) {
      return NextResponse.json({ fehler: 'zweiter_faktor' }, { status: 403 });
    }
    const status = (fehler as { status?: number }).status;
    const code = (fehler as { code?: string }).code;
    if (typeof status === 'number' && typeof code === 'string') {
      return NextResponse.json({ fehler: code }, { status });
    }
    throw fehler;
  }

  const mandant = String(daten.get('mandant') ?? '');
  return NextResponse.redirect(
    internesZiel(
      daten.get('zurueck') as string | null,
      `/portal/${mandant}/dienstplan/einsatz/${einsatzId}`, anfrage),
    303,
  );
}
