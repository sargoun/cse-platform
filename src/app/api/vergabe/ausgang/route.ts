import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { withTenant } from '@/server/kontext/index';
import { GeldFehler, parseGeld } from '@/server/services/finanz/geld';
import {
  AUSGAENGE, EinreichungFehler, erfasseAusgang, type Ausgang,
} from '@/server/services/vergabe/einreichung';
import { alsAntwort } from '../../sicherheit/antwort';

/**
 * `POST /api/vergabe/ausgang` — wie das Verfahren ausgegangen ist (REP-06).
 *
 * **Drei Ausgänge und kein vierter**: Zuschlag, nicht berücksichtigt,
 * Verfahren aufgehoben. Das sind die Enden eines deutschen Vergabeverfahrens,
 * keine erfundene Sortierung — und ohne sie ist „gefunden · geprüft · geboten
 * · gewonnen" nicht zu rechnen.
 *
 * **Der Auftragswert geht durch `parseGeld`**, wie jeder Betrag dieser
 * Plattform: ganze Cent, nie Gleitkomma (Invariante 1). Ein Zuschlagswert ist
 * die Zahl, an der später die Auslastungsrechnung hängt.
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function text(daten: FormData, feld: string): string | null {
  const wert = daten.get(feld);
  return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : null;
}

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
  const ausgang = text(daten, 'ausgang') ?? '';
  if (!UUID.test(ausschreibung)) {
    return NextResponse.json({ fehler: 'unbekannte_bekanntmachung' }, { status: 400 });
  }
  const seite = `/portal/${mandant}/radar/${ausschreibung}/mappe`;
  const zurueck = (schluessel: string): NextResponse => NextResponse.redirect(
    internesZiel(`${seite}?fehler=${schluessel}`, seite, anfrage), 303);

  if (!(AUSGAENGE as readonly string[]).includes(ausgang)) return zurueck('ausgang');

  let wert: bigint | null = null;
  const wertRoh = text(daten, 'wert');
  if (wertRoh !== null) {
    try {
      wert = parseGeld(wertRoh);
    } catch (fehler) {
      if (fehler instanceof GeldFehler) return zurueck('wert');
      throw fehler;
    }
  }

  try {
    await db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung, { recht: 'vergabe.einreichung_erfassen', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        await erfasseAusgang(kontext, {
          ausschreibungId: ausschreibung,
          ausgang: ausgang as Ausgang,
          entschiedenAm: text(daten, 'entschieden_am') ?? '',
          zuschlagswertCent: wert,
          notiz: text(daten, 'notiz'),
        });
      }));
  } catch (fehler) {
    if (fehler instanceof EinreichungFehler) {
      return zurueck(fehler.code === 'stand' ? 'ausgang_ohne_einreichung' : 'ausgang_eingabe');
    }
    const antwort = alsAntwort(fehler);
    if (antwort !== null) return antwort;
    throw fehler;
  }

  return NextResponse.redirect(
    internesZiel(`${seite}?vermerkt=ausgang`, seite, anfrage), 303);
}
