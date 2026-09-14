import { NextResponse, type NextRequest } from 'next/server';
import { anbieter } from '@/server/auth/kennwort-anmeldung';

/**
 * `GET /auth/callback` — die Rueckleitung des Identitaetsanbieters.
 *
 * **Sie existiert, bevor der Anbieter existiert, und sie tut nichts so, als
 * waere er da.** Supabase Auth ist gesetzt (CLAUDE.md, Stack); ohne
 * `SUPABASE_URL` und Dienstschluessel ist es aber nicht verbunden. Eine
 * Rueckleitung, die in diesem Zustand eine Sitzung ausstellte, waere eine
 * Anmeldung ohne Anbieter — also gar keine.
 *
 * Solange nichts verbunden ist, fuehrt jeder Aufruf zurueck zur Anmeldung mit
 * der Auskunft, dass dieser Weg nicht offen ist. Sobald ein Projekt hinterlegt
 * ist, tauscht genau diese Stelle den `code` gegen eine Sitzung — die
 * Tauschanweisung ist das Einzige, was dann hier dazukommt.
 *
 * TODO(client): O-501 — welches Supabase-Projekt in der EU-Region (Frankfurt),
 * welcher Auftragsverarbeitungsvertrag, und welche Anmeldewege sollen darueber
 * laufen (nur Kennwort, oder auch ein Firmenverzeichnis per SAML/OIDC)?
 */
export function GET(anfrage: NextRequest): NextResponse {
  if (anbieter() === 'demo') {
    const ziel = new URL('/auth/login', anfrage.nextUrl.origin);
    ziel.searchParams.set('fehler', 'fremd');
    return NextResponse.redirect(ziel, 303);
  }

  /**
   * Der verbundene Fall ist bewusst noch KEIN halber Tausch.
   *
   * Ein `exchangeCodeForSession`, das gegen ein nicht eingerichtetes Projekt
   * laeuft, gaebe einen Fehler zurueck, den niemand lesen kann. Sobald O-501
   * beantwortet ist, steht hier der Tausch und die Weiterleitung nach
   * `wegNachAnmeldung` — die Entscheidung darueber, wohin es danach geht,
   * liegt schon in `server/auth/kennwort-anmeldung.ts` und wird nicht doppelt
   * getroffen.
   */
  return NextResponse.json(
    { fehler: 'anbieter_nicht_eingerichtet', offen: 'O-501' },
    { status: 501 },
  );
}
