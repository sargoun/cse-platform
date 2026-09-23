'use client';

import { useEffect, useRef } from 'react';

/**
 * Die GERÄTEZEIT — die Behauptung des Telefons, im Augenblick des Absendens
 * (V-060, TIM-08, Invariante 5).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Vier Formulare trugen ein verstecktes `geraete_zeit` — die Stempeluhr, das
 * Wachbuch, die Qualitätsprüfung und die Unterschrift unter dem
 * Leistungsnachweis — und **keines füllte es**. Sechs Routen nehmen den Wert
 * entgegen, die Datenbank leitet `zeitabweichung_sek` daraus ab, und jede
 * Anzeige der Abweichung stand seit je auf „—". Nicht, weil die Uhren
 * stimmten: weil nie eine zweite Uhr gefragt wurde.
 *
 * Das kostet genau dann etwas, wenn es darauf ankommt. Ein Telefon, das eine
 * Stunde nachgeht, erzeugt eine Schicht, die um eine Stunde verschoben
 * behauptet wird — und die Abweichung ist der einzige Hinweis darauf. Ohne
 * sie sieht der Eintrag sauber aus.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Was dieser Baustein NICHT tut.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Er entscheidet nichts. `erfasst_am` stempelt die Datenbank mit `now()`
 * (Invariante 5); die Gerätezeit steht DANEBEN und ist eine Behauptung, die
 * dokumentiert wird. Ein Gerät, das falsch geht, verschiebt damit keine
 * Minute — es hinterlässt eine Zahl, die jemand ansehen kann.
 *
 * **Ohne JavaScript bleibt das Feld leer, und das ist richtig so.** Dann hat
 * niemand etwas behauptet, und die Erfassung gilt trotzdem: sie darf nicht
 * daran hängen, dass ein Skript geladen hat. Diensttelefone am Objekt sind
 * alt und ihre Verbindung schlecht.
 *
 * **Gesetzt wird beim ABSENDEN, nicht beim Laden.** Ein Wert, der beim
 * Rendern entsteht, ist die Zeit, zu der die Seite geöffnet wurde — bei einem
 * Wachbucheintrag, den jemand in Ruhe tippt, sind das zwanzig Minuten
 * Unterschied, und die Abweichung wiese auf ein Gerät, das gar nicht falsch
 * geht.
 */
export function Geraetezeit({ name = 'geraete_zeit', marke = 'geraete-zeit' }: {
  readonly name?: string;
  readonly marke?: string;
}) {
  const feld = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const eingabe = feld.current;
    const formular = eingabe?.form ?? null;
    if (eingabe === null || formular === null) return undefined;
    const setze = (): void => { eingabe.value = new Date().toISOString(); };
    /*
     * `submit` und nicht `click`: ein Formular lässt sich auch mit der
     * Eingabetaste abschicken, und ein Knopf ist nicht der einzige Weg
     * hinaus.
     */
    formular.addEventListener('submit', setze);
    return () => { formular.removeEventListener('submit', setze); };
  }, []);

  return (
    <input ref={feld} type="hidden" name={name} defaultValue="" data-cse={marke} />
  );
}
