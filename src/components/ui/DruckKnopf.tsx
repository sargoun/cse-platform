'use client';

/**
 * Der Knopf, der das Blatt druckt (V-055, EMP-03, § 17 MiLoG).
 *
 * **Der Befund: „Drucken" stand als WORT da.** Die Kopfzeile des
 * Monatsnachweises schrieb „Monatsnachweis · Drucken" — eine Anleitung ohne
 * Bedienelement. Auf einem Telefon gibt es kein Datei-Menü; wer das Blatt für
 * die Lohnstelle oder das Gericht auf Papier braucht, fand hier nichts.
 *
 * **Warum das die einzige Client-Insel dieser Seite ist.** `window.print()`
 * gibt es nur im Browser. Alles andere — die Aufzeichnung, die Summen, die
 * Prüfsumme — entsteht auf dem Server und bleibt dort; diese Datei trägt
 * genau einen Klick und keine Zahl.
 *
 * `cse-nicht-drucken` nimmt ihn vom Papier: ein Knopf im Ausdruck wäre ein
 * Bedienelement auf einem Beweisstück.
 *
 * **Geteilt, seit es ein zweites Blatt gibt** (V-227, D-721): das Druckblatt
 * der Berichte trägt denselben Knopf. Er lag vorher neben dem Monatsnachweis;
 * eine Kopie im Berichtsblatt wäre ein zweites Bauteil für denselben Klick.
 * `cse` benennt ihn für die Browserprüfung des jeweiligen Blatts.
 */
export function DruckKnopf({ text, cse = 'nachweis-drucken' }: {
  readonly text: string;
  readonly cse?: string;
}) {
  return (
    <button
      type="button"
      data-cse={cse}
      onClick={() => { globalThis.print(); }}
      className="cse-nicht-drucken inline-flex min-h-11 items-center rounded-md border
                 border-line-strong px-s4 text-base text-text hover:bg-surface-2"
    >
      {text}
    </button>
  );
}
