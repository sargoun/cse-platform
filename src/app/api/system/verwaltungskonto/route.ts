import type postgres from 'postgres';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { withTenant } from '@/server/kontext/index';
import {
  EINLADUNG_COOKIE, EinladungFehler, istEinladbareRolle, ladeVerwaltungskontoEin,
} from '@/server/services/system/verwaltungskonto';

/**
 * `POST /api/system/verwaltungskonto` — ein Verwaltungskonto einladen
 * (AUT-04, D-610, 0372).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Klartext des Einladungslinks geht in einen KEKS, nie in die Adresse.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Ein Token in der URL steht im Browserverlauf, im Zugriffsprotokoll des
 * Servers und in jedem Proxy dazwischen. Der Keks lebt fünf Minuten, gilt nur
 * für DIESE Seite (`path`) und ist `httpOnly` — dasselbe Muster wie beim
 * Kundenzugang (0249) und beim Mitarbeiter-Anmeldecode (D-487). Gespeichert
 * ist ausschliesslich der SHA-256.
 *
 * **Die Rechteprüfung steht zweifach**: hier über `authorize` und noch einmal
 * in `app.verwaltungskonto_einladen` selbst. Das ist kein Überfluss — eine
 * Route, die ihr Recht nur im eigenen Rumpf kennt, ist von aussen nicht
 * prüfbar (AUT-04), und die Definer-Funktion muss auch dann halten, wenn sie
 * einmal von woanders gerufen wird (Invariante 3).
 */
export const dynamic = 'force-dynamic';

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const daten = await anfrage.formData();
  const mandantSlug = (daten.get('zurueck') as string | null)?.split('/')[2] ?? '';
  const seite = `/portal/${mandantSlug}/einstellungen/benutzer/einladen`;

  const rolle = String(daten.get('rolle') ?? '');
  if (!istEinladbareRolle(rolle)) {
    return NextResponse.redirect(internesZiel(
      `${seite}?meldung=${encodeURIComponent(
        'Über diesen Weg werden nur `admin` und `leitung` eingeladen.')}`,
      '/portal', anfrage), 303);
  }

  let ergebnis: { ok: boolean; grund: string; token: string | null };
  try {
    ergebnis = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung, { recht: 'system.verwaltungskonto_erstellen', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        const r = await ladeVerwaltungskontoEin(kontext, {
          mandantId: sitzung.aktiverMandantId as string,
          email: String(daten.get('email') ?? ''),
          name: String(daten.get('name') ?? ''),
          rolle,
        });
        return { ok: r.ok, grund: r.grund, token: r.token };
      })) as Promise<{ ok: boolean; grund: string; token: string | null }>);
  } catch (fehler) {
    if (fehler instanceof EinladungFehler) {
      return NextResponse.redirect(internesZiel(
        `${seite}?meldung=${encodeURIComponent(fehler.message)}`, '/portal', anfrage), 303);
    }
    /*
     * Dieselbe Behandlung wie beim Kundenzugang: die Definer-Funktion wirft
     * `insufficient_privilege` mit einem deutschen Satz (fehlendes Recht,
     * fehlender zweiter Faktor, Gruppenansicht). Den rohen Fehler
     * weiterzuwerfen hiesse „Da ist etwas schiefgegangen" für eine Lage,
     * deren Grund die Datenbank gerade genannt hat.
     */
    const text = (fehler as { message?: string }).message ?? '';
    if (text !== '' && !text.includes('\n')) {
      return NextResponse.redirect(internesZiel(
        `${seite}?meldung=${encodeURIComponent(text)}`, '/portal', anfrage), 303);
    }
    throw fehler;
  }

  const keks = await cookies();
  if (ergebnis.ok && ergebnis.token !== null) {
    keks.set(EINLADUNG_COOKIE, ergebnis.token, {
      httpOnly: true, sameSite: 'lax', path: seite, maxAge: 300,
      secure: process.env.NODE_ENV === 'production',
    });
  } else {
    keks.delete(EINLADUNG_COOKIE);
  }

  return NextResponse.redirect(internesZiel(
    `${seite}?meldung=${encodeURIComponent(ergebnis.grund)}`, '/portal', anfrage), 303);
}
