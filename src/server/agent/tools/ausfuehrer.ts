import 'server-only';
import { WERKZEUG_REGISTER, type WerkzeugName } from './register-werkzeuge.js';
import type { WerkzeugErgebnis } from './typen.js';

/**
 * Welche der neun Werkzeuge einen AUSFÜHRER haben — und was die übrigen
 * sieben ehrlich antworten (AGT-02, D-435, V-228, D-722).
 *
 * **Der Befund** (Audit Befund 57): das Register versprach im Kommentar, die
 * sieben Modellwerkzeuge gäben `kein_modellzugang` zurück. Gebaut war das
 * nirgends — der Code stand nur als Typliteral da. Die Agentenseite zeigte die
 * sieben trotzdem wie die zwei, die tatsächlich laufen.
 *
 * **Zwei haben einen Ausführer**, beide ohne Modell: `suche_bestand`
 * (`tools/suche-bestand.ts`, der geprüfte Katalog) und `berechne_preis`
 * (`tools/berechne-preis.ts`, die getestete Kalkulation). Für die übrigen
 * sieben gibt es keinen Code, der sie ausführt, und keinen freigegebenen
 * Anbieter, der formulieren, lesen oder sichten könnte. `ohneAusfuehrer`
 * antwortet für sie mit `kein_modellzugang` — ein Ergebnis, das nichts
 * enthält, statt eines, das echt aussähe (CLAUDE.md „No fake integrations").
 *
 * **Die Menge folgt aus dem Register, nicht aus einer zweiten Liste**: genau
 * die Werkzeuge mit `ohneModell` haben einen Ausführer. Kommt ein Ausführer
 * für ein Modellwerkzeug dazu, ändert sich diese Zeile — und der Test
 * `tests/kern/agent-werkzeug-pflege.test.ts` sagt, welche.
 */
export const MIT_AUSFUEHRER: ReadonlySet<WerkzeugName> = new Set(
  (Object.values(WERKZEUG_REGISTER)).filter((w) => w.ohneModell).map((w) => w.name),
);

export function hatAusfuehrer(werkzeug: WerkzeugName): boolean {
  return MIT_AUSFUEHRER.has(werkzeug);
}

/**
 * Die ehrliche Antwort eines Werkzeugs ohne Ausführer. Sie trägt keine Daten
 * und keine gebundenen Werte — es gibt nichts, woraus sie entstehen könnten.
 */
export function ohneAusfuehrer(werkzeug: WerkzeugName): WerkzeugErgebnis<never> {
  return {
    ok: false,
    fehler: {
      code: 'kein_modellzugang',
      nachricht: `Das Werkzeug „${werkzeug}" braucht einen Modellanbieter mit EU-Verarbeitung `
        + 'und Nullspeicherung, und einen Ausführer dafür gibt es noch nicht (D-435). '
        + 'Es liefert deshalb kein Ergebnis, statt eines zu erfinden.',
    },
  };
}
