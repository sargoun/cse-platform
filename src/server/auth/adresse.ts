import { isIP } from 'node:net';

/**
 * Die Adresse, von der eine Anfrage kommt — für das Prüfprotokoll (SEC-A9,
 * V-163, D-657).
 *
 * **Der erste Eintrag aus `x-forwarded-for`, sonst `x-real-ip`** — und der
 * ist nur deshalb die Adresse des Geräts, weil der Proxy davor den Kopf
 * SETZT (D-661). Vercel (CLAUDE.md, Stack; EINRICHTEN) überschreibt
 * `x-forwarded-for` mit der Adresse, von der die Verbindung kam; was der
 * Browser selbst mitschickt, kommt nicht durch. Ein gewöhnlicher
 * Reverse-Proxy HÄNGT dagegen HINTEN an (nginx `$proxy_add_x_forwarded_for`):
 * dann ist der erste Eintrag der, den der Aufrufer frei gesetzt hat, und er
 * stünde als IP im Prüfprotokoll. Wer die Plattform je hinter einem eigenen
 * Proxy betreibt, lässt ihn den Kopf ERSETZEN (nginx:
 * `proxy_set_header X-Forwarded-For $remote_addr;`) — sonst gilt dasselbe
 * für jede Stelle, die den ersten Eintrag liest. Dieselbe Regel wie am
 * Einmalcode (`auth/mitarbeiter/anmeldung.ts`) und an der Freigabe
 * (`api/freigaben/[id]/entscheidung`) — eine dritte Lesart wäre eine dritte
 * Antwort auf dieselbe Frage.
 *
 * **Nur, was eine Adresse IST.** Der Kopf ist vom Aufrufer frei setzbar. Was
 * `isIP` nicht als IPv4 oder IPv6 erkennt, wird `null` — eine fehlende
 * Herkunft ist ehrlicher als eine erfundene, und ein kaputter Wert in der
 * Sitzungsbindung darf keine Schreibtransaktion zu Fall bringen. Die
 * Datenbank prüft ein zweites Mal (`app.protokolliere`, 0415).
 */
export function anfrageAdresse(kopf: { get(name: string): string | null }): string | null {
  const weitergeleitet = kopf.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
  const roh = weitergeleitet !== '' ? weitergeleitet : (kopf.get('x-real-ip')?.trim() ?? '');
  return isIP(roh) === 0 ? null : roh;
}
