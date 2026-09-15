import type { ReactNode } from 'react';

/**
 * Eine Zelle, die zugibt, dass sie NICHTS weiss (TEN-05).
 *
 * **Eine Null und ein fehlendes Recht sehen gleich aus, und das ist die
 * gefährlichere Hälfte.** In der Gruppenansicht filtert die Policy je Zeile
 * mit dem Recht des jeweiligen Bereichs. Wer `gruppe.finanzen.lesen` in einer
 * Gesellschaft nicht hält, bekommt von `sum(...)` dort NULL und von
 * `count(*)` eine 0 — und eine Zeile mit „0,00 €" liest sich als „diese
 * Gesellschaft hat nichts fakturiert". Das ist keine Lücke in der Anzeige,
 * sondern eine falsche Aussage über ein anderes Unternehmen.
 *
 * Die Gruppenübersicht macht es seit jeher richtig (`gruppe/uebersicht.ts`:
 * Recht vor der Zählung, sonst `null`). Die sechs Berichte tun es jetzt auch.
 */
export function NichtLesbar() {
  return (
    <span className="text-text-subtle" title="Für diese Gesellschaft nicht freigegeben">
      —
    </span>
  );
}

/** `inhalt`, wenn die Zeile lesbar ist — sonst der Strich. */
export function nurLesbar(
  zeile: { readonly lesbar: boolean }, inhalt: ReactNode,
): ReactNode {
  return zeile.lesbar ? inhalt : <NichtLesbar />;
}
