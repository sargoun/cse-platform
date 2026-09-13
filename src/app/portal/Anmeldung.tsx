import { devFlaechenAn } from '@/lib/dev-flaechen';

/**
 * Was eine Portalseite ohne Sitzung zeigt.
 *
 * **Kein 404.** Ein 404 hiesse "diese Seite gibt es nicht", und das ist die
 * falsche Auskunft: es gibt sie, man ist nur nicht angemeldet. AUT-06 verlangt
 * 404 fuer FREMDE Zeilen — nicht fuer die eigene Anmeldung.
 *
 * **Der Weg zur Anmeldung steht hier — und er ist echt.** Diese Seite sagte
 * bis D-421 „die Anmeldung wird gerade gebaut (PR 20)", und PR 20 war laengst
 * da: `/auth/mitarbeiter` nimmt Mobilnummer und Einmalcode entgegen (EMP-01).
 * Wer aus einem gespeicherten Portallink hierher kam, las also, es gebe keine
 * Anmeldung, und hatte keinen Verweis — eine Sackgasse mit veraltetem Text.
 *
 * Die uebrigen Rollen (Verwaltung, Leitung, Kunden) bekommen ihren Eingang mit
 * `/auth/login` (AUT-01, AUT-02); bis dahin steht ihr Weg NUR auf den
 * Entwicklungsflaechen, und dort steht er auch.
 */
export function AnmeldungNoetig() {
  return (
    <main className="mx-auto flex w-full max-w-form flex-col gap-s4 p-s6">
      <h1 className="text-h1 text-text">Anmeldung erforderlich</h1>
      <p className="text-base text-text-muted">
        Diese Seite gehört zum Portal. Beschäftigte melden sich mit ihrer
        Mobilnummer und einem Einmalcode an — ein Kennwort brauchen sie nicht.
      </p>
      <p>
        <a
          href="/auth/mitarbeiter"
          data-cse="anmeldung-mitarbeiter"
          className="inline-flex min-h-11 items-center rounded-md bg-brand px-s5 text-base
                     font-semibold text-white transition-colors duration-fast ease-brand
                     hover:bg-brand-hover"
        >
          Anmelden für Mitarbeitende
        </a>
      </p>
      <p className="text-sm text-text-subtle">
        Verwaltung, Leitung und Kunden: die Anmeldung mit E-Mail, Kennwort und
        zweiter Stufe ist noch nicht gebaut (AUT-01). Bis dahin gibt es hier
        kein Formular, das so aussähe, als würde es etwas tun.
      </p>
      {devFlaechenAn() && (
        <p className="text-base text-text">
          <a className="inline-flex min-h-11 items-center underline underline-offset-4"
             href="/dev/anmelden">
            Entwicklungsanmeldung — Konto wählen
          </a>
        </p>
      )}
      <p>
        <a href="/" className="inline-flex min-h-11 items-center text-sm text-text-muted
                               underline underline-offset-4 hover:text-text">
          Zur Website
        </a>
      </p>
    </main>
  );
}
