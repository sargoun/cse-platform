import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { autorisierungsAntwort } from '@/server/auth/antwort';
import { rechtepruefer } from '@/server/auth/zugang';
import { withTenant } from '@/server/kontext/index';
import { WerkzeugPflegeFehler, setzeWerkzeug } from '@/server/services/agent/werkzeug-pflege';
import { slugFuer } from '../../../portal/[mandant]/agenten/kennung';

/**
 * `POST /api/agenten/werkzeug` — ein Werkzeug für einen Agenten in dieser
 * Gesellschaft ein- oder ausschalten (AGT-01, AGT-02, V-228, D-722).
 *
 * **`agent.werkzeug_verbinden`**, dasselbe Recht wie die Schreibpolicy
 * `t_werkzeug_schreiben` (0150). Die Route prüft es, damit der Mensch einen
 * Satz bekommt statt „null Zeilen betroffen".
 *
 * **Der Bereich kommt aus der Sitzung** (Invariante 3): das Formular schickt
 * nur Agent, Werkzeug und die zwei Schalter. Der Rückweg ist das Blatt des
 * Agenten in der aktiven Gesellschaft — ein Browserformular bekommt immer eine
 * Seite mit einer Meldung, nie JSON (D-599).
 */
export const dynamic = 'force-dynamic';

const RECHT = 'agent.werkzeug_verbinden';
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
  const agentId = feld('agent');
  const werkzeug = feld('werkzeug');

  /*
   * Der Rückweg entsteht IN der Transaktion (Slug und Agent aus der Sitzung)
   * und wird hier festgehalten: ein abgewiesener Wunsch wirft, die
   * Transaktion rollt zurück, und der Mensch landet trotzdem auf seinem Blatt.
   */
  let seite = '/portal';
  const zurueck = (grund: string | null): NextResponse => {
    const ziel = new URL(internesZiel(seite, '/portal', anfrage));
    if (grund === null) ziel.searchParams.set('werkzeug', 'gesetzt');
    else ziel.searchParams.set('werkzeug_fehler', grund);
    ziel.hash = 'werkzeuge';
    return NextResponse.redirect(ziel, 303);
  };

  try {
    await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung, { recht: RECHT, schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        const gueltig = UUID.test(agentId);
        const [bereich] = await kontext.abfrage<{ slug: string; kennung: string | null }>(
          `select m.slug,
                  (select a.kennung::text from agent a where a.id = $1::uuid) as kennung
             from mandant m where m.id = app.aktiver_mandant()`,
          [gueltig ? agentId : null]);
        if (bereich !== undefined) {
          seite = `/portal/${bereich.slug}/agenten`
            + (bereich.kennung === null ? '' : `/${slugFuer(bereich.kennung)}`);
        }
        if (!gueltig) {
          throw new WerkzeugPflegeFehler('Diesen Agenten gibt es nicht.', 'kein_agent', 404);
        }
        await setzeWerkzeug(kontext, {
          agentId,
          werkzeug,
          istAktiv: daten.get('aktiv') !== null,
          erfordertFreigabe: daten.get('freigabe') !== null,
        });
      })));
    return zurueck(null);
  } catch (fehler) {
    if (fehler instanceof WerkzeugPflegeFehler) return zurueck(fehler.grund);
    const autorisierung = autorisierungsAntwort(fehler);
    if (autorisierung !== null) return autorisierung;
    throw fehler;
  }
}
