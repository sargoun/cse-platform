import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { withTenant } from '@/server/kontext/index';
import { fuehreLaufAus, type AgentKennung } from '@/server/agent/orchestrator';
import { ENTWURF_AUFTRAEGE } from '@/server/agent/auftraege';
import { alsAntwort } from '../../sicherheit/antwort';

/**
 * `POST /api/agenten/lauf` — einen Agenten laufen lassen (AGT-01, §4).
 *
 * **Der Knopf legt VOR, er sendet nicht.** Am Ende des Laufs steht eine
 * `freigabe` mit Status `offen` im Posteingang; was daraus wird, entscheidet
 * ein Mensch (Invariante 7). Deshalb verlangt diese Route auch nicht das
 * Recht, etwas zu senden, sondern `agent.starten` — und der Posteingang
 * verlangt danach sein eigenes.
 *
 * **Und sie wählt den Auftrag nicht frei.** Was ein Agent formulieren darf,
 * steht in `server/agent/auftraege.ts`: Vorlage, Vorgangsart und die Frage,
 * woher die Tatsachen kommen. Ein Rumpf, der eine beliebige Vorlage mitgäbe,
 * wäre ein Weg, das Modell an den Diensten vorbei zu füttern.
 */
export const dynamic = 'force-dynamic';

function codeVersion(): string {
  return process.env['VERCEL_GIT_COMMIT_SHA'] ?? process.env['CSE_CODE_VERSION'] ?? 'entwicklung';
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
  const mandant = (String(daten.get('mandant') ?? '')).replace(/[^a-z0-9-]/gu, '');
  const agent = String(daten.get('agent') ?? '') as AgentKennung;
  const seite = `/portal/${mandant}/agenten/${agent}`;

  const auftrag = ENTWURF_AUFTRAEGE[agent];
  if (auftrag === undefined) {
    return NextResponse.json({ fehler: 'unbekannter_agent' }, { status: 400 });
  }

  try {
    const ergebnis = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(sitzung, { recht: 'agent.aufgabe_starten', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)));
        return fuehreLaufAus(kontext, {
          ...auftrag,
          agent,
          angefordertVon: sitzung.benutzerId,
          codeVersion: codeVersion(),
        });
      }))) as Awaited<ReturnType<typeof fuehreLaufAus>>;

    /*
     * Drei Ausgänge, drei Sätze — und der gestörte ist einer davon, kein
     * Absturz: „kein Modell freigegeben" ist ein Betriebszustand (§8).
     */
    const ziel = ergebnis.gestoert !== null
      ? `${seite}?lauf=gestoert&code=${encodeURIComponent(ergebnis.gestoert.code)}`
      : ergebnis.bestand
        ? `${seite}?lauf=bestand`
        : `${seite}?lauf=vorgelegt&freigabe=${String(ergebnis.freigabeId)}`;
    return NextResponse.redirect(internesZiel(ziel, seite, anfrage), 303);
  } catch (fehler) {
    const antwort = alsAntwort(fehler);
    if (antwort !== null) return antwort;
    throw fehler;
  }
}
