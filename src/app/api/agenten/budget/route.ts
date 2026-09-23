import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { withTenant } from '@/server/kontext/index';
import { BudgetFehler, setzeBudget } from '@/server/services/agent/budget-pflege';

/**
 * `POST /api/agenten/budget` — die Obergrenze eines Monats setzen (V-015,
 * AGT-05).
 *
 * **`agent.budget_verwalten`, ausdrücklich NICHT `agent.aufgabe_starten`.**
 * Das zweite hält auch eine `leitung`; wer damit auch die Obergrenze setzen
 * dürfte, verstellte seine eigene Grenze. `0385` zieht die Schreibpolicy auf
 * `agent_budget` auf dasselbe Recht nach — die Route prüft es, damit der
 * Mensch einen Satz bekommt statt „null Zeilen betroffen".
 */
export const dynamic = 'force-dynamic';

const RECHT = 'agent.budget_verwalten';
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
  const feld = (name: string): string => {
    const wert = daten.get(name);
    return typeof wert === 'string' ? wert.trim() : '';
  };
  const mandant = feld('mandant').replace(/[^a-z0-9-]/gu, '');
  const seite = `/portal/${mandant}/agenten/budget`;
  const agent = feld('agent');
  const bereich = agent === '' ? 'mandant' as const : 'agent' as const;
  const schwelleRoh = feld('warnschwelle');

  if (bereich === 'agent' && !UUID.test(agent)) {
    return NextResponse.json({ fehler: 'kein_agent' }, { status: 400 });
  }

  const zurueck = (hinweis: string | null): NextResponse => {
    const ziel = new URL(internesZiel(seite, '/portal', anfrage));
    if (hinweis !== null) ziel.searchParams.set('fehler', hinweis);
    else ziel.searchParams.set('gesetzt', '1');
    return NextResponse.redirect(ziel, 303);
  };

  try {
    await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung, { recht: RECHT, schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        return setzeBudget(kontext, {
          bereich,
          agentId: bereich === 'agent' ? agent : null,
          jahr: Number(feld('jahr')),
          monat: Number(feld('monat')),
          budgetEuro: feld('budget'),
          stoppBeiUeberschreitung: daten.get('stopp') !== null,
          warnschwelleProzent: schwelleRoh === '' ? null : Number(schwelleRoh),
        });
      })));
  } catch (fehler) {
    if (fehler instanceof BudgetFehler) return zurueck(fehler.grund);
    throw fehler;
  }
  return zurueck(null);
}
