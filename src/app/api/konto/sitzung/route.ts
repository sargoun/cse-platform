import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { ohneSitzungAntwort } from '@/server/auth/antwort';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { bindePersoenlich } from '@/server/kontext/index';
import { beendeAndereSitzungen, beendeEigeneSitzung, SitzungFehler }
  from '@/server/services/konto/sitzungen';
import type { SitzungFehlerGrund } from '@/lib/i18n/konto';
import { grundAufsFormular } from '../../formular-antwort';

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
 *
 * **Eine Abweisung reist als GRUND** (`?fehler=<grund>`, D-769, D-774). Hier
 * stand der deutsche Satz des Dienstes als `?meldung=`, und die Seite zeigte
 * ihn roh — auch einem Konto mit englischer, arabischer oder türkischer
 * Portalsprache, und jeden Text, den ein präparierter Link mitbrachte. Den
 * Satz hat jetzt die Seite, in der Sprache des Kontos (`SICHERHEIT_TEXTE`).
 *
 * **`sitzung=alle_anderen` beendet jede andere eigene Anmeldung** (V-331) —
 * die laufende bleibt; zurück mit `?beendet=alle`.
 */
export const dynamic = 'force-dynamic';

/** Wohin es ohne `zurueck` geht — die Seite, deren Formular diese Route ruft. */
const SICHERHEIT = '/portal/konto/sicherheit';

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null) {
    return ohneSitzungAntwort(anfrage, sitzung);
  }

  const daten = await anfrage.formData();
  const ziel = String(daten.get('sitzung') ?? '');
  const zurueckRoh = daten.get('zurueck');
  const zurueck = typeof zurueckRoh === 'string' && zurueckRoh !== '' ? zurueckRoh : SICHERHEIT;
  if (ziel === '') {
    return NextResponse.json({ fehler: 'keine_anmeldung' }, { status: 400 });
  }

  const alleAnderen = ziel === 'alle_anderen';
  try {
    await db().begin(async (tx: postgres.TransactionSql) => {
      await bindePersoenlich(tx, sitzung);
      const kontext = {
        abfrage: async <T,>(sql: string, werte: readonly unknown[] = []) =>
          (await tx.unsafe(sql, werte as never[])) as readonly T[],
        schreibe: async <T,>(sql: string, werte: readonly unknown[] = []) =>
          (await tx.unsafe(sql, werte as never[])) as readonly T[],
      } as never;
      if (alleAnderen) {
        await beendeAndereSitzungen(kontext, sitzung.sitzungId);
        return;
      }
      await beendeEigeneSitzung(kontext, ziel, sitzung.sitzungId);
    });
  } catch (fehler) {
    if (fehler instanceof SitzungFehler) {
      /* Der Typ hält Dienst und Satztabelle beieinander: ein neuer Grund ohne Satz bricht hier. */
      const grund: SitzungFehlerGrund = fehler.grund;
      const antwort = grundAufsFormular(anfrage, { json: false, zurueck, grund });
      if (antwort !== null) return antwort;
    }
    throw fehler;
  }

  return NextResponse.redirect(internesZiel(
    `${zurueck}${zurueck.includes('?') ? '&' : '?'}beendet=${alleAnderen ? 'alle' : '1'}`,
    '/portal', anfrage), 303);
}
