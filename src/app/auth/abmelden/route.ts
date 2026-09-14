import type { NextRequest, NextResponse } from 'next/server';
import { meldeAb } from '@/server/auth/abmelden';

/**
 * `POST /auth/abmelden` — die Sitzung beenden und zurueck zur Anmeldung.
 *
 * **POST und nicht GET**, aus demselben Grund wie ueberall sonst: ein GET, das
 * Zustand aendert, laesst sich von einem fremden Bild-Tag, einem Vorauslader
 * oder einem Suchroboter ausloesen.
 *
 * Kein `GET`-Export: eine Adresse, die auf GET mit „Methode nicht erlaubt"
 * antwortet, sagt genau das Richtige — ein Redirect waere ein zweiter Weg
 * hinein.
 */
export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  return meldeAb(anfrage, '/auth/login?abgemeldet=1');
}
