import 'server-only';
import { notFound } from 'next/navigation';

/**
 * Ein Wegsegment, das eine Kennung sein soll — und die Antwort, wenn es keine
 * ist.
 *
 * **Der Befund, der diese Datei gebracht hat.** Ein Rundgang durch jede
 * Portaladresse fand sieben Seiten, die mit **500** antworteten. Fünf davon
 * hatten dieselbe Ursache: `/portal/<bereich>/crm/leads/neu`,
 * `…/crm/kunden/neu`, `…/angebote/neu`, `…/objekte/neu`,
 * `…/reinigung/reviere/neu`. Die Seitenkarte führt jede dieser Adressen, aber
 * gebaut ist keine — also greift Next.js die Nachbarroute `[id]`, und die
 * reicht `"neu"` unverändert in ein `$1::uuid`. Postgres antwortet
 * `invalid input syntax for type uuid`, die Anwendung mit 500 und dem
 * Bildschirm „Da ist etwas schiefgegangen."
 *
 * Nachgezählt trugen **44 dynamische Seiten** diese Lücke. Jeder Tippfehler in
 * einer Adresse, jeder alte Verweis, jede Kennung aus einer anderen Datenbank
 * ergab dort einen Serverfehler statt eines 404 — und ein 500 ist die
 * schlechteste aller Antworten: er sagt „mein Fehler", wo „gibt es nicht" die
 * Wahrheit ist, und er landet im Fehlerprotokoll, das dadurch unlesbar wird.
 *
 * **404 und nicht 400.** Nach aussen ist eine unlesbare Kennung dasselbe wie
 * eine, die es nicht gibt (AUT-06). Ein eigener Fehlercode für „das war keine
 * UUID" verriete, dass die Anwendung Kennungen in diesem Format führt, und
 * hülfe nur dem, der rät.
 *
 * **Nur für UUID-Segmente.** `[datum]` im Bautagebuch trägt ein Datum,
 * `[agent]` einen Schlüssel, `[mandant]` einen Slug. Die prüfen ihre eigene
 * Form — diese Datei ist für die Kennungen.
 */
const MUSTER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function istKennung(wert: string | undefined): wert is string {
  return wert !== undefined && MUSTER.test(wert);
}

/**
 * Gibt die Kennung zurück — oder beendet die Seite mit 404.
 *
 * Als Ausdruck geschrieben, damit sie direkt hinter `await params` steht und
 * nicht irgendwo zwischen den Abfragen: was einmal in eine Abfrage gelangt
 * ist, ist zu spät geprüft.
 */
export function kennungOder404(wert: string | undefined): string {
  if (!istKennung(wert)) notFound();
  return wert;
}
