import { keksSicher } from '@/server/auth/sitzung';
import { MARKE_GUELTIG_MINUTEN, MARKE_KEKS_PFAD } from '@/lib/checkin-marke';

/**
 * Der kurzlebige Keks, in dem eine frisch ausgegebene Marke EINMAL reist.
 *
 * **Warum ein Keks und nicht die Adresszeile.** `app.checkin_ausgeben` gibt
 * die Marke genau einmal im Klartext zurück; gespeichert wird nur ihr
 * SHA-256. Wer sie nicht ausliefert, hat sie verloren — und das ist die
 * richtige Richtung. Sie in die Weiterleitung zu hängen hiesse: im Verlauf,
 * im `Referer` und im Zugriffsprotokoll jedes Vermittlers dazwischen. Für
 * eine Telefonnummer wurde derselbe Weg schon abgelehnt
 * (`auth/mitarbeiter/anmeldung.ts`); eine Zugangsmarke ist mehr als das.
 *
 * **Zehn Minuten, und der Pfad reicht genau einen Bildschirm weit.** Er ist
 * kein Speicher, sondern eine Übergabe: die Seite liest ihn und zeigt den
 * Link, und die **Middleware** nimmt ihn auf derselben Antwort wieder weg.
 *
 * Hier stand einmal „die Seite … löscht ihn im selben Atemzug", und die Seite
 * tat das auch — mit `keks.delete()` mitten im Rendern einer
 * Server-Komponente. Next 15 verbietet das, und die Seite warf: wer eine Marke
 * ausgab, bekam die Fehlerhülle und die Marke war WEG (sie kommt genau einmal
 * im Klartext). Nie aufgefallen, weil der Keks nur dasteht, wenn unmittelbar
 * davor jemand den Knopf gedrückt hat — und das tat kein Test (D-579).
 *
 * `secure` kommt aus `keksSicher()` und nicht aus einer eigenen Regel — auf
 * einer Vorführfläche über `http://192.168…` nähme der Browser einen
 * `Secure`-Keks sonst gar nicht erst an (D-541).
 */
export { MARKE_GUELTIG_MINUTEN, MARKE_KEKS } from '@/lib/checkin-marke';

export function markeKeksOptionen(): {
  httpOnly: true; sameSite: 'lax'; path: string; maxAge: number; secure: boolean;
} {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: MARKE_KEKS_PFAD,
    maxAge: MARKE_GUELTIG_MINUTEN * 60,
    secure: keksSicher(),
  };
}
