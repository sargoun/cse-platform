import { devFlaechenAn } from '@/lib/dev-flaechen';

/**
 * Was eine Portalseite ohne Sitzung zeigt.
 *
 * **Kein 404.** Ein 404 hiesse "diese Seite gibt es nicht", und das ist die
 * falsche Auskunft: es gibt sie, man ist nur nicht angemeldet. AUT-06 verlangt
 * 404 fuer FREMDE Zeilen — nicht fuer die eigene Anmeldung.
 *
 * Die echte Anmeldung (Telefon + Einmalcode) kommt mit PR 20. Bis dahin steht
 * hier, was ist: kein erfundenes Formular, das nichts tut.
 */
export function AnmeldungNoetig() {
  return (
    <main className="mx-auto flex max-w-content flex-col gap-s4 p-s6">
      <h1 className="text-h1 text-text">Anmeldung erforderlich</h1>
      <p className="max-w-[72ch] text-base text-text-muted">
        Diese Seite gehört zum Portal. Die Anmeldung mit Telefonnummer und
        Einmalcode wird gerade gebaut (PR 20); bis dahin gibt es hier kein
        Formular, das so aussähe, als würde es etwas tun.
      </p>
      {devFlaechenAn() && (
        <p className="text-base text-text">
          <a className="underline" href="/dev/anmelden">
            Entwicklungsanmeldung — Konto wählen
          </a>
        </p>
      )}
    </main>
  );
}
