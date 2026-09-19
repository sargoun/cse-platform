import {
  INTERN_EIGENNAME, INTERN_SPRACHEN, internSprachwahl, sprachHinweis,
} from '@/lib/i18n/intern';
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
export function Sprachumschalter(
  { label, ort }: { readonly label: string; readonly ort: 'kopfzeile' | 'blatt' },
) {
  const stand = gemerkteHuelle();
  const { aktiv, fremdeWahl } = internSprachwahl(stand.sprache);

  return (
    <form
      method="post"
      action="/api/konto/sprache"
      aria-label={label}
      data-cse="sprachumschalter"
      /*
       * **Wo dieser Umschalter steht, gehoert ins Markup.** Beide Fassungen —
       * die der Kopfzeile und die des „Mehr"-Blatts — stehen gleichzeitig im
       * Dokument; sichtbar ist je nach Breite nur eine. Ohne Unterscheidung
       * traefe jede Pruefung zwei Elemente und muesste sich ueber die
       * Vorfahren behelfen.
       */
      data-ort={ort}
      /*
       * `flex-wrap`: im geschlossenen „Mehr"-Blatt ist der Kasten 17px breit —
       * Chromium legt den Inhalt eines zugeklappten `<details>` trotzdem aus.
       * Zwei Knoepfe, die nicht schrumpfen, stehen dann bis x=465 in einem
       * Kasten, der bei 390 endet. Sie werden zwar vom `overflow-x` des
       * Blattes beschnitten und schieben die Seite nicht hinaus — aber ein
       * Kasten, der aus seinem Kasten haengt, ist kein Zustand, auf den man
       * sich verlassen will, und der Massenlauf zaehlt ihn zu Recht auf.
       */
      className="flex flex-wrap items-center gap-s2"
      {...(fremdeWahl === null ? {} : { title: sprachHinweis(stand.sprache, fremdeWahl) })}
    >
      {stand.pfad !== null && <input type="hidden" name="zurueck" value={stand.pfad} />}
      {/*
        * **Wessen Wahl hier ueberschrieben wuerde, muss dastehen.** Die Spalte
        * `sprache` ist EINE fuer beide Portale: wer als Arbeiterin Arabisch
        * gewaehlt hat, ersetzt sie mit einem Klick hier. Ein Bildschirm, der
        * das still tut, ist schlimmer als einer, der die Wahl gar nicht
        * anboete.
        *
        * `sr-only` und `title`: sichtbar ist der Umschalter eine Zeile in
        * einer engen Kopfzeile — dort ist fuer zwei Saetze kein Platz (DESIGN
        * §6). Der Screenreader liest sie, die Maus findet sie, und der Platz
        * bleibt, wie er ist.
        */}
      {fremdeWahl !== null && (
        <span className="sr-only" data-cse="sprache-fremd">
          {sprachHinweis(stand.sprache, fremdeWahl)}
        </span>
      )}
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
