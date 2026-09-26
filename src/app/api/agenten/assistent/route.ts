import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { autorisierungsAntwort } from '@/server/auth/antwort';
import { rechtepruefer } from '@/server/auth/zugang';
import { withTenant } from '@/server/kontext/index';
import { AssistentFehler, beantworteFrage } from '@/server/services/agent/assistent';
import { AgentInaktiv } from '@/server/agent/laufzeit';

/**
 * `POST /api/agenten/assistent` — eine Katalogfrage an den CEO-Assistenten,
 * beantwortet und als Aufgabe mit Schritt protokolliert (AGT-04, AGT-07,
 * V-229, D-723).
 *
 * **Das Recht der Seite: `agent.aufgabe_starten`** (die Seite verlangt
 * zusätzlich `agent.lesen`, und die Schreibpolicy `t_mandant` auf
 * `agent_aufgabe` fragt genau dieses Recht). Die Antwort entsteht in der
 * Sitzung des Fragenden; der Bereich kommt aus der Sitzung (Invariante 3).
 *
 * **Ein Browserformular bekommt eine Seite** (D-599): 303 zurück auf den
 * Assistenten mit `?aufgabe=`, und die Seite zeigt die Antwort der
 * protokollierten Aufgabe. Ein abgewiesener Wunsch kommt als `?fehler=`
 * zurück, nicht als JSON.
 */
export const dynamic = 'force-dynamic';

const RECHT = 'agent.aufgabe_starten';

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

  let seite = '/portal';
  const zurueck = (art: 'aufgabe' | 'fehler', wert: string): NextResponse => {
    const ziel = new URL(internesZiel(seite, '/portal', anfrage));
    ziel.searchParams.set(art, wert);
    return NextResponse.redirect(ziel, 303);
  };

  try {
    const ergebnis = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung, { recht: RECHT, schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        const [bereich] = await kontext.abfrage<{ slug: string }>(
          `select m.slug from mandant m where m.id = app.aktiver_mandant()`);
        if (bereich !== undefined) seite = `/portal/${bereich.slug}/agenten/assistent`;
        return beantworteFrage(kontext, {
          abfrageId: feld('frage'),
          schluessel: feld('schluessel'),
          angefordertVon: sitzung.benutzerId,
        });
      }))) as Awaited<ReturnType<typeof beantworteFrage>>;
    return zurueck('aufgabe', ergebnis.aufgabeId);
  } catch (fehler) {
    if (fehler instanceof AssistentFehler) return zurueck('fehler', fehler.grund);
    /* Ein abgeschalteter Agent antwortet nicht — auch nicht auf eine Katalogfrage (AGT-01). */
    if (fehler instanceof AgentInaktiv) return zurueck('fehler', 'agent_aus');
    const autorisierung = autorisierungsAntwort(fehler);
    if (autorisierung !== null) return autorisierung;
    throw fehler;
  }
}
