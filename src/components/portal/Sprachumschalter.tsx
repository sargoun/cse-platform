import { INTERN_EIGENNAME, INTERN_SPRACHEN, internSprachwahl } from '@/lib/i18n/intern';
import { gemerkteHuelle } from '@/app/portal/huellen-speicher';

/**
 * Der Sprachumschalter der internen Kopfzeile — auf jeder Seite (D-592).
 *
 * **Ein Formular, kein Skript.** Die Wahl aendert einen Zustand in der
 * Datenbank; sie gehoert deshalb in ein `POST`, nicht in einen Verweis, den
 * ein Vorablader einer Suchmaschine mitnimmt. Und weil es ein gewoehnliches
 * `<form>` ist, funktioniert es auch dort, wo kein JavaScript laeuft — das
 * war fuer das Diensttelefon schon die Begruendung von `/api/konto/sprache`,
 * und die gilt hier weiter.
 *
 * **Der Rueckweg kommt aus dem Anfragespeicher, nicht aus dem Browser.** Die
 * Route prueft ihn ohnehin gegen `internesZiel`, aber ein Feld, das die Seite
 * selbst fuellt, kann gar nicht erst eine fremde Adresse tragen.
 *
 * **Die aktive Sprache ist ein deaktivierter Knopf, kein fehlender.** Wer
 * „Deutsch" nicht sieht, weiss nicht, ob er Deutsch hat; wer ihn grau und
 * unklickbar sieht, weiss es. `aria-current` sagt dasselbe der Vorlesesoftware.
 */
export function Sprachumschalter({ label }: { readonly label: string }) {
  const stand = gemerkteHuelle();
  const { aktiv, fremdeWahl } = internSprachwahl(stand.sprache);

  return (
    <form
      method="post"
      action="/api/konto/sprache"
      aria-label={label}
      data-cse="sprachumschalter"
      className="flex items-center gap-s2"
    >
      {stand.pfad !== null && <input type="hidden" name="zurueck" value={stand.pfad} />}
      {INTERN_SPRACHEN.map((s) => (
        <button
          key={s}
          type="submit"
          name="sprache"
          value={s}
          disabled={s === aktiv && fremdeWahl === null}
          aria-current={s === aktiv ? 'true' : undefined}
          /*
           * Dieselben Klassen wie die Sitzungspunkte daneben (DESIGN §6):
           * `min-h-11` fuer die Trefferflaeche, `text-sm`, gedaempft bis zum
           * Hover. Die aktive Sprache steht in der vollen Textfarbe — das ist
           * der einzige Unterschied, und er ist derselbe wie beim aktiven Tab.
           */
          className={`flex min-h-11 items-center text-sm ${
            s === aktiv && fremdeWahl === null
              ? 'cursor-default text-text'
              : 'cursor-pointer text-text-muted hover:text-text'
          }`}
        >
          {INTERN_EIGENNAME[s]}
        </button>
      ))}
    </form>
  );
}
