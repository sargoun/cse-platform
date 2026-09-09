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
