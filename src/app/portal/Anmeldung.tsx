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
 * **Beide Eingaenge stehen jetzt hier.** `/auth/mitarbeiter` fuer Beschaeftigte
 * (Mobilnummer und Einmalcode, EMP-01), `/auth/login` fuer Verwaltung, Leitung
 * und Kunden (E-Mail, Kennwort, zweiter Faktor — AUT-01, AUT-02). Bis PR 77 gab
 * es den zweiten nicht, und dieser Absatz sagte, er werde noch gebaut; wer
 * aus einem gespeicherten Portallink als Verwaltung hierher kam, las also,
 * dass es fuer ihn keinen Weg gebe.
 */
export function AnmeldungNoetig({ keksAbgelehnt = false }: { readonly keksAbgelehnt?: boolean } = {}) {
  return (
    <main className="mx-auto flex w-full max-w-form flex-col gap-s4 p-s6">
      <h1 className="text-h1 text-text">Anmeldung erforderlich</h1>
      {/*
        * **Der eine Fall, der sonst wie ein Fehlschlag aussieht** (D-488).
        *
        * Wer gerade den richtigen Code eingegeben hat und TROTZDEM hier
        * landet, hat sich angemeldet — sein Browser hat den Sitzungskeks nur
        * nicht angenommen. Ueber `http://` lehnt jeder Browser einen
        * `__Host-`-Keks ab (er verlangt eine sichere Verbindung), und am
        * Telefon im WLAN ist genau das die uebliche Adresse. Ohne diesen Satz
        * probiert die Mitarbeiterin denselben Weg noch dreimal.
        */}
      {keksAbgelehnt && (
        <p
          data-cse="keks-abgelehnt"
          className="rounded-md border border-warning bg-warning-soft p-s4 text-sm text-warning"
        >
          <strong>Die Anmeldung hat geklappt — der Browser hat die Sitzung nicht behalten.</strong>{' '}
          Das passiert über eine unverschlüsselte Adresse: der Sitzungskeks verlangt{' '}
          <span className="font-mono">https://</span>. Rufen Sie die Plattform über ihre
          https-Adresse auf und melden Sie sich erneut an. Sind Cookies im Browser abgeschaltet,
          schalten Sie sie für diese Adresse ein.
        </p>
      )}
      <p className="text-base text-text-muted">
        Diese Seite gehört zum Portal. Wählen Sie den Eingang, der zu Ihrem
        Zugang gehört.
      </p>
      <p>
        <a
          href="/auth/login"
          data-cse="anmeldung-login"
          className="inline-flex min-h-11 items-center rounded-md bg-brand px-s5 text-base
                     font-semibold text-white transition-colors duration-fast ease-brand
                     hover:bg-brand-hover"
        >
          Anmelden mit E-Mail und Kennwort
        </a>
      </p>
      <p className="text-sm text-text-subtle">
        Verwaltung, Leitung, Buchhaltung und Kundenzugänge. Rollen mit Zugriff
        auf Lohn-, Zeit- und Finanzdaten zeigen zusätzlich einen zweiten Faktor
        vor (AUT-02).
      </p>
      <p>
        <a
          href="/auth/mitarbeiter"
          data-cse="anmeldung-mitarbeiter"
          className="inline-flex min-h-11 items-center rounded-md border border-line px-s5
                     text-base font-semibold text-text transition-colors duration-fast
                     ease-brand hover:border-line-strong"
        >
          Anmelden für Mitarbeitende
        </a>
      </p>
      <p className="text-sm text-text-subtle">
        Beschäftigte im Einsatz melden sich mit ihrer Mobilnummer und einem
        Einmalcode an — ein Kennwort brauchen sie nicht.
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
