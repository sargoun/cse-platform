import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { istGleicherUrsprung, erwarteterUrsprung } from '@/server/auth/ursprung';
import { bindePersoenlich } from '@/server/kontext/index';
import { db } from '@/server/db/pool';
import { markiereAlleGelesen } from '@/server/benachrichtigung/posteingang';
import { sichererRueckweg } from '@/server/auth/kennwort-anmeldung';

/**
 * `POST /api/benachrichtigungen/gelesen` — alles stempeln (NOT-01).
 *
 * Wie beim Oeffnen: persoenlich, deshalb ohne Rechteschluessel, und POST,
 * weil es Zustand aendert. Der Rueckweg wird geprueft (D-504) — `//fremd.tld`
 * beginnt mit einem Schraegstrich und ist trotzdem eine fremde Adresse.
 */
export const dynamic = 'force-dynamic';

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null) return NextResponse.json({ fehler: 'nicht_angemeldet' }, { status: 401 });

  const formular = await anfrage.formData().catch(() => null);
  const zurueck = sichererRueckweg(formular?.get('zurueck')) ?? '/portal';

  const anzahl = await (db().begin(async (tx: postgres.TransactionSql) => {
    await bindePersoenlich(tx, sitzung);
    const abfrage = async <T>(a: string, w?: readonly unknown[]): Promise<readonly T[]> =>
      (await tx.unsafe(a, (w ?? []) as never[])) as unknown as readonly T[];
    return markiereAlleGelesen({ abfrage, schreibe: abfrage });
  }) as Promise<number>);

  const ziel = new URL(zurueck, erwarteterUrsprung(anfrage));
  ziel.searchParams.set('gelesen', String(anzahl));
  return NextResponse.redirect(ziel, 303);
}
