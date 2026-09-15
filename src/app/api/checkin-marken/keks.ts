import { keksSicher } from '@/server/auth/sitzung';

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
 * kein Speicher, sondern eine Übergabe: die Seite liest ihn, zeigt den Link
 * und löscht ihn im selben Atemzug.
 *
 * `secure` kommt aus `keksSicher()` und nicht aus einer eigenen Regel — auf
 * einer Vorführfläche über `http://192.168…` nähme der Browser einen
 * `Secure`-Keks sonst gar nicht erst an (D-541).
 */
export const MARKE_KEKS = 'cse_checkin_marke';

/** So lange darf die Übergabe offen stehen. */
export const MARKE_GUELTIG_MINUTEN = 10;

export function markeKeksOptionen(): {
  httpOnly: true; sameSite: 'lax'; path: string; maxAge: number; secure: boolean;
} {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/portal',
    maxAge: MARKE_GUELTIG_MINUTEN * 60,
    secure: keksSicher(),
  };
}
