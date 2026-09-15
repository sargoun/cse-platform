import type { NextRequest, NextResponse } from 'next/server';
import { meldeAb } from '@/server/auth/abmelden';

/**
 * `POST /api/abmelden` — die Sitzung beenden.
 *
 * **POST und nicht GET**, aus demselben Grund, aus dem die Bereichswahl ein
 * Formular ist und kein Verweis: ein GET, das Zustand aendert, laesst sich von
 * einem fremden Bild-Tag, einem Vorauslader oder einem Suchroboter ausloesen.
 * Eine Abmeldung, die jemand anders fuer dich vornehmen kann, ist ein
 * Aergernis; dieselbe Bauart an einer gefaehrlicheren Stelle waere ein Loch.
 *
 * **Zuerst die Zeile, dann der Keks.** Umgekehrt bliebe die Sitzung offen,
 * waehrend der Browser sie vergisst — wer den Token noch hat, waere weiter
 * angemeldet, und niemand saehe es. Die Verbindung laeuft als Eigentuemer, wie
 * beim Ausstellen: der Aufrufer weist sich durch den BESITZ des Tokens aus,
 * nicht durch eine Mitgliedschaft, und genau diese eine Zeile darf er
 * schliessen.
 */

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  /**
   * **Die Arbeit steht in `server/auth/abmelden.ts`**, seit `/auth/abmelden`
   * dieselbe leisten muss (SPEC §3). Zwei Kopien hiessen, dass eine von beiden
   * irgendwann die Zeile offen laesst, waehrend der Browser den Keks vergisst
   * — und niemand saehe es.
   *
   * Das Ziel bleibt die Website: auf diese Adresse zeigen die Formulare der
   * oeffentlichen Seiten, und wer von dort abmeldet, will nicht auf einem
   * Anmeldeformular landen.
   */
  return meldeAb(anfrage, '/');
}
