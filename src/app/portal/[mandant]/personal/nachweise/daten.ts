/**
 * Der Lesepfad des Nachweisregisters liegt jetzt im DIENST.
 *
 * **Warum diese Datei nur noch verweist.** Die Abfragen standen hier, neben
 * der Seite, die sie benutzt. Der Modulkopf der Sicherheit
 * (`/portal/[mandant]/security`) braucht dieselbe Auskunft — welche
 * § 34a-Nachweise ablaufen oder abgelaufen sind — und hätte damit die
 * `daten.ts` einer anderen Seite importiert. Das ist der Weg, der beim ersten
 * Umbau der Personalseite bricht, und niemand sieht mehr, wer für die Abfrage
 * zuständig ist.
 *
 * Die Datei bleibt stehen, weil die Personalseiten sie unter diesem Namen
 * importieren; sie reicht durch, sie enthält keine zweite Fassung.
 *
 * Neuer Ort: `src/server/services/nachweis/register.ts`.
 */
export {
  lageVon, leseNachweis, leseRegister, leseWarnungen,
  type Lage, type RegisterZeile, type WarnungZeile,
} from '@/server/services/nachweis/register';
