import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { istGleicherUrsprung, erwarteterUrsprung } from '@/server/auth/ursprung';
import { bindePersoenlich } from '@/server/kontext/index';
import { db } from '@/server/db/pool';
import { setzePraeferenz } from '@/server/benachrichtigung/posteingang';
import { alleArten } from '@/server/benachrichtigung/bootstrap';
import { sichererRueckweg } from '@/server/auth/kennwort-anmeldung';
import type { Kanal } from '@/server/benachrichtigung/registry';

/**
 * `POST /api/benachrichtigungen/praeferenz` — die Kanäle je Art (NOT-02).
 *
 * **Das ganze Formular auf einmal.** Ein Kästchen, das einzeln sendet,
 * bräuchte JavaScript; ohne davon wäre die Einstellung nicht bedienbar. Was
 * NICHT im Rumpf steht, ist abgewählt — genau die Semantik eines
 * HTML-Formulars mit Kontrollkästchen.
 *
 * **Die Arten kommen aus dem Register, nicht aus dem Rumpf.** Sonst liesse
 * sich eine Zeile für eine Art schreiben, die es nicht gibt: sie stünde für
 * immer in der Tabelle und beeinflusste nichts.
 *
 * Kein Rechteschlüssel: es sind die eigenen Einstellungen.
 * `t_praeferenz_eigene` bindet sie an `app.aktueller_benutzer()`.
 */
export const dynamic = 'force-dynamic';

const KANAELE: readonly Kanal[] = ['app', 'email'];

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null) return NextResponse.json({ fehler: 'nicht_angemeldet' }, { status: 401 });

  const formular = await anfrage.formData().catch(() => null);
  if (formular === null) return NextResponse.json({ fehler: 'kein_formular' }, { status: 400 });
  const zurueck = sichererRueckweg(formular.get('zurueck')) ?? '/portal';

  const definitionen = alleArten();

  await db().begin(async (tx: postgres.TransactionSql) => {
    await bindePersoenlich(tx, sitzung);
    const abfrage = async <T>(a: string, w?: readonly unknown[]): Promise<readonly T[]> =>
      (await tx.unsafe(a, (w ?? []) as never[])) as unknown as readonly T[];
    const kontext = { abfrage, schreibe: abfrage };

    for (const art of definitionen) {
      const gewaehlt = KANAELE.filter(
        (k) => formular.get(`kanal:${art.schluessel}:${k}`) !== null,
      );
      await setzePraeferenz(kontext, art.schluessel, gewaehlt, art.kanaeleVorgabe);
    }
  });

  const ziel = new URL(zurueck, erwarteterUrsprung(anfrage));
  ziel.searchParams.set('gespeichert', '1');
  return NextResponse.redirect(ziel, 303);
}
