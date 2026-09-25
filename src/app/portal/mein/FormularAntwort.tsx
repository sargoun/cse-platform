import { Hinweis } from '@/components/ui/Hinweis';
import type { PortalSprache } from '@/lib/i18n/texte';
import { formularFehlerSatz, MEIN_FORMULAR_TEXTE } from '@/lib/i18n/mein-formular';

/**
 * Was aus einem abgeschickten Formular des Arbeiterportals wurde — als Kasten
 * über dem Formular (V-198, D-692, D-599, DESIGN §5 „Notices", §8, §9).
 *
 * **Der Befund.** Mehrere Schreibwege des Portals antworteten einem
 * gewöhnlichen `<form method="post">` mit JSON: der Mensch sah eine weisse
 * Seite mit geschweiften Klammern, auf Arabisch wie auf Deutsch dieselbe
 * Sackgasse. Die Routen schicken jetzt `?fehler=<grund>` zurück auf die
 * Seite des Formulars, und dieser Kasten sagt den Satz in der Sprache der
 * Person.
 *
 * **Der Kasten ist `components/ui/Hinweis`** — DESIGN §5 verbietet, ihn aus
 * seinen Klassen nachzubauen. `groesse="base"`, weil Fliesstext im
 * Arbeiterportal nie kleiner als 16 px ist (§8, D-738); `rolle` meldet die
 * Abweisung (`alert`) bzw. die Bestätigung (`status`) einem Screenreader
 * (§9). Die ersten Worte stehen fett, damit die Farbe die Bedeutung nicht
 * allein trägt.
 */
export function FormularFehler(
  { sprache, grund }: { readonly sprache: PortalSprache; readonly grund: unknown },
) {
  const satz = formularFehlerSatz(sprache, grund);
  if (satz === null) return null;
  return (
    <Hinweis art="warnung" cse="formular-fehler" rolle="alert" groesse="base"
             className="mb-s5 max-w-prose">
      <strong>{MEIN_FORMULAR_TEXTE[sprache].titel}</strong>{' '}
      {satz}
    </Hinweis>
  );
}

/** Die Bestätigung nach einem Einwand — eingegangen, nicht entschieden (EMP-07). */
export function EinwandGesendet({ sprache }: { readonly sprache: PortalSprache }) {
  const t = MEIN_FORMULAR_TEXTE[sprache];
  return (
    <Hinweis art="erfolg" cse="einwand-gesendet" rolle="status" groesse="base"
             className="mb-s5 max-w-prose">
      <strong>{t.einwandGesendetTitel}</strong>{' '}
      {t.einwandGesendet}
    </Hinweis>
  );
}
