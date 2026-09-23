import { isIP } from 'node:net';

/**
 * Die Adresse, von der eine Anfrage kommt — für das Prüfprotokoll (SEC-A9,
 * V-163, D-657).
 *
 * **Der erste Eintrag aus `x-forwarded-for`, sonst `x-real-ip`.** Vor der
 * Anwendung steht ein Proxy (Vercel, im Betrieb ein Reverse-Proxy); er hängt
 * die Adresse des Geräts VORN an. Dieselbe Regel wie am Einmalcode
 * (`auth/mitarbeiter/anmeldung.ts`) und an der Freigabe
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
