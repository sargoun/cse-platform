import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { withPersonScope, withTenant, type Sitzung } from '@/server/kontext/index';
import { findeBestaetigungsziel } from '@/server/services/mitarbeiter/dienstanweisungen';
import {
  bestaetigeKenntnisnahme, istDaSprache,
} from '@/server/services/security/dienstanweisung';

/**
 * `POST /api/mein/dienstanweisungen/[id]/kenntnisnahme` — die Wache bestätigt
 * mit EINEM Tipp (EMP-09, SEC-06, Abnahme 2).
 *
 * **Kein Rechteschlüssel, und das ist kein Loch.** Die Rolle `mitarbeiter`
 * hält `dienstanweisung.schreiben` nicht (03-AUTH §12.3), und K-19 verbietet,
 * einen neuen Schlüssel dafür zu erfinden: er müsste jeder Mitarbeiterrolle
 * gebunden werden, also nichts prüfen und dabei behaupten, man prüfe. Bewacht
 * wird der Weg vierfach:
 *
 *  1. durch die Sitzung und den Ursprungsvergleich,
 *  2. durch den serverseitig aufgelösten Mandanten — er kommt aus der
 *     Dienstanweisung, nie aus einem Feld der Anfrage (K-02, Invariante 3),
 *  3. durch die Policy `t_selbst_bestaetigen` auf `da_kenntnisnahme`, die nur
 *     Zeilen zulässt, deren Beschäftigung dem angemeldeten Menschen gehört,
 *     plus die restriktive K-04-Mitarbeiterdecke darüber,
 *  4. durch `t_person` im Personen-Scope: eine Anweisung eines Objekts, auf
 *     dem dieser Mensch nicht eingesetzt ist, liefert dort null Zeilen — also
 *     404 und nicht 403 (AUT-06).
 *
 * **Der Umweg über zwei Scopes ist der Punkt** (K-18): im Personen-Scope ist
 * `app.aktiver_mandant()` NULL, und keine Schreibpolicy träfe zu. Also erst
 * die Anweisung im Personen-Scope auflösen, dann `withTenant` mit genau
 * diesem Mandanten betreten, mit `portal: 'mitarbeiter'`, damit die Decke
 * weiter gilt. Dieselbe Bauart wie `POST /api/mein/antraege`.
 *
 * **Die Beschäftigung steht in KEINEM Formularfeld.** Sie wird in
 * `bestaetigeKenntnisnahme` aus der Sitzung aufgelöst — eine `anstellung_id`
 * aus dem Browser wäre eine Unterschrift, die jemand einem Kollegen
 * unterschiebt.
 *
 * **303 und kein JSON.** Das Formular ist ein echtes `<form method="post">`,
 * damit es auf einem alten Diensttelefon ohne JavaScript funktioniert; eine
 * JSON-Antwort wäre dort eine Sackgasse.
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function uuidOder(daten: FormData, feld: string): string | null {
  const wert = daten.get(feld);
  const text = typeof wert === 'string' ? wert.trim() : '';
  // Ein Wert, der keine id ist, wird VERWORFEN und nicht durchgereicht: die
  // Datenbank soll ihn gar nicht erst sehen.
  return UUID.test(text) ? text : null;
}

export async function POST(
  anfrage: NextRequest,
  kontextParam: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }
  if (sitzung.personId === null || sitzung.personId === '') {
    // Ein Konto ohne Person hat keine Beschaeftigung — und damit nichts zu
    // bestaetigen.
    return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
  }

  const { id } = await kontextParam.params;
  const daten = await anfrage.formData();
  const versionId = uuidOder(daten, 'fassung');
  if (versionId === null) {
    return NextResponse.json({ fehler: 'keine_fassung' }, { status: 400 });
  }
  const spracheRoh = daten.get('sprache');
  const sprache = istDaSprache(spracheRoh) ? spracheRoh : null;
  const geraeteZeit = daten.get('geraete_zeit');

  try {
    await db().begin(async (tx: postgres.TransactionSql) => {
      const ziel = await withPersonScope(tx, sitzung, async (kontext) =>
        findeBestaetigungsziel(kontext, id, versionId));
      if (ziel === null) {
        throw Object.assign(new Error('Diese Dienstanweisung gibt es für Sie nicht.'), {
          code: 'nicht_gefunden', status: 404,
        });
      }
      if (!ziel.istAktiv) {
        /**
         * Das alte Formular. Zwischen dem Laden der Seite und dem Tipp wurde
         * eine neue Fassung freigegeben; eine Bestaetigung der alten waere
         * eine Unterschrift unter einen Text, der nicht mehr gilt — und die
         * Ableitung wiese sie im selben Atemzug als veraltet aus.
         */
        throw Object.assign(new Error(
          'Es gibt inzwischen eine neuere Fassung. Bitte laden Sie die Seite neu '
          + 'und bestätigen Sie den Text, der jetzt gilt.',
        ), { code: 'ungueltiger_zustand', status: 409 });
      }

      const imMandanten: Sitzung = {
        ...sitzung,
        ansicht: 'mandant',
        aktiverMandantId: ziel.mandantId,
        portal: 'mitarbeiter',
      };
      return withTenant(tx, imMandanten, async (kontext) =>
        bestaetigeKenntnisnahme(kontext, {
          versionId: ziel.versionId,
          art: 'portal_klick',
          /**
           * Die Geräteuhr als BEHAUPTUNG (TIM-08). Sie wird gespeichert und
           * ihre Abweichung abgeleitet; massgeblich ist die Serveruhr, und die
           * stempelt der Auslöser.
           */
          geraeteZeit: typeof geraeteZeit === 'string' && geraeteZeit !== ''
            ? geraeteZeit : null,
          // In WELCHER Sprache der Text auf dem Bildschirm stand (EMP-12).
          sprache,
        }));
    });
  } catch (fehler) {
    const status = (fehler as { status?: number }).status;
    const code = (fehler as { code?: string }).code;
    if (typeof status === 'number' && typeof code === 'string') {
      return NextResponse.json(
        { fehler: code, meldung: (fehler as Error).message }, { status });
    }
    throw fehler;
  }

  return NextResponse.redirect(
    internesZiel(
      daten.get('zurueck') as string | null,
      '/portal/mein/dienstanweisungen',
      anfrage,
    ),
    303,
  );
}
