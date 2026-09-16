/**
 * Die Koepfe, die `middleware.ts` setzt und Layouts lesen.
 *
 * Sie stehen in einer eigenen Datei, weil `middleware.ts` in der Edge-Laufzeit
 * laeuft: wer die Namen von dort importierte, zoege die halbe Middleware in
 * jedes Layout. Zwei Zeichenketten an einer Stelle sind billiger als zwei
 * Zeichenketten an zwei Stellen, von denen eine irgendwann anders lautet.
 */
export const KOPF_SPRACHE = 'x-cse-sprache';
export const KOPF_PFAD = 'x-cse-pfad';

/**
 * Die frisch ausgegebene Check-in-Marke, von der Middleware an die Seite
 * gereicht (TIM-09, D-579).
 *
 * **Warum nicht einfach der Keks.** Die Seite darf ihn nicht loeschen — eine
 * Server-Komponente aendert in Next 15 keine Kekse, sie wirft dabei. Loescht
 * ihn dagegen die Middleware, sieht die Seite ihn gar nicht mehr: Next fuehrt
 * die Keksschublade der Antwort auch nach unten durch, und `cookies()` gibt
 * dann nichts zurueck. Beides zusammen hiesse: entweder faellt die Seite um,
 * oder die Marke bleibt liegen.
 *
 * Der Kopf loest genau das. Die Middleware liest den Keks EINMAL, reicht den
 * Wert hier weiter und raeumt den Keks auf derselben Antwort ab. Die Seite
 * bekommt ihn also, und das naechste Laden nicht mehr — was der Keks immer
 * versprochen hat.
 *
 * Ein Kopf auf der ANFRAGE verlaesst den Server nicht; er steht in keiner
 * Auslieferung, keinem Protokoll eines Vermittlers und keinem `Referer`.
 */
export const KOPF_CHECKIN_MARKE = 'x-cse-checkin-marke';
