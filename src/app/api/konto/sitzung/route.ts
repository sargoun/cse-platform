import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { bindePersoenlich } from '@/server/kontext/index';
import { beendeEigeneSitzung, SitzungFehler }
  from '@/server/services/konto/sitzungen';

/**
 * `POST /api/konto/sitzung` — eine EIGENE Anmeldung beenden (V-039, AUT-05).
 *
 * **Kein Rechteschlüssel, und das ist kein Loch.** Wie bei
 * `api/konto/sprache`: §12.4 führt den Zugriff auf das eigene Konto als
 * Selbstzugriff (`S`). Einen Schlüssel zu erfinden, den man anschliessend
 * jeder Rolle bindet, prüfte nichts und behauptete zu prüfen (K-19).
 * `system.sitzung_widerrufen` ist etwas anderes — das Recht, FREMDE
 * Sitzungen zu beenden (V-076).
 *
 * Bewacht wird der Weg dreifach: durch die Sitzung, durch den
 * Ursprungsvergleich und durch `t_sitzung_eigene_schreiben`, die
 * ausschliesslich Zeilen mit `benutzer_id = app.aktueller_benutzer()`
 * zulässt. Die Kennung kommt damit aus der Datenbanksitzung und nie aus einem
 * Feld der Anfrage (K-02, Invariante 3).
 *
 * **`bindePersoenlich` und nicht `withTenant`.** Eine Anmeldung hängt an
 * keinem Mandanten; eine Arbeitersitzung hat per Konstruktion gar keinen.
 */
export const dynamic = 'force-dynamic';

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const daten = await anfrage.formData();
  const ziel = String(daten.get('sitzung') ?? '');
  const zurueck = String(daten.get('zurueck') ?? '/portal/konto/sicherheit');
  if (ziel === '') {
    return NextResponse.json({ fehler: 'keine_anmeldung' }, { status: 400 });
  }

  try {
    await db().begin(async (tx: postgres.TransactionSql) => {
      await bindePersoenlich(tx, sitzung);
      await beendeEigeneSitzung(
        {
          abfrage: async <T,>(sql: string, werte: readonly unknown[] = []) =>
            (await tx.unsafe(sql, werte as never[])) as readonly T[],
          schreibe: async <T,>(sql: string, werte: readonly unknown[] = []) =>
            (await tx.unsafe(sql, werte as never[])) as readonly T[],
        } as never,
        ziel, sitzung.sitzungId,
      );
    });
  } catch (fehler) {
    if (fehler instanceof SitzungFehler) {
      const trenner = zurueck.includes('?') ? '&' : '?';
      return NextResponse.redirect(internesZiel(
        `${zurueck}${trenner}meldung=${encodeURIComponent(fehler.message)}`,
        '/portal', anfrage), 303);
    }
    throw fehler;
  }

  return NextResponse.redirect(internesZiel(
    `${zurueck}${zurueck.includes('?') ? '&' : '?'}beendet=1`, '/portal', anfrage), 303);
}
